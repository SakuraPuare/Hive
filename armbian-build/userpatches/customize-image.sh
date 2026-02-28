#!/bin/bash
# Armbian 构建钩子 — 在 chroot 内执行
# overlay/ 目录通过 bind mount 挂载到 /tmp/overlay，需要手动复制
# 参数: $1=RELEASE $2=LINUXFAMILY $3=BOARD $4=BUILD_DESKTOP $5=ARCH

set -e
RELEASE="$1"
ARCH="$5"

echo ">>> customize-image.sh: RELEASE=${RELEASE} ARCH=${ARCH}"

# ─────────────────────────────────────────────
# 0. 从overlay复制文件到根目录
# ─────────────────────────────────────────────
echo ">>> Copying overlay files to root..."
if [ -d "/tmp/overlay" ]; then
    cp -a /tmp/overlay/* / 2>/dev/null || true
    # cp -a 会保留构建主机的 UID/GID（kent:kent），必须修正回 root:root
    chown -R root:root /etc /usr/local/bin 2>/dev/null || true
    # 确保 MOTD 脚本可执行
    chmod +x /etc/update-motd.d/* 2>/dev/null || true
    echo ">>> Overlay files copied to root directory"
else
    echo ">>> WARNING: /tmp/overlay not found"
fi

# ─────────────────────────────────────────────
# 1. 系统基础调优
# ─────────────────────────────────────────────
cat >> /etc/sysctl.d/99-hive.conf << 'EOF'
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

# 内核安全加固
cat > /etc/sysctl.d/99-hive-security.conf << 'EOF'
# 防 SYN flood
net.ipv4.tcp_syncookies = 1

# 防 IP 欺骗（反向路径过滤）
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# 禁止 ICMP 重定向
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# 禁止源路由
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# 忽略伪造 ICMP 错误
net.ipv4.icmp_ignore_bogus_error_responses = 1

# 记录异常包（Martian packets）
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# ASLR（地址空间随机化）
kernel.randomize_va_space = 2
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
    prometheus-node-exporter \
    ufw \
    fail2ban \
    unattended-upgrades \
    auditd \
    nginx \
    zsh \
    net-tools \
    vim

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
MISSING_BINARIES=""
for bin in xray cloudflared frpc easytier-core; do
    if [ -f "/usr/local/bin/${bin}" ]; then
        chmod +x "/usr/local/bin/${bin}"
        echo ">>> ${bin}: OK"
    else
        echo ">>> WARNING: /usr/local/bin/${bin} not found (run download-binaries.sh first)"
        MISSING_BINARIES="${MISSING_BINARIES} ${bin}"
    fi
done

if [ -f "/usr/local/bin/provision-node.sh" ]; then
    chmod +x /usr/local/bin/provision-node.sh
    echo ">>> provision-node.sh: OK"
else
    echo ">>> WARNING: /usr/local/bin/provision-node.sh not found (run download-binaries.sh first)"
    MISSING_BINARIES="${MISSING_BINARIES} provision-node.sh"
fi

if [ -n "$MISSING_BINARIES" ]; then
    echo ">>> ERROR: Missing binaries:$MISSING_BINARIES"
    echo ">>> Please run: ./scripts/download-binaries.sh"
    exit 1
fi

# ─────────────────────────────────────────────
# 5. 创建目录和权限
# ─────────────────────────────────────────────
mkdir -p /etc/hive /etc/cloudflared /etc/xray /etc/frp
# config.env 由 build.sh 渲染后放入 overlay，此处确保权限
chmod 600 /etc/hive/config.env 2>/dev/null || true

# ─────────────────────────────────────────────
# 5.5. 预设账号密码（跳过首次启动交互）
# ─────────────────────────────────────────────
echo ">>> Setting up pre-configured user accounts..."

# 从 overlay 渲染好的配置文件读取密码
[ -f /etc/hive/config.env ] && . /etc/hive/config.env

ROOT_PASSWORD="${DEFAULT_ROOT_PASSWORD:-1234}"
echo "root:${ROOT_PASSWORD}" | chpasswd
echo ">>> Root password set to: ${ROOT_PASSWORD}"

# 完全禁用首次登录交互（只保留root账号）
echo ">>> Disabling first login interactive setup..."

# 移除首次登录触发文件
rm -f /root/.not_logged_in_yet

# 禁用首次登录检查脚本
chmod -x /etc/profile.d/armbian-check-first-login.sh 2>/dev/null || true
chmod -x /etc/profile.d/armbian-check-first-login-reboot.sh 2>/dev/null || true

# 禁用首次登录服务
systemctl disable armbian-firstrun.service 2>/dev/null || true
systemctl mask armbian-firstrun.service 2>/dev/null || true

# 设置root默认shell为zsh
chsh -s /bin/zsh root

# SSH 安全加固：仅允许密钥登录
echo ">>> Hardening SSH configuration..."
cat > /etc/ssh/sshd_config.d/99-hive-hardening.conf << 'EOF'
PermitRootLogin yes
PasswordAuthentication yes
KbdInteractiveAuthentication no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
EOF

echo ">>> First login interactive setup completely disabled - root only mode"

# 自动安全更新
echo ">>> Configuring unattended-upgrades..."
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# ─────────────────────────────────────────────
# 6. 启用服务（只启用 provision-node，其余由它在首次启动时 enable）
# ─────────────────────────────────────────────
if [ -f "/etc/systemd/system/provision-node.service" ]; then
    systemctl enable provision-node.service
    echo ">>> provision-node.service enabled"
else
    echo ">>> ERROR: provision-node.service not found"
    exit 1
fi

systemctl enable tailscaled.service   # daemon 预启动，tailscale up 由 provision 执行
systemctl enable prometheus-node-exporter.service
# nginx：禁用默认站点，启用 hive 站点
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/hive /etc/nginx/sites-enabled/hive
systemctl enable nginx.service
systemctl enable hive-firewall.service  # 启动时自动配置防火墙
systemctl enable hive-fail2ban.service  # 启动时自动配置入侵防护
systemctl enable auditd.service        # 系统审计日志
systemctl enable unattended-upgrades.service  # 自动安全更新

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
