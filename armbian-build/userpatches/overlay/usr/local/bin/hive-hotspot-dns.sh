#!/bin/bash
# /usr/local/bin/hive-hotspot-dns.sh
# 生成 5GHz 热点（hostapd + 独立 dnsmasq）的 DHCP/DNS 配置，并让上游 DNS 跟着
# mihomo 的实际状态走：
#   - mihomo 在跑（DNS 监听 1053）→ 转发给它，客户端拿 fake-IP、按规则分流；
#   - mihomo 没跑（没有配置 / 已停用 / 崩溃）→ 用公共 DNS，热点客户端直接 NAT 出网。
# 没有后者时，dnsmasq 的 no-resolv + server=127.0.0.1#1053 会让所有解析超时，
# 客户端"连上 Wi-Fi 但打不开任何网页"。
#
# 触发：hive-hotspot.sh（热点生成）与 hive-mihomo.service 的
#       ExecStartPost（--wait 等端口就绪）/ ExecStopPost（立即回退直连 DNS）。
set -o pipefail

LOG_TAG="hive-hotspot-dns"
ENV_FILE="/etc/hive/hotspot-5g.env"
CONF="/etc/hive/dnsmasq-5g.conf"
FALLBACK_DNS=("223.5.5.5" "119.29.29.29")

log() { echo "[$LOG_TAG] $*"; logger -t "$LOG_TAG" "$*" 2>/dev/null || true; }

WAIT=0
[ "${1:-}" = "--wait" ] && WAIT=5

[ -f "$ENV_FILE" ] || exit 0
# shellcheck disable=SC1090
. "$ENV_FILE"
[ -n "${AP_IFACE:-}" ] || exit 0
AP_ADDR="${AP_IP4:-10.42.1.1/24}"
AP_ADDR="${AP_ADDR%%/*}"

# mihomo 的 DNS 端口真的在监听才算数：ExecStartPost 时进程已 fork，端口可能还没 bind。
mihomo_dns_up() {
    # ExecStartPost 时 ActiveState 仍为 activating，但主进程已在运行。
    case "$(systemctl show -p SubState --value hive-mihomo 2>/dev/null)" in
        running|start-post) ;;
        *) return 1 ;;
    esac
    command -v ss >/dev/null 2>&1 || return 0
    ss -lunH 'sport = :1053' 2>/dev/null | grep -q .
}

# 订阅门禁生效时热点走直连（hive-hotspot-firewall.sh 把热点网段从 TUN 里摘到 main 表），
# 此时 fake-IP 在 main 表不可路由，必须用公共 DNS。判据与那个脚本一致：门禁 DROP 在不在、
# mihomo 有没有配置；另外这里还要求 1053 真的在听（ExecStartPost 时进程已 fork，端口可能未 bind）。
MIHOMO_CONF="/etc/mihomo/config.yaml"
gate_present() {
    command -v iptables >/dev/null 2>&1 &&
        iptables -w 3 -C FORWARD -m comment --comment hive-subscription -j DROP 2>/dev/null
}

hotspot_proxied() {
    gate_present && return 1
    [ -s "$MIHOMO_CONF" ] || return 1
    mihomo_dns_up
}

for _ in $(seq 1 "$WAIT"); do
    hotspot_proxied && break
    sleep 1
done

if hotspot_proxied; then
    upstream="server=127.0.0.1#1053"
    why="mihomo DNS（fake-IP 分流）"
else
    upstream=""
    for server in "${FALLBACK_DNS[@]}"; do upstream+="server=${server}"$'\n'; done
    upstream=${upstream%$'\n'}
    why="公共 DNS（直连，无 mihomo）"
fi

tmp=$(mktemp "${CONF}.XXXXXX") || exit 1
{
    echo "interface=${AP_IFACE}"
    echo "bind-interfaces"
    echo "listen-address=${AP_ADDR}"
    echo "dhcp-range=10.42.1.50,10.42.1.200,255.255.255.0,12h"
    echo "dhcp-option=3,${AP_ADDR}"      # 网关
    echo "dhcp-option=6,${AP_ADDR}"      # DNS 指向本机
    echo "no-resolv"
    printf '%s\n' "$upstream"
} > "$tmp" || { rm -f "$tmp"; exit 1; }
chmod 644 "$tmp"

if [ -f "$CONF" ] && cmp -s "$tmp" "$CONF"; then
    rm -f "$tmp"
    exit 0
fi
mv -f "$tmp" "$CONF" || { rm -f "$tmp"; exit 1; }
log "5G 热点 DHCP/DNS 已更新：${AP_IFACE} 上游=${why}"
# 已在跑就用新配置重启；未激活时 try-restart 是空操作，等热点单元自己拉起。
# --no-block：这个脚本可能跑在 hive-mihomo 的 ExecStartPost 里，不能耗它的启动超时。
systemctl --no-block try-restart hive-hotspot-5g-dnsmasq.service >/dev/null 2>&1 || true
exit 0
