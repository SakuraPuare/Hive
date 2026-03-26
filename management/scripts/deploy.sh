#!/bin/bash
# deploy.sh — 标准化发布流程
#
# 用法：
#   bash management/scripts/deploy.sh
#
# 流程：
#   1. 拉取最新代码
#   2. 备份当前二进制、前端、数据库
#   3. 编译 hive-registry
#   4. 构建 registry-ui
#   5. 替换二进制，重启服务
#   6. 部署前端
#   7. 健康检查
#   8. 失败时提示回滚

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="${ROOT_DIR}/management/scripts"

# 加载 .env
if [ -f "${ROOT_DIR}/.env" ]; then
    set -a; source "${ROOT_DIR}/.env"; set +a
fi

REGISTRY_BIN="/usr/local/bin/hive-registry"
UI_DEPLOY="/var/www/hive-ui"
BACKUP_BASE="${ROOT_DIR}/backups/deploy"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
HEALTH_URL="http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}/health"

echo "=== Hive Deploy (${TIMESTAMP}) ==="

# ── 0. 检查前提 ──────────────────────────────────────────────────────────
if ! command -v go &>/dev/null; then
    echo "ERROR: go not found" >&2; exit 1
fi
if ! command -v npm &>/dev/null; then
    echo "ERROR: npm not found" >&2; exit 1
fi

# ── 1. 拉取最新代码 ──────────────────────────────────────────────────────
echo ">>> Pulling latest code..."
cd "${ROOT_DIR}"
git pull --ff-only

# ── 2. 备份 ──────────────────────────────────────────────────────────────
echo ">>> Creating backup at ${BACKUP_DIR}..."
mkdir -p "${BACKUP_DIR}"

# 备份二进制
if [ -f "${REGISTRY_BIN}" ]; then
    cp "${REGISTRY_BIN}" "${BACKUP_DIR}/hive-registry"
    echo "  binary backed up"
fi

# 备份前端
if [ -d "${UI_DEPLOY}" ]; then
    cp -a "${UI_DEPLOY}" "${BACKUP_DIR}/hive-ui"
    echo "  frontend backed up"
fi

# 备份数据库
echo "  backing up database..."
bash "${SCRIPT_DIR}/backup-db.sh" || echo "  WARNING: db backup failed (non-fatal)"

# ── 3. 编译后端 ──────────────────────────────────────────────────────────
echo ">>> Building hive-registry..."
cd "${ROOT_DIR}/management/registry"

# 检测架构
ARCH=$(uname -m)
case "${ARCH}" in
    x86_64)  GOARCH=amd64 ;;
    aarch64) GOARCH=arm64 ;;
    *)       GOARCH=amd64 ;;
esac

CGO_ENABLED=0 GOOS=linux GOARCH=${GOARCH} \
    go build -ldflags="-s -w" -o hive-registry .
echo "  built for ${GOARCH}"

# ── 4. 构建前端 ──────────────────────────────────────────────────────────
echo ">>> Building registry-ui..."
cd "${ROOT_DIR}/management/registry-ui"
npm ci --prefer-offline
npm run build
echo "  frontend built"

# ── 5. 部署后端 ──────────────────────────────────────────────────────────
echo ">>> Deploying hive-registry..."
cd "${ROOT_DIR}/management/registry"
cp hive-registry "${REGISTRY_BIN}"
systemctl restart hive-registry
echo "  service restarted"

# ── 6. 部署前端 ──────────────────────────────────────────────────────────
echo ">>> Deploying registry-ui..."
UI_OUT="${ROOT_DIR}/management/registry-ui/out"
mkdir -p "${UI_DEPLOY}"
rsync -a --delete "${UI_OUT}/" "${UI_DEPLOY}.new/"
if [ -d "${UI_DEPLOY}" ]; then
    mv "${UI_DEPLOY}" "${UI_DEPLOY}.old"
fi
mv "${UI_DEPLOY}.new" "${UI_DEPLOY}"
rm -rf "${UI_DEPLOY}.old"
systemctl reload nginx
echo "  frontend deployed"

# ── 7. 健康检查 ──────────────────────────────────────────────────────────
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
        echo "!!! HEALTH CHECK FAILED after ${RETRIES} attempts"
        echo "!!! Run rollback: bash ${SCRIPT_DIR}/rollback.sh ${TIMESTAMP}"
        echo ""
        exit 1
    fi
    echo "  attempt ${i}/${RETRIES} failed, retrying..."
    sleep 2
done

# ── 8. 重载监控 ──────────────────────────────────────────────────────────
echo ">>> Reloading monitoring stack..."
cd "${ROOT_DIR}/management"
docker compose up -d --remove-orphans
curl -sf -X POST http://127.0.0.1:4230/-/reload || true
echo "  monitoring reloaded"

# ── 清理旧备份（保留最近 5 次）──────────────────────────────────────────
DEPLOY_BACKUPS=$(ls -1d "${BACKUP_BASE}"/20* 2>/dev/null | sort -r | tail -n +6)
if [ -n "${DEPLOY_BACKUPS}" ]; then
    echo "${DEPLOY_BACKUPS}" | xargs rm -rf
    echo ">>> Cleaned old deploy backups"
fi

echo ""
echo "=== Deploy Complete ==="
echo "  Backup: ${BACKUP_DIR}"
echo "  Rollback: bash ${SCRIPT_DIR}/rollback.sh ${TIMESTAMP}"
echo ""
