# Hive — RK3528A 边缘代理集群

将一张编译好的 IMG 写到 100 张 SD 卡，设备上电后约 2 分钟自动成为可用的 v2ray 代理节点，无需逐台手工配置。

---

## 架构

```
[v2ray 用户]
     │  VLESS+ws+TLS
     ▼
[Cloudflare Edge]
     │  CF Tunnel (http2)
     ▼
[cloudflared]   ← 节点无需公网 IP
     │
     ▼
[nginx]         ← 监听 127.0.0.1:10077，WebSocket /ray → xray
     │
     ▼
[xray-core]     VLESS+WS 监听 127.0.0.1:10079
     │
     ▼
[本地出口]      节点所在国家直连

────────── 管理平面（三套冗余）──────────
[Tailscale mesh]  → 主通道：SSH / Ansible / Prometheus
[EasyTier mesh]   → 备用通道：独立 P2P 网络
[FRP tunnel]      → 最后防线：依赖境外 VPS frps
```

**管理服务器（VPS）**：frps · Prometheus · Grafana · Node Registry API · Ansible

---

## 零配置原理

所有节点烧录同一张镜像（嵌入共享凭证），首次上电自动完成个性化：

| 生成内容 | 方式 | 重刷镜像是否变化 |
|----------|------|------------------|
| 主机名 `hive-<mac6>` | eth0 MAC 末 6 位 | 不变 |
| SSH Host Key (Ed25519) | SHA-256(mac) seed | **不变** |
| xray UUID | SHA-256(mac) | **不变** |
| EasyTier IP | MAC6 三字节映射 → `10.b1.b2.b3` | 不变 |
| FRP 远程端口 | MD5(MAC) → 10000–60000 | 不变 |
| CF Tunnel 凭证 + DNS 记录 | Cloudflare API 自动创建 | 重建（幂等） |
| Machine ID | `systemd-machine-id-setup` | 重建 |

---

## 快速开始

### 前提

- Ubuntu 22.04 / Debian 12 构建主机（推荐 8 核 / 16 GB RAM）
- 已完成服务端部署（见[服务端文档](#服务端部署)）

```bash
# 安装构建依赖
sudo apt install -y git curl wget jq build-essential python3 \
    ccache unzip qemu-user-static binfmt-support debootstrap
```

### 构建流程

```bash
# 1. 初始化 Armbian 框架（首次）
./scripts/setup-armbian.sh

# 2. 下载 arm64 二进制（xray / cloudflared / frpc / easytier）
./scripts/download-binaries.sh

# 3. 填写凭证
cp .env.example .env
vim .env   # 填入 CF Token、Tailscale OAuth Secret、FRP 地址等

# 4. 构建镜像（首次约 30-90 分钟，有 ccache 后 10-20 分钟）
./scripts/build.sh

# 5. 烧录
sudo dd if=armbian-build/build/output/images/*.img of=/dev/sdX bs=4M status=progress
```

详见 [docs/BUILD.md](docs/BUILD.md)。

### 上电验证

```bash
# ~2 分钟后，在管理服务器上查看节点
tailscale status | grep hive-

# SSH 到节点
ssh root@hive-<mac6>

# 查看节点所有管理通道地址（离线工具）
./scripts/node-lookup.sh <mac6>
```

---

## .env 关键变量

```bash
# Cloudflare（节点 URL: hive-<mac6>.yourdomain.com）
CF_API_TOKEN=       # 需要 Tunnel:Edit + DNS:Edit 权限
CF_ACCOUNT_ID=
CF_ZONE_ID=
CF_DOMAIN=yourdomain.com

# Tailscale — 使用 OAuth Client Secret（不过期，区别于 90 天 Auth Key）
# 必须在 ACL Policy 中声明 tag: "tagOwners": { "tag:hive": ["autogroup:admin"] }
TAILSCALE_OAUTH_SECRET=tskey-client-xxxxx

# FRP（SSH 应急隧道）
FRP_SERVER_ADDR=your-vps.example.com
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=

# EasyTier（P2P mesh）
EASYTIER_NETWORK_NAME=hive
EASYTIER_SECRET=
EASYTIER_PEERS=your-vps.example.com   # 可逗号分隔多中继

# 节点 root 初始密码（provision 后应通过 SSH key 登录）
DEFAULT_ROOT_PASSWORD=

# 可选
NODE_REGISTRY_URL=https://registry.yourdomain.com
```

---

## 节点内服务

| 服务 | 端口 | 说明 |
|------|------|------|
| nginx | 127.0.0.1:10077 | WebSocket 反向代理，/ray → xray |
| xray | 127.0.0.1:10079 | VLESS+WS 代理核心 |
| cloudflared | — | CF Tunnel，暴露 nginx 到公网 |
| frpc | — | FRP 客户端，暴露 SSH 到 VPS |
| easytier | — | P2P mesh，提供备用管理 IP |
| tailscaled | — | Tailscale VPN，主管理通道 |
| prometheus-node-exporter | 9100 | 指标采集（仅 Tailscale 可达） |
| ufw | — | 防火墙，开机自动配置（日志默认关闭） |
| fail2ban | — | SSH 暴力破解防护 |
| auditd | — | 系统审计日志 |

**xray 协议**：VLESS + WebSocket（`/ray`），经 nginx 和 CF Tunnel 对外暴露为 HTTPS。
客户端链接格式（登录节点后 MOTD 自动显示）：

```
vless://<uuid>@<hive-mac6.yourdomain.com>:443?type=ws&security=tls&path=%2Fray#hive-<mac6>
```

---

## 服务端部署

按顺序完成以下步骤后再构建镜像：

| 步骤 | 文档 | 内容 |
|------|------|------|
| 1 | [01-foreign-vps.md](management/docs/01-foreign-vps.md) | 境外 VPS：frps + EasyTier 中继 |
| 2 | [03-cloudflare-tokens.md](management/docs/03-cloudflare-tokens.md) | 获取 CF API Token / Account ID / Zone ID |
| 3 | [04-tailscale-key.md](management/docs/04-tailscale-key.md) | 创建 Tailscale OAuth Client + 配置 ACL |
| 4 | [02-china-vps.md](management/docs/02-china-vps.md) | 管理 VPS：Node Registry + Prometheus + Grafana |
| 5 | — | 填 `.env`，构建镜像，批量烧录 |

---

## 安全特性

- **防火墙（UFW）**：默认拒绝所有入站，仅开放 SSH（本地网络 + Tailscale）和 Node Exporter（仅 Tailscale）
- **入侵防护（fail2ban）**：SSH 3 次失败封禁 2 小时；端口扫描封禁
- **SSH 加固**：`MaxAuthTries 3`、`LoginGraceTime 30`、禁 X11/Agent 转发
- **内核加固**：SYN cookie、rp_filter、禁 ICMP 重定向、禁源路由、ASLR
- **自动安全更新**：`unattended-upgrades` 仅应用安全补丁
- **审计日志**：`auditd` 记录 SSH config、root/.ssh、/etc/shadow 变更
- **确定性 SSH key**：重刷镜像后 fingerprint 不变，避免 known_hosts 重置

详见 [docs/SECURITY-SUMMARY.md](docs/SECURITY-SUMMARY.md)。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/INDEX.md](docs/INDEX.md) | 文档总索引 |
| [docs/BUILD.md](docs/BUILD.md) | 镜像构建全流程 |
| [docs/PROVISION.md](docs/PROVISION.md) | 首次启动配置详解 |
| [docs/NODE-OPERATIONS.md](docs/NODE-OPERATIONS.md) | 节点日常运维 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 常见故障排查 |
| [docs/FIREWALL.md](docs/FIREWALL.md) | 防火墙配置 |
| [docs/FAIL2BAN.md](docs/FAIL2BAN.md) | 入侵防护配置 |

