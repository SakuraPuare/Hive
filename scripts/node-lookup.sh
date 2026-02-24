#!/bin/bash
# 根据 MAC6 计算该节点的全部管理通道地址
# 用法：
#   ./scripts/node-lookup.sh a4b2c1
#   ./scripts/node-lookup.sh a4:b2:c1:xx:xx:xx   （输入完整 MAC 也可）
#
# 输出与设备首次启动后 /etc/edge/node-info 完全一致

set -e

input="${1:-}"
if [ -z "$input" ]; then
    echo "Usage: $0 <mac6>  (e.g. a4b2c1)"
    echo "       $0 <full-mac>  (e.g. aa:bb:cc:a4:b2:c1)"
    exit 1
fi

# 统一处理：取最后 6 个十六进制字符
MAC6=$(echo "$input" | tr -d ':' | tr '[:upper:]' '[:lower:]' | grep -o '.\{6\}$')

if [ ${#MAC6} -ne 6 ]; then
    echo "ERROR: could not parse MAC6 from: $input"
    exit 1
fi

HOSTNAME="edge-${MAC6}"

# ── EasyTier IP（MAC6 三字节映射）──────────────────────────
ET_B1=$(printf "%d" "0x${MAC6:0:2}")
ET_B2=$(printf "%d" "0x${MAC6:2:2}")
ET_B3=$(printf "%d" "0x${MAC6:4:2}")
EASYTIER_IP="10.${ET_B1}.${ET_B2}.${ET_B3}"

# ── FRP 端口（全 MAC 哈希，需要补全 MAC——此处仅从 MAC6 估算）──
# 注意：provision-node.sh 使用完整 12 位 MAC 做哈希
# 此脚本只有 MAC6，结果仅供参考；精确值在节点的 /etc/edge/node-info 里
PORT_OFFSET=$(echo "$MAC6" | md5sum | tr -dc '0-9' | cut -c1-4)
FRP_PORT_APPROX=$((10000 + 10#$PORT_OFFSET % 50000))

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
printf "│  FRP        ssh -p %-4s root@%-19s│\n" "${FRP_PORT_APPROX}*" "${VPS_ADDR}"
printf "│  CF Proxy   https://%-28s│\n" "${MAC6}.${CF_DOMAIN_LABEL}"
echo "├─────────────────────────────────────────────────┤"
echo "│  * FRP port computed from MAC6 only (approx).  │"
echo "│    Exact port: cat /etc/edge/node-info on node  │"
echo "└─────────────────────────────────────────────────┘"
echo ""
