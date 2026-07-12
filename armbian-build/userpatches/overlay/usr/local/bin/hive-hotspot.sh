#!/bin/bash
# /usr/local/bin/hive-hotspot.sh
# 检测无线网卡 → 自动开启双频热点：2.4GHz(WPA2) + 5GHz(WPA3)
#
# 设计（与全仓库"一切从 MAC 确定性派生"一致）：
#   SSID(2.4G) = Hive-<节点身份MAC>        WPA2-PSK
#   SSID(5G)   = Hive-<节点身份MAC>-5G     WPA3-SAE (pmf=required)
#   密码       = sha256("hive-wifi-psk:"+MAC) 前 16 位十六进制（两频共用，每台唯一、重刷不变）
#
# 硬件约束：单 radio 网卡同一时刻只能工作在一个频段，无法同时 2.4G+5G。
#   → 两张卡时：各管一个频段（5G 优先给 mt76，2.4G 给另一张）。
#   → 单卡时：只能开一个频段，按 HOTSPOT_PREFER_BAND（默认 2.4G，兼容性最好）。
#
# 触发：hive-hotspot.service（开机）+ udev（热插拔）。幂等，可反复调用。
# 门控：无 AP-capable 无线网卡时干净退出 0。

set -o pipefail

LOG_TAG="hive-hotspot"
CONN_2G="hive-hotspot-2g"
CONN_5G="hive-hotspot-5g"
NODE_INFO="/etc/hive/node-info"
KF_DIR="/etc/NetworkManager/system-connections"

log() { echo "[$LOG_TAG] $*"; logger -t "$LOG_TAG" "$*" 2>/dev/null || true; }
upper() { echo "$1" | tr 'a-f' 'A-F'; }

# ── 0. 前置检查 + 单实例锁（udev 与 systemd 可能并发触发）──────────────
if ! command -v nmcli >/dev/null 2>&1; then
    log "nmcli 不存在（NetworkManager 未安装），跳过"; exit 0
fi
if command -v flock >/dev/null 2>&1; then
    exec 9>/run/hive-hotspot.lock || { log "无法创建锁文件，退出"; exit 0; }
    flock -n 9 || { log "已有实例在运行，退出"; exit 0; }
fi
have_iw=0; command -v iw >/dev/null 2>&1 && have_iw=1

# ── 配置（可在 /etc/hive/config.env 覆盖）─────────────────────────────
[ -f /etc/hive/config.env ] && . /etc/hive/config.env 2>/dev/null
COUNTRY="${HOTSPOT_COUNTRY:-CN}"        # 5GHz AP 必需的国家码
# 5G AP 信道：默认 149（U-NII-3，5745MHz）。CN 监管域下 ch36-48(5150-5350) 整段是 DFS+RADAR，
# wpa_supplicant 不做 DFS CAC，会拒绝在其上开 AP（实测 "Frequency 5180 not allowed for AP
# mode, RADAR"）。ch149/153/157/161/165 在 CN 为非 DFS、允许 AP 主动发射，是唯一可靠选择。
# （FCC 域下 ch36 才免 DFS——旧默认 36 的注释是按美国域写的，对 CN 不成立。）
CH5G="${HOTSPOT_5G_CHANNEL:-149}"       # 5G 信道（CN 非 DFS：149/153/157/161/165）
WIDTH_5G="${HOTSPOT_5G_WIDTH:-80}"      # 5G 频宽 20|40|80，默认 80（DFS/无效组合自动降级）
PREFER="${HOTSPOT_PREFER_BAND:-5}"      # 单 radio 卡只能开一频时的偏好：5 或 2.4，默认 5（优先 5G WPA3）

# ip_forward 兜底：常态由 /etc/sysctl.d/99-hive.conf 开，此处仅热插拔场景兜底
# （5G 客户端上网靠 Mihomo TUN auto-route 转发，需 ip_forward=1）。
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true

