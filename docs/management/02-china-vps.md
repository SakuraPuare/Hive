# 中国 VPS 部署：Node Registry + Prometheus + Grafana + cloudflared

> **角色**：管理平面的大脑。Ansible、Prometheus、订阅链接都从这里发出。
> 所有对外暴露的 HTTP 服务通过 CF Tunnel 出去，节点不直连此服务器。

---

## 一、基础准备

大多数组件可通过一键脚本完成安装。在项目根目录执行：

```bash
git clone <your-repo> /opt/rk3528-hive
cd /opt/rk3528-hive
cp .env.example .env && nano .env   # 填入所有必填项
bash management/setup-vps.sh
```

脚本会自动完成：Docker、Ansible、Go 安装、hive-registry 编译安装、Prometheus + Grafana 启动、cron 配置。

下面是各步骤的手动说明（供参考或排障）：

```bash
apt update && apt install -y curl wget unzip jq \
    prometheus-node-exporter docker.io docker-compose-v2
systemctl enable --now docker
systemctl enable --now prometheus-node-exporter
```

---

## 二、部署 Node Registry API

Node Registry 是一个 Go 编写的单二进制服务（~10 MB RAM），使用服务器自带 MySQL 9。

### 2.0 初始化 MySQL 数据库

```bash
# 以 root 登录 MySQL
mysql -u root -p

# 创建数据库和用户
CREATE DATABASE hive_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hive'@'localhost' IDENTIFIED BY 'CHANGE_ME_DB_PASSWORD';
GRANT ALL PRIVILEGES ON hive_registry.* TO 'hive'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 2.1 编译并安装二进制

`setup-vps.sh` 会自动安装 Go（如已安装则跳过）并编译安装 hive-registry。手动步骤如下：

```bash
# 安装 Go 1.22+（若尚未安装）
wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/golang.sh

# 进入 registry 目录并编译
cd /opt/rk3528-hive/management/registry
make build

# 原子替换安装（服务运行中也安全）
cp hive-registry /usr/local/bin/hive-registry.new
chmod +x /usr/local/bin/hive-registry.new
mv /usr/local/bin/hive-registry.new /usr/local/bin/hive-registry
```

> 如果管理服务器是 ARM64：`make build-arm64` 然后使用 `hive-registry-arm64`。

### 2.2 创建环境变量文件

```bash
cat > /etc/hive-registry.env << 'EOF'
LISTEN_ADDR=127.0.0.1:8080

# MySQL 连接
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=hive
MYSQL_PASSWORD=CHANGE_ME_DB_PASSWORD
MYSQL_DB=hive_registry

# 连接池（小规模部署默认即可）
DB_MAX_OPEN=10
DB_MAX_IDLE=3

# xray path（需与节点 xray config 一致）
XRAY_PATH=ray

# 管理操作认证（PATCH/DELETE 接口，留空关闭认证）
API_SECRET=CHANGE_ME_ADMIN_SECRET
EOF
chmod 600 /etc/hive-registry.env
```

### 2.3 systemd 服务

```bash
cat > /etc/systemd/system/hive-registry.service << 'EOF'
[Unit]
Description=Hive Node Registry
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=nobody
EnvironmentFile=/etc/hive-registry.env
ExecStart=/usr/local/bin/hive-registry
Restart=always
RestartSec=5

# 资源限制（单二进制通常只需 ~15 MB）
MemoryMax=64M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hive-registry
systemctl status hive-registry
```

### 2.4 验证

```bash
# 健康检查（含 DB 连通性）—— 直连 Go 服务，路径无 /api 前缀
curl -H "Authorization: Bearer <API_SECRET>" http://127.0.0.1:8080/health
# → {"status":"ok"}

# 节点列表（空）
curl -H "Authorization: Bearer <API_SECRET>" http://127.0.0.1:8080/nodes
# → []

# 通过 nginx（外部路径，含 /api 前缀）
curl -H "Authorization: Bearer <API_SECRET>" http://localhost/api/nodes

# 控制台 Dashboard
curl -s -H "Authorization: Bearer <API_SECRET>" http://127.0.0.1:8080/ | grep -o 'Total:.*'
```

API 完整规范见 [docs/NODE-REGISTRY-API.md](../../docs/NODE-REGISTRY-API.md)。

---

## 三、部署 Prometheus + Grafana（Docker Compose）

```bash
# 创建 Prometheus targets 目录（cron 会把节点列表写在这里）
mkdir -p /opt/rk3528-hive/management/prometheus/targets
echo '[]' > /opt/rk3528-hive/management/prometheus/targets/nodes.json

cd /opt/rk3528-hive/management

# 修改 docker-compose.yml 里的 GF_SECURITY_ADMIN_PASSWORD（或在 .env 中设置）
nano docker-compose.yml

