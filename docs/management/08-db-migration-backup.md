# 数据库迁移、备份与恢复

本文说明 `hive_registry` 数据库的迁移机制、备份策略和恢复演练步骤。

---

## 一、迁移机制

### 设计原则

- 迁移列表内嵌在 `management/registry/migration.go` 中，不依赖外部文件
- 每条迁移有唯一递增的 `version` 编号，禁止修改已发布的条目
- 服务启动时自动执行所有未执行的迁移，幂等安全
- 执行记录写入 `schema_migrations` 表

### schema_migrations 表

```sql
CREATE TABLE schema_migrations (
    version    INT UNSIGNED NOT NULL,
    desc       VARCHAR(256) NOT NULL DEFAULT '',
    applied_at DATETIME     NOT NULL,
    PRIMARY KEY (version)
);
```

### 启动日志示例

全新数据库首次启动：

```
migration 001: initial schema: users, rbac, audit_logs, nodes, subscription_groups
migration 001: done
migration 002: alter users.role from ENUM to VARCHAR(64) for multi-role support
migration 002: done
schema up to date (latest: 2)
```

已是最新版本时：

```
schema up to date (latest: 2)
```

### 如何新增迁移

在 `migration.go` 的 `migrations` 列表末尾追加一条：

```go
{
    version: 3,
    desc:    "add nodes.enabled column",
    up:      `ALTER TABLE nodes ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '节点是否启用'`,
},
```

规则：

- `version` 必须严格递增，不能跳号
- `up` 字段支持多条 SQL，用分号分隔
- 已发布的迁移条目禁止修改（包括 `up` 内容）
- 迁移只有 `up`，没有 `down`；需要回滚时，新增一条反向迁移

### 查看当前版本

```bash
mysql -u hive -p hive_registry -e "SELECT * FROM schema_migrations ORDER BY version;"
```

---

## 二、备份策略

### 脚本位置

```
management/scripts/backup-db.sh   # 备份
management/scripts/restore-db.sh  # 恢复
```

### 手动备份

```bash
cd /path/to/rk3528-hive/management/scripts

# 使用默认配置（连接 127.0.0.1:3306，用户 hive）
MYSQL_PASSWORD=yourpassword ./backup-db.sh

# 自定义备份目录和保留天数
MYSQL_PASSWORD=yourpassword \
BACKUP_DIR=/data/backups \
BACKUP_KEEP_DAYS=30 \
./backup-db.sh
```

备份文件命名格式：`hive_registry_YYYYMMDD_HHMMSS.sql.gz`

### 定时备份（cron）

每天凌晨 3 点自动备份，保留 14 天：

```bash
# 编辑 crontab
crontab -e
```

添加：

```cron
0 3 * * * MYSQL_PASSWORD=yourpassword BACKUP_DIR=/var/backups/hive-db /path/to/management/scripts/backup-db.sh >> /var/log/hive-backup.log 2>&1
```

建议把密码写入 `/etc/hive/backup.env`（权限 600），然后：

```cron
0 3 * * * . /etc/hive/backup.env && /path/to/management/scripts/backup-db.sh >> /var/log/hive-backup.log 2>&1
```

`/etc/hive/backup.env` 内容示例：

```bash
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=hive
export MYSQL_PASSWORD=yourpassword
export MYSQL_DB=hive_registry
export BACKUP_DIR=/var/backups/hive-db
export BACKUP_KEEP_DAYS=14
```

### 备份验证

定期检查备份文件是否可解压：

```bash
gunzip -t /var/backups/hive-db/hive_registry_*.sql.gz
```

---

## 三、恢复演练

### 恢复步骤

1. 停止 `hive-registry` 服务（避免写入冲突）：

```bash
systemctl stop hive-registry
# 或
kill $(pgrep hive-registry)
```

2. 执行恢复脚本：

```bash
MYSQL_PASSWORD=yourpassword \
./management/scripts/restore-db.sh \
  /var/backups/hive-db/hive_registry_20260326_030000.sql.gz
```

脚本会要求输入 `yes` 确认，然后：

- DROP 并重建 `hive_registry` 数据库
- 导入备份数据

3. 重启服务（服务启动时会自动执行迁移检查）：

```bash
systemctl start hive-registry
```

4. 验证：

```bash
curl http://127.0.0.1:8080/health
mysql -u hive -p hive_registry -e "SELECT COUNT(*) FROM nodes;"
```

### 恢复注意事项

- 恢复会清空目标数据库，操作不可逆，务必确认备份文件有效
- 如果备份时数据库版本低于当前代码，服务重启后会自动补执行缺失的迁移
- 如果备份时数据库版本高于当前代码（回滚了服务版本），需要人工评估兼容性

---

## 四、本地开发环境重置

本地开发时，最快的重置方式是删除 MySQL 容器重建：

```bash
docker rm -f hive-mysql

docker run --name hive-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=hive_registry \
  -e MYSQL_USER=hive \
  -e MYSQL_PASSWORD=hive \
  -p 3306:3306 \
  -d mysql:8

# 重启后端（自动建表）
cd management/registry && go run .

# 插入演示数据
make seed-local-demo
```
