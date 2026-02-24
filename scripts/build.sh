#!/bin/bash
# 一键构建入口
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARMBIAN_DIR="${ROOT_DIR}/armbian-build/build"

# 加载环境变量
if [ -f "${ROOT_DIR}/.env" ]; then
    set -a
    source "${ROOT_DIR}/.env"
    set +a
else
    echo "ERROR: .env not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# 检查 Armbian 框架是否已 clone
if [ ! -f "${ARMBIAN_DIR}/compile.sh" ]; then
    echo "ERROR: Armbian framework not found at ${ARMBIAN_DIR}."
    echo "Run: ./scripts/setup-armbian.sh"
    exit 1
fi

# 检查关键二进制是否已下载
OVERLAY_BIN="${ROOT_DIR}/armbian-build/userpatches/overlay/usr/local/bin"
for bin in xray cloudflared frpc easytier-core; do
    if [ ! -f "${OVERLAY_BIN}/${bin}" ]; then
        echo "ERROR: ${bin} not found. Run: ./scripts/download-binaries.sh"
        exit 1
    fi
done

# 将 userpatches/ 同步到 Armbian build 目录
# Armbian 以 compile.sh 所在目录为根查找 userpatches/
echo ">>> Syncing userpatches to Armbian build dir..."
rsync -a --delete "${ROOT_DIR}/armbian-build/userpatches/" "${ARMBIAN_DIR}/userpatches/"

# 渲染配置模板（envsubst 替换 ${VAR} 占位符，%%VAR%% 占位符留给首次启动脚本处理）
echo ">>> Rendering config templates..."

# /etc/edge/config.env — 所有共享凭证烧入镜像
envsubst < "${ROOT_DIR}/configs/edge/config.env.tpl" \
    > "${ARMBIAN_DIR}/userpatches/overlay/etc/edge/config.env"

# /etc/frp/frpc.toml — 服务端信息在构建时渲染，%%FRP_PORT%%/%%HOSTNAME%% 留给首次启动
envsubst < "${ROOT_DIR}/configs/frp/frpc.toml.tpl" \
    > "${ARMBIAN_DIR}/userpatches/overlay/etc/frp/frpc.toml"

echo ">>> Templates rendered."

# 执行 Armbian 构建
echo ">>> Starting Armbian build..."
cd "${ARMBIAN_DIR}"

./compile.sh build \
    BOARD="${BOARD:-nanopi-zero2}" \
    BRANCH="${BRANCH:-vendor}" \
    RELEASE="${RELEASE:-trixie}" \
    BUILD_MINIMAL=no \
    KERNEL_CONFIGURE="${KERNEL_CONFIGURE:-no}" \
    COMPRESS_OUTPUTIMAGE=yes \
    "$@"
