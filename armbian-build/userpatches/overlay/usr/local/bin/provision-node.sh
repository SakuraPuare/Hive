#!/bin/bash
# /usr/local/bin/provision-node.sh
# 首次启动编排脚本 — 仅执行一次，完成后自我禁用
# 基于用户提供的 CF Tunnel + v2ray 脚本改编

set -e

DONE_MARKER="/etc/edge/provisioned"
LOG="/var/log/provision-node.log"

# 如果已经跑过就退出
[ -f "$DONE_MARKER" ] && exit 0

exec > >(tee -a "$LOG") 2>&1
echo "=== provision-node start: $(date) ==="

# 等待网络就绪
for i in $(seq 1 30); do
    ip route get 8.8.8.8 &>/dev/null && break
    echo ">>> Waiting for network... ($i/30)"
    sleep 2
done

source /etc/edge/config.env

# ─────────────────────────────────────────────
# 1. 设备唯一标识
# ─────────────────────────────────────────────
# 取第一块非 lo 网卡的 MAC
IFACE=$(ip -o link show | awk '$2 !~ /^lo:/ {gsub(/:$/,"",$2); print $2; exit}')
MAC=$(cat /sys/class/net/${IFACE}/address | tr -d ':')
MAC6="${MAC: -6}"
HOSTNAME="edge-${MAC6}"

echo ">>> Device: ${HOSTNAME}  MAC: ${MAC}  IFACE: ${IFACE}"

hostnamectl set-hostname "$HOSTNAME"
grep -q "$HOSTNAME" /etc/hosts || echo "127.0.1.1 $HOSTNAME" >> /etc/hosts
systemd-machine-id-setup --commit
rm -f /etc/ssh/ssh_host_*
ssh-keygen -A
echo ">>> Identity set."

# ─────────────────────────────────────────────
# 2. xray UUID（每台唯一）
# ─────────────────────────────────────────────
UUID=$(cat /proc/sys/kernel/random/uuid)
sed -i "s/%%XRAY_UUID%%/${UUID}/g" /etc/xray/config.json
echo ">>> xray UUID: ${UUID}"

# ─────────────────────────────────────────────
# 3. FRP 端口（MAC 哈希 → 10000-60000，不冲突）
# ─────────────────────────────────────────────
PORT_OFFSET=$(echo "$MAC" | md5sum | tr -dc '0-9' | cut -c1-4)
FRP_PORT=$((10000 + 10#$PORT_OFFSET % 50000))
sed -i "s/%%FRP_PORT%%/${FRP_PORT}/g"   /etc/frp/frpc.toml
sed -i "s/%%HOSTNAME%%/${HOSTNAME}/g"   /etc/frp/frpc.toml
echo ">>> FRP port: ${FRP_PORT}"

# ─────────────────────────────────────────────
# 4. Cloudflare Tunnel（参考用户提供的脚本）
# ─────────────────────────────────────────────
TUNNEL_NAME="edge-${MAC6}"
FULL_DOMAIN="${MAC6}.${CF_DOMAIN}"

echo ">>> Creating CF Tunnel: ${TUNNEL_NAME} → ${FULL_DOMAIN}"

CREATE_RES=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/tunnels" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"${TUNNEL_NAME}\",\"config_src\":\"local\"}")

TUNNEL_ID=$(echo "$CREATE_RES" | jq -r '.result.id')
TUNNEL_SECRET=$(echo "$CREATE_RES" | jq -r '.result.credentials_file.TunnelSecret')

if [ "$TUNNEL_ID" = "null" ] || [ -z "$TUNNEL_ID" ]; then
    echo "!!! CF Tunnel creation failed:"
    echo "$CREATE_RES"
    exit 1
fi
echo ">>> Tunnel ID: ${TUNNEL_ID}"

# 写入 cloudflared 凭证文件（与用户脚本格式一致）
cat > /etc/cloudflared/cert.json << EOF
{
    "AccountTag":   "${CF_ACCOUNT_ID}",
    "TunnelSecret": "${TUNNEL_SECRET}",
    "TunnelID":     "${TUNNEL_ID}"
}
EOF

# 添加 DNS CNAME 记录
curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${MAC6}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}" \
    > /dev/null && echo ">>> DNS record created."

# 生成 cloudflared 运行配置（protocol: http2，与用户脚本一致）
cat > /etc/cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/cert.json
protocol: http2

ingress:
  - hostname: ${FULL_DOMAIN}
    service: http://localhost:10077
  - service: http_status:404
EOF
echo ">>> cloudflared config written."

# ─────────────────────────────────────────────
# 5. 启动核心服务
# ─────────────────────────────────────────────
echo ">>> Starting services..."
systemctl enable --now xray
systemctl enable --now cloudflared
systemctl enable --now frpc

# EasyTier（将 config.env 变量注入 service）
systemctl enable --now easytier

# ─────────────────────────────────────────────
# 6. Tailscale 加入（使用嵌入的可复用 AuthKey）
# ─────────────────────────────────────────────
echo ">>> Joining Tailscale..."
systemctl enable --now tailscaled
sleep 2
tailscale up \
    --authkey="${TAILSCALE_AUTHKEY}" \
    --hostname="${HOSTNAME}" \
    --accept-dns=false \
    --advertise-tags=tag:edge-node \
    || echo ">>> Tailscale up failed (will retry on next boot via tailscaled)"

# ─────────────────────────────────────────────
# 7. 上报 Node Registry（非关键，失败不中止）
# ─────────────────────────────────────────────
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "pending")
if [ -n "${NODE_REGISTRY_URL}" ]; then
    curl -sf -X POST "${NODE_REGISTRY_URL}/api/nodes/register" \
        -H "Content-Type: application/json" \
        -d "{
          \"mac\":          \"${MAC}\",
          \"mac6\":         \"${MAC6}\",
          \"hostname\":     \"${HOSTNAME}\",
          \"cf_url\":       \"https://${FULL_DOMAIN}\",
          \"tailscale_ip\": \"${TAILSCALE_IP}\",
          \"xray_uuid\":    \"${UUID}\",
          \"frp_port\":     ${FRP_PORT}
        }" && echo ">>> Registered with Node Registry." \
        || echo ">>> Registry unavailable (non-fatal)."
fi

# ─────────────────────────────────────────────
# 8. 完成，自我禁用
# ─────────────────────────────────────────────
touch "$DONE_MARKER"
systemctl disable provision-node.service

echo "=== provision-node done: $(date) ==="
echo "=== Node: ${HOSTNAME} | CF: https://${FULL_DOMAIN} | TS: ${TAILSCALE_IP} ==="
