# RK3528A 边缘代理集群 — 完整系统架构计划

## Context

**目标**：将一张编译好的 IMG 写到 100 张 SD 卡，设备上电后自动成为可用的 v2ray 代理节点，无需逐台手工配置。

**确认决策**：
- CF Tunnel：有自有域名托管在 CF（节点 URL 为 `edge-<mac6>.yourdomain.com`）
- 设备 ID：MAC 末 6 位（完全自动，零操作）
- xray UUID：每台独立生成（一台泄露不影响其他节点）
- 管理服务器：已有在运行的公网 VPS

---

## 一、整体架构

```
[v2ray 用户]
     ↓  VLESS+WebSocket+TLS
[Cloudflare Edge]
     ↓  CF Tunnel
[cloudflared daemon]  ← 主接入，无需公网 IP
     ↓
[xray-core]           ← VLESS+WS 监听 127.0.0.1:8080
     ↓
[本地互联网出口]       ← 节点所在国家/地区直连

─────── 管理平面（三套冗余，互为备份）───────
[Tailscale mesh]  → 主管理通道（SSH/Ansible/Prometheus）
[EasyTier mesh]   → 备用管理通道（独立于 Tailscale）
[FRP tunnel]      → 最后防线（依赖 VPS 上的 frps）
```

**管理服务器（你的 VPS）**：
- `frps` — FRP 服务端
- `prometheus` — 从所有节点抓取指标
- `grafana` — 监控看板
- Node Registry API — 节点注册/订阅生成
- Ansible — 批量命令执行

---

## 二、零配置策略

### 嵌入镜像（所有节点相同）

| 内容 | 文件位置 |
|------|----------|
| CF Account API Token | `/etc/edge/config.env` |
| CF Zone ID + 你的域名 | `/etc/edge/config.env` |
| Tailscale Auth Key（Reusable，非 Ephemeral） | `/etc/edge/config.env` |
| EasyTier 网络名 + 密钥 | `/etc/edge/config.env` |
| FRP 服务端地址 + Token | `/etc/frp/frpc.toml.tpl` |
| Node Registry 上报地址 | `/etc/edge/config.env` |
| xray 配置模板（含 WS path，占位 UUID） | `/etc/xray/config.json` |

### 首次启动自动生成（每台唯一）

| 内容 | 生成方式 |
|------|----------|
| 主机名 `edge-<mac6>` | eth0 MAC 末 6 位 |
| Machine-ID | `systemd-machine-id-setup` |
| SSH Host Keys | `ssh-keygen -A` |
| xray UUID | `uuidgen` |
| CF Tunnel 凭证 + DNS 记录 | `cloudflared tunnel create/route` via CF API |
| FRP 远程端口（10000-60000） | `echo $MAC | md5sum` 哈希截取 |

**零配置保证：设备上电 → 等待约 2 分钟 → 代理可用，管理面板可见。**

---

## 三、组件详细设计

### 3.1 xray-core

协议：**VLESS + WebSocket**（CF Tunnel 只支持 HTTP/WS，不支持原始 TCP，无法用 Reality）

```json
// /etc/xray/config.json（UUID 和 path 在首次启动时替换）
{
  "log": { "loglevel": "warning" },
  "inbounds": [{
    "port": 8080,
    "listen": "127.0.0.1",
    "protocol": "vless",
    "settings": {
      "clients": [{ "id": "%%XRAY_UUID%%", "level": 0 }],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "ws",
      "wsSettings": { "path": "/%%XRAY_PATH%%" }
    }
  }],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
```

`%%XRAY_PATH%%` 嵌入镜像时写死（如 `/ray`），所有节点相同，靠 UUID 区分。

**内存优化**（适配 1GB RAM）：
```ini
# /etc/systemd/system/xray.service
Environment="GOGC=20"
MemoryHigh=200M
MemoryMax=300M
LimitNOFILE=65535
```

### 3.2 cloudflared（CF Tunnel）

首次启动脚本执行：
```bash
# 1. 使用 API Token 创建 tunnel
cloudflared tunnel create "edge-${MAC6}"
# → 生成 ~/.cloudflared/<tunnel-uuid>.json

# 2. 创建 DNS 记录（CNAME → tunnel.cfargotunnel.com）
cloudflared tunnel route dns "edge-${MAC6}" "edge-${MAC6}.yourdomain.com"

# 3. 生成 tunnel 运行配置
cat > /etc/cloudflared/config.yml << EOF
tunnel: edge-${MAC6}
credentials-file: /root/.cloudflared/${TUNNEL_UUID}.json
ingress:
  - hostname: edge-${MAC6}.yourdomain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF
```

用户连接地址：`wss://edge-<mac6>.yourdomain.com/ray`

### 3.3 Tailscale

```bash
# 首次启动时执行（使用嵌入的 OAuth Client Secret）
tailscale up \
  --authkey="${TAILSCALE_OAUTH_SECRET}" \
  --hostname="edge-${MAC6}" \
  --accept-dns=false \
  --advertise-tags=tag:hive
```

加入后即可通过 Tailscale IP（100.x.x.x）进行 SSH 和 Prometheus 抓取。

