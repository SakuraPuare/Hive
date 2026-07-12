#!/bin/bash
# 根据 MAC6 计算该节点的全部管理通道地址
# 用法：
#   ./scripts/node-lookup.sh a4b2c1
#   ./scripts/node-lookup.sh a4:b2:c1:xx:xx:xx   （输入完整 MAC 也可）
#
# 输出与设备首次启动后 /etc/hive/node-info 完全一致

set -e

input="${1:-}"
if [ -z "$input" ]; then
    echo "Usage: $0 <mac6>  (e.g. a4b2c1)"
    echo "       $0 <full-mac>  (e.g. aa:bb:cc:a4:b2:c1)"
    exit 1
fi

# 归一化：去冒号、转小写
MAC_NORM=$(echo "$input" | tr -d ':' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-f0-9')
# 取最后 6 个十六进制字符作 MAC6
MAC6=$(echo "$MAC_NORM" | grep -o '.\{6\}$')
# 仅当输入是完整 12 位 MAC 时才有全 MAC（FRP 端口精确计算需要它）
MAC_FULL=""
[ ${#MAC_NORM} -eq 12 ] && MAC_FULL="$MAC_NORM"

if [ ${#MAC6} -ne 6 ]; then
    echo "ERROR: could not parse MAC6 from: $input"
    exit 1
fi

HOSTNAME="hive-${MAC6}"

# ── EasyTier IP（MAC6 三字节映射）──────────────────────────
ET_B1=$(printf "%d" "0x${MAC6:0:2}")
ET_B2=$(printf "%d" "0x${MAC6:2:2}")
ET_B3=$(printf "%d" "0x${MAC6:4:2}")
EASYTIER_IP="10.${ET_B1}.${ET_B2}.${ET_B3}"

# ── FRP 端口（provision 用完整 12 位 MAC 的 md5 前 8 位 hex % 50000 + 10000）──
# 只有传入完整 MAC 才能精确算出；仅给 MAC6 时无法推导（md5(MAC6) 与 md5(fullMAC) 无关）。
if [ -n "$MAC_FULL" ]; then
    PORT_HEX=$(printf '%s' "$MAC_FULL" | md5sum | cut -c1-8)
    FRP_PORT=$((10000 + 0x${PORT_HEX} % 50000))
else
    FRP_PORT="N/A"
fi

# ── 从 .env 读取 VPS 地址（若存在）──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VPS_ADDR="<your-vps>"
CF_DOMAIN_LABEL="<cf-domain>"
if [ -f "${ROOT_DIR}/.env" ]; then
    source "${ROOT_DIR}/.env" 2>/dev/null || true
    [ -n "${FRP_SERVER_ADDR:-}" ] && VPS_ADDR="$FRP_SERVER_ADDR"
    [ -n "${CF_DOMAIN:-}"       ] && CF_DOMAIN_LABEL="$CF_DOMAIN"
fi

echo ""
echo "┌─────────────────────────────────────────────────┐"
printf "│  NODE: %-40s│\n" "$HOSTNAME"
echo "├─────────────────────────────────────────────────┤"
printf "│  Tailscale  ssh root@%-27s│\n" "${HOSTNAME}"
printf "│  EasyTier   ssh root@%-27s│\n" "${EASYTIER_IP}"
printf "│  FRP        ssh -p %-6s root@%-17s│\n" "${FRP_PORT}" "${VPS_ADDR}"
printf "│  CF Proxy   https://%-28s│\n" "${HOSTNAME}.${CF_DOMAIN_LABEL}"
echo "├─────────────────────────────────────────────────┤"
if [ "$FRP_PORT" = "N/A" ]; then
echo "│  FRP port needs full MAC (pass aa:bb:cc:dd:ee:ff)│"
echo "│  or read exact port: cat /etc/hive/node-info    │"
fi
echo "└─────────────────────────────────────────────────┘"
echo ""
