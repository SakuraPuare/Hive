#!/bin/bash
# 下载预编译 arm64 二进制到 overlay 目录
# 版本号在此统一管理，从根目录运行：./scripts/download-binaries.sh
set -e

# 支持通过环境变量覆盖，默认使用 latest（xray / cloudflared / mihomo）
XRAY_VER="${XRAY_VER:-latest}"               # e.g. v26.2.6 或 latest
CLOUDFLARED_VER="${CLOUDFLARED_VER:-latest}" # e.g. 2026.2.0 或 latest
FRP_VER="${FRP_VER:-0.67.0}"
EASYTIER_VER="${EASYTIER_VER:-v2.4.5}"
MIHOMO_VER="${MIHOMO_VER:-latest}"           # e.g. v1.19.3 或 latest

DEST="armbian-build/userpatches/overlay/usr/local/bin"
mkdir -p "$DEST"

# ── xray-core ──────────────────────────────────────────────────────────
echo ">>> Downloading xray ${XRAY_VER}..."
if [ "$XRAY_VER" = "latest" ]; then
  XRAY_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-arm64-v8a.zip"
else
  XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-arm64-v8a.zip"
fi
curl -L "$XRAY_URL" -o /tmp/xray.zip
unzip -jo /tmp/xray.zip "xray" -d "${DEST}"
chmod +x "${DEST}/xray"
rm /tmp/xray.zip
echo "    xray: OK"

# ── cloudflared ────────────────────────────────────────────────────────
echo ">>> Downloading cloudflared ${CLOUDFLARED_VER}..."
if [ "$CLOUDFLARED_VER" = "latest" ]; then
  CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
else
  CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VER}/cloudflared-linux-arm64"
fi
curl -L "$CLOUDFLARED_URL" -o "${DEST}/cloudflared"
chmod +x "${DEST}/cloudflared"
echo "    cloudflared: OK"

# ── frpc ───────────────────────────────────────────────────────────────
# https://github.com/fatedier/frp/
echo ">>> Downloading frpc ${FRP_VER}..."
curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_arm64.tar.gz" \
    | tar xz --strip-components=1 -C "${DEST}" "frp_${FRP_VER}_linux_arm64/frpc"
chmod +x "${DEST}/frpc"
echo "    frpc: OK"

# ── easytier-core ──────────────────────────────────────────────────────
# https://github.com/EasyTier/EasyTier
echo ">>> Downloading easytier ${EASYTIER_VER}..."
curl -L "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-aarch64-${EASYTIER_VER}.zip" \
    -o /tmp/easytier.zip
unzip -jo /tmp/easytier.zip "*/easytier-core" -d "${DEST}"
chmod +x "${DEST}/easytier-core"
rm /tmp/easytier.zip
echo "    easytier-core: OK"

# ── mihomo ─────────────────────────────────────────────────────────────
# https://github.com/MetaCubeX/mihomo
echo ">>> Downloading mihomo ${MIHOMO_VER}..."
if [ "$MIHOMO_VER" = "latest" ]; then
  MIHOMO_API="https://api.github.com/repos/MetaCubeX/mihomo/releases/latest"
else
  MIHOMO_API="https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/${MIHOMO_VER}"
fi
MIHOMO_URL=$(curl -fsSL "$MIHOMO_API" \
  | jq -r '.assets[].browser_download_url
      | select(test("mihomo-linux-arm64.*\\.gz$"))
      | select(test("compatible") | not)
      | select(test("go120") | not)' \
  | head -1)
if [ -z "$MIHOMO_URL" ]; then
  echo "ERROR: cannot find mihomo linux arm64 asset for ${MIHOMO_VER}" >&2
  exit 1
fi
curl -L "$MIHOMO_URL" -o /tmp/mihomo.gz
gzip -dc /tmp/mihomo.gz > "${DEST}/mihomo"
chmod +x "${DEST}/mihomo"
rm /tmp/mihomo.gz
echo "    mihomo: OK"

echo ""
echo ">>> All binaries downloaded:"
ls -lh "${DEST}"
