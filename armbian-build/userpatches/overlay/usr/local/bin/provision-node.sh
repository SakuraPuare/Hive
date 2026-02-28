#!/bin/bash
# /usr/local/bin/provision-node.sh
# 首次启动编排脚本 — 仅执行一次，完成后自我禁用
# 基于用户提供的 CF Tunnel + v2ray 脚本改编

set -e

DONE_MARKER="/etc/hive/provisioned"
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

source /etc/hive/config.env

# ─────────────────────────────────────────────
# 1. 设备唯一标识
# ─────────────────────────────────────────────
# 取第一块非 lo 网卡的 MAC
IFACE=$(ip -o link show | awk '$2 !~ /^lo:/ {gsub(/:$/,"",$2); print $2; exit}')
MAC=$(cat /sys/class/net/${IFACE}/address | tr -d ':')
MAC6="${MAC: -6}"
HOSTNAME="hive-${MAC6}"

echo ">>> Device: ${HOSTNAME}  MAC: ${MAC}  IFACE: ${IFACE}"

hostnamectl set-hostname "$HOSTNAME"
grep -q "$HOSTNAME" /etc/hosts || echo "127.0.1.1 $HOSTNAME" >> /etc/hosts
systemd-machine-id-setup --commit

# ── 确定性 SSH Host Key（基于 MAC，重刷镜像不改 fingerprint）────────
echo ">>> Generating deterministic SSH host keys from MAC..."
rm -f /etc/ssh/ssh_host_*

# SHA-256(domain:MAC) → 32 字节 Ed25519 seed
SEED_HEX=$(printf 'hive-ssh-ed25519:%s' "${MAC}" | sha256sum | awk '{print $1}')

