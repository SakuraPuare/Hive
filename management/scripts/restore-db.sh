#!/usr/bin/env bash
# restore-db.sh — 从备份文件恢复 hive_registry 数据库
#
# 用法：
#   ./restore-db.sh <backup-file.sql.gz>
#
# 示例：
#   ./restore-db.sh /var/backups/hive-db/hive_registry_20260326_120000.sql.gz
#
# 环境变量：
#   MYSQL_HOST      默认 127.0.0.1
#   MYSQL_PORT      默认 3306
#   MYSQL_USER      默认 hive
#   MYSQL_PASSWORD  默认 （空）
#   MYSQL_DB        默认 hive_registry
#
# 注意：
#   - 恢复前会要求二次确认，防止误操作
#   - 备份会先在临时库完整导入校验，通过后才 DROP 目标库
#   - 建议恢复前先手动执行一次 backup-db.sh

set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-${REGISTRY_MYSQL_HOST:-127.0.0.1}}"
MYSQL_PORT="${MYSQL_PORT:-${REGISTRY_MYSQL_PORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${REGISTRY_MYSQL_USER:-hive}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${REGISTRY_MYSQL_PASSWORD:-}}"
MYSQL_DB="${MYSQL_DB:-${REGISTRY_MYSQL_DB:-hive_registry}}"

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <backup-file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore] 错误：文件不存在：${BACKUP_FILE}"
  exit 1
fi

if [[ ! "${MYSQL_DB}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "[restore] 错误：MYSQL_DB 只允许字母、数字和下划线：${MYSQL_DB}"
  exit 1
fi

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[restore] 备份文件：${BACKUP_FILE} (${SIZE})"
echo "[restore] 目标数据库：${MYSQL_DB} @ ${MYSQL_HOST}:${MYSQL_PORT}"
echo ""
echo "警告：此操作将删除并重建数据库 ${MYSQL_DB}，所有现有数据将丢失！"
echo -n "确认继续？输入 yes 继续，其他任意键取消："
read -r CONFIRM || CONFIRM=""

if [[ "${CONFIRM}" != "yes" ]]; then
  echo "[restore] 已取消"
  exit 0
fi

mysql_cmd() {
  MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
    --host="${MYSQL_HOST}" \
    --port="${MYSQL_PORT}" \
    --user="${MYSQL_USER}" \
    "$@"
}

echo "[restore] 校验备份..."
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "[restore] 错误：备份不是有效的 gzip 文件，目标库未改动" >&2
  exit 1
fi

# 目标库只在整个备份导入成功后才会被删除。旧流程先 DROP 再 gunzip：一个截断
# 或非 gzip 的文件会让节点停在空库上，而且脚本无法再退回。
VERIFY_DB="${MYSQL_DB:0:40}_verify_$$"
cleanup_verify() {
  mysql_cmd -e "DROP DATABASE IF EXISTS \`${VERIFY_DB}\`;" >/dev/null 2>&1 || true
}
trap cleanup_verify EXIT

mysql_cmd -e "DROP DATABASE IF EXISTS \`${VERIFY_DB}\`; CREATE DATABASE \`${VERIFY_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "[restore] 导入到校验库 ${VERIFY_DB}..."
gunzip -c "${BACKUP_FILE}" | mysql_cmd "${VERIFY_DB}"

FOUND=$(mysql_cmd -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${VERIFY_DB}' AND table_name IN ('schema_migrations','users','nodes','customers')")
if [[ "${FOUND}" != "4" ]]; then
  echo "[restore] 错误：备份缺少核心表（找到 ${FOUND}/4），目标库未改动" >&2
  exit 1
fi
cleanup_verify
trap - EXIT
echo "[restore] 校验通过"

# 重建数据库
mysql_cmd -e "DROP DATABASE IF EXISTS \`${MYSQL_DB}\`; CREATE DATABASE \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 导入数据
echo "[restore] 导入到 ${MYSQL_DB}..."
if ! gunzip -c "${BACKUP_FILE}" | mysql_cmd "${MYSQL_DB}"; then
  echo "[restore] 错误：导入目标库失败，${MYSQL_DB} 可能不完整；备份本身已通过校验，修复存储问题后可重新执行" >&2
  exit 1
fi

echo "[restore] 恢复完成"
echo "[restore] 请重启 hive-registry 服务以重新执行迁移检查"
