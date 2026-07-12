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
    # cp -a 保留构建主机的 UID/GID（kent:kent），只修正 overlay 涉及的目录
    chown -R root:root /etc/hive /etc/xray /etc/frp /etc/cloudflared \
        /etc/systemd/system /etc/nginx /etc/update-motd.d \
        /etc/NetworkManager /etc/udev/rules.d /etc/mihomo \
        /usr/local/bin /var/www 2>/dev/null || true
    chmod +x /etc/update-motd.d/* 2>/dev/null || true
    echo ">>> Overlay files copied to root directory"
else
    echo ">>> WARNING: /tmp/overlay not found"
fi

# ─────────────────────────────────────────────
# 1. 系统基础调优
# ─────────────────────────────────────────────
cat > /etc/sysctl.d/99-hive.conf << 'EOF'
# IP 转发（代理节点必须，Cloudflare Mesh 也需要）
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv6.conf.all.accept_ra = 2

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
# 2. 添加第三方 apt 源（先加源，再统一 update + install）
# ─────────────────────────────────────────────

# Tailscale 官方 apt 源
echo ">>> Adding Tailscale apt repo..."
curl -fsSL "https://pkgs.tailscale.com/stable/debian/${RELEASE}.noarmor.gpg" \
    | tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] \
https://pkgs.tailscale.com/stable/debian ${RELEASE} main" \
    | tee /etc/apt/sources.list.d/tailscale.list

# Cloudflare WARP 官方 apt 源（Mesh 节点需要 warp-cli）
echo ">>> Adding Cloudflare WARP apt repo..."
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] \
https://pkg.cloudflareclient.com/ ${RELEASE} main" \
    | tee /etc/apt/sources.list.d/cloudflare-client.list

# ─────────────────────────────────────────────
# 3. 安装运行时依赖（单次 update + install）
# ─────────────────────────────────────────────
# apt-get update 容错：cloudflare-warp 源在部分构建环境（如国内 runner）可能不可达，
# 若因此让 update 非零退出会在 set -e 下拖垮整个构建。核心包索引若真缺失，
# 后面的 install 仍会硬失败，所以这里 `|| true` 是安全的。
apt-get update -q || true
# 核心运行时依赖 + tailscale（主管理通道，必需）。python3 供 hive-regen-hostkeys.sh
# 构造确定性 SSH host key 用；缺它会导致离线首启无 host key。这批任一失败即中止构建。
apt-get install -y --no-install-recommends \
    curl \
    jq \
    ca-certificates \
    gnupg \
    python3 \
    prometheus-node-exporter \
    ufw \
    fail2ban \
    unattended-upgrades \
    auditd \
    nginx \
    zsh \
    net-tools \
    vim \
    wpasupplicant \
    hostapd \
    dnsmasq-base \
    iw \
    nftables \
    tailscale \
    cloudflare-warp

# hostapd：5G 热点用独立 hostapd 托管（NM 内建 wpa_supplicant 在 MT7922 上开 80MHz 会失败）。
#   屏蔽发行版自带的 hostapd.service（读 /etc/default/hostapd、DAEMON_CONF 空会空跑/报错）——
#   我们用自定义 unit hive-hotspot-5g.service 显式指定配置。
# dnsmasq：仅装 dnsmasq-base（提供 /usr/sbin/dnsmasq 二进制、无自启 service），
#   不装完整 dnsmasq 包——完整包带的默认 service 监听全接口 53/67，会与 2.4G 的 NM 内建
#   dnsmasq(10.42.0.1)、systemd-resolved(127.0.0.53) 抢端口。5G 的 DHCP/DNS 由
#   hive-hotspot-5g-dnsmasq.service 用 --conf-file + bind-interfaces 只绑 AP 口驱动。
systemctl mask hostapd.service 2>/dev/null || true

# WiFi 热点固件（AX210 需 iwlwifi-ty-*，MT7921/MT7922 需 mediatek/WIFI_*MT79*）。
# 非致命：基础镜像通常已带 armbian-firmware；缺失则尝试补装，失败不中止构建。
# 注意：必须独立逐包尝试——armbian-firmware-full 即便装上也未必含 MT7922 固件，
#       故无论它成功与否都再补装 Debian 的 firmware-mediatek（非 non-free 源装不到时跳过）。
echo ">>> Installing WiFi firmware for hotspot (non-fatal)..."
# 确保 Debian non-free-firmware 组件启用，否则 firmware-mediatek/iwlwifi 装不到。
# Armbian minimal 镜像的 .sources 可能只含 main。deb822 与 one-line 两种格式都处理。
for sf in /etc/apt/sources.list.d/*.sources; do
    [ -f "$sf" ] || continue
    if grep -q "debian" "$sf" 2>/dev/null && ! grep -qi "non-free-firmware" "$sf"; then
        sed -i '/^Components:/ s/$/ contrib non-free non-free-firmware/' "$sf"
    fi
done
if [ -f /etc/apt/sources.list ] && grep -qE "^deb .*debian" /etc/apt/sources.list 2>/dev/null \
        && ! grep -qi "non-free-firmware" /etc/apt/sources.list; then
    sed -i '/^deb .*debian/ s/ main\( .*\)\?$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list
fi
apt-get update -q 2>/dev/null || true
apt-get install -y --no-install-recommends armbian-firmware-full 2>/dev/null \
    || echo ">>> armbian-firmware-full not available, will rely on Debian firmware-* pkgs"
for fw in firmware-mediatek firmware-iwlwifi firmware-misc-nonfree firmware-realtek; do
    apt-get install -y --no-install-recommends "$fw" 2>/dev/null \
        && echo ">>> firmware pkg installed: $fw" \
        || echo ">>> firmware pkg skipped (unavailable): $fw"
done
# 校验关键固件是否就位（MT7922 是当前实测用卡），缺失仅告警不中止
if ls /lib/firmware/mediatek/WIFI_*MT7922* >/dev/null 2>&1; then
    echo ">>> MT7922 firmware present: OK"
else
    echo ">>> WARNING: MT7922 firmware missing — MT7921/7922 WiFi/热点将无法启用"
fi

# 监管域数据库签名：Debian 的 wireless-regdb 默认 alternative 指向 regulatory.db-debian
# （priority 100），但 Armbian 内核（mainline 系）编进去的是上游 sforshee 证书，验签失败
# → 内核弃用 regdb、监管域卡在 world 00 → 5GHz AP 因 PASSIVE-SCAN(no-IR) 起不来
#   （2026-07-04 MT7922/rockchip64 实测：dmesg "regulatory.db ... signature invalid"，
#    iw reg set CN 静默失败、iw reg get 恒为 country 00，5G 热点 supplicant-timeout）。
# 强制切到 upstream 签名，使内核能加载 regdb、iw reg set <国家码> 真正生效。slave 的 .p7s 自动跟切。
if update-alternatives --list regulatory.db 2>/dev/null | grep -q upstream; then
    update-alternatives --set regulatory.db /lib/firmware/regulatory.db-upstream \
        && echo ">>> regulatory.db → upstream 签名（匹配 Armbian mainline 内核证书）" \
        || echo ">>> WARNING: 无法切换 regulatory.db 到 upstream，5GHz 热点可能起不来"
fi

# 清理 apt 缓存，减少镜像体积
apt-get clean
rm -rf /var/lib/apt/lists/*

# ─────────────────────────────────────────────
# 4. 设置二进制权限（由 download-binaries.sh 预置到 overlay）
# ─────────────────────────────────────────────
MISSING_BINARIES=""
for bin in xray cloudflared frpc easytier-core xray-exporter; do
    if [ -f "/usr/local/bin/${bin}" ]; then
        chmod +x "/usr/local/bin/${bin}"
        echo ">>> ${bin}: OK"
    else
        echo ">>> WARNING: /usr/local/bin/${bin} not found (run download-binaries.sh first)"
        MISSING_BINARIES="${MISSING_BINARIES} ${bin}"
    fi
done

# Hive 运维脚本权限
if [ -f "/usr/local/bin/hive-xray-sync" ]; then
    chmod +x /usr/local/bin/hive-xray-sync
    echo ">>> hive-xray-sync: OK"
fi

# 透明代理网关：拓扑配置脚本 + Mihomo 配置同步脚本
if [ -f "/usr/local/bin/hive-gateway.sh" ]; then
    chmod +x /usr/local/bin/hive-gateway.sh
    echo ">>> hive-gateway.sh: OK"
fi
if [ -f "/usr/local/bin/hive-command-agent" ]; then
    chmod +x /usr/local/bin/hive-command-agent
    echo ">>> hive-command-agent: OK"
fi
if [ -f "/usr/local/bin/hive-clash-sync" ]; then
    chmod +x /usr/local/bin/hive-clash-sync
    echo ">>> hive-clash-sync: OK"
fi
if [ -f "/usr/local/bin/mihomo" ]; then
    chmod +x /usr/local/bin/mihomo
    echo ">>> mihomo: OK"
fi

# WiFi 热点：脚本可执行 + NM dispatcher 可执行（NM 只跑可执行的 dispatcher）
if [ -f "/usr/local/bin/hive-hotspot.sh" ]; then
    chmod +x /usr/local/bin/hive-hotspot.sh
    echo ">>> hive-hotspot.sh: OK"
fi
if [ -f "/usr/local/bin/hive-test.sh" ]; then
    chmod +x /usr/local/bin/hive-test.sh
    echo ">>> hive-test.sh: OK"
fi
if [ -f "/etc/NetworkManager/dispatcher.d/90-hive-hotspot" ]; then
    chmod 755 /etc/NetworkManager/dispatcher.d/90-hive-hotspot
    echo ">>> NM dispatcher 90-hive-hotspot: OK"
fi
# 5G hostapd/dnsmasq 两个 unit：仅设属主权限，不 enable——由 hive-hotspot.sh 按需
# systemctl restart 拉起（ConditionPathExists 防无配置空跑），开机自启经 hive-hotspot.service 间接保证。
for u in hive-hotspot-5g.service hive-hotspot-5g-dnsmasq.service; do
    if [ -f "/etc/systemd/system/$u" ]; then
        chown root:root "/etc/systemd/system/$u"
        chmod 644 "/etc/systemd/system/$u"
        echo ">>> systemd unit $u: OK"
    fi
done

if [ -f "/usr/local/bin/provision-node.sh" ]; then
    chmod +x /usr/local/bin/provision-node.sh
    echo ">>> provision-node.sh: OK"
else
    echo ">>> WARNING: /usr/local/bin/provision-node.sh not found (run download-binaries.sh first)"
    MISSING_BINARIES="${MISSING_BINARIES} provision-node.sh"
fi

if [ -f "/usr/local/bin/hive-regen-hostkeys.sh" ]; then
    chmod +x /usr/local/bin/hive-regen-hostkeys.sh
    echo ">>> hive-regen-hostkeys.sh: OK"
else
    echo ">>> WARNING: /usr/local/bin/hive-regen-hostkeys.sh not found"
    MISSING_BINARIES="${MISSING_BINARIES} hive-regen-hostkeys.sh"
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
echo ">>> Root password configured"

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

# SSH 安全加固
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

# host key 首启重建：必须在 sshd 之前、不依赖网络，否则镜像清洗删 key 后 sshd 永久失败
if [ -f "/etc/systemd/system/hive-regen-hostkeys.service" ]; then
    systemctl enable hive-regen-hostkeys.service
    echo ">>> hive-regen-hostkeys.service enabled"
else
    echo ">>> ERROR: hive-regen-hostkeys.service not found"
    exit 1
fi

systemctl enable tailscaled.service   # daemon 预启动，tailscale up 由 provision 执行
systemctl enable warp-svc.service    # WARP daemon 预启动，warp-cli 注册由 provision 执行
systemctl enable prometheus-node-exporter.service
# nginx：禁用默认站点，启用 hive 站点
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/hive /etc/nginx/sites-enabled/hive
systemctl enable nginx.service
systemctl enable hive-firewall.service  # 启动时自动配置防火墙
systemctl enable hive-fail2ban.service  # 启动时自动配置入侵防护
systemctl enable auditd.service        # 系统审计日志
systemctl enable unattended-upgrades.service  # 自动安全更新

# WiFi 热点：开机自动检测无线网卡并开热点（无卡则脚本自行退出，无副作用）
if [ -f "/etc/systemd/system/hive-hotspot.service" ]; then
    systemctl enable hive-hotspot.service
    echo ">>> hive-hotspot.service enabled"
fi

# 透明代理网关：开机配 WAN/LAN 拓扑 + 启 Mihomo + 周期同步配置（单网口设备自退）
if [ -f "/etc/systemd/system/hive-gateway.service" ]; then
    systemctl enable hive-gateway.service
    echo ">>> hive-gateway.service enabled"
fi
if [ -f "/etc/systemd/system/hive-mihomo.service" ]; then
    systemctl enable hive-mihomo.service
    echo ">>> hive-mihomo.service enabled"
fi
if [ -f "/etc/systemd/system/hive-clash-sync.timer" ]; then
    systemctl enable hive-clash-sync.timer
    echo ">>> hive-clash-sync.timer enabled"
fi
if [ -f "/etc/systemd/system/hive-command-agent.timer" ]; then
    systemctl enable hive-command-agent.timer
    echo ">>> hive-command-agent.timer enabled"
fi
# MetaCubeXD 面板静态资源校验（由 download-binaries.sh 预置，Mihomo external-ui 托管）
if [ -d "/var/www/metacubexd" ] && [ -n "$(ls -A /var/www/metacubexd 2>/dev/null)" ]; then
    echo ">>> metacubexd panel: OK"
else
    echo ">>> WARNING: /var/www/metacubexd empty (run download-binaries.sh first; panel UI 将不可用)"
fi

# ─────────────────────────────────────────────
# 7. apt 源：多镜像冗余（国内源容易 403，多列几个互为 fallback）
# ─────────────────────────────────────────────
# DEB822 URIs 字段支持多个空格分隔的 URI，apt 自动选最快可用的
# echo ">>> Configuring multi-mirror apt sources..."

# # debian.sources 有两个 stanza（主源 + security），按内容分别替换
# if [ -f /etc/apt/sources.list.d/debian.sources ]; then
#     # 主源（匹配含 /debian 但不含 security 的 URIs 行）
#     sed -i '/security/!s|^URIs:.*debian.*|URIs: https://mirrors.tuna.tsinghua.edu.cn/debian https://mirrors.ustc.edu.cn/debian https://mirrors.aliyun.com/debian https://deb.debian.org/debian|' \
#         /etc/apt/sources.list.d/debian.sources
#     # security 源
#     sed -i 's|^URIs:.*security.*|URIs: https://mirrors.tuna.tsinghua.edu.cn/debian-security https://mirrors.ustc.edu.cn/debian-security https://security.debian.org/|' \
#         /etc/apt/sources.list.d/debian.sources
# fi

# # ubuntu.sources
# if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
#     sed -i 's|^URIs:.*|URIs: https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports/ https://mirrors.ustc.edu.cn/ubuntu-ports/ https://mirrors.aliyun.com/ubuntu-ports/ https://ports.ubuntu.com/|' \
#         /etc/apt/sources.list.d/ubuntu.sources
# fi

# # armbian.sources
# if [ -f /etc/apt/sources.list.d/armbian.sources ]; then
#     sed -i 's|^URIs:.*|URIs: https://mirrors.tuna.tsinghua.edu.cn/armbian https://mirrors.ustc.edu.cn/armbian https://apt.armbian.com|' \
#         /etc/apt/sources.list.d/armbian.sources
# fi

echo ">>> apt sources: multi-mirror configured (tuna/ustc/aliyun/official)"

# ─────────────────────────────────────────────
# 7.5 串口全 log（出厂默认：所有镜像启动即把内核 log 全打出来）
# ─────────────────────────────────────────────
# 目的：批量部署的边缘节点出问题时，插串口即可看到从内核入口起的完整 log，
#       无需再手动改卡。earlycon 让 8250 串口 probe 完成前的早期 log（DTB/SMP/
#       时钟/initramfs）也可见，曾据此定位 Zero2 的 CONFIG_TMPFS 缺失卡死。
# 机制：boot-rk35xx.cmd 等 bootscript 读 armbianEnv.txt：earlycon=on → cmdline 加
#       裸 earlycon（由 DTB stdout-path 推导地址）；verbosity 即 loglevel。
# 幂等：存在则改值，不存在则追加。chroot 内 /boot 即 boot 分区，会进最终镜像。
echo ">>> Enabling full serial boot log (earlycon + verbosity=7)..."
ENVF=/boot/armbianEnv.txt
if [ -f "$ENVF" ]; then
    set_env_kv() {
        local k="$1" v="$2"
        if grep -qE "^${k}=" "$ENVF"; then
            sed -i "s|^${k}=.*|${k}=${v}|" "$ENVF"
        else
            echo "${k}=${v}" >> "$ENVF"
        fi
    }
    set_env_kv verbosity 7
    set_env_kv earlycon on
    echo ">>> armbianEnv.txt: verbosity=7 earlycon=on"
else
    echo ">>> WARNING: $ENVF not found, skip full-log setup"
fi

# ─────────────────────────────────────────────
# 8. 镜像清洗（移除唯一标识，供批量烧录）
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