# 构造 PKCS8 DER（固定前缀 + 32 字节 seed），转成 PEM
# PKCS8 Ed25519 DER 前缀：302e020100300506032b657004220420
PKCS8_B64=$(python3 -c "
import base64
der = bytes.fromhex('302e020100300506032b657004220420' + '${SEED_HEX}')
b64 = base64.b64encode(der).decode()
print('\n'.join(b64[i:i+64] for i in range(0, len(b64), 64)))
")

(umask 077; printf -- '-----BEGIN PRIVATE KEY-----\n%s\n-----END PRIVATE KEY-----\n' \
    "${PKCS8_B64}" > /etc/ssh/ssh_host_ed25519_key)

# 转成 OpenSSH 私钥格式（sshd 标准格式）
ssh-keygen -P "" -N "" -p -f /etc/ssh/ssh_host_ed25519_key

# 导出公钥
ssh-keygen -y -f /etc/ssh/ssh_host_ed25519_key > /etc/ssh/ssh_host_ed25519_key.pub
chmod 644 /etc/ssh/ssh_host_ed25519_key.pub

# RSA / ECDSA 仍随机生成（兼容旧客户端，fingerprint 不关键）
ssh-keygen -q -t rsa -b 3072 -N "" -f /etc/ssh/ssh_host_rsa_key
ssh-keygen -q -t ecdsa -N "" -f /etc/ssh/ssh_host_ecdsa_key
# ──────────────────────────────────────────────────────────────────────

echo ">>> Identity set. Ed25519 fingerprint bound to MAC ${MAC}"

# ── 导入 GitHub 公钥作为 root authorized_keys ─────────────────────
echo ">>> Importing SSH public keys from GitHub..."
mkdir -p /root/.ssh && chmod 700 /root/.ssh
curl -fsSL https://github.com/SakuraPuare.keys >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
echo ">>> $(wc -l < /root/.ssh/authorized_keys) authorized keys installed."

# ─────────────────────────────────────────────
# 2. xray UUID（确定性，基于 MAC，重刷不变）
# ─────────────────────────────────────────────
UUID_HEX=$(printf 'hive-xray-uuid:%s' "${MAC}" | sha256sum | awk '{print $1}')
# 取前 32 hex 构造 UUID v4 格式（设置 version=4, variant=10xx）
UUID="${UUID_HEX:0:8}-${UUID_HEX:8:4}-4${UUID_HEX:13:3}-$(printf '%x' $(( 0x${UUID_HEX:16:2} & 0x3f | 0x80 )))${UUID_HEX:18:2}-${UUID_HEX:20:12}"
sed -i "s/%%XRAY_UUID%%/${UUID}/g" /etc/xray/config.json
echo ">>> xray UUID: ${UUID} (deterministic from MAC)"

# 伪装跳转 URL
CAMOUFLAGE_URL="${CAMOUFLAGE_URL:-https://www.cloudflare.com/}"
sed -i "s|%%CAMOUFLAGE_URL%%|${CAMOUFLAGE_URL}|g" /etc/nginx/sites-available/hive
nginx -t -q && systemctl reload nginx
echo ">>> Camouflage URL: ${CAMOUFLAGE_URL}"

# ─────────────────────────────────────────────
# 3. 三套管理通道地址（全部从 MAC6 确定性推导）
# ─────────────────────────────────────────────

# FRP 端口：MAC 全段 md5 哈希 → 10000-60000
PORT_OFFSET=$(echo "$MAC" | md5sum | tr -dc '0-9' | cut -c1-4)
FRP_PORT=$((10000 + 10#$PORT_OFFSET % 50000))
sed -i "s/%%FRP_PORT%%/${FRP_PORT}/g"  /etc/frp/frpc.toml
sed -i "s/%%HOSTNAME%%/${HOSTNAME}/g"  /etc/frp/frpc.toml
echo ">>> FRP port: ${FRP_PORT}"

# EasyTier IP：MAC6 的三个字节直接映射到 10.x.x.x
# 例：MAC6=a4b2c1 → 10.164.178.193/8
ET_B1=$(printf "%d" "0x${MAC6:0:2}")
ET_B2=$(printf "%d" "0x${MAC6:2:2}")
ET_B3=$(printf "%d" "0x${MAC6:4:2}")
EASYTIER_IP="10.${ET_B1}.${ET_B2}.${ET_B3}"
echo ">>> EasyTier IP: ${EASYTIER_IP}"

# Tailscale：hostname 固定为 hive-<mac6>，MagicDNS 自动解析
# IP 由 Tailscale 云分配（不可预测），但 hostname 始终可达
echo ">>> Tailscale hostname: ${HOSTNAME}"

# ─────────────────────────────────────────────
# 4. Cloudflare Tunnel（参考用户提供的脚本）
# ─────────────────────────────────────────────
TUNNEL_NAME="hive-${MAC6}"
FULL_DOMAIN="hive-${MAC6}.${CF_DOMAIN}"

echo ">>> Creating CF Tunnel: ${TUNNEL_NAME} → ${FULL_DOMAIN}"

# 先尝试查找已存在的同名 tunnel（幂等）
EXISTING=$(curl -s -G \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/tunnels" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    --data-urlencode "name=${TUNNEL_NAME}" \
    --data-urlencode "is_deleted=false")

TUNNEL_ID=$(echo "$EXISTING" | jq -r '.result[0].id // empty')

if [ -n "$TUNNEL_ID" ] && [ -f /etc/cloudflared/cert.json ]; then
    # tunnel 存在且本地有凭证，直接复用
    echo ">>> Tunnel already exists: ${TUNNEL_ID}, reusing with existing cert.json."
else
    # 没有本地凭证就必须（重新）创建 tunnel 才能拿到 secret
    if [ -n "$TUNNEL_ID" ]; then
        echo ">>> Tunnel exists but no local cert.json, deleting to recreate..."
        curl -s -X DELETE \
            "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/tunnels/${TUNNEL_ID}" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" >/dev/null
    fi

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

    cat > /etc/cloudflared/cert.json << EOF
{
    "AccountTag":   "${CF_ACCOUNT_ID}",
    "TunnelSecret": "${TUNNEL_SECRET}",
    "TunnelID":     "${TUNNEL_ID}"
}
EOF
fi
echo ">>> Tunnel ID: ${TUNNEL_ID}"

# 添加 DNS CNAME 记录（幂等：先查再建）
EXISTING_DNS=$(curl -s -G \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    --data-urlencode "type=CNAME" \
    --data-urlencode "name=${FULL_DOMAIN}")

DNS_ID=$(echo "$EXISTING_DNS" | jq -r '.result[0].id // empty')

if [ -n "$DNS_ID" ]; then
    echo ">>> DNS record already exists for ${FULL_DOMAIN}, updating."
    curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${DNS_ID}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${TUNNEL_NAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}" >/dev/null
else
    DNS_RES=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${TUNNEL_NAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}")
    if ! echo "$DNS_RES" | grep -q '"success":true'; then
        echo "!!! DNS record creation failed:"
        echo "$DNS_RES"
        exit 1
    fi
fi
echo ">>> DNS record OK: ${FULL_DOMAIN}"

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
# 5. 写入节点信息汇总文件（运维查阅用）
# ─────────────────────────────────────────────
TAILSCALE_IP_PENDING="pending"
cat > /etc/hive/node-info << EOF
# 本节点访问信息（由 provision-node.sh 生成）
HOSTNAME=${HOSTNAME}
MAC=${MAC}
MAC6=${MAC6}

# 三套管理通道（全部从 MAC6 确定性推导）
EASYTIER_IP=${EASYTIER_IP}
FRP_PORT=${FRP_PORT}
TAILSCALE_HOST=${HOSTNAME}

# 代理接入
CF_URL=https://${FULL_DOMAIN}
XRAY_UUID=${UUID}

# CF Tunnel
TUNNEL_ID=${TUNNEL_ID}
EOF
echo ">>> node-info written to /etc/hive/node-info"

# ─────────────────────────────────────────────
# 6. 启动核心服务
# ─────────────────────────────────────────────
echo ">>> Starting services..."
systemctl enable --now xray
systemctl enable --now cloudflared
systemctl enable --now frpc

# EasyTier：start-easytier.sh 从 node-info 读取 --ipv4 参数
systemctl enable --now easytier

# 安全加固：防火墙 + 入侵防护（非致命，不中止 provision）
systemctl enable --now hive-firewall || echo ">>> hive-firewall failed (non-fatal)"
systemctl enable --now hive-fail2ban || echo ">>> hive-fail2ban failed (non-fatal)"

# ─────────────────────────────────────────────
# 7. Tailscale 加入（使用嵌入的可复用 AuthKey）
# ─────────────────────────────────────────────
echo ">>> Joining Tailscale..."
systemctl enable --now tailscaled
sleep 2

# OAuth client secret → access token → 生成非临时 pre-auth key
# tskey-client-<ID>-<SECRET> 格式中提取 client ID
TS_CLIENT_ID=$(echo "${TAILSCALE_OAUTH_SECRET}" | sed 's/tskey-client-\([^-]*\)-.*/\1/')

TS_ACCESS_TOKEN=$(curl -sf -X POST "https://api.tailscale.com/api/v2/oauth/token" \
    -d "client_id=${TS_CLIENT_ID}" \
    -d "client_secret=${TAILSCALE_OAUTH_SECRET}" | jq -r '.access_token // empty')

if [ -n "${TS_ACCESS_TOKEN}" ]; then
    TS_AUTHKEY=$(curl -sf -X POST "https://api.tailscale.com/api/v2/tailnet/-/keys" \
        -H "Authorization: Bearer ${TS_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"capabilities\": {
                \"devices\": {
                    \"create\": {
                        \"reusable\": false,
                        \"ephemeral\": false,
                        \"preauthorized\": true,
                        \"tags\": [\"tag:hive\"]
                    }
                }
            },
            \"expirySeconds\": 300
        }" | jq -r '.key // empty')
fi

if [ -z "${TS_AUTHKEY}" ]; then
    echo "!!! Failed to generate Tailscale auth key via OAuth, using secret directly"
    TS_AUTHKEY="${TAILSCALE_OAUTH_SECRET}"
fi

# 清理同 hostname 的旧节点（避免重刷后出现 -1 -2 后缀）
if [ -n "${TS_ACCESS_TOKEN}" ]; then
    echo ">>> Checking for stale Tailscale nodes with hostname: ${HOSTNAME}..."
    STALE_IDS=$(curl -sf \
        -H "Authorization: Bearer ${TS_ACCESS_TOKEN}" \
        "https://api.tailscale.com/api/v2/tailnet/-/devices" | \
        jq -r --arg h "${HOSTNAME}" '.devices[] | select(.hostname == $h) | .id')
    for DEVICE_ID in $STALE_IDS; do
        echo ">>> Deleting stale node: ${DEVICE_ID}"
        curl -sf -X DELETE \
            -H "Authorization: Bearer ${TS_ACCESS_TOKEN}" \
            "https://api.tailscale.com/api/v2/device/${DEVICE_ID}" \
            && echo ">>> Deleted ${DEVICE_ID}" \
            || echo ">>> Failed to delete ${DEVICE_ID} (non-fatal)"
    done
fi

tailscale up \
    --authkey="${TS_AUTHKEY}" \
    --hostname="${HOSTNAME}" \
    --accept-dns=false \
    || echo ">>> Tailscale up failed (will retry on next boot via tailscaled)"

# ─────────────────────────────────────────────
# 8. 上报 Node Registry（非关键，失败不中止）
# ─────────────────────────────────────────────
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "pending")
# 更新 node-info 里的 Tailscale IP
sed -i "s/^TAILSCALE_HOST=.*/TAILSCALE_HOST=${HOSTNAME}\nTAILSCALE_IP=${TAILSCALE_IP}/" \
    /etc/hive/node-info

