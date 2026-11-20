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

frps 提供 SSH 应急隧道。当 Tailscale 和 EasyTier 都不可达时，节点通过 frps 保持 SSH 可访问。节点上的客户端是 `frpc`（单元 `frpc.service`，配置由 `configs/frp/frpc.toml.tpl` 渲染）。

### 2.1 下载并安装

节点镜像不钉 frp 版本。`scripts/download-binaries.sh` 的 `resolve_latest_tag` 请求 `https://github.com/fatedier/frp/releases/latest`，从跳转路径取出 tag，再去掉前缀 `v`，下载 `frp_<版本>_linux_arm64.tar.gz` 里的 `frpc`。服务端的 `frps` 必须用**同一次构建**的同一个 tag（构建日志有 `>>> frpc <版本>`）。资产名换成 `linux_amd64`。

已经知道版本时先执行 `export FRP_VER=<构建日志里的版本>`（只写数字，不要 `v` 前缀，也不要沿用旧文档里的 `0.61.1`）。留空则按脚本同样的方式解析 latest；latest 会随时间变化，和已经烧录的镜像可能不是同一个 tag。

```bash
if [ -z "${FRP_VER:-}" ]; then
  _url=$(curl -fsI -o /dev/null -w '%{redirect_url}' \
    https://github.com/fatedier/frp/releases/latest || true)
  FRP_VER="${_url##*/tag/}"
  if [ -z "${FRP_VER}" ] || [ "${FRP_VER}" = "${_url}" ]; then
    echo "无法解析 frp 的 latest tag" >&2
    unset FRP_VER
  else
    FRP_VER="${FRP_VER#v}"
  fi
fi

if [ -n "${FRP_VER:-}" ]; then
  echo "frps ${FRP_VER}"
  cd /tmp
  wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_amd64.tar.gz"
  tar xzf "frp_${FRP_VER}_linux_amd64.tar.gz"
  cp "frp_${FRP_VER}_linux_amd64/frps" /usr/local/bin/frps
  chmod +x /usr/local/bin/frps
fi
```

### 2.2 配置文件

`bindPort` 必须等于项目根 `.env` 的 `FRP_SERVER_PORT`（`.env.example` 默认 `7000`）。`auth.token` 必须等于 `FRP_AUTH_TOKEN`。节点 `remotePort` 由 `provision-node.sh` 计算：MAC 的 md5 前 8 位十六进制，`10000 + 该值 % 50000`，结果在 **10000–59999**。下面的 `allowPorts` 用 10000–60000，覆盖这段。

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

# 允许节点使用的端口范围（节点实际 remotePort 为 10000–59999）
allowPorts = [
  { start = 10000, end = 60000 }
]
EOF
```

改掉两个占位：`auth.token` 换成随机字符串；`webServer.password` 也要换。面板只绑在 `127.0.0.1:7500`，从操作者机器上看：

```bash
ssh -L 7500:127.0.0.1:7500 root@<这台机器>
```

然后打开 `http://127.0.0.1:7500`，用户名是 `webServer.user`。

节点连上之后，应急 SSH 是：

```bash
ssh -p <remotePort> root@<这台机器的公网地址>
```

`<remotePort>` 就是该节点 `frpc.toml` 里的 `remotePort`（provision 结束时也会打印 `FRP : ssh -p <端口> root@<VPS>`）。

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
# 7000：节点连 frps。须与 bindPort / FRP_SERVER_PORT 一致
ufw allow 7000/tcp comment "frps main port"
# 10000:60000：frps 为每个节点监听的 remotePort，应急 SSH 走这里。
# 不放行的话，节点能连上 7000，从外面 ssh -p <remotePort> 仍会被 ufw 丢掉。
# 不要放行 7500，面板只应留在 127.0.0.1。
ufw allow 10000:60000/tcp comment "frps mapped SSH ports"
```

---

## 三、部署 EasyTier 中继

中继跑在固定公网地址上，供边缘节点连接。节点不在这台机器上运行：`start-easytier.sh` 读取 `/etc/hive/config.env` 与 `/etc/hive/node-info`，把 `EASYTIER_PEERS` 收成 `--peers`，并带上 `--network-name`、`--network-secret`、`--ipv4 <EASYTIER_IP>/16`、`--hostname`、`--relay-network-whitelist`。没有写端口的 peer 会变成 `tcp://主机:11010`，与下面的 TCP 监听一致。`--no-tun` 表示中继自己不建 TUN、也不占 mesh IP；节点地址由 registry 分配。

