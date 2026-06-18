# /etc/hive/config.env
# 由 scripts/build.sh 从此模板渲染，烧录进镜像
# 所有节点共享同一份（每台设备首次启动时从此读取凭证）

# ===== Cloudflare Tunnel =====
CF_API_TOKEN=${CF_API_TOKEN}
CF_ACCOUNT_ID=${CF_ACCOUNT_ID}
CF_ZONE_ID=${CF_ZONE_ID}
CF_DOMAIN=${CF_DOMAIN}

# ===== Tailscale =====
TAILSCALE_OAUTH_SECRET=${TAILSCALE_OAUTH_SECRET}

# ===== EasyTier =====
EASYTIER_NETWORK_NAME=${EASYTIER_NETWORK_NAME}
EASYTIER_SECRET=${EASYTIER_SECRET}
EASYTIER_PEERS=${EASYTIER_PEERS}

# ===== FRP 服务端 =====
FRP_SERVER_ADDR=${FRP_SERVER_ADDR}
FRP_SERVER_PORT=${FRP_SERVER_PORT}
FRP_AUTH_TOKEN=${FRP_AUTH_TOKEN}

# ===== 预设账号密码 =====
DEFAULT_ROOT_PASSWORD=${DEFAULT_ROOT_PASSWORD}

# ===== Node Registry（可选，无则跳过注册）=====
NODE_REGISTRY_URL=${NODE_REGISTRY_URL}
NODE_REGISTRY_API_SECRET=${REGISTRY_API_SECRET}

# ===== 伪装跳转目标（CF Pages 或任意 URL）=====
CAMOUFLAGE_URL=${CAMOUFLAGE_URL}

# ===== WiFi 热点（插无线网卡自动开热点）=====
# 单卡（单 radio）只能开一个频段：默认优先 5G(WPA3)，卡不支持 5G 才回退 2.4G(WPA2)。
# 两张卡时自动双频：5G(WPA3) + 2.4G(WPA2) 各占一张。留空则用脚本内默认值。
HOTSPOT_COUNTRY=${HOTSPOT_COUNTRY}            # 5GHz 国家码，默认 CN（36-48 免 DFS）
HOTSPOT_5G_CHANNEL=${HOTSPOT_5G_CHANNEL}      # 5G 信道，默认 36（免 DFS）
HOTSPOT_PREFER_BAND=${HOTSPOT_PREFER_BAND}    # 单卡偏好频段：5 或 2.4，默认 5（优先 5G WPA3）
