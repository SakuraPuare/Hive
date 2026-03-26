#!/usr/bin/env bash
# backup-db.sh — 备份 hive_registry 数据库
#
# 用法：
#   ./backup-db.sh                    # 使用环境变量或默认值
#   BACKUP_DIR=/data/backups ./backup-db.sh
#
# 环境变量（均有默认值，可通过 .env 或 export 覆盖）：
#   MYSQL_HOST        默认 127.0.0.1
#   MYSQL_PORT        默认 3306
#   MYSQL_USER        默认 hive
#   MYSQL_PASSWORD    默认 （空）
#   MYSQL_DB          默认 hive_registry
#   BACKUP_DIR        默认 /var/backups/hive-db
#   BACKUP_KEEP_DAYS  默认 14（保留天数，0 表示不清理）
#
# 输出文件格式：
#   {BACKUP_DIR}/hive_registry_YYYYMMDD_HHMMSS.sql.gz

set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-hive}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DB="${MYSQL_DB:-hive_registry}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hive-db}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
FILENAME="${MYSQL_DB}_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "[backup] 开始备份 ${MYSQL_DB} → ${FILEPATH}"

# 构造 mysqldump 参数（密码通过环境变量传入，避免命令行泄露）
MYSQL_PWD="${MYSQL_PASSWORD}" mysqldump \
  --host="${MYSQL_HOST}" \
  --port="${MYSQL_PORT}" \
  --user="${MYSQL_USER}" \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  "${MYSQL_DB}" \
  | gzip -9 > "${FILEPATH}"

SIZE=$(du -sh "${FILEPATH}" | cut -f1)
echo "[backup] 完成：${FILEPATH} (${SIZE})"

# 清理过期备份
if [[ "${BACKUP_KEEP_DAYS}" -gt 0 ]]; then
  echo "[backup] 清理 ${BACKUP_KEEP_DAYS} 天前的备份..."
  find "${BACKUP_DIR}" -name "${MYSQL_DB}_*.sql.gz" -mtime "+${BACKUP_KEEP_DAYS}" -delete
  echo "[backup] 清理完成"
fi

echo "[backup] 当前备份列表："
ls -lh "${BACKUP_DIR}/${MYSQL_DB}_"*.sql.gz 2>/dev/null || echo "  （无备份文件）"
