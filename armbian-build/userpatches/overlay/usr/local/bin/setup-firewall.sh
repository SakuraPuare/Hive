#!/bin/bash
#
# Hive Network Node 防火墙配置脚本
# 只开放必要的端口，提高安全性
#
# 使用策略：
# - 默认拒绝所有入站连接
# - 允许必要的出站连接
# - 仅开放 SSH 和 Node Exporter 端口
# - 限制 SSH 访问来源（可选）
#

set -e

# 加载节点配置（EASYTIER_PEERS、FRP_SERVER_PORT 等）
[ -f /etc/hive/config.env ] && source /etc/hive/config.env

echo ">>> 配置 Hive Node 防火墙..."

# 检查是否已安装 ufw
if ! command -v ufw >/dev/null 2>&1; then
    echo "ERROR: ufw not installed. Installing..."
    apt-get update && apt-get install -y ufw
fi

# 重置防火墙规则
echo "重置防火墙规则..."
ufw --force reset
ufw logging off

# 设置默认策略：拒绝入站，允许出站，拒绝转发
ufw default deny incoming
ufw default allow outgoing
ufw default deny forward

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 基础系统服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 允许环回接口
echo "允许环回接口..."
ufw allow in on lo
ufw allow out on lo

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SSH 访问控制
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# SSH 端口 22 - 限制访问来源
echo "配置 SSH 访问..."

# 允许本地网络 SSH（根据实际网络调整）
ufw allow from 192.168.0.0/16 to any port 22 comment 'SSH - Local Network'
ufw allow from 10.0.0.0/8 to any port 22 comment 'SSH - Private Network'
ufw allow from 172.16.0.0/12 to any port 22 comment 'SSH - Private Network'

# Tailscale 网络范围（CGNAT 段 100.64.0.0/10，非整个 100/8——后者含公网可路由地址）
ufw allow from 100.64.0.0/10 to any port 22 comment 'SSH - Tailscale'

# 如果需要允许特定公网 IP，取消注释并修改：
# ufw allow from YOUR_OFFICE_IP to any port 22 comment 'SSH - Office IP'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 监控和管理服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Prometheus Node Exporter (9100) - Tailscale + EasyTier 双路监控互备
echo "配置监控服务..."
ufw allow from 100.64.0.0/10 to any port 9100 comment 'Node Exporter - Tailscale'
# EasyTier 网段 (172.20.0.0/16)：Prometheus 经集群内 easytier pod 走这条路抓
ufw allow from 172.20.0.0/16 to any port 9100 comment 'Node Exporter - EasyTier'

# Xray Exporter (9550) - per-user 流量指标，Tailscale + EasyTier
ufw allow from 100.64.0.0/10 to any port 9550 comment 'Xray Exporter - Tailscale'
ufw allow from 172.20.0.0/16 to any port 9550 comment 'Xray Exporter - EasyTier'

# 如果有其他监控系统，取消注释并调整：
# ufw allow from YOUR_MONITORING_IP to any port 9100 comment 'Node Exporter - Monitoring'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# EasyTier（监听 P2P 端口，支持对端直连）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# EasyTier 默认监听 11010(tcp/udp) + 11011(udp/ws) + 11012(wss/tcp) 等待对端直连(P2P)。
# 不放行时 LAN 邻居与公网对端的直连 SYN 被 UFW BLOCK，只能退回走 relay（延迟/带宽差）。
# 放行后可建直连。EasyTier 有 network-secret 加密鉴权，对端无密钥无法入网，故放行全网段。
echo "配置 EasyTier P2P 监听端口直连放行..."
ufw allow proto tcp to any port 11010:11012 comment 'EasyTier P2P - TCP/WS/WSS'
ufw allow proto udp to any port 11010:11011 comment 'EasyTier P2P - UDP'

# 中继回包放行：
# 问题：EasyTier 发出 UDP 时源端口随机（如 43232→relay:11010），
#       中继 STUN 回包源端口不同（如 relay:40836→43232），
#       conntrack 无法识别为 ESTABLISHED，UFW 直接 BLOCK。
# 解法：允许来自中继服务器 IP 的全部 UDP 入站（不限端口）。
echo "配置 EasyTier 中继服务器 UDP 放行..."
if [ -n "${EASYTIER_PEERS}" ]; then
    # 提取所有唯一主机名（去协议前缀和端口）
    RELAY_HOSTS=$(echo "${EASYTIER_PEERS}" | tr ',' '\n' \
        | sed 's|.*://||;s|:.*||' | sed '/^[[:space:]]*$/d' | sort -u)
    for HOST in $RELAY_HOSTS; do
        [ -z "$HOST" ] && continue
        # 解析主机名为 IP（失败则直接用原值）
        IP=$(getent hosts "$HOST" 2>/dev/null | awk '{print $1; exit}')
        IP=${IP:-$HOST}
        ufw allow in proto udp from "$IP" comment "EasyTier relay: $HOST"
        echo "  允许 UDP 入站来自 $HOST ($IP)"
    done
else
    echo "  EASYTIER_PEERS 未配置，跳过"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 网络诊断和安全
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ICMP (ping) — ufw 默认 before.rules 已允许 echo-request，无需额外规则
echo "配置网络诊断..."

# 允许 DHCP 客户端（如果使用 DHCP）
ufw allow out 67 comment 'DHCP Client'
ufw allow out 68 comment 'DHCP Client'

# 允许 NTP 时间同步
ufw allow out 123 comment 'NTP Time Sync'

# 允许 DNS 查询
ufw allow out 53 comment 'DNS Queries'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 隧道和代理服务（出站连接）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Cloudflare Tunnel 端口说明见:
# https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/#required-for-tunnel-operation

