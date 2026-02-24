#!/bin/bash
# 下载预编译 arm64 二进制到 overlay 目录
# 版本号在此统一管理，从根目录运行：./scripts/download-binaries.sh
set -e

XRAY_VER="v24.9.30"
CLOUDFLARED_VER="2024.9.1"
FRP_VER="0.61.1"
EASYTIER_VER="v2.1.3"

DEST="armbian-build/userpatches/overlay/usr/local/bin"
mkdir -p "$DEST"

# ── xray-core ──────────────────────────────────────────────────────────
echo ">>> Downloading xray ${XRAY_VER}..."
curl -L "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-arm64-v8a.zip" \
    -o /tmp/xray.zip
unzip -jo /tmp/xray.zip "xray" -d "${DEST}"
chmod +x "${DEST}/xray"
rm /tmp/xray.zip
echo "    xray: OK"

# ── cloudflared ────────────────────────────────────────────────────────
echo ">>> Downloading cloudflared ${CLOUDFLARED_VER}..."
curl -L "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VER}/cloudflared-linux-arm64" \
    -o "${DEST}/cloudflared"
chmod +x "${DEST}/cloudflared"
echo "    cloudflared: OK"

# ── frpc ───────────────────────────────────────────────────────────────
echo ">>> Downloading frpc ${FRP_VER}..."
curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_arm64.tar.gz" \
    | tar xz --strip-components=1 -C "${DEST}" "frp_${FRP_VER}_linux_arm64/frpc"
chmod +x "${DEST}/frpc"
echo "    frpc: OK"

# ── easytier-core ──────────────────────────────────────────────────────
echo ">>> Downloading easytier ${EASYTIER_VER}..."
curl -L "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-aarch64-${EASYTIER_VER}.zip" \
    -o /tmp/easytier.zip
unzip -jo /tmp/easytier.zip "*/easytier-core" -d "${DEST}"
chmod +x "${DEST}/easytier-core"
rm /tmp/easytier.zip
echo "    easytier-core: OK"

echo ""
echo ">>> All binaries downloaded:"
ls -lh "${DEST}"
