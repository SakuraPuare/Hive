# 数据库迁移、备份与恢复

本文说明 `hive_registry` 的迁移、备份和恢复。迁移列表在 `management/registry/internal/store/migration.go`，脚本在 `management/scripts/backup-db.sh` 和 `management/scripts/restore-db.sh`。

---

## 一、迁移机制

`management/registry/main.go` 连上数据库后调用 `store.RunMigrations`。它先创建 `schema_migrations`（若还没有），再按 `Migrations` 切片的顺序执行尚未记录的条目。表里已经有的 `version` 会跳过；是否执行过只看 `version`，改已有条目的 `up` 不会重跑。

一条迁移的语句全部成功后，才插入 `schema_migrations`。这些语句不在同一个事务里。中途失败时进程以 `log.Fatalf` 退出，该 `version` 不会记为已执行，下次启动会整段重试。删除列或索引时，MySQL 错误码 1091（对象不存在）会被忽略并继续；其它错误会中止启动。

### 设计原则

- 列表是同文件中的 `Migrations` 变量，不读取外部 SQL 文件
- 每条有唯一 `version`，列表按 version 升序。已发布条目（含 `up`）不要改
- 只有 `up`，没有 `down`。要回退时追加一条反向迁移
- `up` 里可以用分号写多条 SQL，空语句会跳过。切分不识别字符串字面量，分号不要写进字符串

### schema_migrations 表

由 `ensureMigrationsTable` 执行：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INT UNSIGNED NOT NULL,
    description VARCHAR(256) NOT NULL DEFAULT '',
    applied_at  DATETIME     NOT NULL,
    PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='数据库迁移版本记录';
```

### 启动日志

版本号按三位补零（`migration %03d`）。当前列表是 version 1 到 39。空库首次启动会逐条执行，收尾一行里的数字来自代码中最后一条的 version：

```
migration 001: initial schema: users, rbac, audit_logs, nodes, subscription_groups
migration 001: done
...
migration 039: nodes: physical LAN and observed egress heartbeat snapshot
migration 039: done
schema up to date (latest: 39)
```

已全部执行过时只有：

```
schema up to date (latest: 39)
```

### 如何新增迁移

在 `Migrations` 末尾追加。当前最后一条是 39，新的 `version` 取更大的整数并保持升序：

```go
{
    version: 40,
    desc:    "一句话说明，会写入 schema_migrations.description",
    up: `
ALTER TABLE some_table ADD COLUMN some_column INT NOT NULL DEFAULT 0;
`,
},
```

`some_table` 和 `some_column` 只说明写法，不是仓库里的迁移。

### 查看当前版本

```bash
mysql -u hive -p hive_registry -e "SELECT version, description, applied_at FROM schema_migrations ORDER BY version;"
```

---

## 二、备份策略

`management/scripts/backup-db.sh` 的连接参数先读 `MYSQL_*`，没有则读 `REGISTRY_MYSQL_*`（仓库 `.env` 用这组名字），再使用默认值：

- `MYSQL_HOST` / `REGISTRY_MYSQL_HOST`：`127.0.0.1`
- `MYSQL_PORT` / `REGISTRY_MYSQL_PORT`：`3306`
- `MYSQL_USER` / `REGISTRY_MYSQL_USER`：`hive`
- `MYSQL_PASSWORD` / `REGISTRY_MYSQL_PASSWORD`：空
- `MYSQL_DB` / `REGISTRY_MYSQL_DB`：`hive_registry`
- `BACKUP_DIR`：`/var/backups/hive-db`
- `BACKUP_KEEP_DAYS`：`14`。设为 `0` 则不删除旧文件

`management/scripts/deploy.sh` 会先加载仓库根目录的 `.env`，再跑这个脚本。备份失败则中止发布，不会继续替换二进制。

### 手动备份

在仓库根目录执行：

```bash
# 默认写到 /var/backups/hive-db，保留 14 天
MYSQL_PASSWORD=yourpassword management/scripts/backup-db.sh

# 使用 .env 里的 REGISTRY_MYSQL_*
set -a && . ./.env && set +a
management/scripts/backup-db.sh

BACKUP_DIR=/data/backups BACKUP_KEEP_DAYS=30 \
  MYSQL_PASSWORD=yourpassword \
  management/scripts/backup-db.sh
