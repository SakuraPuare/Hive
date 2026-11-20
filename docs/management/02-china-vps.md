# 中国 VPS 部署：Node Registry + Prometheus + Grafana + cloudflared

> **角色**：管理平面的大脑。Ansible、Prometheus、订阅链接都从这里发出。
> 所有对外暴露的 HTTP 服务通过 CF Tunnel 出去，节点不直连此服务器。

---

## 一、基础准备

大多数组件可通过一键脚本完成安装。在项目根目录执行：

```bash
git clone https://github.com/SakuraPuare/Hive /opt/hive
cd /opt/hive
cp .env.example .env && nano .env   # 填入所有必填项
bash management/setup-vps.sh
```

脚本会自动完成：nginx（覆盖为 `management/nginx/nginx.conf`）、Docker、Ansible、Go、MySQL 库和 `'hive'@'127.0.0.1'`、hive-registry 编译安装、Node.js、registry-ui 构建并放到 `/var/www/hive-ui`、Prometheus + Grafana + Alertmanager，以及每分钟刷新 Prometheus 目标的 cron。

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
CREATE USER 'hive'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_DB_PASSWORD';
GRANT ALL PRIVILEGES ON hive_registry.* TO 'hive'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

`MYSQL_HOST` 默认是 `127.0.0.1`，走的是 TCP。`'hive'@'localhost'` 是另一条账号，TCP 连不上。`setup-vps.sh` 创建的就是 `'hive'@'127.0.0.1'`。

### 2.1 编译并安装二进制

`setup-vps.sh` 会自动安装 Go（如已安装则跳过）并编译安装 hive-registry。手动步骤如下：

```bash
# 安装 Go 1.22.5（若尚未安装）。脚本按 dpkg 架构选择 amd64 或 arm64，不要在 ARM 管理机上下 amd64 包。
wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/golang.sh

# 进入 registry 目录并编译
cd /opt/hive/management/registry
make build

# 原子替换安装（服务运行中也安全）
cp hive-registry /usr/local/bin/hive-registry.new
chmod +x /usr/local/bin/hive-registry.new
mv /usr/local/bin/hive-registry.new /usr/local/bin/hive-registry
```

> 如果管理服务器是 ARM64：`make build-arm64` 然后使用 `hive-registry-arm64`。

### 2.2 创建环境变量文件

```bash
install -d -m 0700 -o nobody /var/lib/hive-registry/ota

cat > /etc/hive-registry.env << 'EOF'
OTA_ARTIFACT_DIR=/var/lib/hive-registry/ota
OTA_RETENTION_DAYS=30
LISTEN_ADDR=127.0.0.1:8080

# MySQL 连接（对应 .env 里的 REGISTRY_MYSQL_*）
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

# Cloudflare 优选地址（可选，留空则订阅直连各节点自己的隧道域名）
# 只替换 TCP 拨号地址：TLS SNI 与 WebSocket Host 仍是节点自己的域名，
# 由 Cloudflare 按 SNI 把连接路由到对应隧道。所有节点必须同一 CF zone。
CF_PREFERRED_HOST=

# 管理面板生成 SSH 命令用；留空则不填。对应 .env 的 FRP_SERVER_ADDR。
FRP_SERVER_ADDR=

# 管理接口 Bearer。留空则这些接口拒绝，不会变成匿名放行。
# 若同时设置遗留的 API_SECRET，两者必须不同，否则进程直接退出。
# setup-vps.sh 未提供时会 openssl rand -hex 32，重跑时复用已写入的值。
ADMIN_API_SECRET=CHANGE_ME_ADMIN_SECRET
ADMIN_USER=admin
ADMIN_PASS=CHANGE_ME_ADMIN_PASSWORD
# 非 HIVE_ENV=dev 时必填，否则 hive-registry 拒绝启动。对应 .env 的 REGISTRY_ADMIN_SESSION_SECRET。
ADMIN_SESSION_SECRET=CHANGE_ME_SESSION_SECRET
CORS_ALLOW_ORIGINS=
ADMIN_COOKIE_SAMESITE=lax
EOF
chmod 600 /etc/hive-registry.env
```

服务以 `User=nobody` 运行，OTA 目录要事先交给 `nobody`。`.env` 里的 `REGISTRY_API_SECRET` 不会被 `setup-vps.sh` 写进这个文件；管理自动化用的是上面的 `ADMIN_API_SECRET`。旧的 `API_SECRET` 只在 `/subscription` 和 `/subscription/clash` 上还能用。

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
# 健康检查（含 DB 连通性）—— 直连 Go 服务，无 /api 前缀，也不校验 Bearer
curl -sf http://127.0.0.1:8080/health
# → {"status":"ok"}

# 节点列表（空）。管理接口认 ADMIN_API_SECRET，不认旧的 API_SECRET
curl -H "Authorization: Bearer <ADMIN_API_SECRET>" http://127.0.0.1:8080/nodes
# → []

# 通过 nginx：/api/ 会被剥掉再转给 Go
curl -H "Authorization: Bearer <ADMIN_API_SECRET>" http://localhost/api/nodes

# 管理界面是 nginx 上的静态前端，不是 Go 进程的 HTML
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost/
```

API 完整规范见 [Node Registry API](/NODE-REGISTRY-API)。

---

## 三、部署 Prometheus + Grafana（Docker Compose）

```bash
# 创建 Prometheus targets 目录（cron 会把节点列表写在这里）
mkdir -p /opt/hive/management/prometheus/targets
echo '[]' > /opt/hive/management/prometheus/targets/nodes.json

cd /opt/hive/management

