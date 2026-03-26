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
#   - 恢复会先 DROP 再 CREATE 目标数据库，所有现有数据将丢失
#   - 建议恢复前先手动执行一次 backup-db.sh

set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-hive}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DB="${MYSQL_DB:-hive_registry}"

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <backup-file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore] 错误：文件不存在：${BACKUP_FILE}"
  exit 1
fi

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[restore] 备份文件：${BACKUP_FILE} (${SIZE})"
echo "[restore] 目标数据库：${MYSQL_DB} @ ${MYSQL_HOST}:${MYSQL_PORT}"
echo ""
echo "警告：此操作将删除并重建数据库 ${MYSQL_DB}，所有现有数据将丢失！"
echo -n "确认继续？输入 yes 继续，其他任意键取消："
read -r CONFIRM

if [[ "${CONFIRM}" != "yes" ]]; then
  echo "[restore] 已取消"
  exit 0
fi

echo "[restore] 开始恢复..."

# 重建数据库
MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
  --host="${MYSQL_HOST}" \
  --port="${MYSQL_PORT}" \
  --user="${MYSQL_USER}" \
  -e "DROP DATABASE IF EXISTS \`${MYSQL_DB}\`; CREATE DATABASE \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 导入数据
gunzip -c "${BACKUP_FILE}" | MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
  --host="${MYSQL_HOST}" \
  --port="${MYSQL_PORT}" \
  --user="${MYSQL_USER}" \
  "${MYSQL_DB}"

echo "[restore] 恢复完成"
echo "[restore] 请重启 hive-registry 服务以重新执行迁移检查"