echo "配置隧道服务..."

# Cloudflare Tunnel - 隧道运行必需：7844 (http2/quic)
ufw allow out 7844/tcp comment 'Cloudflare Tunnel - TCP (http2)'
ufw allow out 7844/udp comment 'Cloudflare Tunnel - UDP (quic)'

# Cloudflare Tunnel - 可选：443（更新检查、API、Access JWT 等）
ufw allow out 443 comment 'Cloudflare Tunnel - HTTPS (optional)'

# FRP Client - 根据您的 FRP_SERVER_PORT 配置（默认 7000）
# 从 .env 读取端口或使用默认值
FRP_PORT=${FRP_SERVER_PORT:-7000}

ufw allow out $FRP_PORT comment "FRP Client - Port $FRP_PORT"

# Tailscale - 通常使用 41641/udp 和 443/tcp
ufw allow out 41641/udp comment 'Tailscale - UDP'
ufw allow out 443/tcp comment 'Tailscale - TCP Fallback'

# Cloudflare WARP / Mesh - 使用 2408/udp 和 1701/udp
ufw allow out 2408/udp comment 'Cloudflare WARP - UDP'
ufw allow out 1701/udp comment 'Cloudflare WARP - UDP Fallback'
# WARP 虚拟网段（100.96.0.0/12）—— 允许 Mesh 节点间互通
ufw allow from 100.96.0.0/12 comment 'Cloudflare Mesh - Inbound'
ufw allow out to 100.96.0.0/12 comment 'Cloudflare Mesh - Outbound'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 透明代理网关 TUN 口（Mihomo Meta）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Mihomo TUN 用 system 内核栈（吞吐最高）：转发流量经内核 INPUT/FORWARD 链投递到
# Mihomo 监听口，默认 deny incoming/forward 会拦掉致握手失败（SYN 反复重传）。
# TUN 口（Meta）上的流量全部由 Mihomo 受控（dns-hijack + 规则分流），整口放行安全：
#   - in  on Meta：放行转发 TCP/UDP 投递到本机监听口（INPUT）
#   - out on Meta：放行 Mihomo 把回包/代理流量写回 TUN（OUTPUT）
#   - routed on Meta：放行下游设备经 TUN 的转发（FORWARD，绕过 default deny forward）
# 接口此刻可能尚未创建，ufw 仍会按接口名落规则，待 Meta 出现即生效。
GATEWAY_TUN_IFACE="${GATEWAY_TUN_IFACE:-Meta}"
echo "配置透明网关 TUN 口（${GATEWAY_TUN_IFACE}）放行..."
ufw allow in on "$GATEWAY_TUN_IFACE" comment 'Mihomo TUN - in'
ufw allow out on "$GATEWAY_TUN_IFACE" comment 'Mihomo TUN - out'
ufw route allow in on "$GATEWAY_TUN_IFACE" comment 'Mihomo TUN - forward in'
ufw route allow out on "$GATEWAY_TUN_IFACE" comment 'Mihomo TUN - forward out'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5GHz 热点（hostapd）转发/DHCP/DNS 放行
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5G 热点由 hostapd 独立托管（非 NM 连接），不触发 90-hive-hotspot NM dispatcher，
# 且本脚本开头 `ufw --force reset` 会清掉 hive-hotspot.sh 先前打的洞。故必须在此按
# AP 接口名自补放行（与 hive-hotspot.sh 的 apply_ufw_5g 同规则、同 comment，幂等叠加，
# 覆盖“防火墙先起 / 热点先起”两种启动顺序）。接口名从 hive-hotspot.sh 写的 env 读取。
# 2.4G 仍走 NM shared，由 90-hive-hotspot dispatcher 动态放行，不在此处理。
if [ -f /etc/hive/hotspot-5g.env ]; then
    . /etc/hive/hotspot-5g.env
    if [ -n "${AP_IFACE:-}" ]; then
        echo "配置 5G 热点（hostapd）放行：$AP_IFACE ..."
        ufw route allow in on "$AP_IFACE" comment 'hive-hotspot-5g forward'
        ufw allow in on "$AP_IFACE" to any port 67 proto udp comment 'hive-hotspot-5g DHCP'
        ufw allow in on "$AP_IFACE" to any port 53 comment 'hive-hotspot-5g DNS'
    fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 安全加固
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "应用安全策略..."

# 启用连接状态跟踪
ufw --force enable

# 配置日志记录（记录被阻止的连接）
ufw logging medium

# 设置速率限制防止 SSH 爆破攻击
ufw limit ssh comment 'SSH Rate Limiting'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 显示配置结果
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "✅ 防火墙配置完成！"
echo ""
echo "当前规则："
ufw status verbose
echo ""
echo "📋 开放的端口："
echo "  - SSH (22): 本地网络 + Tailscale"
echo "  - Node Exporter (9100): 仅 Tailscale"
echo "  - EasyTier P2P (11010-11012 tcp, 11010-11011 udp): 全网段直连"
echo "  - 透明网关 TUN 口 (Meta): in/out/forward 放行（system 栈转发投递）"
echo "  - 出站: DNS, NTP, HTTPS, CF Tunnel(7844,443), CF WARP(2408,1701), Tailscale, FRP($FRP_PORT)"
echo ""
echo "🔐 安全特性："
echo "  - 默认拒绝所有入站连接"
echo "  - SSH 速率限制"
echo "  - 连接状态跟踪"
echo "  - 日志记录已启用"
echo ""
echo "⚠️  注意："
echo "  - 如果丢失 SSH 连接，请通过物理控制台访问"
echo "  - 根据实际网络环境调整 SSH 访问范围"
echo "  - 监控日志：journalctl -f -u ufw"

exit 0