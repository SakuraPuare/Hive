#!/bin/bash
# /opt/rk3528-hive/management/scripts/test-node.sh
# 从管理 VPS 测试任意 hive 节点的所有通道
#
# 用法：
#   test-node.sh <hostname|mac6>        # 测试单个节点
#   test-node.sh --all                  # 测试所有已注册节点

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "${SCRIPT_DIR}/.env" ] && source "${SCRIPT_DIR}/.env"

REGISTRY_URL="http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}"
AUTH_ARGS=()
[ -n "${REGISTRY_API_SECRET:-}" ] && AUTH_ARGS=(-H "Authorization: Bearer ${REGISTRY_API_SECRET}")

PASS=0; FAIL=0; WARN=0

pass() { printf "\e[0;92m[PASS]\e[0m %-22s %s\n" "$1" "$2"; PASS=$((PASS+1)); }
fail() { printf "\e[0;91m[FAIL]\e[0m %-22s %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }
warn() { printf "\e[0;93m[WARN]\e[0m %-22s %s\n" "$1" "$2"; WARN=$((WARN+1)); }

# ── 获取节点信息 ──────────────────────────────────────────────────────────────
fetch_node() {
    local query="$1"
    if [[ "$query" == "hive-"* ]]; then
        curl -sf "${AUTH_ARGS[@]}" "${REGISTRY_URL}/nodes" 2>/dev/null \
            | jq -c --arg h "$query" '.[] | select(.hostname == $h)'
    else
        curl -sf "${AUTH_ARGS[@]}" "${REGISTRY_URL}/nodes/${query}" 2>/dev/null
    fi
}

fetch_all_nodes() {
    curl -sf "${AUTH_ARGS[@]}" "${REGISTRY_URL}/nodes" 2>/dev/null
}

# ── 测试单个节点 ──────────────────────────────────────────────────────────────
test_node() {
    local node_json="$1"

    local hostname cf_url tailscale_ip easytier_ip frp_port frp_server xray_uuid last_seen
    hostname=$(echo "$node_json"    | jq -r '.hostname')
    cf_url=$(echo "$node_json"      | jq -r '.cf_url // empty')
    tailscale_ip=$(echo "$node_json"| jq -r '.tailscale_ip // empty')
    easytier_ip=$(echo "$node_json" | jq -r '.easytier_ip // empty')
    frp_port=$(echo "$node_json"    | jq -r '.frp_port // empty')
    xray_uuid=$(echo "$node_json"   | jq -r '.xray_uuid // empty')
    last_seen=$(echo "$node_json"   | jq -r '.last_seen // empty')

    PASS=0; FAIL=0; WARN=0

    echo ""
    echo "=== Testing node: ${hostname} (last seen: ${last_seen}) ==="
    echo ""

    # 1. Registry 可达性（节点能查到就算通过）
    pass "registry" "node found, last_seen=${last_seen}"

    # 2. Tailscale
    if [ -n "${tailscale_ip}" ] && [ "${tailscale_ip}" != "pending" ]; then
        if ping -c1 -W2 "${tailscale_ip}" &>/dev/null; then
            pass "tailscale-ping" "${tailscale_ip} reachable"
        else
            fail "tailscale-ping" "${tailscale_ip} unreachable"
        fi
        if timeout 3 bash -c "echo >/dev/tcp/${tailscale_ip}/22" 2>/dev/null; then
            pass "tailscale-ssh" "port 22 open on ${tailscale_ip}"
        else
            warn "tailscale-ssh" "port 22 not reachable on ${tailscale_ip}"
        fi
        METRIC_LINES=$(curl -sf --max-time 5 "http://${tailscale_ip}:9100/metrics" 2>/dev/null | wc -l || echo 0)
        if [ "${METRIC_LINES}" -gt 10 ]; then
            pass "node-exporter" "http://${tailscale_ip}:9100/metrics OK (${METRIC_LINES} lines)"
        else
            fail "node-exporter" "http://${tailscale_ip}:9100/metrics unreachable"
        fi
    else
        warn "tailscale" "IP is '${tailscale_ip:-not set}', skipping Tailscale tests"
    fi

    # 3. EasyTier
    if [ -n "${easytier_ip}" ]; then
        if ping -c1 -W2 "${easytier_ip}" &>/dev/null; then
            pass "easytier-ping" "${easytier_ip} reachable"
        else
            fail "easytier-ping" "${easytier_ip} unreachable"
        fi
    else
        warn "easytier" "IP not set, skipping"
    fi

    # 4. FRP SSH
    if [ -n "${frp_port}" ] && [ -n "${FRP_SERVER_ADDR:-}" ]; then
        if timeout 3 bash -c "echo >/dev/tcp/${FRP_SERVER_ADDR}/${frp_port}" 2>/dev/null; then
            pass "frp-ssh" "port ${frp_port} open on ${FRP_SERVER_ADDR}"
        else
            fail "frp-ssh" "${FRP_SERVER_ADDR}:${frp_port} unreachable"
        fi
    else
        warn "frp" "FRP_SERVER_ADDR not set or frp_port missing, skipping"
    fi

    # 5. Cloudflare Tunnel + Xray WebSocket
    if [ -n "${cf_url}" ]; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${cf_url}" 2>/dev/null || echo "000")
        if [[ "$HTTP_CODE" =~ ^(101|200|400|404)$ ]]; then
            pass "cf-tunnel" "${cf_url} → HTTP ${HTTP_CODE}"
        else
            fail "cf-tunnel" "${cf_url} → HTTP ${HTTP_CODE}"
        fi

        if [ -n "${xray_uuid}" ]; then
            CF_HOST="${cf_url#https://}"
            WS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
                -H "Upgrade: websocket" \
                -H "Connection: Upgrade" \
                -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
                -H "Sec-WebSocket-Version: 13" \
                "https://${CF_HOST}/ray" 2>/dev/null || echo "000")
            if [ "$WS_CODE" = "101" ]; then
                pass "xray-ws" "WebSocket 101 OK via ${CF_HOST}"
            else
                warn "xray-ws" "WebSocket returned HTTP ${WS_CODE} via ${CF_HOST}"
            fi
        fi
    else
        warn "cf-tunnel" "CF_URL not set, skipping"
    fi

    echo ""
    local total=$((PASS + FAIL + WARN))
    echo "=== ${hostname}: ${total} tests — \e[0;92m${PASS} passed\e[0m, \e[0;91m${FAIL} failed\e[0m, \e[0;93m${WARN} warnings\e[0m ==="
}

# ── 入口 ──────────────────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    echo "Usage: $(basename "$0") <hostname|mac6|mac>  # test single node"
    echo "       $(basename "$0") --all                # test all nodes"
    exit 1
fi

if [ "$1" = "--all" ]; then
    NODES=$(fetch_all_nodes)
    COUNT=$(echo "$NODES" | jq 'length')
    echo "Testing ${COUNT} nodes..."
    TOTAL_FAIL=0
    while IFS= read -r node; do
        test_node "$node"
        TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
        PASS=0; FAIL=0; WARN=0
    done < <(echo "$NODES" | jq -c '.[]')
    echo ""
    [ "${TOTAL_FAIL}" -eq 0 ]
else
    NODE=$(fetch_node "$1")
    if [ -z "$NODE" ]; then
        echo "ERROR: node '$1' not found in registry" >&2
        exit 1
    fi
    test_node "$NODE"
    [ "${FAIL}" -eq 0 ]
fi
