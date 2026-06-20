#!/bin/bash
# 下载预编译 arm64 二进制到 overlay 目录
# 版本号在此统一管理，从根目录运行：./scripts/download-binaries.sh
set -e

# 支持通过环境变量覆盖，默认使用 latest（仅 xray / cloudflared）
XRAY_VER="${XRAY_VER:-latest}"               # e.g. v26.2.6 或 latest
CLOUDFLARED_VER="${CLOUDFLARED_VER:-latest}" # e.g. 2026.2.0 或 latest
FRP_VER="${FRP_VER:-0.69.1}"
EASYTIER_VER="${EASYTIER_VER:-v2.6.4}"
XRAY_EXPORTER_VER="${XRAY_EXPORTER_VER:-v0.2.0}" # compassvpn/xray-exporter
MIHOMO_VER="${MIHOMO_VER:-v1.19.27}"             # MetaCubeX/mihomo（Clash.Meta 内核，透明代理网关）
METACUBEXD_VER="${METACUBEXD_VER:-v1.256.0}"     # MetaCubeX/metacubexd（Clash API Web 面板）

DEST="armbian-build/userpatches/overlay/usr/local/bin"
mkdir -p "$DEST"

# metacubexd 静态 Web 面板部署目录（由 nginx 托管）
WWW_METACUBEXD="armbian-build/userpatches/overlay/var/www/metacubexd"

# ── xray-core ──────────────────────────────────────────────────────────
echo ">>> Downloading xray ${XRAY_VER}..."
if [ "$XRAY_VER" = "latest" ]; then
  XRAY_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-arm64-v8a.zip"
else
  XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-arm64-v8a.zip"
fi
curl -fL "$XRAY_URL" -o /tmp/xray.zip
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
curl -fL "$CLOUDFLARED_URL" -o "${DEST}/cloudflared"
chmod +x "${DEST}/cloudflared"
echo "    cloudflared: OK"

# ── frpc ───────────────────────────────────────────────────────────────
# https://github.com/fatedier/frp/
echo ">>> Downloading frpc ${FRP_VER}..."
curl -fL "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_arm64.tar.gz" \
    | tar xz --strip-components=1 -C "${DEST}" "frp_${FRP_VER}_linux_arm64/frpc"
chmod +x "${DEST}/frpc"
echo "    frpc: OK"

# ── easytier-core ──────────────────────────────────────────────────────
# https://github.com/EasyTier/EasyTier
echo ">>> Downloading easytier ${EASYTIER_VER}..."
curl -fL "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-aarch64-${EASYTIER_VER}.zip" \
    -o /tmp/easytier.zip
unzip -jo /tmp/easytier.zip "*/easytier-core" -d "${DEST}"
chmod +x "${DEST}/easytier-core"
rm /tmp/easytier.zip
echo "    easytier-core: OK"

# ── mihomo ─────────────────────────────────────────────────────────────
# https://github.com/MetaCubeX/mihomo
# Clash.Meta 内核，做透明代理网关；arm64 资产为 gzip 单文件
echo ">>> Downloading mihomo ${MIHOMO_VER}..."
curl -fL "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VER}/mihomo-linux-arm64-${MIHOMO_VER}.gz" \
    -o /tmp/mihomo.gz
gunzip -f /tmp/mihomo.gz
mv /tmp/mihomo "${DEST}/mihomo"
chmod +x "${DEST}/mihomo"
echo "    mihomo: OK"

# ── metacubexd ─────────────────────────────────────────────────────────
# https://github.com/MetaCubeX/metacubexd
# Clash API 的 Web 仪表盘（静态资源），解压到 var/www，由 nginx 托管
echo ">>> Downloading metacubexd ${METACUBEXD_VER}..."
mkdir -p "${WWW_METACUBEXD}"
curl -fL "https://github.com/MetaCubeX/metacubexd/releases/download/${METACUBEXD_VER}/compressed-dist.tgz" \
    | tar xz -C "${WWW_METACUBEXD}"
echo "    metacubexd: OK"

# ── xray-exporter ──────────────────────────────────────────────────────
# https://github.com/compassvpn/xray-exporter
# 读取 Xray StatsService(gRPC) 并暴露 per-user Prometheus 指标，供计费使用
echo ">>> Downloading xray-exporter ${XRAY_EXPORTER_VER}..."
curl -fL "https://github.com/compassvpn/xray-exporter/releases/download/${XRAY_EXPORTER_VER}/xray-exporter-linux-arm64" \
    -o "${DEST}/xray-exporter"
chmod +x "${DEST}/xray-exporter"
echo "    xray-exporter: OK"

echo ""
echo ">>> All binaries downloaded:"
ls -lh "${DEST}"
echo ""
echo ">>> metacubexd 面板已部署到: ${WWW_METACUBEXD}"
