#!/bin/bash
# rollback.sh — 回滚到指定备份版本
#
# 用法：
#   bash management/scripts/rollback.sh <TIMESTAMP>
#   bash management/scripts/rollback.sh              # 回滚到最近一次备份
#
# 示例：
#   bash management/scripts/rollback.sh 20260326_143000

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# 加载 .env
if [ -f "${ROOT_DIR}/.env" ]; then
    set -a; source "${ROOT_DIR}/.env"; set +a
fi

REGISTRY_BIN="/usr/local/bin/hive-registry"
UI_DEPLOY="/var/www/hive-ui"
BACKUP_BASE="${ROOT_DIR}/backups/deploy"
HEALTH_URL="http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health"

# 确定回滚目标
if [ -n "${1:-}" ]; then
    BACKUP_DIR="${BACKUP_BASE}/${1}"
else
    # 自动选择最近一次备份
    BACKUP_DIR=$(ls -1d "${BACKUP_BASE}"/20* 2>/dev/null | sort -r | head -1)
fi

if [ -z "${BACKUP_DIR}" ] || [ ! -d "${BACKUP_DIR}" ]; then
    echo "ERROR: backup not found: ${BACKUP_DIR:-<none>}" >&2
    echo ""
    echo "Available backups:"
    ls -1d "${BACKUP_BASE}"/20* 2>/dev/null | sort -r || echo "  (none)"
    exit 1
fi

echo "=== Hive Rollback ==="
echo "  From: ${BACKUP_DIR}"
echo ""

# ── 1. 回滚后端二进制 ────────────────────────────────────────────────────
if [ -f "${BACKUP_DIR}/hive-registry" ]; then
    echo ">>> Restoring hive-registry binary..."
    cp "${BACKUP_DIR}/hive-registry" "${REGISTRY_BIN}"
    systemctl restart hive-registry
    echo "  binary restored, service restarted"
else
    echo ">>> No binary backup found, skipping backend rollback"
fi

# ── 2. 回滚前端 ──────────────────────────────────────────────────────────
if [ -d "${BACKUP_DIR}/hive-ui" ]; then
    echo ">>> Restoring registry-ui..."
    if [ -d "${UI_DEPLOY}" ]; then
        mv "${UI_DEPLOY}" "${UI_DEPLOY}.rollback-tmp"
    fi
    cp -a "${BACKUP_DIR}/hive-ui" "${UI_DEPLOY}"
    rm -rf "${UI_DEPLOY}.rollback-tmp"
    systemctl reload nginx
    echo "  frontend restored"
else
    echo ">>> No frontend backup found, skipping UI rollback"
fi

# ── 3. 健康检查 ──────────────────────────────────────────────────────────
echo ">>> Health check..."
sleep 2

RETRIES=5
for i in $(seq 1 ${RETRIES}); do
    if curl -sf "${HEALTH_URL}" > /dev/null 2>&1; then
        echo "  health check passed"
        break
    fi
    if [ "${i}" -eq "${RETRIES}" ]; then
        echo ""
        echo "!!! HEALTH CHECK FAILED after rollback"
        echo "!!! Manual intervention required"
        echo ""
        exit 1
    fi
    echo "  attempt ${i}/${RETRIES} failed, retrying..."
    sleep 2
done

echo ""
echo "=== Rollback Complete ==="
echo ""
echo "  NOTE: Database was NOT rolled back."
echo "  If you need to restore the database, run:"
echo "    ls ${ROOT_DIR}/backups/"
echo "    # Find the .sql.gz file, then:"
echo "    gunzip < <backup-file>.sql.gz | mysql -u hive -p hive_registry"
echo ""