---

## 关键文件结构

```
.
├── .env.example                   # 环境变量模板（复制为 .env 后填写）
├── scripts/
│   ├── build.sh                   # 一键构建脚本（含 ccache 优化）
│   ├── download-binaries.sh       # 下载 arm64 二进制
│   ├── setup-armbian.sh           # 初始化 Armbian 构建框架
│   └── node-lookup.sh             # 离线计算节点地址（仅需 mac6）
├── configs/
│   ├── hive/config.env.tpl        # 节点配置模板（嵌入镜像）
│   └── frp/frpc.toml.tpl          # FRP 客户端配置模板
├── armbian-build/userpatches/
│   ├── customize-image.sh         # 镜像定制钩子（chroot 内执行）
│   └── overlay/                   # 直接覆盖到镜像根目录
│       ├── etc/hive/              # 节点配置目录
│       ├── etc/xray/config.json   # xray 配置（含 UUID 占位符）
│       ├── etc/frp/frpc.toml      # FRP 客户端配置
│       ├── etc/systemd/system/    # systemd 服务文件
│       ├── etc/update-motd.d/     # 自定义登录 MOTD
│       └── usr/local/bin/
│           ├── provision-node.sh  # 首次启动编排脚本（核心）
│           ├── setup-firewall.sh  # UFW 防火墙配置
│           ├── setup-fail2ban.sh  # fail2ban 配置
│           ├── hive-firewall      # 防火墙管理工具
│           ├── hive-fail2ban      # 入侵防护管理工具
│           └── start-easytier.sh  # EasyTier 启动包装脚本
├── management/
│   ├── docker-compose.yml         # Prometheus + Grafana
│   ├── registry/main.py           # Node Registry API（FastAPI）
│   └── docs/                      # 服务端部署文档
└── ansible/                       # 批量管理 playbook
```

---

## 已知限制

- **FRP 端口碰撞**：50000 端口分配 100 台设备碰撞概率约 0.1%，发生时 FRP 不可用，但不影响 Tailscale / EasyTier 主通道
- **SSH 密码登录**：当前开启（`PasswordAuthentication yes`），provision 导入 GitHub 公钥后建议手动关闭或通过 Ansible 批量改为 `no`
- **CF Tunnel 重建**：重刷镜像且本地 `cert.json` 丢失时会删除旧 Tunnel 并重建，Tunnel ID 变化（VLESS 链接中的 hostname 不变）
- **Tailscale tag 权限**：必须在 ACL Policy 中声明 `tagOwners`，否则 `tailscale up --advertise-tags=tag:hive` 会失败
