#!/bin/bash
#
# Hive Network Node fail2ban 配置脚本
# 提供自动入侵检测和防护
#

set -e

echo ">>> 配置 fail2ban 入侵防护..."

# 检查是否已安装 fail2ban
if ! command -v fail2ban-server >/dev/null 2>&1; then
    echo "ERROR: fail2ban not installed. Installing..."
    apt-get update && apt-get install -y fail2ban
fi

# 创建配置目录
mkdir -p /etc/fail2ban/jail.d
mkdir -p /etc/fail2ban/filter.d
mkdir -p /etc/fail2ban/action.d

echo "配置 fail2ban 基础设置..."

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 基础配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 构建 ignoreip：静态地址段 + EasyTier 中继服务器 IP
IGNOREIP="127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12 100.0.0.0/8 fe80::/10"

if [ -n "${EASYTIER_PEERS:-}" ]; then
    echo "  解析 EasyTier 中继服务器 IP..."
    RELAY_HOSTS=$(echo "${EASYTIER_PEERS}" | tr ',' '\n' \
        | sed 's|.*://||;s|:.*||' | sed '/^[[:space:]]*$/d' | sort -u)
    for HOST in $RELAY_HOSTS; do
        [ -z "$HOST" ] && continue
        IP=$(getent hosts "$HOST" 2>/dev/null | awk '{print $1; exit}')
        IP=${IP:-$HOST}
        IGNOREIP="$IGNOREIP $IP"
        echo "  EasyTier 中继白名单: $HOST → $IP"
    done
else
    echo "  EASYTIER_PEERS 未配置，跳过中继 IP 解析"
fi

cat > /etc/fail2ban/jail.d/hive-defaults.conf << EOF
[DEFAULT]
# 白名单（不被封禁的 IP）
ignoreip = ${IGNOREIP}

# 封禁时间（默认 1 小时）
bantime = 3600

# 查找时间窗口（10 分钟）
findtime = 600

# 最大重试次数（5 次）
maxretry = 5

# 后端类型（systemd 日志）
backend = systemd

# 封禁动作（与 ufw 集成）
banaction = ufw
banaction_allports = ufw

# 邮件通知设置（可选）
# destemail = admin@yourdomain.com
# sender = fail2ban@hive-node
# mta = sendmail

# 动作配置
action = %(action_)s
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SSH 保护
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cat > /etc/fail2ban/jail.d/hive-ssh.conf << 'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
maxretry = 3
bantime = 7200
findtime = 600

# SSH 暴力破解保护（更严格）
[sshd-aggressive]
enabled = true
port = ssh
filter = sshd[mode=aggressive]
logpath = %(sshd_log)s
maxretry = 2
bantime = 86400
findtime = 300
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 自定义过滤器 - 异常连接检测
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cat > /etc/fail2ban/filter.d/hive-suspicious.conf << 'EOF'
# Hive Network 可疑连接检测
[Definition]

# 检测端口扫描
failregex = ^.*kernel:.*IN=.*OUT= MAC=.*SRC=<HOST>.*DPT=(?:22|23|25|53|80|110|143|443|993|995|3389|5432|5900).*$
            ^.*UFW BLOCK.*SRC=<HOST>.*DPT=(?:22|23|25|53|80|110|143|443|993|995|3389|5432|5900).*$

ignoreregex =

# 时间格式
datepattern = ^%%b\s+%%d\s+%%H:%%M:%%S
EOF

cat > /etc/fail2ban/jail.d/hive-suspicious.conf << 'EOF'
[hive-portscan]
enabled = true
filter = hive-suspicious
logpath = /var/log/kern.log
           /var/log/ufw.log
maxretry = 10
findtime = 60
bantime = 3600
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 系统服务攻击检测
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cat > /etc/fail2ban/jail.d/hive-services.conf << 'EOF'
# PAM 通用认证失败（涵盖 sudo、su、login 等）
[pam-generic]
enabled = true
filter = pam-generic
backend = systemd
maxretry = 5
bantime = 3600
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# UFW 集成配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 确保 UFW 开启 IPv6 支持（否则无法封禁 IPv6 地址）
sed -i 's/^IPV6=no/IPV6=yes/' /etc/default/ufw

cat > /etc/fail2ban/action.d/ufw.conf << 'EOF'
# UFW 封禁动作（兼容 IPv4 + IPv6）
[Definition]

actionstart =
actionstop =
actioncheck = ufw status | grep -q active
actionban = ufw insert 1 deny from <ip> to any
actionunban = ufw --force delete deny from <ip> to any

[Init]
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 日志轮转配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cat > /etc/logrotate.d/fail2ban-hive << 'EOF'
/var/log/fail2ban.log {
    daily
    missingok
    rotate 30
    compress
    notifempty
    create 0640 root adm
    postrotate
        /usr/bin/fail2ban-client flushlogs 1>/dev/null || true
    endscript
}
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 启用服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "启用并启动 fail2ban 服务..."
systemctl enable fail2ban
systemctl restart fail2ban

# 等待服务启动
sleep 3

echo ""
echo "✅ fail2ban 配置完成！"
echo ""
echo "当前状态："
fail2ban-client status

echo ""
echo "📋 已启用的保护："
echo "  - SSH 暴力破解防护"
echo "  - 端口扫描检测"
echo "  - 系统认证失败检测"
echo "  - sudo 滥用检测"
echo ""
echo "🔧 管理命令："
echo "  fail2ban-client status              # 查看状态"
echo "  fail2ban-client status sshd         # 查看 SSH 保护状态"
echo "  fail2ban-client unban <IP>          # 手动解封 IP"
echo "  tail -f /var/log/fail2ban.log       # 查看实时日志"

exit 0