# ── 1. 取节点身份 MAC（与 hostname/SSH 同源：第一块非 lo 有线网卡）────────
get_node_mac() {
    if [ -f "$NODE_INFO" ]; then
        local m
        m=$(grep -E '^MAC=' "$NODE_INFO" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r')
        if [ -n "$m" ]; then echo "$m"; return; fi
    fi
    local iface iface_path
    for iface_path in /sys/class/net/*; do
        iface=$(basename "$iface_path")
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

# ── 2. 派生 SSID / 密码 / 确定性 UUID ─────────────────────────────────
MAC_UP=$(upper "$NODE_MAC")
SSID_2G="Hive-${MAC_UP}"
SSID_5G="Hive-${MAC_UP}-5G"
PSK=$(printf 'hive-wifi-psk:%s' "$NODE_MAC" | sha256sum | awk '{print substr($1,1,16)}')
mkuuid() {  # 从种子确定性派生 RFC4122 v4 UUID
    local h; h=$(printf '%s:%s' "$1" "$NODE_MAC" | sha256sum | awk '{print $1}')
    printf '%s-%s-4%s-%x%s-%s\n' "${h:0:8}" "${h:8:4}" "${h:13:3}" \
        "$(( 0x${h:16:2} & 0x3f | 0x80 ))" "${h:18:2}" "${h:20:12}"
}
UUID_2G=$(mkuuid hive-wifi-uuid-2g)
UUID_5G=$(mkuuid hive-wifi-uuid-5g)

# ── 3. 探测无线网卡：AP 能力 + 支持频段 + 驱动 ────────────────────────
# phy_caps <phy> → 输出空格分隔的标记：ap 2g 5g（有哪个输出哪个）
phy_caps() {
    local phy="$1" info; info=$(iw phy "$phy" info 2>/dev/null)
    [ -n "$info" ] || return
    echo "$info" | awk '
        /Supported interface modes/ {m=1; next}
        m && /\*/ { if ($0 ~ /[ \t]AP$/ || $0 ~ /[ \t]AP[ \/]/) print "ap"; next }
        m {m=0}'
    # 频段：解析未禁用的频率（2400-2500→2g，4900-5900→5g）
    echo "$info" | awk '/MHz/ && !/disabled/ {
        for(i=1;i<=NF;i++) if($i=="MHz"){ f=$(i-1)+0;
            if(f>=2400&&f<=2500) print "2g";
            if(f>=4900&&f<=5900) print "5g" } }' | sort -u
}

