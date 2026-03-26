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

---

## 二、标准发布

### 自动发布（推荐）

```bash
ssh root@<VPS-IP>
cd /opt/rk3528-hive
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
cd /opt/rk3528-hive

# 1. 拉取代码
git pull --ff-only

# 2. 备份数据库
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
echo "0 3 * * * root /opt/rk3528-hive/management/scripts/backup-db.sh" > /etc/cron.d/hive-backup
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
