#!/bin/bash
# /usr/local/bin/hive-hotspot-firewall.sh
# 让热点客户端"能上网"的四件事，全部幂等，可在任意启动顺序反复调用：
#
#   1. UFW 放行 AP 接口的 DHCP/DNS/转发（5G）。`ufw --force reset` 会清掉这些洞，
#      所以热点生成与防火墙初始化都要各调一次（同规则、同 comment）。
#   2. 热点网段的 SNAT：mihomo 不在时客户端靠它直连出公网；走 TUN 的出站不 NAT，
#      保持原始源地址交给 mihomo 做规则分流。
#   3. 订阅门禁（hive_gateway_block_forward 落的 FORWARD DROP）之上的双向 ACCEPT：
#      入向"AP 接口 + 热点网段"，回程"conntrack --ctorigsrc 热点网段 + oif AP"。
#      没有 mihomo 配置/授权时门禁会一直挂着，不豁免热点就是"连上 Wi-Fi 没网"。
#   4. 直连模式（门禁在 / 没有配置 / mihomo 没跑）下把热点网段从 TUN 摘到 main 表，
#      并给公共解析器插绕开 dns-hijack 的直连规则 —— 否则会进 TUN 被交付配置的
#      MATCH,REJECT 拒掉，或拿到不可路由的 fake-IP。
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
    # 回程也必须放行：门禁的 DROP 是无条件的，只放行"客户端→外网"方向时对端回包
    # 会在 FORWARD 被 DROP（实测 TCP SYN 出得去、连不上）。用 conntrack 原始源地址
    # 限定"客户端发起的会话"，避免把 eth 侧客户流量一起漏掉。
    while iptables -w 3 -C FORWARD -o "$iface" -m conntrack --ctorigsrc "$net" \
            -m comment --comment hive-hotspot-ret -j ACCEPT 2>/dev/null; do
        iptables -w 3 -D FORWARD -o "$iface" -m conntrack --ctorigsrc "$net" \
            -m comment --comment hive-hotspot-ret -j ACCEPT 2>/dev/null || break
    done
    iptables -w 3 -I FORWARD 1 -o "$iface" -m conntrack --ctorigsrc "$net" \
        -m comment --comment hive-hotspot-ret -j ACCEPT 2>/dev/null ||
        log "无法为 $iface ($net) 插入回程放行"
}

# ── 4. 门禁生效时把热点流量从 mihomo TUN 里摘出来 ─────────────────────────
# 订阅门禁在 = 节点当前不该按网关策略转发客户流量，但热点必须能上网。此时若让热点
# 包照旧进 TUN（auto-route 的 `not from all iif lo lookup 2022`），它们会被交付配置
# 末端的 MATCH,REJECT 拒掉（实测 HTTPS 全超时、ICMP 只留一行 DIRECT 日志）。
# 给热点网段插一条更高优先级的策略路由回 main 表：走物理上行 + 上面的 SNAT 直连，
# 与 mihomo 配置内容无关。门禁撤销后删掉这条规则，恢复"热点客户端走代理分流"。
# DNS 侧同步：这种直连状态下必须用公共 DNS（fake-IP 在 main 表不可路由）——
# hive-hotspot-dns.sh 用同一个判据（门禁 DROP 是否存在）。
BYPASS_PREF=8000
DNS_BYPASS_PREF=7000
# 直连模式下 dnsmasq 交给客户端的公共解析器。必须与 hive-hotspot-dns.sh 的列表一致。
FALLBACK_DNS="223.5.5.5 119.29.29.29"
MIHOMO_CONF="/etc/mihomo/config.yaml"
gate_present() {
    command -v iptables >/dev/null 2>&1 &&
        iptables -w 3 -C FORWARD -m comment --comment hive-subscription -j DROP 2>/dev/null
}

# 热点交给 mihomo 分流的唯一条件：门禁不在 + mihomo 在跑 + 确实有配置。
# 没有配置 / 已停用 / 崩溃 / 订阅未授权（门禁在）一律直连 —— 用户要求是
# "没有 mihomo 配置时 AP 也要有网"，所以这里默认站在可用性一侧。
hotspot_proxied() {
    gate_present && return 1
    systemctl is-active --quiet hive-mihomo 2>/dev/null || return 1
    [ -s "$MIHOMO_CONF" ]
}

# have_rule <rule show 里出现的子串>：故意不用 `ip rule show | grep -q` —— pipefail 下
# grep -q 提前退出会给上游 SIGPIPE，整条管道判失败，于是每轮都重复 add。
have_rule() {
    local rules
    rules=$(ip rule show 2>/dev/null) || return 1
    case "$rules" in *"$1"*) return 0;; esac
    return 1
}
rule_set() {  # $1=add|del $2=pref $3..=ip rule 参数
    ip rule "$1" "${@:3}" pref "$2" 2>/dev/null
}

route_bypass() {  # $1=subnet：热点网段 → main（直连）
    command -v ip >/dev/null 2>&1 || return 0
    local net="$1"
    [ -n "$net" ] || return 0
    if ! hotspot_proxied; then
        have_rule "from $net lookup main" && return 0
        rule_set add "$BYPASS_PREF" from "$net" lookup main ||
            log "无法为 $net 添加直连策略路由（热点流量仍会进 TUN）"
    else
        while have_rule "from $net lookup main"; do
            rule_set del "$BYPASS_PREF" from "$net" lookup main || break
        done
    fi
}

# dnsmasq 自己的上游查询（本机发起、dst 公共解析器）也会被 mihomo 的
# `dns-hijack: any:53` 抓走并回 fake-IP —— 实测热点客户端因此拿到 198.18.x，
# 而直连模式下 198.18.x 在 main 表不可路由，网页全超时。直连模式按目的地址
# 给这几个公共解析器插更高优先级的 main 表规则，让解析结果回到真实 IP。
dns_bypass() {
    command -v ip >/dev/null 2>&1 || return 0
    local server
    for server in $FALLBACK_DNS; do
        if ! hotspot_proxied; then
            have_rule "to $server lookup main" && continue
            rule_set add "$DNS_BYPASS_PREF" to "$server" lookup main ||
                log "无法为 $server 添加直连解析路由（热点 DNS 会拿到 fake-IP）"
        else
            while have_rule "to $server lookup main"; do
                rule_set del "$DNS_BYPASS_PREF" to "$server" lookup main || break
            done
        fi
    done
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
route_bypass "$AP5_NET"
route_bypass "$AP2_SUBNET"
dns_bypass
exit 0
