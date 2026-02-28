#!/bin/bash
# 构建 VitePress 文档并通过 Wrangler 发布到 Cloudflare Pages
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="${ROOT_DIR}/docs/.vitepress/dist"

# ─── 加载 .env ───────────────────────────────────────────────
ENV_FILE="${ROOT_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
else
    echo "警告: .env 不存在，将使用已登录的 wrangler 凭证"
fi

# ─── 参数 ────────────────────────────────────────────────────
PROJECT_NAME="${DOCS_PROJECT_NAME:-hive-docs}"

# 支持命令行覆盖：./deploy-docs.sh my-project-name
if [ -n "$1" ]; then
    PROJECT_NAME="$1"
fi

echo "部署目标: Cloudflare Pages 项目「${PROJECT_NAME}」"
echo ""

# ─── 依赖检查 ────────────────────────────────────────────────
cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
    echo ">>> 安装依赖..."
    npm install
fi

# ─── 构建 ────────────────────────────────────────────────────
echo ">>> 构建 VitePress 文档..."
npm run docs:build

echo ""
echo "构建完成: ${DIST_DIR}"
echo ""

# ─── 部署 ────────────────────────────────────────────────────
echo ">>> 发布到 Cloudflare Pages..."

WRANGLER_ARGS=(
    pages deploy "$DIST_DIR"
    --project-name "$PROJECT_NAME"
)

# 如果 .env 提供了 CF 凭证则注入（否则使用 wrangler login 的已登录状态）
if [ -n "$CF_API_TOKEN" ]; then
    export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
fi
if [ -n "$CF_ACCOUNT_ID" ]; then
    export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
fi

npx wrangler "${WRANGLER_ARGS[@]}"

echo ""
echo "✓ 发布完成"
echo "  部署 URL 已在上方输出，将其填入 .env 的 CAMOUFLAGE_URL"