if [ -n "${NODE_REGISTRY_URL}" ]; then
    curl -sf -X POST "${NODE_REGISTRY_URL}/nodes/register" \
        -H "Content-Type: application/json" \
        ${NODE_REGISTRY_API_SECRET:+-H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}"} \
        -d "{
          \"mac\":          \"${MAC}\",
          \"mac6\":         \"${MAC6}\",
          \"hostname\":     \"${HOSTNAME}\",
          \"cf_url\":       \"https://${FULL_DOMAIN}\",
          \"tunnel_id\":    \"${TUNNEL_ID}\",
          \"tailscale_ip\": \"${TAILSCALE_IP}\",
          \"easytier_ip\":  \"${EASYTIER_IP}\",
          \"frp_port\":     ${FRP_PORT},
          \"xray_uuid\":    \"${UUID}\"
        }" && echo ">>> Registered with Node Registry." \
        || echo ">>> Registry unavailable (non-fatal)."
fi

# ─────────────────────────────────────────────
# 9. 完成，自我禁用
# ─────────────────────────────────────────────
touch "$DONE_MARKER"
systemctl disable provision-node.service

echo "=== provision-node done: $(date) ==="
echo "============================================"
echo "  NODE    : ${HOSTNAME}"
echo "  Tailscale: ssh root@${HOSTNAME}  (MagicDNS)"
echo "  EasyTier : ssh root@${EASYTIER_IP}"
echo "  FRP      : ssh -p ${FRP_PORT} root@<VPS>"
echo "  CF Proxy : https://${FULL_DOMAIN}"
echo "============================================"