docker compose up -d
docker compose ps
```

### 3.1 定时更新 Prometheus 节点列表

`setup-vps.sh` 会自动创建 `/etc/cron.d/hive-targets`。手动写入：

```bash
TARGETS_FILE="/opt/rk3528-hive/management/prometheus/targets/nodes.json"
AUTH_HEADER='-H "Authorization: Bearer <API_SECRET>"'   # 若无认证则删除此行

cat > /etc/cron.d/hive-targets << EOF
* * * * * root curl -sf ${AUTH_HEADER} -o ${TARGETS_FILE} http://127.0.0.1:8080/prometheus-targets
EOF
chmod 0644 /etc/cron.d/hive-targets
```

> **注意**：cron 直连 Go 服务（`127.0.0.1:8080`），路径**无** `/api` 前缀。

### 3.2 Grafana 配置

Grafana 监听 `127.0.0.1:3000`，通过 Tailscale IP 访问（不对公网开放）。

1. 浏览器打开 `http://<Tailscale-IP>:3000`
2. 添加 Prometheus 数据源：URL 填 `http://localhost:9090`
3. 导入 Dashboard（推荐 Node Exporter Full，ID: 1860）

---

## 四、暴露 Node Registry 到全球（CF Tunnel）

**核心**：节点在全球各地，需要通过 CF Tunnel 访问中国服务器上的 Node Registry。
节点不会直连中国服务器 IP，流量经过 Cloudflare 边缘，绕过地理限制。

### 4.1 安装 cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

### 4.2 登录并创建 Tunnel

```bash
# 登录（会打开浏览器或给出授权链接）
cloudflared tunnel login

# 创建 Tunnel（名字叫 registry）
cloudflared tunnel create registry

# 查看 Tunnel ID
cloudflared tunnel list
```

### 4.3 配置路由

```bash
# 将 registry.yourdomain.com 指向这个 tunnel
# （把 registry 和 yourdomain.com 换成你的实际值）
cloudflared tunnel route dns registry registry.yourdomain.com
```

### 4.4 配置文件

```bash
mkdir -p /etc/cloudflared

# 把下面的 TUNNEL_ID 替换为上面 cloudflared tunnel list 看到的 ID
cat > /etc/cloudflared/config-registry.yml << 'EOF'
tunnel: TUNNEL_ID_HERE
credentials-file: /root/.cloudflared/TUNNEL_ID_HERE.json
protocol: http2

ingress:
  - hostname: registry.yourdomain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF
```

### 4.5 systemd 服务

```bash
cat > /etc/systemd/system/cloudflared-registry.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel for Node Registry
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/config-registry.yml run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cloudflared-registry
```

### 4.6 验证

```bash
curl https://registry.yourdomain.com/
# 应看到 Node Registry 控制台 HTML
```

---

## 五、安装并配置 Ansible

Ansible 通过 Tailscale mesh 管理所有节点，不需要知道节点的公网 IP。

```bash
apt install -y ansible

# 安装 Tailscale inventory 插件
ansible-galaxy collection install community.general

# 安装 Tailscale（管理服务器也加入 tailnet，用于 SSH 到节点）
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --accept-dns=false
```

---

## 六、把 Ansible 配好

```bash
mkdir -p /opt/rk3528-edge/ansible/{inventory,playbooks,roles}

cat > /opt/rk3528-edge/ansible/ansible.cfg << 'EOF'
[defaults]
inventory         = inventory/tailscale.yaml
host_key_checking = False
remote_user       = root
private_key_file  = ~/.ssh/id_ed25519
stdout_callback   = yaml

[ssh_connection]
ssh_args = -o ConnectTimeout=10 -o StrictHostKeyChecking=no
EOF

cat > /opt/rk3528-edge/ansible/inventory/tailscale.yaml << 'EOF'
plugin: community.general.tailscale
filters:
  - "tag:hive"
EOF
```

### 测试 Ansible 连通性（等设备上线后）

```bash
cd /opt/rk3528-edge/ansible
ansible all -m ping
ansible all -m command -a "uptime"
```

---

## 七、记录填入 .env 的信息

```
NODE_REGISTRY_URL=https://registry.yourdomain.com
```

---

## 八、整体验证清单

```bash
# Node Registry 本地可用（路径无 /api 前缀）
curl -H "Authorization: Bearer <API_SECRET>" http://127.0.0.1:8080/health
curl -H "Authorization: Bearer <API_SECRET>" http://127.0.0.1:8080/nodes

# Node Registry 通过 nginx（含 /api 前缀）
curl -H "Authorization: Bearer <API_SECRET>" http://localhost/api/health

# Node Registry 通过 CF Tunnel 全球可用
curl -H "Authorization: Bearer <API_SECRET>" https://registry.yourdomain.com/api/nodes

# Prometheus 在跑
curl http://127.0.0.1:4230/-/healthy

# Grafana 在跑
curl http://127.0.0.1:4231/api/health

# cron 已安装
cat /etc/cron.d/hive-targets

# 节点列表更新到 Prometheus（有节点上线后）
cat /opt/rk3528-hive/management/prometheus/targets/nodes.json
```
