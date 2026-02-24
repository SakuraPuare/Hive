#!/bin/bash
# Armbian 构建钩子 — 在 chroot 内执行
# 此时 overlay/ 目录的文件已被复制到镜像根目录
# 参数: $1=RELEASE $2=LINUXFAMILY $3=BOARD $4=BUILD_DESKTOP $5=ARCH

set -e
RELEASE="$1"
ARCH="$5"

echo ">>> customize-image.sh: RELEASE=${RELEASE} ARCH=${ARCH}"

# ─────────────────────────────────────────────
# 1. 系统基础调优
# ─────────────────────────────────────────────
cat >> /etc/sysctl.d/99-edge.conf << 'EOF'
# IP 转发（代理节点必须）
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# 网络缓冲区（提升代理吞吐）
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576

# TCP 性能
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_congestion_control = bbr
EOF

# ─────────────────────────────────────────────
# 2. 安装运行时依赖
# ─────────────────────────────────────────────
apt-get update -q
apt-get install -y --no-install-recommends \
    curl \
    jq \
    ca-certificates \
    gnupg \
    prometheus-node-exporter

# ─────────────────────────────────────────────
# 3. 安装 Tailscale（官方 apt 源）
# ─────────────────────────────────────────────
echo ">>> Installing Tailscale..."
curl -fsSL "https://pkgs.tailscale.com/stable/debian/${RELEASE}.noarmor.gpg" \
    | tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] \
https://pkgs.tailscale.com/stable/debian ${RELEASE} main" \
    | tee /etc/apt/sources.list.d/tailscale.list
apt-get update -q
apt-get install -y tailscale

# ─────────────────────────────────────────────
# 4. 设置二进制权限（由 download-binaries.sh 预置到 overlay）
# ─────────────────────────────────────────────
for bin in xray cloudflared frpc easytier-core; do
    if [ -f "/usr/local/bin/${bin}" ]; then
        chmod +x "/usr/local/bin/${bin}"
        echo ">>> ${bin}: OK"
    else
        echo ">>> WARNING: /usr/local/bin/${bin} not found (run download-binaries.sh first)"
    fi
done

chmod +x /usr/local/bin/provision-node.sh

# ─────────────────────────────────────────────
# 5. 创建目录和权限
# ─────────────────────────────────────────────
mkdir -p /etc/edge /etc/cloudflared /etc/xray /etc/frp
# config.env 由 build.sh 渲染后放入 overlay，此处确保权限
chmod 600 /etc/edge/config.env 2>/dev/null || true

# ─────────────────────────────────────────────
# 6. 启用服务（只启用 provision-node，其余由它在首次启动时 enable）
# ─────────────────────────────────────────────
systemctl enable provision-node.service
systemctl enable tailscaled.service   # daemon 预启动，tailscale up 由 provision 执行
systemctl enable prometheus-node-exporter.service

# ─────────────────────────────────────────────
# 7. 镜像清洗（移除唯一标识，供批量烧录）
# ─────────────────────────────────────────────
echo ">>> Sanitizing image for mass deployment..."
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
rm -f /etc/ssh/ssh_host_*
rm -f /var/lib/tailscale/tailscaled.state 2>/dev/null || true
journalctl --rotate 2>/dev/null && journalctl --vacuum-time=1s 2>/dev/null || true
find /var/log -name "*.log" -delete 2>/dev/null || true
history -c 2>/dev/null || true

echo ">>> customize-image.sh done."
