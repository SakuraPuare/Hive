# 发布与回滚

本文档描述 Hive 管理平面的标准发布和回滚流程。

---

## 一、发布前检查清单

发布前确认以下事项：

- [ ] `main` 分支 CI 通过（Go build + frontend build）
- [ ] 本地已测试过要发布的功能
- [ ] 数据库 schema 变更已确认（如有新表或字段）
- [ ] `.env` 中新增的环境变量已在 VPS 上配置
- [ ] 当前没有其他人正在发布

### Actions 检查与产物交接

Registry CI 的 `gofmt check` 会阻断后续测试和前端构建，Go 改动提交前须通过 `gofmt -l .`。文档 GitHub Pages 按[官方推荐](https://github.com/actions/deploy-pages#usage)拆分构建上传与部署 job，部署通过 `needs` 等待上传 job 完成。`deploy-pages` 单次列举产物可能碰到[列表可见性延迟](https://github.com/actions/deploy-pages/issues/451)，出现上传成功但查不到 `github-pages` 的偶发失败；这不是已证实的上传/部署版本不兼容。跨 job 交接降低这个竞态风险，不能保证 GitHub 服务永不发生延迟。Cloudflare Pages 不使用这条产物链。

---

## 二、标准发布

### 自动发布（推荐）

```bash
ssh root@<VPS-IP>
cd /opt/hive
bash management/scripts/deploy.sh
```

脚本会自动执行：

1. `git pull --ff-only` 拉取最新代码
2. 备份当前二进制、前端、数据库
3. 编译 `hive-registry`
4. 构建 `registry-ui`
5. 替换二进制，重启 systemd 服务
6. 原子部署前端静态资源
7. 健康检查（5 次重试）
8. 重载监控栈

如果健康检查失败，脚本会输出回滚命令。

### 手动发布

如果需要更细粒度的控制：

```bash
ssh root@<VPS-IP>
cd /opt/hive

# 1. 拉取代码
git pull --ff-only

# 2. 备份数据库（失败会中止发布，不会继续替换二进制）
bash management/scripts/backup-db.sh

# 3. 编译后端
cd management/registry
make build
cp hive-registry /usr/local/bin/hive-registry

# 4. 重启后端
systemctl restart hive-registry

# 5. 健康检查
curl -sf http://127.0.0.1:8080/health

# 6. 构建前端
cd ../registry-ui
npm ci && npm run build

# 7. 部署前端
rsync -a --delete out/ /var/www/hive-ui/
systemctl reload nginx

# 8. 重载监控
cd ..
docker compose up -d --remove-orphans
curl -sf -X POST http://127.0.0.1:4230/-/reload
```

---

## 三、回滚

### 自动回滚

```bash
# 回滚到最近一次备份
bash management/scripts/rollback.sh

# 回滚到指定版本
bash management/scripts/rollback.sh 20260326_143000
```

查看可用备份：

```bash
ls -1 backups/deploy/
```

### 手动回滚

```bash
# 1. 恢复二进制
cp backups/deploy/<TIMESTAMP>/hive-registry /usr/local/bin/hive-registry
systemctl restart hive-registry

# 2. 恢复前端
cp -a backups/deploy/<TIMESTAMP>/hive-ui /var/www/hive-ui
systemctl reload nginx

# 3. 健康检查
curl -sf http://127.0.0.1:8080/health
```

### 数据库回滚

数据库不会自动回滚。如果需要恢复数据库：

```bash
# 查看可用备份
ls -lh backups/ /var/backups/hive-db/

# 恢复
gunzip < /var/backups/hive-db/hive_registry_20260326_030000.sql.gz \
  | mysql -u hive -p hive_registry
```

注意：数据库恢复会覆盖当前数据，请确认后再执行。

---

## 四、数据库迁移

当前 schema 变更通过 `initSchema()` 中的 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE` 语句自动执行。

发布包含 schema 变更时的注意事项：

1. 新增表：直接发布，`initSchema()` 会自动创建
2. 新增字段：确保 `ALTER TABLE` 语句是幂等的（使用 `IF NOT EXISTS` 或先检查）
3. 删除字段/表：先发布不依赖该字段的代码，确认稳定后再清理 schema
4. 发布前务必备份数据库

---

## 五、紧急回滚预案

如果发布后出现严重问题：

1. 立即执行 `bash management/scripts/rollback.sh`
2. 确认健康检查通过
3. 检查 Grafana 看板确认服务恢复
4. 如果回滚脚本也失败，手动恢复：
   ```bash
   # 停止服务
   systemctl stop hive-registry

   # 恢复上一版本二进制
   cp backups/deploy/<最近的TIMESTAMP>/hive-registry /usr/local/bin/
   systemctl start hive-registry

   # 确认
   curl http://127.0.0.1:8080/health
   ```
5. 如果数据库也需要恢复，参考上面的"数据库回滚"

---

## 六、备份策略

### 自动备份

数据库每天凌晨 3 点自动备份，保留 14 天：

```bash
# 安装 cron（setup-vps.sh 已包含）
echo "0 3 * * * root /opt/hive/management/scripts/backup-db.sh" > /etc/cron.d/hive-backup
chmod 0644 /etc/cron.d/hive-backup
```

### 手动备份

```bash
bash management/scripts/backup-db.sh
```

### 发布备份

每次发布会自动备份到 `backups/deploy/<TIMESTAMP>/`，保留最近 5 次。

---

## 七、监控与告警

发布后关注以下监控：

- Grafana `Hive Registry` 看板：请求 QPS、延迟、错误率
- Prometheus 告警：`RegistryDown`、`RegistryHighErrorRate`、`RegistryHighLatency`
- 节点状态：`NodeDown`、`NodeMassOffline`

告警通过 Alertmanager webhook 发送，配置在 `management/alertmanager/alertmanager.yml`。

### 监控内部路由与公共入口

Prometheus 和 Alertmanager 都显式使用 `--web.route-prefix=/`，监听宿主机回环地址；内部调用不带公共路径前缀：

| 用途 | 内部地址 |
| --- | --- |
| Registry 的默认 `PROMETHEUS_URL`、Grafana 数据源 | `http://127.0.0.1:4230`（数据源使用等价的 `localhost`） |
| Prometheus 查询 / 重载 | `http://127.0.0.1:4230/api/v1/query`、`http://127.0.0.1:4230/-/reload` |
| Prometheus 向 Alertmanager 发送告警 | `http://localhost:9093/api/v2/alerts`（告警目标不加 `path_prefix`） |
| Alertmanager 查询 / 重载 | `http://127.0.0.1:9093/api/v2/alerts`、`http://127.0.0.1:9093/-/reload` |

两个 nginx 配置（`management/nginx/nginx.conf` 和 `management/nginx/hive.conf`）都将 `/prometheus/`、`/alertmanager/` 转发到对应的内部根路由。这里 `proxy_pass` 地址末尾的 `/` 必须保留，它负责剥离公共前缀；不带末尾斜杠的公共入口会先重定向到带斜杠的入口，并保留查询参数。

`PROMETHEUS_EXTERNAL_URL`、`ALERTMANAGER_EXTERNAL_URL` 仍分别包含公共 `/prometheus`、`/alertmanager` 路径，用于 UI、跳转和告警中的链接；默认值分别为 `http://localhost/prometheus`、`http://localhost/alertmanager`。生产环境设为实际对外地址即可，不要据此给 Registry URL、Grafana 数据源、重载脚本或告警目标添加前缀。Grafana 仍使用自己的 `serve_from_sub_path=true` 模式，nginx 对 `/grafana/` 保留前缀，不要与这两个服务混用。

从旧配置升级时，需同时更新 Compose 中的两个 `route-prefix` 参数及已安装的 nginx 配置，再按发布流程重新创建监控容器并重载 nginx；只改一侧会产生 404。确认内部与公共路径都可用：

```bash
# 内部调用（不经过 nginx）
curl -fsS --get --data-urlencode 'query=vector(1)' http://127.0.0.1:4230/api/v1/query
curl -fsS -X POST http://127.0.0.1:4230/-/reload
curl -fsS http://127.0.0.1:9093/api/v2/alerts
curl -fsS -X POST http://127.0.0.1:9093/-/reload

# 公共路径（PUBLIC_URL 设为实际 nginx 入口，不含路径前缀）
curl -fsS --get --data-urlencode 'query=vector(1)' "${PUBLIC_URL}/prometheus/api/v1/query"
curl -fsS "${PUBLIC_URL}/alertmanager/api/v2/alerts"
```
