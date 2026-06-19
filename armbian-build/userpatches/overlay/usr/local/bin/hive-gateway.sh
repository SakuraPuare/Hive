#!/bin/bash
# /usr/local/bin/hive-gateway.sh
# 探测有线网卡拓扑 → 双网口设备(如 NanoPi R3S)自动当路由器：
#   WAN 口  接上游（DHCP 客户端，method=auto）
#   LAN 口  给下游设备发 DHCP + NAT（NM method=shared 自带 dnsmasq），静态网关 10.42.2.1/24
#
# 透明代理由 Mihomo(hive-mihomo.service)接管，本脚本只负责把"物理拓扑"配好：
#   - 单网口设备（如 Zero2）：无 WAN/LAN 之分，干净退出 0；Mihomo 透明代理对 WiFi 热点下游仍有效。
#   - 双/多网口设备：第一个口作 WAN，其余口作 LAN（10.42.2.1 / .3.1 / .4.1 递增，避开热点的 .0.1/.1.1）。
#
# 设计与 hive-hotspot.sh 一致：一切从 MAC 确定性派生、NM keyfile、flock 单实例锁、幂等可反复调用。
# 触发：hive-gateway.service（开机）+ udev（网线热插拔）。门控：网卡 < 2 时干净退出 0。

set -o pipefail

LOG_TAG="hive-gateway"
NODE_INFO="/etc/hive/node-info"
KF_DIR="/etc/NetworkManager/system-connections"

log() { echo "[$LOG_TAG] $*"; logger -t "$LOG_TAG" "$*" 2>/dev/null || true; }
upper() { echo "$1" | tr 'a-f' 'A-F'; }

# ── 0. 前置检查 + 单实例锁（udev 与 systemd 可能并发触发）──────────────
if ! command -v nmcli >/dev/null 2>&1; then
    log "nmcli 不存在（NetworkManager 未安装），跳过"; exit 0
fi
if command -v flock >/dev/null 2>&1; then
    exec 9>/run/hive-gateway.lock || { log "无法创建锁文件，退出"; exit 0; }
    flock -n 9 || { log "已有实例在运行，退出"; exit 0; }
fi

# ── 配置（可在 /etc/hive/config.env 覆盖）─────────────────────────────
[ -f /etc/hive/config.env ] && . /etc/hive/config.env 2>/dev/null
GW_ENABLED="${GATEWAY_ENABLED:-on}"
case "$(echo "$GW_ENABLED" | tr 'A-Z' 'a-z')" in
    off|0|false|no) log "GATEWAY_ENABLED=$GW_ENABLED，网关功能已禁用，跳过"; exit 0 ;;
esac
WAN_PIN="${GATEWAY_WAN_IFACE:-}"        # 指定 WAN 口（留空自动探测）
LAN_PIN="${GATEWAY_LAN_IFACE:-}"        # 指定 LAN 口（留空：除 WAN 外其余有线口都当 LAN）

# ── 1. 取节点身份 MAC（与 hostname/SSH 同源：第一块非 lo 有线网卡）────────
get_node_mac() {
    if [ -f "$NODE_INFO" ]; then
        local m
        m=$(grep -E '^MAC=' "$NODE_INFO" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r')
        if [ -n "$m" ]; then echo "$m"; return; fi
    fi
    local iface
    for iface in $(ls /sys/class/net 2>/dev/null); do
        case "$iface" in
            lo|docker*|veth*|br-*|tailscale*|easytier*|warp*|cni*|virbr*|wg*) continue ;;
        esac
        [ -e "/sys/class/net/$iface/phy80211" ] && continue
        cat "/sys/class/net/$iface/address" 2>/dev/null | tr -d ':\n'; return
    done
}
NODE_MAC=$(get_node_mac | tr 'A-F' 'a-f' | tr -cd 'a-f0-9')
if [ "${#NODE_MAC}" -lt 12 ]; then
    log "无法确定节点 MAC（得到 '${NODE_MAC}'），中止"; exit 0
fi
NODE_MAC="${NODE_MAC: -12}"

