#!/bin/bash
# /usr/local/bin/hive-hotspot-firewall.sh
# 让热点客户端"能上网"的三件事，全部幂等，可在任意启动顺序反复调用：
#
#   1. UFW 放行 AP 接口的 DHCP/DNS/转发（5G）。`ufw --force reset` 会清掉这些洞，
#      所以热点生成与防火墙初始化都要各调一次（同规则、同 comment）。
#   2. 热点网段的 SNAT：mihomo 不在时客户端靠它直连出公网；走 TUN 的出站不 NAT，
#      保持原始源地址交给 mihomo 做规则分流。
#   3. 订阅门禁（hive_gateway_block_forward 落的 FORWARD DROP）之上的 ACCEPT。
#      没有 mihomo 配置/授权时门禁会一直挂着，不豁免热点就是"连上 Wi-Fi 没网"。
#      匹配条件用"AP 接口 + 热点网段"，eth 侧伪造热点源地址进不来。
#
# 调用方：hive-hotspot.sh（热点生成）、setup-firewall.sh（防火墙初始化）、
#         hive-mihomo.service 的 ExecStartPost/ExecStopPost、hive-subscription-state。
set -o pipefail

LOG_TAG="hive-hotspot-firewall"
ENV_FILE="/etc/hive/hotspot-5g.env"
CONF_ENV="/etc/hive/config.env"
NODE_INFO="/etc/hive/node-info"
AP2_STATE="/run/hive-hotspot-ap-iface.hive-hotspot-2g"
AP2_SUBNET="10.42.0.0/24"          # 2.4G 固定网段（hive-hotspot.sh 的 10.42.0.1/24）

log() { echo "[$LOG_TAG] $*"; logger -t "$LOG_TAG" "$*" 2>/dev/null || true; }
valid_iface() { [[ "$1" =~ ^[A-Za-z0-9_.:@-]{1,15}$ ]]; }

# 从 "ip/prefix" 推出 /24 网段；热点只用 /24，其他前缀视为未知（返回空）。
subnet24() {
    local ip="${1:-}" prefix
    prefix="${ip##*/}"
    ip="${ip%%/*}"
    [ "$prefix" = "24" ] || return 0
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 0
    IFS=. read -r a b c _ <<<"$ip"
    printf '%s.%s.%s.0/24\n' "$a" "$b" "$c"
}

AP5_IF=""; AP5_NET=""
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    AP5_IF="${AP_IFACE:-}"
    AP5_NET=$(subnet24 "${AP_IP4:-10.42.1.1/24}")
fi

# ── 1. UFW：按 5G AP 接口放行（2.4G 走 NM shared，由 90-hive-hotspot dispatcher 管）──
apply_ufw() {
    command -v ufw >/dev/null 2>&1 || return 0
    valid_iface "$AP5_IF" || return 0
    local old
    old=$(grep -E '^AP_IFACE=' "${ENV_FILE}.prev" 2>/dev/null | cut -d= -f2)
    if valid_iface "$old" && [ "$old" != "$AP5_IF" ]; then
        ufw route delete allow in on "$old" >/dev/null 2>&1 || true
        ufw delete allow in on "$old" to any port 67 proto udp >/dev/null 2>&1 || true
        ufw delete allow in on "$old" to any port 53 >/dev/null 2>&1 || true
    fi
    ufw route allow in on "$AP5_IF" comment 'hive-hotspot-5g forward' >/dev/null 2>&1 || true
    ufw allow in on "$AP5_IF" to any port 67 proto udp comment 'hive-hotspot-5g DHCP' >/dev/null 2>&1 || true
    ufw allow in on "$AP5_IF" to any port 53 comment 'hive-hotspot-5g DNS' >/dev/null 2>&1 || true
}

# ── 2. SNAT：热点网段经物理上行直接出网（mihomo TUN 出站不 NAT）─────────────
apply_snat() {
    command -v iptables >/dev/null 2>&1 || return 0
    [ -n "$AP5_NET" ] || return 0
    local tun="${GATEWAY_TUN_IFACE:-Meta}"
    iptables -w 3 -t nat -C POSTROUTING -s "$AP5_NET" ! -o "$tun" \
        -m comment --comment hive-hotspot-nat -j MASQUERADE 2>/dev/null && return 0
    iptables -w 3 -t nat -A POSTROUTING -s "$AP5_NET" ! -o "$tun" \
        -m comment --comment hive-hotspot-nat -j MASQUERADE 2>/dev/null ||
        log "无法添加 $AP5_NET 的 SNAT（非 $tun 出口）"
}

# ── 3. 门禁之上按 AP 接口+网段放行转发 ─────────────────────────────────────
exempt() {  # $1=iface $2=subnet
    command -v iptables >/dev/null 2>&1 || return 0
    local iface="$1" net="$2"
    valid_iface "$iface" && [ -n "$net" ] || return 0
    # 先删后插：DROP 可能在上一轮之后插到我们头上，只有重新插到 position 1 才保证在门禁之上。
    while iptables -w 3 -C FORWARD -i "$iface" -s "$net" \
            -m comment --comment hive-hotspot -j ACCEPT 2>/dev/null; do
        iptables -w 3 -D FORWARD -i "$iface" -s "$net" \
            -m comment --comment hive-hotspot -j ACCEPT 2>/dev/null || break
    done
    iptables -w 3 -I FORWARD 1 -i "$iface" -s "$net" \
        -m comment --comment hive-hotspot -j ACCEPT 2>/dev/null ||
        log "无法为 $iface ($net) 插入转发放行"
}

ap2_iface() {
    local iface
    if [ -f "$AP2_STATE" ]; then
        iface=$(cat "$AP2_STATE" 2>/dev/null)
        valid_iface "$iface" && { echo "$iface"; return; }
    fi
    [ -f "$NODE_INFO" ] || return 0
    iface=$(awk -F= '$1=="WIFI_IFACE_2G"{print $2}' "$NODE_INFO" 2>/dev/null | tr -d "'\"")
    valid_iface "$iface" && echo "$iface"
}

[ -f "$CONF_ENV" ] && . "$CONF_ENV" 2>/dev/null

apply_ufw
apply_snat
exempt "$AP5_IF" "$AP5_NET"
for iface in "$@" $(ap2_iface); do
    exempt "$iface" "$AP2_SUBNET"
done
exit 0
