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

# ===== 节点 SSH 授权公钥来源（GitHub 用户名，逗号分隔；留空则不导入）=====
SSH_IMPORT_GITHUB=${SSH_IMPORT_GITHUB}

# ===== WiFi 热点（插无线网卡自动开热点）=====
# 单卡（单 radio）只能开一个频段：默认优先 5G(WPA3)，卡不支持 5G 才回退 2.4G(WPA2)。
# 两张卡时自动双频：5G(WPA3) + 2.4G(WPA2) 各占一张。留空则用脚本内默认值。
HOTSPOT_COUNTRY=${HOTSPOT_COUNTRY}            # 5GHz 国家码，默认 CN（ch149@80MHz@33dBm，比 US 30dBm 功率更高）
HOTSPOT_5G_CHANNEL=${HOTSPOT_5G_CHANNEL}      # 5G 信道，默认 149（CN 非 DFS，可开 80MHz）
HOTSPOT_5G_WIDTH=${HOTSPOT_5G_WIDTH}          # 5G 频宽 20|40|80，默认 80（160 因驱动 AP-DFS+客户端锁 6G 不提供）
HOTSPOT_PREFER_BAND=${HOTSPOT_PREFER_BAND}    # 单卡偏好频段：5 或 2.4，默认 5（优先 5G WPA3）

# ===== 透明代理网关（路由器角色，LAN/WiFi 设备连上即自动走代理）=====
# 双网口设备（如 NanoPi R3S）自动 WAN/LAN 分口：WAN 接上游路由器走 DHCP，
# LAN 给下游设备发 DHCP 并由 Mihomo 做透明代理。单网口设备也会启用 Mihomo，
# 接管 WiFi 热点等转发流量。分流方向/上游节点由 registry 面板动态下发。
GATEWAY_ENABLED=${GATEWAY_ENABLED}            # on/off，默认 on（无下游也不占流量）
GATEWAY_WAN_IFACE=${GATEWAY_WAN_IFACE}        # WAN 口名，留空自动探测（有默认路由的口）
GATEWAY_LAN_IFACE=${GATEWAY_LAN_IFACE}        # LAN 口名，留空自动（WAN 之外的有线口）
GATEWAY_TUN_IFACE=${GATEWAY_TUN_IFACE}        # Mihomo TUN 口名，默认 Meta（防火墙据此放行 system 栈转发投递）
GATEWAY_DASHBOARD_PORT=${GATEWAY_DASHBOARD_PORT}  # 可视化面板端口，默认 9090（http://<lan-ip>:9090/ui）