```

文件名是 `{MYSQL_DB}_YYYYMMDD_HHMMSS.sql.gz`，时间是 UTC（`date -u`）。默认库名下为 `hive_registry_YYYYMMDD_HHMMSS.sql.gz`。

`mysqldump` 使用 `--single-transaction --routines --triggers --set-gtid-purged=OFF`。内容先写入 `*.sql.gz.partial`；`gzip -t` 通过且解压后非空，才改成正式文件名。失败时删除 `.partial`。密码经 `MYSQL_PWD` 传给客户端。

### 定时备份

备份 cron 需要自己添加。`management/setup-vps.sh` 写入的定时任务是 `/etc/cron.d/hive-targets`（刷新 Prometheus 目标），不包含数据库备份。该脚本头部的安装示例把仓库克隆到 `/opt/hive`。

用户 crontab 每天本地时间 03:00 执行，并加载 `.env`：

```cron
0 3 * * * set -a && . /opt/hive/.env && set +a && /opt/hive/management/scripts/backup-db.sh >> /var/log/hive-backup.log 2>&1
```

也可以加载 `setup-vps.sh` 生成的 `/etc/hive-registry.env`（其中是 `MYSQL_*`，权限 600）：

```cron
0 3 * * * set -a && . /etc/hive-registry.env && set +a && /opt/hive/management/scripts/backup-db.sh >> /var/log/hive-backup.log 2>&1
```

克隆目录不是 `/opt/hive` 时，换成实际路径。crontab 按机器本地时区触发，文件名时间是 UTC。时区为 UTC+8 时，本地 03:00 的备份，文件名时刻是前一日 `190000`。不写 `BACKUP_DIR` 和 `BACKUP_KEEP_DAYS` 时使用上面的默认值。

### 备份验证

```bash
gunzip -t /var/backups/hive-db/hive_registry_*.sql.gz
```

---

## 三、恢复演练

`management/scripts/restore-db.sh` 使用与备份相同的 `MYSQL_*` / `REGISTRY_MYSQL_*`（没有 `BACKUP_DIR` 和 `BACKUP_KEEP_DAYS`）。`MYSQL_DB` 只允许字母、数字和下划线。

1. 停止服务。单元文件是 `hive-registry.service`，`Restart=always`，用 systemctl 停止：

```bash
systemctl stop hive-registry
```

2. 执行恢复。出现提示后只有输入 `yes` 才会继续；其它输入或遇到 EOF 会取消，退出码为 0。

```bash
MYSQL_PASSWORD=yourpassword \
  management/scripts/restore-db.sh \
  /var/backups/hive-db/hive_registry_YYYYMMDD_HHMMSS.sql.gz
```

脚本注释建议恢复前先手动执行一次 `backup-db.sh`。确认之后脚本会：

- 用 `gzip -t` 检查压缩包；无效则不改目标库
- 导入临时库。库名是 `MYSQL_DB` 的前 40 个字符，加上 `_verify_` 和进程号。临时库必须同时含有 `schema_migrations`、`users`、`nodes`、`customers`，否则中止，目标库不变
- 校验通过后删除并重建目标库（`utf8mb4` / `utf8mb4_unicode_ci`），再导入
- 导入目标库失败时，目标库可能不完整。备份本身已经通过校验，排除存储问题后可以再执行

3. 启动服务。启动时会再次跑迁移，补上备份里还没有的 version：

```bash
systemctl start hive-registry
```

4. 验证。`/health` 在数据库 ping 成功时返回 `{"status":"ok"}`，正文里没有 schema 版本。`setup-vps.sh` 写入的 `LISTEN_ADDR` 默认是 `127.0.0.1:8080`：

```bash
curl -sf http://127.0.0.1:8080/health
mysql -u hive -p hive_registry -e "SELECT COUNT(*) FROM nodes;"
```

### 恢复注意事项

- 恢复会删除目标库，操作不可逆
- 备份的 schema 版本低于当前二进制时，服务启动后会执行尚未记录的迁移
- 备份的 schema 版本高于当前二进制时，程序不会自动降级，需要自行确认兼容性

---

## 四、本地开发环境重置

清掉本地 MySQL、重建容器并灌入演示数据的步骤，见 [本地开发与调试](./07-local-dev.md) 的「三、启动 MySQL」和「八、常用重置方式」。`go run .` 启动 registry 时同样会执行 `store.RunMigrations`。演示数据在 `management/registry` 目录执行 `make seed-local-demo`，对应脚本是 `management/registry/dev/seed-local-demo.sh`。