### 3.1 下载并安装

版本规则与 frps 相同。`download-binaries.sh` 解析 `EasyTier/EasyTier` 的 `releases/latest`，tag **保留** `v` 前缀，下载 `easytier-linux-aarch64-<tag>.zip`。构建日志是 `>>> easytier <tag>`。这里用 `easytier-linux-x86_64`。不要沿用旧文档里的 `v2.1.3`。已知版本时 `export EASYTIER_VER=vX.Y.Z`。

```bash
if [ -z "${EASYTIER_VER:-}" ]; then
  _url=$(curl -fsI -o /dev/null -w '%{redirect_url}' \
    https://github.com/EasyTier/EasyTier/releases/latest || true)
  EASYTIER_VER="${_url##*/tag/}"
  if [ -z "${EASYTIER_VER}" ] || [ "${EASYTIER_VER}" = "${_url}" ]; then
    echo "无法解析 EasyTier 的 latest tag" >&2
    unset EASYTIER_VER
  fi
fi

if [ -n "${EASYTIER_VER:-}" ]; then
  echo "easytier-core ${EASYTIER_VER}"
  cd /tmp
  wget -q "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-x86_64-${EASYTIER_VER}.zip"
  unzip -jo "easytier-linux-x86_64-${EASYTIER_VER}.zip" "*/easytier-core" -d /usr/local/bin/
  chmod +x /usr/local/bin/easytier-core
fi
```

### 3.2 systemd 服务

`--network-name` 与 `--network-secret` 必须和 `.env` 里的 `EASYTIER_NETWORK_NAME`、`EASYTIER_SECRET` 相同。`.env.example` 里网络名示例是 `hive`。

```bash
cat > /etc/systemd/system/easytier-relay.service << 'EOF'
[Unit]
Description=EasyTier Relay Node
After=network-online.target
Wants=network-online.target

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

监听同时包含 TCP 和 UDP `11010`，两条都放行。

```bash
ufw allow 11010/tcp comment "EasyTier TCP"
ufw allow 11010/udp comment "EasyTier UDP"
```

---

## 四、验证

```bash
# frps 是否在监听 7000
ss -tlnp | grep 7000

# EasyTier TCP/UDP 11010
ss -tulnp | grep 11010

systemctl status frps easytier-relay

journalctl -u frps -f --no-pager
journalctl -u easytier-relay -f --no-pager
```

---

## 五、记录填入 .env 的信息

部署完成后，把以下信息填入项目根目录的 `.env`（`scripts/build.sh` 会渲染进节点的 `/etc/hive/config.env`）：

```
FRP_SERVER_ADDR=<这台机器的公网 IP 或域名>
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=<frps.toml 里的 auth.token>

EASYTIER_PEERS=<见下方>
EASYTIER_NETWORK_NAME=<中继的 --network-name>
EASYTIER_SECRET=<中继的 --network-secret>
```

`EASYTIER_PEERS` 逗号分隔，可写多个中继。`start-easytier.sh` 对每一项：

- 已含 `://`：原样作为 `--peers`（例如 `tcp://203.0.113.1:11010`）
- 不含 `://` 但含 `:`：补成 `tcp://该项`（例如 `203.0.113.1:11010`）
- 只有 IP 或域名：补成 `tcp://主机:11010`

只填这台机器的公网 IP 或域名即可对上本节的 TCP `11010`。
