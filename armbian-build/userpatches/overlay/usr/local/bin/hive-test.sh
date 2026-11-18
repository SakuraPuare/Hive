#!/bin/bash
# /usr/local/bin/hive-test.sh
# 一键测试 hive 节点所有功能

PASS=0; FAIL=0; WARN=0

pass() { printf "\e[0;92m[PASS]\e[0m %-20s %s\n" "$1" "$2"; ((PASS++)); }
fail() { printf "\e[0;91m[FAIL]\e[0m %-20s %s\n" "$1" "$2"; ((FAIL++)); }
warn() { printf "\e[0;93m[WARN]\e[0m %-20s %s\n" "$1" "$2"; ((WARN++)); }

svc_active() { systemctl is-active --quiet "$1"; }

# ── 加载配置 ──────────────────────────────────────────────────────────────────
[ -f /etc/hive/config.env ] && source /etc/hive/config.env
source /usr/local/bin/hive-node-info
hive_load_node_info

HOSTNAME="${HOSTNAME:-$(hostname)}"
echo ""
echo "=== Hive Node Test: ${HOSTNAME} ==="
echo ""

# ── 1. 网络 ───────────────────────────────────────────────────────────────────
if ping -c1 -W3 8.8.8.8 &>/dev/null; then
    pass "internet" "reachable"
else
    fail "internet" "cannot reach 8.8.8.8"
fi

# ── 2. Xray (VLESS+WS) ────────────────────────────────────────────────────────
if svc_active xray; then
    # WebSocket 握手：发 Upgrade 头，期望 101
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
        -H "Upgrade: websocket" \
        -H "Connection: Upgrade" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        -H "Sec-WebSocket-Version: 13" \
        http://127.0.0.1:10077/ray 2>/dev/null)
    if [ "$HTTP_CODE" = "101" ]; then
        pass "xray" "listening :10077, WebSocket 101 OK"
    else
        warn "xray" "running but WebSocket returned HTTP ${HTTP_CODE:-timeout}"
    fi
else
    fail "xray" "service not active"
fi

# Xray must run as the dedicated user; TPROXY only sees forwarded traffic,
# so the Xray exit needs no mark/bypass rules.
XRAY_USER=$(ps -o user= -C xray 2>/dev/null | head -1 | tr -d ' ')
if [ "$XRAY_USER" = "xray" ] && runuser -u xray -- test -r /etc/xray/config.json 2>/dev/null; then
    pass "xray-user" "running as xray, config readable"
else
    fail "xray-user" "user=${XRAY_USER:-none}, config not readable by xray"
fi

# ── 3. Cloudflare Tunnel ──────────────────────────────────────────────────────
if svc_active cloudflared; then
    if [ -n "${CF_URL}" ]; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${CF_URL}" 2>/dev/null)
        # 根路径 302 到伪装站是预期行为；2xx/3xx 都说明 tunnel 链路可达。
        if [[ "$HTTP_CODE" =~ ^(101|2[0-9][0-9]|3[0-9][0-9]|400|404)$ ]]; then
            pass "cloudflared" "${CF_URL} → HTTP ${HTTP_CODE}"
        else
            warn "cloudflared" "running but ${CF_URL} returned HTTP ${HTTP_CODE:-timeout}"
        fi
    else
        warn "cloudflared" "running but CF_URL not set in node-info"
    fi
else
    fail "cloudflared" "service not active"
fi

# ── 4. FRP Client ─────────────────────────────────────────────────────────────
if svc_active frpc; then
    if [ -n "${FRP_SERVER_ADDR}" ] && [ -n "${FRP_PORT}" ]; then
        # frpc 可能走 IPv6 连 frps，不能按 FRP_SERVER_ADDR 字面量 grep；
        # 直接看有没有属于 frpc 进程的已建立 TCP 连接。
        if ss -tnp 2>/dev/null | grep -q 'frpc'; then
            pass "frpc" "connected to ${FRP_SERVER_ADDR}, SSH port ${FRP_PORT}"
        elif journalctl -u frpc --since "10 min ago" --no-pager 2>/dev/null | grep -q "login to server success"; then
            pass "frpc" "connected to ${FRP_SERVER_ADDR} (log), SSH port ${FRP_PORT}"
        else
            warn "frpc" "running but no active connection to ${FRP_SERVER_ADDR}"
        fi
    else
        warn "frpc" "running but FRP_SERVER_ADDR/FRP_PORT not set"
    fi
else
    fail "frpc" "service not active"
fi