# 从种子确定性派生 RFC4122 v4 UUID（与 hive-hotspot.sh 同算法）
mkuuid() {
    local h; h=$(printf '%s:%s' "$1" "$NODE_MAC" | sha256sum | awk '{print $1}')
    printf '%s-%s-4%s-%x%s-%s\n' "${h:0:8}" "${h:8:4}" "${h:13:3}" \
        "$(( 0x${h:16:2} & 0x3f | 0x80 ))" "${h:18:2}" "${h:20:12}"
}

# ── 2. 枚举物理有线网卡（排除虚拟口与无线口）──────────────────────────
is_wired_phys() {  # $1=iface → 0 表示是物理有线口
    local iface="$1"
    case "$iface" in
        lo|docker*|veth*|br-*|tailscale*|easytier*|warp*|cni*|virbr*|wg*|tun*|tap*) return 1 ;;
    esac
    [ -e "/sys/class/net/$iface/phy80211" ] && return 1   # 无线口排除
    [ -e "/sys/class/net/$iface/device" ]   || return 1   # 必须有真实 device（排除纯虚拟口）
    return 0
}

declare -a WIRED
for dir in /sys/class/net/*; do
    iface=$(basename "$dir")
    is_wired_phys "$iface" || continue
    WIRED+=("$iface")
done

NWIRED=${#WIRED[@]}
log "发现 ${NWIRED} 个物理有线口: [${WIRED[*]:-none}]"

if [ "$NWIRED" -lt 2 ]; then
    log "仅 ${NWIRED} 个有线口，不配置 WAN/LAN（非路由器场景；网关仍由 Mihomo 接管本机转发）"
    exit 0
fi

# ── 3. 选 WAN 口 ──────────────────────────────────────────────────────
# 优先级：GATEWAY_WAN_IFACE 指定 > 当前持有默认路由的口 > 第一个 up 的口 > 兜底第一个。
in_wired() {  # $1=iface 是否在 WIRED 列表里
    local w
    for w in "${WIRED[@]}"; do [ "$w" = "$1" ] && return 0; done
    return 1
}
WAN=""
if [ -n "$WAN_PIN" ] && in_wired "$WAN_PIN"; then
    WAN="$WAN_PIN"; log "WAN 口由 GATEWAY_WAN_IFACE 指定：$WAN"
fi
if [ -z "$WAN" ]; then
    # 解析默认路由的 dev
    def_dev=$(ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')
    if [ -n "$def_dev" ] && in_wired "$def_dev"; then
        WAN="$def_dev"; log "WAN 口取自当前默认路由：$WAN"
    fi
fi
if [ -z "$WAN" ]; then
    for iface in "${WIRED[@]}"; do
        if [ "$(cat "/sys/class/net/$iface/operstate" 2>/dev/null)" = "up" ]; then
            WAN="$iface"; log "WAN 口取第一个 up 的有线口：$WAN"; break
        fi
    done
fi
if [ -z "$WAN" ]; then
    WAN="${WIRED[0]}"; log "WAN 口兜底取第一个有线口：$WAN"
fi

# ── 4. 选 LAN 口（除 WAN 外其余有线口；GATEWAY_LAN_IFACE 指定则只用它）──
declare -a LANS
if [ -n "$LAN_PIN" ] && in_wired "$LAN_PIN" && [ "$LAN_PIN" != "$WAN" ]; then
    LANS+=("$LAN_PIN"); log "LAN 口由 GATEWAY_LAN_IFACE 指定：$LAN_PIN"
else
    for iface in "${WIRED[@]}"; do
        [ "$iface" = "$WAN" ] && continue
        LANS+=("$iface")
    done
fi
if [ "${#LANS[@]}" -eq 0 ]; then
    log "未找到可用 LAN 口（仅 WAN=$WAN），跳过 LAN 配置"; exit 0
fi

# ── 5. WAN 口确保为 DHCP 客户端（method=auto）────────────────────────
# WAN 口通常本就是 NM 默认连接（auto）。仅当存在绑定该口的连接且非 auto 时才纠正，
# 避免误动用户/其它机制配的连接；找不到现有连接时不强行新建，交给 NM 默认行为。
wan_conn=$(nmcli -t -f NAME,DEVICE connection show 2>/dev/null | awk -F: -v d="$WAN" '$2==d{print $1; exit}')
if [ -n "$wan_conn" ]; then
    wan_method=$(nmcli -t -f ipv4.method connection show "$wan_conn" 2>/dev/null | cut -d: -f2)
    if [ "$wan_method" != "auto" ]; then
        nmcli connection modify "$wan_conn" ipv4.method auto 2>/dev/null \
            && log "WAN($WAN) 连接 '$wan_conn' 已设为 DHCP(auto)" \
            || log "WAN($WAN) 连接 '$wan_conn' 设 auto 失败（忽略）"
    else
        log "WAN($WAN) 连接 '$wan_conn' 已是 DHCP(auto)，不动"
    fi
else
    log "WAN($WAN) 暂无绑定连接，交由 NM 默认 DHCP 行为处理"
fi

# ── 6. 为每个 LAN 口写 NM keyfile（静态网关 + method=shared 自带 DHCP+NAT）──
# $1=conn_id $2=uuid $3=iface $4=mac $5=ipv4_addr(含/24)
write_lan_kf() {
    local kf="$KF_DIR/$1.nmconnection"
    umask 077
    {
        echo "[connection]"
        echo "id=$1"; echo "uuid=$2"; echo "type=ethernet"
        echo "interface-name=$3"
        echo "autoconnect=true"; echo "autoconnect-priority=50"
        echo
        echo "[ethernet]"
        echo "mac-address=$(upper "$4")"
        echo
        echo "[ipv4]"; echo "method=shared"; echo "address1=$5"
        echo
        echo "[ipv6]"; echo "method=ignore"
    } > "$kf"
    chmod 600 "$kf"; chown root:root "$kf"
    log "已写入 $kf (addr=$5)"
}

declare -a LAN_DONE
PRIMARY_LAN_IP="10.42.2.1"
oct=2                                   # LAN 网段从 10.42.2.0/24 起（避开热点 10.42.0/1）
for iface in "${LANS[@]}"; do
    mac=$(cat "/sys/class/net/$iface/address" 2>/dev/null)
    [ -n "$mac" ] || { log "$iface 无 MAC，跳过"; continue; }
    addr="10.42.${oct}.1/24"
    conn_id="hive-lan-${iface}"
    uuid=$(mkuuid "hive-lan-uuid-${iface}")
    write_lan_kf "$conn_id" "$uuid" "$iface" "$mac" "$addr"
    LAN_DONE+=("$iface")
    [ "$oct" -eq 2 ] && PRIMARY_LAN_IP="10.42.2.1"
    oct=$((oct+1))
done

# ── 7. 把网关拓扑记入 node-info（运维查阅 + 面板访问）────────────────
mkdir -p /etc/hive
if [ -f "$NODE_INFO" ]; then
    sed -i '/^GATEWAY_/d' "$NODE_INFO"
fi
grep -q '^MAC=' "$NODE_INFO" 2>/dev/null || echo "MAC=${NODE_MAC}" >> "$NODE_INFO"
{
    echo "GATEWAY_WAN_IFACE=${WAN}"
    echo "GATEWAY_LAN_IFACES=${LAN_DONE[*]}"
    echo "GATEWAY_LAN_IP=${PRIMARY_LAN_IP}"
} >> "$NODE_INFO"

# ── 8. 让 NM 重载并激活 LAN 连接 ──────────────────────────────────────
nmcli connection reload 2>/dev/null || true
for iface in "${LAN_DONE[@]}"; do
    conn_id="hive-lan-${iface}"
    # 等待设备就绪（热插拔时网卡可能稍晚出现）
    for t in $(seq 1 10); do
        nmcli -t -f DEVICE device status 2>/dev/null | grep -qx "$iface" && break; sleep 1
    done
    if nmcli connection up "$conn_id" >/dev/null 2>&1; then
        log "LAN 已启动：$conn_id on $iface"
    else
        log "$conn_id nmcli up 失败（将由 autoconnect 重试）"
    fi
done

log "完成。WAN=[$WAN] LAN=[${LAN_DONE[*]:-none}] 主 LAN IP=${PRIMARY_LAN_IP}"
exit 0
