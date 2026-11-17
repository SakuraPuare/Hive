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

# ufw 的每条命令都会整份重写 /etc/ufw/user.rules：两个进程并发改规则时，后写的一方
# 会把对方刚加入的条目覆盖掉。首启实测：hive-hotspot.service 与本单元同时启动，
# 热点脚本用旧快照重写，使 SSH 源限制、Node Exporter 9100 等前段规则整段消失，
# 结果 SSH 变成对全网限速放行、Prometheus 抓不到本机指标。
# 所有 ufw 变更必须持有同一把锁；本脚本内部再调 hive-hotspot-firewall.sh 时，
# 用环境变量告知"锁已在手"，避免同一进程二次 flock 自锁。
UFW_LOCK="${UFW_LOCK:-/run/hive-ufw.lock}"
if [ "${HIVE_UFW_LOCK_HELD:-}" != 1 ]; then
    exec 8>"$UFW_LOCK"
    if ! flock -w 180 8; then
        echo "ERROR: 等待 ufw 变更锁超时（其他进程正在改防火墙）" >&2
        exit 1
    fi
    export HIVE_UFW_LOCK_HELD=1
fi

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

# Mihomo 面板（MetaCubeXD 9090）：客户在门户里看到网关实时流量/会话，要能直接打开
# 面板。只放行内网与管理网段（不暴露公网），面板自身还有 per-node secret
# （HMAC(server key, mac)，见 registry gatewaySecret）。
ufw allow from 192.168.0.0/16 to any port 9090 comment 'Mihomo dashboard - LAN'
ufw allow from 10.0.0.0/8 to any port 9090 comment 'Mihomo dashboard - LAN/hotspot'
ufw allow from 172.16.0.0/12 to any port 9090 comment 'Mihomo dashboard - EasyTier'
ufw allow from 100.64.0.0/10 to any port 9090 comment 'Mihomo dashboard - Tailscale'

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
# 解析必须绕开 mihomo 的 fake-IP。本机 DNS 被 TUN 劫持，getent 拿到的是
# 198.18.0.0/16 的假地址——实测这些假地址被写进 ufw（ALLOW 198.18.0.9/udp），
# 真实中继（81.71.155.152 等）的 UDP 回包反而被 UFW BLOCK，EasyTier 握手
# "connect timeout after 1.99s"，节点在 mesh 里假在线、registry 连不上它。
# 用 DoH（223.5.5.5）拿真实记录，并再次过滤 fake-IP 兜底。
resolve_relay_ips() {
    local host="$1" type="$2" ips
    ips=$(curl -4 -sS --max-time 8 -H 'accept: application/dns-json' \
            "https://223.5.5.5/resolve?name=${host}&type=${type}" 2>/dev/null \
        | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for answer in data.get("Answer", []):
    if answer.get("type") in (1, 28):
        print(answer.get("data", ""))' 2>/dev/null)
    if [ -z "$ips" ]; then
        ips=$(getent ahosts "$host" 2>/dev/null | awk '{print $1}')
    fi
    printf '%s\n' "$ips" | grep -vE '^198\.18\.' | sed '/^[[:space:]]*$/d' | sort -u
}
if [ -n "${EASYTIER_PEERS}" ]; then
    # 提取所有唯一主机名（去协议前缀和端口）
    RELAY_HOSTS=$(echo "${EASYTIER_PEERS}" | tr ',' '\n' \
        | sed 's|.*://||;s|:.*||' | sed '/^[[:space:]]*$/d' | sort -u)
    for HOST in $RELAY_HOSTS; do
        [ -z "$HOST" ] && continue
        IPS=$(resolve_relay_ips "$HOST" A)
        for IP in $IPS; do
            ufw allow in proto udp from "$IP" comment "EasyTier relay: $HOST"
            echo "  允许 UDP 入站来自 $HOST ($IP)"
        done
        [ -n "$IPS" ] || echo "  ⚠ 无法解析 ${HOST} 的真实 IPv4，跳过 UDP 中继放行"
        IPS6=$(resolve_relay_ips "$HOST" AAAA)
        for IP6 in $IPS6; do
            ufw allow in proto udp from "$IP6" comment "EasyTier relay: $HOST (v6)"
            echo "  允许 UDP(v6) 入站来自 $HOST ($IP6)"
        done
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
# 5GHz 热点（hostapd）转发/DHCP/DNS 放行 + 热点网段 SNAT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5G 热点由 hostapd 独立托管（非 NM 连接），不触发 90-hive-hotspot NM dispatcher，
# 且本脚本开头的 `ufw --force reset` 会清掉先前打的洞与 NAT 规则。故在这里按
# /etc/hive/hotspot-5g.env 里的 AP 接口重打一遍（与 hive-hotspot.sh 同一脚本、幂等）。
# 同时给它加 SNAT 并豁免订阅门禁：mihomo 没有配置/授权时，热点客户端仍能直连出网。
# 2.4G 走 NM shared，由 90-hive-hotspot dispatcher 动态放行，不在此处理。
if [ -x /usr/local/bin/hive-hotspot-firewall.sh ]; then
    echo "配置 5G 热点（hostapd）放行与 SNAT..."
    /usr/local/bin/hive-hotspot-firewall.sh || echo "  ⚠ 热点防火墙规则未完整应用（无 5G 热点属正常）"
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

# ──────────────────────────────────────────────────────────────────────────
# 规则复核
# ──────────────────────────────────────────────────────────────────────────
# 上面的写入仍可能被并发的 ufw 使用者覆盖（见文件开头的锁说明）。这里逐条确认
# 关键放行是否真的落盘：缺失就重放一次，仍缺失则让本单元失败。单元失败时
# ExecStartPost 不会创建 firewall-configured 标记，下次开机整段重跑，
# 不会静默留下"SSH 对全网放行、监控抓不到本机"的状态。
echo "复核关键规则..."
ensure_added() {
    local rule="$1"
    ufw show added | grep -Fq "$rule" && return 0
    echo "WARN: 防火墙规则缺失，重新应用：$rule" >&2
    eval "ufw $rule" >/dev/null 2>&1 || true
    ufw show added | grep -Fq "$rule"
}

missing=0
for rule in \
    "allow in on lo" \
    "allow from 192.168.0.0/16 to any port 22 comment 'SSH - Local Network'" \
    "allow from 10.0.0.0/8 to any port 22 comment 'SSH - Private Network'" \
    "allow from 172.16.0.0/12 to any port 22 comment 'SSH - Private Network'" \
    "allow from 100.64.0.0/10 to any port 22 comment 'SSH - Tailscale'" \
    "allow from 100.64.0.0/10 to any port 9100 comment 'Node Exporter - Tailscale'" \
    "allow from 172.20.0.0/16 to any port 9100 comment 'Node Exporter - EasyTier'" \
    "allow from 100.64.0.0/10 to any port 9550 comment 'Xray Exporter - Tailscale'" \
    "allow from 172.20.0.0/16 to any port 9550 comment 'Xray Exporter - EasyTier'" \
    "allow from 100.64.0.0/10 to any port 9090 comment 'Mihomo dashboard - Tailscale'"; do
    ensure_added "$rule" || missing=1
done
if [ "$missing" -ne 0 ]; then
    echo "ERROR: 关键防火墙规则仍未生效；本次不落 firewall-configured，下次开机重试" >&2
    exit 1
fi

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
echo "  - Node Exporter (9100): Tailscale + EasyTier"
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