# 密码取仓库根目录 .env 的 GRAFANA_PASSWORD（默认 changeme）
docker compose up -d
docker compose ps
```

`docker compose up -d` 会启动 Prometheus（只绑 `127.0.0.1:4230`）、Grafana（host 网络，端口 `4231`，默认听所有网卡）和 Alertmanager（只绑 `127.0.0.1:9093`）。

### 3.1 定时更新 Prometheus 节点列表

`setup-vps.sh` 会自动创建 `/etc/cron.d/hive-targets`，权限 `0600`。手动写入时换成实际的 `ADMIN_API_SECRET`：

```bash
cat > /etc/cron.d/hive-targets << 'EOF'
* * * * * root curl -sf -H "Authorization: Bearer <ADMIN_API_SECRET>" -o /opt/hive/management/prometheus/targets/nodes.json http://127.0.0.1:8080/prometheus-targets
EOF
chmod 0600 /etc/cron.d/hive-targets
```

> cron 直连 Go 服务（`127.0.0.1:8080`），路径没有 `/api`。`/prometheus-targets` 要 `ADMIN_API_SECRET`（或带 `prometheus:read` 的会话）。旧的 `API_SECRET` 会得到 401。

### 3.2 从浏览器访问

`setup-vps.sh` 把 `management/nginx/nginx.conf` 装成 `/etc/nginx/nginx.conf`。它在 80 端口反代。Prometheus 和 Alertmanager 只绑在本机回环地址上，经 nginx 才能从外面访问；Grafana 自己听 `4231`，子路径是 `/grafana/`：

| 浏览器路径 | 上游 |
|------------|------|
| `/` | `/var/www/hive-ui`（registry-ui 静态导出） |
| `/api/` | `127.0.0.1:8080`（去掉 `/api` 前缀） |
| `/prometheus/` | `127.0.0.1:4230` |
| `/grafana/` | `127.0.0.1:4231`（`GF_SERVER_SERVE_FROM_SUB_PATH=true`） |
| `/alertmanager/` | `127.0.0.1:9093` |

Grafana 用户是 `admin`，密码是 `.env` 里的 `GRAFANA_PASSWORD`。数据源已经由 `management/grafana/provisioning/datasources/prometheus.yml` 指向 `http://localhost:4230`，并且 `editable: false`。导入 Node Exporter Full（ID 1860）时选这份已有的 Prometheus 数据源。页面在 `http://<主机>/grafana/`，本机也可以直接开 `http://127.0.0.1:4231/grafana/`。数据源 URL 用 `http://localhost:4230`。

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
curl -sf https://registry.yourdomain.com/health
# → {"status":"ok"}
```

上面的 ingress 指到 Go 的 `127.0.0.1:8080`，所以健康检查走 `/health`，管理界面仍在 nginx 的 `/`。节点走这条隧道时，`NODE_REGISTRY_URL` 填 `https://registry.yourdomain.com`：节点会自己拼接 `/nodes/...`。

---

## 五、安装并配置 Ansible

Ansible 通过 Tailscale mesh 管理所有节点，不需要知道节点的公网 IP。

```bash
apt install -y ansible

# setup-vps.sh 会安装 community.general。它不是 Tailscale inventory 插件
# （community.general.tailscale 这个插件不存在），仓库里的 playbook 也只用 ansible.builtin。
ansible-galaxy collection install community.general

# 管理服务器加入 tailnet，用于 SSH 到节点
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --accept-dns=false
```

---

## 六、把 Ansible 配好

克隆到 `/opt/hive` 之后，直接用仓库里的 `ansible/ansible.cfg` 和 `ansible/inventory/tailscale.py`。

```bash
cd /opt/hive/ansible
ansible-inventory --list | head
ansible hive_nodes -m ping
ansible hive_nodes -m command -a "uptime"
```

`ansible/ansible.cfg` 把 inventory 指到 `inventory/tailscale.py`：`remote_user=root`、`host_key_checking=False`、`forks=20`、`timeout=30`，SSH 打开 pipelining。脚本从本机 `tailscale status --json` 读取带 `tag:hive` 的节点；测试时可以把一份 JSON 放到 `HIVE_TAILSCALE_STATUS`。

---

## 七、记录填入 .env 的信息

```
# 第四节的隧道指到 127.0.0.1:8080：节点会再拼接 /nodes/...
NODE_REGISTRY_URL=https://registry.yourdomain.com

# 节点改走本机 nginx 时，填到 /api 这一级（与 .env.example 的注释一致），末尾不加 /
# NODE_REGISTRY_URL=https://registry.yourdomain.com/api
```

---

## 八、整体验证清单

```bash
# Node Registry 本地可用（路径无 /api 前缀）。/health 不校验 Bearer
curl -sf http://127.0.0.1:8080/health
curl -H "Authorization: Bearer <ADMIN_API_SECRET>" http://127.0.0.1:8080/nodes

# 通过 nginx（含 /api 前缀；管理界面在 /）
curl -sf http://localhost/api/health
curl -H "Authorization: Bearer <ADMIN_API_SECRET>" http://localhost/api/nodes
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost/

# 第四节的 CF Tunnel 直连 Go 时，路径同样没有 /api
curl -sf https://registry.yourdomain.com/health
curl -H "Authorization: Bearer <ADMIN_API_SECRET>" https://registry.yourdomain.com/nodes

# Prometheus / Grafana / Alertmanager 在跑
curl -sf http://127.0.0.1:4230/-/healthy
curl -sf http://127.0.0.1:4231/grafana/api/health
curl -sf http://127.0.0.1:9093/-/healthy

# cron 已安装（权限 0600）
cat /etc/cron.d/hive-targets

# 节点列表更新到 Prometheus（有节点上线后）
cat /opt/hive/management/prometheus/targets/nodes.json
```