# ── 5. EasyTier ───────────────────────────────────────────────────────────────
if svc_active easytier; then
    # EasyTier 的接口名不固定是 easytier*（常见 tun0）：优先按 registry
    # 分配的 EASYTIER_IP 找承载接口，找不到再退回接口名启发式。
    ET_IFACE=""
    if [ -n "${EASYTIER_IP}" ]; then
        ET_IFACE=$(ip -4 -o addr show 2>/dev/null | awk -v ip="${EASYTIER_IP}" '$4 ~ ("^" ip "/") {print $2; exit}')
    fi
    if [ -z "${ET_IFACE}" ]; then
        ET_IFACE=$(ip link show 2>/dev/null | grep -oE 'easytier[^ :]*|tun[0-9]+' | head -1)
    fi
    if [ -n "${ET_IFACE}" ]; then
        ACTUAL_IP=$(ip -4 addr show "${ET_IFACE}" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)
        if [ -n "${EASYTIER_IP}" ] && [ "${ACTUAL_IP}" = "${EASYTIER_IP}" ]; then
            pass "easytier" "${ET_IFACE} @ ${ACTUAL_IP}"
        elif [ -n "${ACTUAL_IP}" ]; then
            warn "easytier" "${ET_IFACE} @ ${ACTUAL_IP} (expected ${EASYTIER_IP:-unknown})"
        else
            warn "easytier" "${ET_IFACE} exists but no IP assigned yet"
        fi
    else
        warn "easytier" "running but no easytier/tun interface found"
    fi
else
    fail "easytier" "service not active"
fi

# ── 6. Tailscale ──────────────────────────────────────────────────────────────
if svc_active tailscaled; then
    TS_STATUS=$(tailscale status --peers=false 2>/dev/null | head -1)
    TS_IP=$(tailscale ip -4 2>/dev/null)
    if [ -n "${TS_IP}" ]; then
        pass "tailscale" "connected as ${HOSTNAME} @ ${TS_IP}"
    else
        warn "tailscale" "running but not connected (${TS_STATUS:-no status})"
    fi
else
    fail "tailscale" "tailscaled not active"
fi

# ── 7. Cloudflare Mesh (WARP Connector) ──────────────────────────────────
if [ -z "${MESH_TUNNEL_ID:-}" ] || [ "${MESH_TUNNEL_ID}" = "none" ] || [ -z "${MESH_IP:-}" ] || [ "${MESH_IP}" = "pending" ]; then
    pass "cf-mesh" "not configured (optional)"
elif command -v warp-cli &>/dev/null; then
    WARP_STATUS=$(warp-cli status 2>/dev/null)
    if echo "$WARP_STATUS" | grep -qi "connected"; then
        WARP_IP=$(echo "$WARP_STATUS" | grep -oP '(?<=IP: )\S+' || echo "unknown")
        pass "cf-mesh" "connected @ ${WARP_IP}"
    elif echo "$WARP_STATUS" | grep -qi "registration missing"; then
        fail "cf-mesh" "not registered (run warp-cli connector new <TOKEN>)"
    else
        warn "cf-mesh" "warp-cli present but status: $(echo "$WARP_STATUS" | head -1)"
    fi
else
    warn "cf-mesh" "warp-cli not installed"
fi

