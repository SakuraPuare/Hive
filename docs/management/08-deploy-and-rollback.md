# 发布与回滚

本文描述 Hive 管理平面的发布和回滚。仓库根目录执行这些脚本：

| 脚本 | 作用 |
| --- | --- |
| `management/scripts/deploy.sh` | 拉取代码、备份、编译、替换二进制和前端、健康检查、重载 Prometheus |
| `management/scripts/rollback.sh` | 把二进制和前端恢复到 `backups/deploy/<TIMESTAMP>/` |
| `management/scripts/backup-db.sh` | 备份 MySQL |
| `management/scripts/restore-db.sh` | 从 `.sql.gz` 恢复 MySQL |

`deploy.sh` 和 `rollback.sh` 在存在仓库根 `.env` 时会 source 它。`backup-db.sh` 和 `restore-db.sh` 不读文件，只读当前环境里的变量。

---

## 一、发布前检查清单

- [ ] `main` 上 Registry CI 通过。`.github/workflows/registry-cicd.yml` 的 `ci-go` 包含 `gofmt`、`go vet`、Go 测试、设备和管理脚本回归、amd64/arm64 构建以及 OpenAPI 生成；`ci-frontend` 依赖 `ci-go`，再做类型检查、测试和 `npm run build`
- [ ] 要发布的功能已在本地验证
- [ ] 数据库变更已追加到 `management/registry/internal/store/migration.go` 的 `Migrations` 末尾（见第四节）
- [ ] 新增环境变量已写进 VPS 上的 `.env`。`deploy.sh` 只为自己的备份和健康检查 source 这份文件，不会改写 `/etc/hive-registry.env`。`hive-registry` 读的是这份 systemd `EnvironmentFile`。`setup-vps.sh` 只会把脚本里列出的项写进去（含 `LISTEN_ADDR`、`MYSQL_*`、`ADMIN_*`）。服务要识别的新变量必须出现在该文件里，然后重启 `hive-registry`
- [ ] 没有另一份发布正在进行

这些 CI job 都要求 `github.server_url == 'https://github.com'`。同名工作流里的 `deploy` job 只上传 `hive-registry-amd64` 和 `hive-registry-arm64` 产物，不会登录 VPS。

### Actions 检查与产物交接

`gofmt check` 失败会停掉 `ci-go` 里后续步骤，前端 job 也不会开始。Go 改动提交前用 `gofmt -l .` 确认没有输出。

