# 境外 VPS 部署：frps + EasyTier 中继

> **角色**：这台机器是所有边缘节点的"最后防线"接入点。
> 配置要求极低（1C/512MB 够用），选洛杉矶或东京节点覆盖面最广。

---

## 一、基础准备

```bash
# 以 root 运行，或全程 sudo
apt update && apt install -y curl wget unzip
```

---

## 二、部署 frps（FRP 服务端）

frps 提供 SSH 应急隧道。当 Tailscale 和 EasyTier 都不可达时，节点通过 frps 保持 SSH 可访问。

### 2.1 下载并安装

```bash
FRP_VER="0.61.1"
cd /tmp
wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_amd64.tar.gz"
tar xzf "frp_${FRP_VER}_linux_amd64.tar.gz"
cp "frp_${FRP_VER}_linux_amd64/frps" /usr/local/bin/frps
chmod +x /usr/local/bin/frps
```

### 2.2 配置文件

```bash
mkdir -p /etc/frp
cat > /etc/frp/frps.toml << 'EOF'
# FRP 服务端配置
bindPort = 7000

# 认证（与设备端 .env 里 FRP_AUTH_TOKEN 保持一致）
auth.method = "token"
auth.token  = "CHANGE_ME_STRONG_TOKEN"

# 管理面板（仅监听本地，通过 SSH 隧道访问）
webServer.addr     = "127.0.0.1"
webServer.port     = 7500
webServer.user     = "admin"
webServer.password = "CHANGE_ME_PANEL_PASS"

# 允许节点使用的端口范围
allowPorts = [
  { start = 10000, end = 60000 }
]
EOF
```

> **修改 `CHANGE_ME_STRONG_TOKEN`** — 填一个随机字符串，对应设备 `.env` 里的 `FRP_AUTH_TOKEN`。

### 2.3 systemd 服务

```bash
cat > /etc/systemd/system/frps.service << 'EOF'
[Unit]
Description=FRP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now frps
systemctl status frps
```

### 2.4 防火墙

```bash
# 如果开启了 ufw
ufw allow 7000/tcp comment "frps main port"
```

---

## 三、部署 EasyTier 中继

EasyTier 中继是 mesh 网络的汇聚点。边缘节点通过它互相发现，并在直连打洞失败时中继流量。

### 3.1 下载并安装

```bash
EASYTIER_VER="v2.1.3"
cd /tmp
wget -q "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-x86_64-${EASYTIER_VER}.zip"
unzip -jo "easytier-linux-x86_64-${EASYTIER_VER}.zip" "*/easytier-core" -d /usr/local/bin/
chmod +x /usr/local/bin/easytier-core
```

### 3.2 systemd 服务

EasyTier 中继就是一个普通节点，运行在稳定的公网 IP 上供其他节点连接。

```bash
# 替换以下变量后执行：
# EASYTIER_NETWORK_NAME — 与设备 .env 保持一致
# EASYTIER_SECRET       — 与设备 .env 保持一致

cat > /etc/systemd/system/easytier-relay.service << 'EOF'
[Unit]
Description=EasyTier Relay Node
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/easytier-core \
    --network-name CHANGE_ME_NETWORK_NAME \
    --network-secret CHANGE_ME_SECRET \
    --listeners tcp://0.0.0.0:11010 udp://0.0.0.0:11010 \
    --no-tun
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now easytier-relay
systemctl status easytier-relay
```

### 3.3 防火墙

```bash
ufw allow 11010/tcp comment "EasyTier TCP"
ufw allow 11010/udp comment "EasyTier UDP"
```

---

## 四、验证

```bash
# frps 是否在监听
ss -tlnp | grep 7000

# EasyTier 是否运行
systemctl status easytier-relay

# 查看 frps 日志
journalctl -u frps -f --no-pager

# 查看 EasyTier 日志
journalctl -u easytier-relay -f --no-pager
```

---

## 五、记录填入 .env 的信息

部署完成后，把以下信息填入项目根目录的 `.env`：

```
FRP_SERVER_ADDR=<这台机器的公网 IP 或域名>
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=<你在 frps.toml 里设置的 token>

EASYTIER_PEERS=<这台机器的公网 IP 或域名，多中继逗号分隔>
EASYTIER_NETWORK_NAME=<你设置的网络名>
EASYTIER_SECRET=<你设置的密钥>
```