declare -a C_IF C_MAC C_DRV C_BANDS
for dir in /sys/class/net/*; do
    [ -e "$dir/phy80211" ] || continue
    iface=$(basename "$dir")
    phy=$(basename "$(readlink -f "$dir/phy80211" 2>/dev/null)" 2>/dev/null)
    drv=$(basename "$(readlink -f "$dir/device/driver" 2>/dev/null)" 2>/dev/null)
    mac=$(cat "$dir/address" 2>/dev/null)

    caps=""; bands=""
    if [ "$have_iw" = "1" ] && [ -n "$phy" ]; then
        caps=$(phy_caps "$phy")
        echo "$caps" | grep -qw ap || { log "$iface ($phy): 不支持 AP，跳过"; continue; }
        echo "$caps" | grep -qw 2g && bands="2g"
        echo "$caps" | grep -qw 5g && bands="$bands 5g"
    fi
    # iw 不可用或没解析出频段时的兜底：按驱动推断（mt76/iwlwifi 双频，sprd 仅 2.4G）
    if [ -z "$bands" ]; then
        case "$drv" in
            mt76*|mt79*|iwlwifi) bands="2g 5g" ;;
            sprd*|uwe*)          bands="2g" ;;
            *)                   bands="2g" ;;
        esac
    fi
    log "候选 $iface phy=$phy driver=${drv:-?} mac=$mac bands=[${bands# }]"
    C_IF+=("$iface"); C_MAC+=("$mac"); C_DRV+=("$drv"); C_BANDS+=("${bands# }")
done

if [ "${#C_IF[@]}" -eq 0 ]; then
    log "未发现支持 AP 的无线网卡 — 不启用热点（无网卡的板子属正常）"
    # 清理可能残留的连接
    nmcli connection down "$CONN_2G" >/dev/null 2>&1 || true
    nmcli connection down "$CONN_5G" >/dev/null 2>&1 || true
    exit 0
fi
# >>> PART1_END <<<

# ── 4. 频段分配（单 radio：一张卡只能管一个频段）──────────────────────
# 5G 优先级：mt76(3) > iwlwifi(1) > 其它(0)；2.4G 优先级：mt76(3) > iwlwifi(2) > sprd(1)。
# 策略：先在"支持 5G 的卡"里挑 5G 最佳者占用 5G；再在剩余卡里挑 2.4G 最佳者占用 2.4G。
score5g() { case "$1" in mt76*|mt79*) echo 3;; iwlwifi) echo 1;; *) echo 0;; esac; }
score2g() { case "$1" in mt76*|mt79*) echo 3;; iwlwifi) echo 2;; sprd*|uwe*) echo 1;; *) echo 0;; esac; }

n=${#C_IF[@]}
i5=-1; best=-1
for ((k=0;k<n;k++)); do
    case " ${C_BANDS[$k]} " in *" 5g "*) ;; *) continue;; esac
    s=$(score5g "${C_DRV[$k]}")
    if [ "$s" -gt "$best" ]; then best=$s; i5=$k; fi
done
i2=-1; best=-1
for ((k=0;k<n;k++)); do
    [ "$k" -eq "$i5" ] && continue                       # 5G 已占用的卡不再用
    case " ${C_BANDS[$k]} " in *" 2g "*) ;; *) continue;; esac
    s=$(score2g "${C_DRV[$k]}")
    if [ "$s" -gt "$best" ]; then best=$s; i2=$k; fi
done

# 单卡兜底：只有一张卡（单 radio），只能开一个频段。
# 策略：优先 5G(WPA3)；卡不支持 5G 才回退 2.4G(WPA2)。可用 HOTSPOT_PREFER_BAND=2.4 改偏好。
if [ "$n" -eq 1 ]; then
    has5g=0; has2g=0
    case " ${C_BANDS[0]} " in *" 5g "*) has5g=1;; esac
    case " ${C_BANDS[0]} " in *" 2g "*) has2g=1;; esac
    if [ "$PREFER" = "2.4" ] && [ "$has2g" = "1" ]; then
        i2=0; i5=-1; log "单卡且偏好 2.4G → 只开 2.4G WPA2"
    elif [ "$has5g" = "1" ]; then
        i5=0; i2=-1; log "单卡 → 优先开 5G WPA3"
    else
        i2=0; i5=-1; log "单卡不支持 5G → 回退 2.4G WPA2"
    fi
fi

# ── 5. 设置 regulatory domain（5GHz AP 必需）──────────────────────────
if [ "$i5" -ge 0 ] && [ "$have_iw" = "1" ]; then
    iw reg set "$COUNTRY" 2>/dev/null && log "已设国家码 $COUNTRY（5G AP 需要）" || true
fi

# ── 6. 写 NM keyfile（每频段一个，绑各自网卡 MAC）─────────────────────
# $1=keyfile $2=conn_id $3=uuid $4=ssid $5=mac $6=band(bg/a) $7=secblock $8=ipv4_addr
write_kf() {
    local kf="$KF_DIR/$2.nmconnection"
    umask 077
    {
        echo "[connection]"
        echo "id=$2"; echo "uuid=$3"; echo "type=wifi"
        echo "autoconnect=true"; echo "autoconnect-priority=100"
        echo
        echo "[wifi]"
        echo "mode=ap"; echo "band=$6"; echo "ssid=$4"
        echo "mac-address=$(upper "$5")"
        [ "$6" = "a" ] && echo "channel=$CH5G"
        echo
        printf '%s\n' "$7"
        echo
        echo "[ipv4]"; echo "method=shared"; echo "address1=$8"
        echo
        echo "[ipv6]"; echo "method=ignore"
    } > "$kf"
    chmod 600 "$kf"; chown root:root "$kf"
    log "已写入 $kf"
}

# ── 6b. 5G hostapd 后端辅助函数 ───────────────────────────────────────
# 5G 用独立 hostapd（NM 内建 wpa_supplicant 在 MT7922 上开 80MHz 会 HT_SCAN 失败）。
HOSTAPD_CONF="/etc/hostapd/hive-5g.conf"
DNSMASQ_CONF="/etc/hive/dnsmasq-5g.conf"
HOTSPOT_5G_ENV="/etc/hive/hotspot-5g.env"
AP5G_IP4="10.42.1.1/24"

# derive_5g_params <channel> <width> → 输出 "SEG0 DIR"（DIR=PLUS/MINUS/NONE），无效组合输出空
# 80MHz 中心频率 seg0 索引 + HT40 方向：ch149/153/157/161 同属一个 80MHz 块（中心 5775=idx155）。
derive_5g_params() {
    local ch="$1" w="$2" base seg0 idx dir
    case "$w" in
        20) echo "$ch NONE"; return 0 ;;
        40)
            case "$ch" in
                36|44|52|60|100|108|116|124|132|140|149|157|165) echo "$((ch+2)) PLUS" ;;
                40|48|56|64|104|112|120|128|136|144|153|161)      echo "$((ch-2)) MINUS" ;;
                *) echo "" ;;
            esac ; return 0 ;;
        80)
            case "$ch" in
                36|40|44|48)     base=36;  seg0=42  ;;
                52|56|60|64)     base=52;  seg0=58  ;;   # DFS
                100|104|108|112) base=100; seg0=106 ;;   # DFS
                116|120|124|128) base=116; seg0=122 ;;   # DFS
                132|136|140|144) base=132; seg0=138 ;;   # DFS
                149|153|157|161) base=149; seg0=155 ;;
                *) echo ""; return 0 ;;                  # 165 单信道无法 80MHz
            esac
            idx=$(( (ch - base) / 4 ))
            [ $((idx % 2)) -eq 0 ] && dir=PLUS || dir=MINUS
            echo "$seg0 $dir" ; return 0 ;;
    esac
}

# generate_hostapd_conf <iface> <ssid> <psk> <channel> <width> → 写 $HOSTAPD_CONF（chmod 600）
# 约束：20MHz 时 ht_capab 不能含 [HT40±]（否则 hostapd 拒启）；80MHz 必须同时给 vht+he 两个 seg0。
generate_hostapd_conf() {
    local iface="$1" ssid="$2" psk="$3" ch="$4" w="$5"
    local params seg0 dir htc="[SHORT-GI-20][SHORT-GI-40]" vhtcw hecw
    params=$(derive_5g_params "$ch" "$w")
    if [ -z "$params" ]; then w=20; params="$ch NONE"; log "5G ch$ch@${5}MHz 无效组合，降级 20MHz"; fi
    seg0=${params%% *}; dir=${params##* }
    case "$dir" in PLUS) htc="[HT40+]$htc";; MINUS) htc="[HT40-]$htc";; esac
    case "$w" in 80) vhtcw=1; hecw=1;; *) vhtcw=0; hecw=0;; esac
    mkdir -p /etc/hostapd
    umask 077
    {
        echo "interface=$iface"
        echo "driver=nl80211"
        echo "ssid=$ssid"
        echo "country_code=$COUNTRY"
        echo "ieee80211d=1"
        echo "hw_mode=a"
        echo "channel=$ch"
        echo "wmm_enabled=1"
        echo "ieee80211n=1"
        echo "ht_capab=$htc"
        echo "ieee80211ac=1"
        echo "vht_oper_chwidth=$vhtcw"
        [ "$vhtcw" = 1 ] && echo "vht_oper_centr_freq_seg0_idx=$seg0"
        echo "ieee80211ax=1"
        echo "he_oper_chwidth=$hecw"
        [ "$hecw" = 1 ] && echo "he_oper_centr_freq_seg0_idx=$seg0"
        echo "wpa=2"
        echo "wpa_key_mgmt=SAE"
        echo "rsn_pairwise=CCMP"
        echo "ieee80211w=2"
        echo "sae_password=$psk"
    } > "$HOSTAPD_CONF"
    chmod 600 "$HOSTAPD_CONF"
    log "已写入 $HOSTAPD_CONF (ch$ch/${w}MHz seg0=$seg0 $dir)"
}

# release_iface_from_nm <iface> <mac>：把 5G 卡从 NM 彻底摘管，防 autoconnect 抢接口。
# 仅 `nmcli device set managed no` 不持久（NM reload/重启后重新纳管）→ 必须写 conf.d 按 MAC。
release_iface_from_nm() {
    local iface="$1" mac="$2"
    nmcli connection down "$CONN_5G"   >/dev/null 2>&1 || true
    nmcli connection delete "$CONN_5G" >/dev/null 2>&1 || true
    rm -f "$KF_DIR/$CONN_5G.nmconnection" 2>/dev/null
    mkdir -p /etc/NetworkManager/conf.d
    printf '[keyfile]\nunmanaged-devices=mac:%s\n' "$(upper "$mac")" \
        > /etc/NetworkManager/conf.d/99-hive-hotspot-5g.conf
    nmcli general reload 2>/dev/null || nmcli connection reload 2>/dev/null || true
    nmcli device set "$iface" managed no >/dev/null 2>&1 || true
}

# write_5g_env <iface>：供两个 systemd unit（EnvironmentFile）与 setup-firewall.sh 读取。
# 先把上轮 env 备份为 .prev，供 apply_ufw_5g 在接口改名时清理旧规则。
write_5g_env() {
    local iface="$1"
    mkdir -p /etc/hive
    [ -f "$HOTSPOT_5G_ENV" ] && cp -f "$HOTSPOT_5G_ENV" "${HOTSPOT_5G_ENV}.prev" 2>/dev/null || true
    {
        echo "AP_IFACE=$iface"
        echo "AP_IP4=$AP5G_IP4"
        echo "HOTSPOT_COUNTRY=$COUNTRY"
    } > "$HOTSPOT_5G_ENV"
    chmod 644 "$HOTSPOT_5G_ENV"
}

# write_dnsmasq_conf <iface>：只绑 AP 口的独立 dnsmasq 实例（DHCP + DNS→Mihomo）。
# bind-interfaces + listen-address 三重隔离，不抢系统 53/67、2.4G NM dnsmasq、Mihomo。
write_dnsmasq_conf() {
    local iface="$1"
    mkdir -p /etc/hive
    {
        echo "interface=$iface"
        echo "bind-interfaces"
        echo "listen-address=10.42.1.1"
        echo "dhcp-range=10.42.1.50,10.42.1.200,255.255.255.0,12h"
        echo "dhcp-option=3,10.42.1.1"      # 网关
        echo "dhcp-option=6,10.42.1.1"      # DNS 指向本机
        echo "no-resolv"
        echo "server=127.0.0.1#1053"        # 转发给 Mihomo DNS（fake-ip 分流→走代理）
    } > "$DNSMASQ_CONF"
    chmod 644 "$DNSMASQ_CONF"
}

# apply_ufw_5g <new_iface>：按接口名静态放行 forward/DHCP/DNS；接口改名时清旧规则。
apply_ufw_5g() {
    command -v ufw >/dev/null 2>&1 || return 0
    local new="$1" old
    old=$(grep -E '^AP_IFACE=' "${HOTSPOT_5G_ENV}.prev" 2>/dev/null | cut -d= -f2)
    if [ -n "$old" ] && [ "$old" != "$new" ]; then
        ufw route delete allow in on "$old" 2>/dev/null || true
        ufw delete allow in on "$old" to any port 67 proto udp 2>/dev/null || true
        ufw delete allow in on "$old" to any port 53 2>/dev/null || true
    fi
    ufw route allow in on "$new" comment 'hive-hotspot-5g forward' 2>/dev/null || true
    ufw allow in on "$new" to any port 67 proto udp comment 'hive-hotspot-5g DHCP' 2>/dev/null || true
    ufw allow in on "$new" to any port 53 comment 'hive-hotspot-5g DNS' 2>/dev/null || true
}

# 2.4G 仍走 NM shared（WPA2-PSK）。5G 改走独立 hostapd（WPA3-SAE 在 hostapd 配置里）。
SEC_WPA2=$'[wifi-security]\nkey-mgmt=wpa-psk\nproto=rsn\npairwise=ccmp\ngroup=ccmp\npsk='"$PSK"

DONE_2G=""; DONE_5G=""
if [ "$i2" -ge 0 ]; then
    write_kf x "$CONN_2G" "$UUID_2G" "$SSID_2G" "${C_MAC[$i2]}" bg "$SEC_WPA2" "10.42.0.1/24"
    DONE_2G="${C_IF[$i2]}"
else
    rm -f "$KF_DIR/$CONN_2G.nmconnection" 2>/dev/null
fi
# 5G 走独立 hostapd（不写 NM keyfile）：摘管 → 生成配置 → 拉起两个常驻单元 → 干净失败处理。
if [ "$i5" -ge 0 ]; then
    IF5="${C_IF[$i5]}"; MAC5="${C_MAC[$i5]}"
    release_iface_from_nm "$IF5" "$MAC5"
    generate_hostapd_conf "$IF5" "$SSID_5G" "$PSK" "$CH5G" "$WIDTH_5G"
    write_5g_env "$IF5"
    write_dnsmasq_conf "$IF5"
    apply_ufw_5g "$IF5"
    systemctl daemon-reload 2>/dev/null || true
    systemctl restart hive-hotspot-5g.service 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet hive-hotspot-5g.service; then
        systemctl restart hive-hotspot-5g-dnsmasq.service 2>/dev/null || true
        DONE_5G="$IF5"
        log "5G hostapd 已启动：$SSID_5G on $IF5 @ ch$CH5G/${WIDTH_5G}MHz"
    else
        # 无回退：干净失败，不留半吊子（NM 已摘管、又无 hostapd，接口不能悬空）。
        log "ERROR: hostapd 未能在 $IF5 起 5G AP，清理并放弃（不回退 NM）"
        journalctl -u hive-hotspot-5g -n 20 --no-pager 2>/dev/null \
            | while read -r l; do log "  hostapd: $l"; done
        systemctl stop hive-hotspot-5g.service hive-hotspot-5g-dnsmasq.service 2>/dev/null || true
        ip addr flush dev "$IF5" 2>/dev/null || true
        DONE_5G=""
    fi
else
    # 无 5G 卡：停单元、清生成的配置、把接口交还 NM（删 unmanaged conf.d）。
    systemctl stop hive-hotspot-5g.service hive-hotspot-5g-dnsmasq.service 2>/dev/null || true
    rm -f "$HOSTAPD_CONF" "$DNSMASQ_CONF" "$HOTSPOT_5G_ENV" \
          /etc/NetworkManager/conf.d/99-hive-hotspot-5g.conf 2>/dev/null
    nmcli general reload 2>/dev/null || true
    rm -f "$KF_DIR/$CONN_5G.nmconnection" 2>/dev/null
fi

# ── 7. 把凭证记入 node-info（运维查阅 + MOTD + 测试）──────────────────
mkdir -p /etc/hive
if [ -f "$NODE_INFO" ]; then
    sed -i '/^WIFI_/d' "$NODE_INFO"
fi
grep -q '^MAC=' "$NODE_INFO" 2>/dev/null || echo "MAC=${NODE_MAC}" >> "$NODE_INFO"
{
    echo "WIFI_PSK=${PSK}"
    [ -n "$DONE_2G" ] && { echo "WIFI_SSID_2G=${SSID_2G}"; echo "WIFI_IFACE_2G=${DONE_2G}"; }
    [ -n "$DONE_5G" ] && { echo "WIFI_SSID_5G=${SSID_5G}"; echo "WIFI_IFACE_5G=${DONE_5G}"; echo "WIFI_5G_WIDTH=${WIDTH_5G}"; }
    # 兼容旧字段（MOTD/test 单频展示用）：优先 2.4G，否则 5G
    if [ -n "$DONE_2G" ]; then echo "WIFI_SSID=${SSID_2G}"; echo "WIFI_IFACE=${DONE_2G}";
    elif [ -n "$DONE_5G" ]; then echo "WIFI_SSID=${SSID_5G}"; echo "WIFI_IFACE=${DONE_5G}"; fi
} >> "$NODE_INFO"

# ── 8. 让 NM 重载并激活 2.4G（5G 已由上方 hostapd 单元拉起，不走 NM）───────
nmcli connection reload 2>/dev/null || true
bring_up() {  # $1=conn_id $2=iface
    [ -n "$2" ] || return
    for _ in $(seq 1 10); do
        nmcli -t -f DEVICE device status 2>/dev/null | grep -qx "$2" && break; sleep 1
    done
    nmcli device disconnect "$2" >/dev/null 2>&1 || true
    if nmcli connection up "$1" >/dev/null 2>&1; then
        log "热点已启动：$1 on $2"
    else
        log "$1 nmcli up 失败（将由 autoconnect 重试）"
    fi
}
bring_up "$CONN_2G" "$DONE_2G"

log "完成。2.4G=[${SSID_2G}@${DONE_2G:-none}] 5G=[${SSID_5G}@${DONE_5G:-none}] PSK=$PSK"
exit 0