### 3.4 EasyTier

```bash
easytier-core \
  --network-name "${EASYTIER_NETWORK_NAME}" \
  --network-secret "${EASYTIER_SECRET}" \
  --peers tcp://${EASYTIER_RELAY}:11010 \
  --hostname "edge-${MAC6}"
```

### 3.5 FRP 客户端

```toml
# 首次启动时由脚本渲染
serverAddr = "${FRP_SERVER}"
serverPort = 7000
auth.token = "${FRP_TOKEN}"

[[proxies]]
name = "ssh-edge-${MAC6}"
type = "tcp"
localPort = 22
remotePort = ${FRP_PORT}   # MAC md5 哈希计算
```

### 3.6 Prometheus Node Exporter

安装后监听 9100，绑定 tailscale0 接口。
管理服务器的 Prometheus 通过 Tailscale IP（100.x.x.x:9100）抓取。

---

## 四、首次启动脚本（provision-node.sh）

```bash
#!/bin/bash
# /usr/local/bin/provision-node.sh
# 仅执行一次，完成后自我禁用

set -e
DONE_MARKER="/etc/edge/provisioned"
[ -f "$DONE_MARKER" ] && exit 0

source /etc/edge/config.env

# --- 1. 基础标识 ---
IFACE=$(ip -o link show | awk '$2 != "lo:" {print $2}' | head -1 | tr -d ':')
MAC=$(cat /sys/class/net/${IFACE}/address | tr -d ':')
MAC6="${MAC: -6}"
HOSTNAME="edge-${MAC6}"

hostnamectl set-hostname "$HOSTNAME"
echo "127.0.1.1 $HOSTNAME" >> /etc/hosts
systemd-machine-id-setup --commit
ssh-keygen -A

# --- 2. xray UUID ---
UUID=$(cat /proc/sys/kernel/random/uuid)
sed -i "s/%%XRAY_UUID%%/${UUID}/g" /etc/xray/config.json

# --- 3. FRP 端口分配 ---
PORT_OFFSET=$(echo "$MAC" | md5sum | tr -dc '0-9' | cut -c1-4)
FRP_PORT=$((10000 + 10#$PORT_OFFSET % 50000))
sed -i "s/\${FRP_PORT}/${FRP_PORT}/g" /etc/frp/frpc.toml
sed -i "s/\${MAC6}/${MAC6}/g" /etc/frp/frpc.toml

# --- 4. Cloudflare Tunnel ---
export CLOUDFLARE_API_TOKEN="${CF_API_TOKEN}"
cloudflared tunnel create "edge-${MAC6}"
TUNNEL_UUID=$(cloudflared tunnel list --output json | \
  jq -r ".[] | select(.name==\"edge-${MAC6}\") | .id")
cloudflared tunnel route dns "edge-${MAC6}" "edge-${MAC6}.${CF_DOMAIN}"

cat > /etc/cloudflared/config.yml << EOF
tunnel: edge-${MAC6}
credentials-file: /root/.cloudflared/${TUNNEL_UUID}.json
ingress:
  - hostname: edge-${MAC6}.${CF_DOMAIN}
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF

# --- 5. 启动所有服务 ---
systemctl enable --now xray
systemctl enable --now cloudflared
systemctl enable --now easytier
systemctl enable --now frpc
tailscale up --authkey="${TAILSCALE_OAUTH_SECRET}" \
  --hostname="edge-${MAC6}" \
  --accept-dns=false \
  --advertise-tags=tag:hive

# --- 6. 上报到 Node Registry ---
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "pending")
curl -sf -X POST "${NODE_REGISTRY_URL}/api/nodes/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"mac\": \"${MAC}\",
    \"mac6\": \"${MAC6}\",
    \"hostname\": \"${HOSTNAME}\",
    \"cf_url\": \"edge-${MAC6}.${CF_DOMAIN}\",
    \"tailscale_ip\": \"${TAILSCALE_IP}\",
    \"xray_uuid\": \"${UUID}\",
    \"frp_port\": ${FRP_PORT}
  }" || true   # 不因注册失败而中止

# --- 7. 完成 ---
mkdir -p /etc/edge
touch "$DONE_MARKER"
systemctl disable provision-node
```

---

## 五、管理服务器部署（VPS 端）

### 5.1 Node Registry API

小型 Python FastAPI 服务，功能：
- `POST /api/nodes/register` — 设备首次启动时上报
- `GET  /api/nodes` — 列出所有节点（含状态、CF URL、UUID）
- `GET  /api/subscription` — 生成 v2ray 订阅（Base64 VLESS URL 列表）
- `GET  /api/labels` — 可打印的设备标签 HTML 页

**设备标签示例**（A4 纸打印，每行 4 个）：
```
┌──────────────────────┐
│  NODE  a4b2c1        │
│  edge-a4b2c1.xxx.com │
│  日本 JP / #042      │
│  [QR Code]           │
└──────────────────────┘
```

注：序号 #042 是管理员在 Registry 界面手动标注的地理位置序号（可选），MAC 末 6 位是主键。

