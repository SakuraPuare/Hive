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
#
# 备份先写 .partial 并在改名发布前校验：恢复流程会先删库再导入，一份损坏
# 但文件名正常的备份等于没有备份。

set -euo pipefail

# 部署 .env 使用 REGISTRY_MYSQL_*，systemd 环境文件使用 MYSQL_*。两者都接受，
# 否则按文档执行会连到空的默认实例并把失败吞成一份空备份。
MYSQL_HOST="${MYSQL_HOST:-${REGISTRY_MYSQL_HOST:-127.0.0.1}}"
MYSQL_PORT="${MYSQL_PORT:-${REGISTRY_MYSQL_PORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${REGISTRY_MYSQL_USER:-hive}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${REGISTRY_MYSQL_PASSWORD:-}}"
MYSQL_DB="${MYSQL_DB:-${REGISTRY_MYSQL_DB:-hive_registry}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hive-db}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
FILENAME="${MYSQL_DB}_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"
PARTIAL="${FILEPATH}.partial"

mkdir -p "${BACKUP_DIR}"
trap 'rm -f "${PARTIAL}"' EXIT

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
  | gzip -9 > "${PARTIAL}"

# mysqldump 失败时 pipefail 已经让脚本退出，但 gzip 仍会留下一个可解压的
# 空文件。发布前同时检查完整性与实际内容。
gzip -t "${PARTIAL}" || {
  echo "[backup] 错误：备份压缩包损坏，未发布 ${FILENAME}" >&2
  exit 1
}
if [ "$(gzip -dc "${PARTIAL}" | wc -c)" -eq 0 ]; then
  echo "[backup] 错误：备份内容为空，未发布 ${FILENAME}" >&2
  exit 1
fi

mv -f "${PARTIAL}" "${FILEPATH}"
trap - EXIT

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