# ── 8. Prometheus Node Exporter ──────────────────────────────────────────────
if svc_active prometheus-node-exporter; then
    METRIC_LINES=$(curl -sf --max-time 3 http://127.0.0.1:9100/metrics 2>/dev/null | wc -l)
    if [ "${METRIC_LINES:-0}" -gt 10 ]; then
        pass "node-exporter" "metrics OK (${METRIC_LINES} lines)"
    else
        warn "node-exporter" "running but metrics endpoint returned ${METRIC_LINES:-0} lines"
    fi
else
    fail "node-exporter" "service not active"
fi

# ── 9. UFW Firewall ───────────────────────────────────────────────────────────
if svc_active ufw; then
    RULE_COUNT=$(ufw status 2>/dev/null | grep -c "ALLOW\|DENY" || echo 0)
    pass "firewall" "ufw active, ${RULE_COUNT} rules"
else
    fail "firewall" "ufw not active"
fi

# ── 10. fail2ban ──────────────────────────────────────────────────────────────
if svc_active fail2ban; then
    JAIL_COUNT=$(fail2ban-client status 2>/dev/null | grep "Number of jail" | grep -o '[0-9]*' || echo 0)
    if [ "${JAIL_COUNT:-0}" -gt 0 ]; then
        pass "fail2ban" "${JAIL_COUNT} jails active"
    else
        warn "fail2ban" "running but no jails active"
    fi
else
    fail "fail2ban" "service not active"
fi

# ── 11. WiFi 热点（仅当存在无线网卡时检测，否则跳过）─────────────────────
WLAN_PRESENT=0
for d in /sys/class/net/*/phy80211; do [ -e "$d" ] && WLAN_PRESENT=1 && break; done
if [ "$WLAN_PRESENT" = "1" ]; then
    check_ap() {  # $1=conn_id $2=频段标签 $3=期望SSID
        local conn="$1" label="$2" ssid="$3"
        nmcli -t -f NAME connection show 2>/dev/null | grep -qx "$conn" || return 1
        if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "$conn"; then
            local ifc ip
            ifc=$(nmcli -t -f GENERAL.DEVICES connection show "$conn" 2>/dev/null | cut -d: -f2)
            ip=$(ip -4 addr show "$ifc" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)
            pass "wifi-${label}" "SSID=${ssid:-?} on ${ifc:-?} @ ${ip:-no-ip}"
        else
            warn "wifi-${label}" "$conn configured but not active"
        fi
        return 0
    }
    GOT=0
    # 2.4G：仍走 NM shared，沿用原 check_ap
    check_ap "hive-hotspot-2g" "2.4g" "${WIFI_SSID_2G}" && GOT=1
    # 5G：走独立 hostapd（非 NM），查 hostapd + dnsmasq 服务态 + 接口 IP
    if systemctl is-active --quiet hive-hotspot-5g && systemctl is-active --quiet hive-hotspot-5g-dnsmasq; then
        ifc="${WIFI_IFACE_5G}"
        ip=$(ip -4 addr show "$ifc" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)
        w=$(iw dev "$ifc" info 2>/dev/null | awk '/width/{print $6; exit}')
        if [ "$ip" = "10.42.1.1" ]; then
            pass "wifi-5g" "hostapd SSID=${WIFI_SSID_5G:-?} on ${ifc:-?} @ ${ip} width=${w:-?}MHz"
        else
            warn "wifi-5g" "hostapd/dnsmasq active 但接口无 10.42.1.1（ip=${ip:-none}）"
        fi
        GOT=1
    elif [ -n "${WIFI_SSID_5G:-}" ]; then
        warn "wifi-5g" "配置了 5G 但 hostapd/dnsmasq 未运行（try: systemctl status hive-hotspot-5g）"
    fi
    [ "$GOT" = "1" ] || warn "wifi-hotspot" "wireless NIC present but no hotspot connection (try: hive-hotspot.sh)"
fi

# ── 12. 透明代理网关（Mihomo）─────────────────────────────────────────────
if [ "${GATEWAY_ENABLED:-on}" = "off" ] || [ "${GATEWAY_ENABLED:-on}" = "0" ]; then
    warn "gateway" "GATEWAY_ENABLED=off, 透明代理网关已禁用"
else
    # mihomo 服务
    if systemctl is-active --quiet hive-mihomo 2>/dev/null; then
        pass "gateway-mihomo" "hive-mihomo active"
    else
        warn "gateway-mihomo" "hive-mihomo not active (try: systemctl status hive-mihomo)"
    fi
    # TPROXY config + nft/ip rule (no TUN)
    if grep -q '^tproxy-port: 7893' /etc/mihomo/config.yaml 2>/dev/null &&
       ! grep -q '^tun:' /etc/mihomo/config.yaml 2>/dev/null; then
        pass "gateway-tproxy" "mihomo tproxy-port=7893, no TUN"
    else
        fail "gateway-tproxy" "mihomo config is not tproxy/7893"
    fi
    if nft list table inet hive_gateway >/dev/null 2>&1 &&
       ip rule show 2>/dev/null | grep -q 'fwmark 0x2 lookup 100'; then
        pass "gateway-tproxy-route" "nft hive_gateway + fwmark 0x2 ip rule"
    else
        warn "gateway-tproxy-route" "nft/ip rule missing (no LAN/AP or route unit failed)"
    fi
    # external-controller 面板可达
    SECRET=$(grep -E '^secret:' /etc/mihomo/config.yaml 2>/dev/null | head -1 | sed 's/^secret:[[:space:]]*//; s/^"//; s/"$//')
    if curl -sf --max-time 3 ${SECRET:+-H "Authorization: Bearer ${SECRET}"} \
        "http://127.0.0.1:9090/version" >/dev/null 2>&1; then
        pass "gateway-panel" "Clash API @ :9090 (面板: http://${GATEWAY_LAN_IP:-<lan-ip>}:9090/ui)"
    else
        warn "gateway-panel" "Clash API :9090 unreachable"
    fi
    # WAN/LAN 拓扑（双网口）或单臂网关（单网口无无线）
    if [ -n "${GATEWAY_ONE_ARM_IFACE:-}" ]; then
        pass "gateway-topo" "one-arm ${GATEWAY_ONE_ARM_IFACE} @ ${GATEWAY_ONE_ARM_IP:-?} (clients set default gateway)"
    elif [ -n "${GATEWAY_LAN_IFACES:-}" ]; then
        pass "gateway-topo" "WAN=${GATEWAY_WAN_IFACE:-?} LAN=${GATEWAY_LAN_IFACES}"
    else
        pass "gateway-topo" "single-NIC device (no WAN/LAN split, expected)"
    fi
fi

# ── 13. SSH Host Key 确定性验证 ───────────────────────────────────────────
if [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
    FP=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')
    pass "ssh-hostkey" "Ed25519 ${FP}"
else
    fail "ssh-hostkey" "/etc/ssh/ssh_host_ed25519_key.pub not found"
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + WARN))
printf "\n=== %s tests: \e[0;92m%s passed\e[0m, \e[0;91m%s failed\e[0m, \e[0;93m%s warnings\e[0m ===\n\n" "$TOTAL" "$PASS" "$FAIL" "$WARN"

[ "${FAIL}" -eq 0 ]
