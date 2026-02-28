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
[ -f /etc/hive/node-info  ] && source /etc/hive/node-info

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

# ── 3. Cloudflare Tunnel ──────────────────────────────────────────────────────
if svc_active cloudflared; then
    if [ -n "${CF_URL}" ]; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${CF_URL}" 2>/dev/null)
        if [[ "$HTTP_CODE" =~ ^(101|200|400|404)$ ]]; then
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
        # 检查是否有到 FRP 服务器的 TCP 连接
        if ss -tn | grep -q "${FRP_SERVER_ADDR}"; then
            pass "frpc" "connected to ${FRP_SERVER_ADDR}, SSH port ${FRP_PORT}"
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
    ET_IFACE=$(ip link show 2>/dev/null | grep -o 'easytier[^ :]*' | head -1)
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
        warn "easytier" "running but no easytier interface found"
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

# ── 7. Prometheus Node Exporter ───────────────────────────────────────────────
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

# ── 8. UFW Firewall ───────────────────────────────────────────────────────────
if svc_active ufw; then
    RULE_COUNT=$(ufw status 2>/dev/null | grep -c "ALLOW\|DENY" || echo 0)
    pass "firewall" "ufw active, ${RULE_COUNT} rules"
else
    fail "firewall" "ufw not active"
fi

# ── 9. fail2ban ───────────────────────────────────────────────────────────────
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

# ── 10. SSH Host Key 确定性验证 ───────────────────────────────────────────────
if [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
    FP=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')
    pass "ssh-hostkey" "Ed25519 ${FP}"
else
    fail "ssh-hostkey" "/etc/ssh/ssh_host_ed25519_key.pub not found"
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + WARN))
echo ""
echo "=== ${TOTAL} tests: \e[0;92m${PASS} passed\e[0m, \e[0;91m${FAIL} failed\e[0m, \e[0;93m${WARN} warnings\e[0m ==="
echo ""

[ "${FAIL}" -eq 0 ]