### 5.2 Prometheus 配置（VPS 端）

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'hives'
    file_sd_configs:
      - files: ['/etc/prometheus/nodes.json']  # Node Registry 定期更新此文件
    scheme: http
    metrics_path: /metrics
    # 通过 Tailscale IP（100.x.x.x:9100）抓取
```

Node Registry 提供 `GET /api/prometheus-targets` → 输出 Prometheus file_sd 格式，
定时任务每分钟刷新 `nodes.json`。

### 5.3 Ansible

```yaml
# ansible/inventory/tailscale.yaml
plugin: community.general.tailscale
tags:
  - tag:hive
```

```bash
# 批量推送新 xray 配置
ansible-playbook -i inventory/tailscale.yaml playbooks/update-xray.yml

# 批量查看 xray 状态
ansible -i inventory/tailscale.yaml tag_edge_node \
  -m command -a "systemctl status xray --no-pager"
```

---

## 六、设备标识说明

**设备 ID**：MAC 末 6 位（如 `a4b2c1`）
**访问地址**：`edge-a4b2c1.yourdomain.com`
**管理 IP**：Tailscale 分配的 `100.x.x.x`

贴在外壳上的内容：MAC 末 6 位 + QR 码（扫码跳转管理页面）。
QR 码生成由 Node Registry 的 `/api/labels` 页面完成，打印即用。

---

## 七、实现路线图（按优先级）

### Phase 1 — 让一台设备跑起来

1. 更新 `.env.example`（加 CF_API_TOKEN, CF_ZONE_ID, CF_DOMAIN, NODE_REGISTRY_URL）
2. `scripts/download-binaries.sh`：加入 cloudflared、xray 下载
3. 创建 overlay 目录结构 + 所有 systemd service 文件
4. 编写 `provision-node.sh`（核心首次启动脚本）
5. 完善 `customize-image.sh`（安装 cloudflared、xray、node-exporter）
6. 重新编译 IMG → 烧录 → 验证：CF Tunnel 可用、Tailscale 在线

**验收标准**：一台设备上电 2 分钟内，v2ray 客户端能连通。

### Phase 2 — 管理基础设施

7. VPS 上部署 frps
8. 编写 Node Registry API（Python FastAPI + SQLite）
9. VPS 上部署 Prometheus + Grafana
10. 编写 Ansible inventory + 基础 playbook

**验收标准**：Grafana 能看到节点在线状态，Ansible 能批量执行命令。

### Phase 3 — 规模化

11. 批量烧录 100 张 SD 卡（用 `dd` + 循环）
12. 上电、等待注册
13. 从 `/api/labels` 打印标签，贴到设备
14. 验证 100 个节点全部出现在 Prometheus

### Phase 4 — 加固

15. 防火墙规则（iptables：eth0 仅允许出站 + DHCP）
16. 自动故障转移逻辑（systemd + healthcheck）
17. Ansible playbook：定期更新 xray 配置/版本

---

## 八、关键文件清单

### 新建（镜像内，via overlay）
- `armbian-build/userpatches/overlay/usr/local/bin/provision-node.sh`
- `armbian-build/userpatches/overlay/etc/edge/config.env.tpl`（嵌入所有共享凭证）
- `armbian-build/userpatches/overlay/etc/xray/config.json`（含占位符）
- `armbian-build/userpatches/overlay/etc/frp/frpc.toml.tpl`
- `armbian-build/userpatches/overlay/etc/systemd/system/provision-node.service`
- `armbian-build/userpatches/overlay/etc/systemd/system/xray.service`
- `armbian-build/userpatches/overlay/etc/systemd/system/cloudflared.service`
- `armbian-build/userpatches/overlay/etc/systemd/system/easytier.service`
- `armbian-build/userpatches/overlay/etc/systemd/system/frpc.service`

### 新建（VPS 管理服务）
- `management/registry/main.py`（Node Registry API）
- `management/registry/requirements.txt`
- `management/prometheus/nodes.json.tpl`
- `ansible/inventory/tailscale.yaml`
- `ansible/playbooks/update-xray.yml`
- `ansible/playbooks/restart-services.yml`

### 修改（现有文件）
- `armbian-build/userpatches/customize-image.sh`（安装软件 + enable 服务）
- `scripts/download-binaries.sh`（加 cloudflared、xray、prometheus-node-exporter）
- `.env.example`（加 CF_API_TOKEN、CF_ZONE_ID、CF_DOMAIN、NODE_REGISTRY_URL）
- `scripts/build.sh`（渲染 config.env.tpl）

---

## 九、快速开始

```bash
# 1. 复制并填写环境变量
cp .env.example .env
# 编辑 .env，填入 CF_API_TOKEN、TAILSCALE_OAUTH_SECRET 等

# 2. 初始化 Armbian 构建框架（首次）
./scripts/setup-armbian.sh

# 3. 下载 arm64 二进制
./scripts/download-binaries.sh

# 4. 构建镜像
./scripts/build.sh

# 或手动构建（支持交互式 kernel menuconfig）
cd armbian-build/build
./compile.sh build BOARD=nanopi-zero2 BRANCH=vendor BUILD_MINIMAL=no KERNEL_CONFIGURE=yes RELEASE=trixie
```