文档工作流 `.github/workflows/deploy-docs.yml` 按 [actions/deploy-pages 的用法](https://github.com/actions/deploy-pages#usage) 把 GitHub Pages 拆成两个 job：`build-github` 构建并上传产物，`deploy-github` 通过 `needs` 等待后再部署。`deploy-pages` 若在上传刚结束时列举产物，可能碰到[列表可见性延迟](https://github.com/actions/deploy-pages/issues/451)，表现为上传成功但暂时找不到 `github-pages` 产物。拆开 job 能降低这个竞态，不能保证 GitHub 侧不再出现延迟。Cloudflare Pages 走独立的 `deploy-cloudflare` job，直接 `wrangler pages deploy`，不使用这条产物链。

---

## 二、标准发布

### 自动发布（推荐）

克隆路径与 `management/setup-vps.sh` 的说明一致时：

```bash
ssh root@<VPS-IP>
cd /opt/hive
bash management/scripts/deploy.sh
```

脚本会：

1. 确认本机有 `go` 和 `npm`
2. `git pull --ff-only`
3. 把已安装的 `/usr/local/bin/hive-registry` 和 `/var/www/hive-ui` 复制到 `backups/deploy/<TIMESTAMP>/`。时间戳来自 `date +%Y%m%d_%H%M%S`，是 VPS 本地时间。二进制或前端目录不存在就跳过对应项
4. 运行 `backup-db.sh`。失败则立刻退出，此时还没有替换二进制或前端
5. 按 `uname -m` 编译后端：`x86_64` 用 `amd64`，`aarch64` 用 `arm64`，其他架构用 `amd64`。命令是 `CGO_ENABLED=0 GOOS=linux GOARCH=<arch> go build -ldflags="-s -w" -o hive-registry .`，不执行 `go mod tidy`
6. 在 `management/registry-ui` 执行 `npm ci --prefer-offline` 和 `npm run build`
7. 用 `mktemp` 加 `mv -f` 把新二进制换到 `/usr/local/bin/hive-registry`（`chmod 0755`），然后 `systemctl restart hive-registry`
8. 把 `management/registry-ui/out/` 同步到 `/var/www/hive-ui.new/`，交换目录后删除旧目录，再 `systemctl reload nginx`
9. 先等 2 秒，再请求 `http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health`，最多 5 次，每次间隔 2 秒。服务实际监听的是 `/etc/hive-registry.env` 里的 `LISTEN_ADDR`（`setup-vps.sh` 由 `REGISTRY_LISTEN_ADDR` 写入，默认 `127.0.0.1:8080`）
10. 在 `management/` 执行 `docker compose up -d --remove-orphans`，然后 `POST http://127.0.0.1:4230/-/reload`。这次 curl 失败不会让发布失败
11. 删掉 `backups/deploy/20*` 里除最近 5 个以外的目录

健康检查失败时，脚本打印 `bash management/scripts/rollback.sh <TIMESTAMP>` 并退出，不会自己回滚。打印出来的时间戳是第 3 步留下的备份，也就是替换前的二进制和前端。第 10、11 步不会执行。

`management/registry/Makefile` 的 `make build` 会先 `go mod tidy`，且默认 `GOARCH=amd64`。`make build-arm64` 的产物名是 `hive-registry-arm64`。发布脚本不调用这两个目标。

### 手动发布

需要逐步执行时，在 `/opt/hive` 按同一顺序做。下面省略了脚本里的 5 次健康检查重试，也省略了旧发布备份的清理。数据库备份失败时不要继续替换文件。

```bash
cd /opt/hive
set -euo pipefail
if [ -f .env ]; then set -a; . ./.env; set +a; fi
git pull --ff-only

TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "backups/deploy/${TS}"
[ -f /usr/local/bin/hive-registry ] && cp /usr/local/bin/hive-registry "backups/deploy/${TS}/hive-registry"
[ -d /var/www/hive-ui ] && cp -a /var/www/hive-ui "backups/deploy/${TS}/hive-ui"
bash management/scripts/backup-db.sh

cd management/registry
case "$(uname -m)" in
    x86_64)  GOARCH=amd64 ;;
    aarch64) GOARCH=arm64 ;;
    *)       GOARCH=amd64 ;;
esac
CGO_ENABLED=0 GOOS=linux GOARCH="${GOARCH}" go build -ldflags="-s -w" -o hive-registry .

cd ../registry-ui
npm ci --prefer-offline && npm run build

registry_tmp=$(mktemp /usr/local/bin/hive-registry.XXXXXX)
cp ../registry/hive-registry "${registry_tmp}"
chmod 0755 "${registry_tmp}"
mv -f "${registry_tmp}" /usr/local/bin/hive-registry
systemctl restart hive-registry

mkdir -p /var/www/hive-ui
rsync -a --delete out/ /var/www/hive-ui.new/
[ -d /var/www/hive-ui ] && mv /var/www/hive-ui /var/www/hive-ui.old
mv /var/www/hive-ui.new /var/www/hive-ui
rm -rf /var/www/hive-ui.old
systemctl reload nginx

curl -sf "http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health"

cd ..
docker compose up -d --remove-orphans
curl -sf -X POST http://127.0.0.1:4230/-/reload || true
```

---

## 三、回滚

### 二进制与前端

```bash
# 无参数：backups/deploy/20* 按名字倒序后的第一个（时间戳最新）
bash management/scripts/rollback.sh

# 指定发布开始时留下的时间戳
bash management/scripts/rollback.sh 20260326_143000
```

在仓库根目录查看：

```bash
ls -1d backups/deploy/20*
```

目录不存在时脚本会列出这些备份并退出。存在的 `hive-registry` 会原子替换后 `systemctl restart hive-registry`；存在的 `hive-ui` 目录会换回 `/var/www/hive-ui` 后 `systemctl reload nginx`。缺某一项就跳过并打印说明。随后做与发布相同的 5 次健康检查。健康检查失败时脚本退出，提示需要人工处理。

`rollback.sh` 不恢复数据库。

### 回滚脚本没有完成时

```bash
# 在仓库根目录执行；TS 换成 backups/deploy/ 下的目录名
cd /opt/hive
TS=20260326_143000
registry_tmp=$(mktemp /usr/local/bin/hive-registry.XXXXXX)
cp "backups/deploy/${TS}/hive-registry" "${registry_tmp}"
chmod 0755 "${registry_tmp}"
mv -f "${registry_tmp}" /usr/local/bin/hive-registry
systemctl restart hive-registry

mv /var/www/hive-ui /var/www/hive-ui.rollback-tmp
cp -a "backups/deploy/${TS}/hive-ui" /var/www/hive-ui
rm -rf /var/www/hive-ui.rollback-tmp
systemctl reload nginx

curl -sf "http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health"
```

### 数据库

发布备份目录里没有 SQL。`backup-db.sh` 默认写到 `/var/backups/hive-db/`，文件名是 `${MYSQL_DB}_YYYYMMDD_HHMMSS.sql.gz`，时间戳来自 `date -u`（UTC）。用户、库名和目录的默认值是 `hive`、`hive_registry`、`/var/backups/hive-db`；已设置的 `MYSQL_*` 优先，否则用 `REGISTRY_MYSQL_*`。

```bash
ls -lh /var/backups/hive-db/

cd /opt/hive
set -a; . ./.env; set +a
bash management/scripts/backup-db.sh
systemctl stop hive-registry
bash management/scripts/restore-db.sh \
  /var/backups/hive-db/hive_registry_YYYYMMDD_HHMMSS.sql.gz
systemctl start hive-registry
curl -sf "http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health"
```

`restore-db.sh` 要求输入 `yes`。它先检查 gzip，把数据导入临时库，并确认其中有 `schema_migrations`、`users`、`nodes`、`customers` 这四张表，然后才 `DROP` 并重建目标库。校验失败时目标库不变。导入目标库失败时，脚本会说明目标库可能不完整，备份本身已通过校验，可以在修好存储后再执行。恢复会清掉目标库里的现有数据。

`rollback.sh` 结束时还会打印一行 `gunzip | mysql`。那一行没有上面的校验。恢复数据库用 `restore-db.sh`。

更展开的备份和恢复说明见 [数据库迁移、备份与恢复](./08-db-migration-backup.md)。

---

## 四、数据库迁移

进程启动时 `management/registry/main.go` 调用 `store.RunMigrations`。迁移写在 `management/registry/internal/store/migration.go` 的 `Migrations` 里，按 `version` 递增，只有 `up`。已经记在 `schema_migrations`（`version`、`description`、`applied_at`）里的版本会跳过。某条语句失败时进程退出，且不会记下该 `version`；MySQL 错误 1091（删除不存在的索引或列）会被忽略并继续。代码要求不要改已经发布的条目，因为已应用的版本不会重跑。

发布时：

1. 新表或新字段：在列表末尾追加更大的 `version`。`deploy.sh` 重启服务后会执行尚未记录的迁移
2. 删字段或删表：先发布不再依赖它的程序，稳定后再追加一条迁移做删除。回滚二进制不会撤销已经执行的 SQL
3. 迁移执行到一半失败时，用上一节从本次发布前的数据库备份恢复
4. `up` 里可以用分号分隔多条 SQL

查看已应用版本（默认账号和库名）：

```bash
mysql -u hive -p hive_registry -e "SELECT * FROM schema_migrations ORDER BY version;"
```

---

## 五、备份策略

### 发布目录

每次 `deploy.sh` 把二进制和前端放到 `backups/deploy/<本地时间戳>/`，并只保留名字匹配 `20*` 的最近 5 个目录。这里没有数据库转储。

### 数据库文件

`backup-db.sh` 先写 `.sql.gz.partial`，`gzip -t` 通过且解压后不是空文件才改成正式名字。`BACKUP_KEEP_DAYS` 默认 14：删除修改时间超过该天数的 `${MYSQL_DB}_*.sql.gz`。设为 `0` 则不清理。

手动备份：

```bash
cd /opt/hive
set -a; . ./.env; set +a
bash management/scripts/backup-db.sh
```

`setup-vps.sh` 只安装 `/etc/cron.d/hive-targets`，不会安装数据库备份 cron。需要每天跑时自行添加。下面这条与 `deploy.sh` 一样先 source `.env`，时钟是 VPS 本地时间每天 03:00；文件名里的时间仍是 UTC。

```bash
cat > /etc/cron.d/hive-backup << 'EOF'
0 3 * * * root bash -c 'set -a; . /opt/hive/.env; set +a; /opt/hive/management/scripts/backup-db.sh'
EOF
chmod 0644 /etc/cron.d/hive-backup
```

---

## 六、监控与告警

发布后看这些信号：

- Grafana 看板 `Hive Registry`（`management/grafana/provisioning/dashboards/hive-registry.json`）：请求 QPS、延迟、错误率
- `management/prometheus/rules/management.yml`：`RegistryDown`、`RegistryHighErrorRate`、`RegistryHighLatency`、`MySQLDown`、`NodeMassOffline`
- `management/prometheus/rules/edge-nodes.yml`：`NodeDown`

告警由 Alertmanager 发给 webhook。模板在 `management/alertmanager/alertmanager.yml`，里面的 `__ALERTMANAGER_WEBHOOK_URL__` 在容器启动时换成 `ALERTMANAGER_WEBHOOK_URL`（未设置时是 `http://localhost:9999/alert`）。改这份 YAML 或 webhook 地址后，需要重建 alertmanager 容器，启动命令才会重新渲染配置：

```bash
cd /opt/hive/management
docker compose up -d --force-recreate alertmanager
```

`deploy.sh` 的监控步骤是 `docker compose up -d --remove-orphans`，再重载 Prometheus。它不会重载 Alertmanager。Compose 里的 Alertmanager 也没有 `--web.enable-lifecycle`。

### 监控内部路由与公共入口

Prometheus 和 Alertmanager 都使用 `--web.route-prefix=/`，并监听宿主机回环地址。内部调用不带公共路径前缀：

| 用途 | 地址 |
| --- | --- |
| Registry 默认 `PROMETHEUS_URL`、Grafana 数据源 | `http://127.0.0.1:4230`（数据源写的是等价的 `http://localhost:4230`） |
| Prometheus 查询 / 重载 | `http://127.0.0.1:4230/api/v1/query`、`http://127.0.0.1:4230/-/reload` |
| Prometheus 把告警发给 Alertmanager | `localhost:9093`，`management/prometheus/prometheus.yml` 未设置 `path_prefix` |
| Alertmanager 查询 | `http://127.0.0.1:9093/api/v2/alerts` |

`management/nginx/nginx.conf` 和 `management/nginx/hive.conf` 都把 `/prometheus/`、`/alertmanager/` 转到上述内部根路径。`proxy_pass` 末尾的 `/` 用来去掉公共前缀。不带斜杠的 `/prometheus` 和 `/alertmanager` 会 301 到带斜杠的地址，并保留查询参数。

`PROMETHEUS_EXTERNAL_URL`、`ALERTMANAGER_EXTERNAL_URL` 仍带公共路径，只给页面和告警里的链接用。Compose 默认值是 `http://localhost/prometheus` 和 `http://localhost/alertmanager`。生产环境改成实际对外地址，不要把这两个前缀加到 Registry 的 `PROMETHEUS_URL`、Grafana 数据源、Prometheus 重载或告警目标上。Grafana 使用 `GF_SERVER_SERVE_FROM_SUB_PATH=true`，nginx 对 `/grafana/` 保留前缀。

从旧的带前缀内部路由升级时，Compose 里的两个 `--web.route-prefix=/` 和已安装的 nginx 配置要一起换，再按发布流程重建监控容器并重载 nginx。只改一侧会得到 404。

```bash
# 内部调用（不经过 nginx）
curl -fsS --get --data-urlencode 'query=vector(1)' http://127.0.0.1:4230/api/v1/query
curl -fsS -X POST http://127.0.0.1:4230/-/reload
curl -fsS http://127.0.0.1:9093/api/v2/alerts

# 公共路径（PUBLIC_URL 是 nginx 入口，不含 /prometheus 或 /alertmanager）
curl -fsS --get --data-urlencode 'query=vector(1)' "${PUBLIC_URL}/prometheus/api/v1/query"
curl -fsS "${PUBLIC_URL}/alertmanager/api/v2/alerts"
```
