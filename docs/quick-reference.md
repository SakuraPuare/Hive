# 文档索引

## 快速入门

```
1. 准备凭证（Cloudflare、Tailscale OAuth、FRP、EasyTier，以及可达的 NODE_REGISTRY_URL）
2. cp .env.example .env && vim .env
3. ./scripts/setup-armbian.sh
4. ./scripts/download-binaries.sh
5. ./scripts/build.sh
6. 烧录到 SD 卡，插电
```

首启会请求 `POST ${NODE_REGISTRY_URL}/nodes/allocate-easytier` 领取 EasyTier 地址。地址为空时 `provision-node.sh` 直接退出，并且不会写入 `/etc/hive/provisioned`。

---

## 文档列表

### 节点端文档

| 文档 | 内容 |
|------|------|
| [BUILD.md](./BUILD.md) | 镜像构建全流程（环境准备、构建、烧录） |
| [PROVISION.md](./PROVISION.md) | 首次启动配置详解（provision 流程） |
| [NODE-OPERATIONS.md](./NODE-OPERATIONS.md) | 节点日常运维（SSH、服务管理、Ansible 批量操作） |
| [OTA.md](./OTA.md) | 签名 OTA 与 Zero2 / R28S / R3S LTS / Orange Pi 4 LTS 引导 A/B |
| [HOTSPOT.md](./HOTSPOT.md) | WiFi 热点（自动，双频） |
| [GATEWAY.md](./GATEWAY.md) | 透明代理网关（路由器角色） |
| [subscription-enforcement.md](./subscription-enforcement.md) | 订阅授权、计费与在线设备数限制 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 常见故障排查（provision 失败、SSH 问题、转发服务故障） |
| [FIREWALL.md](./FIREWALL.md) | 防火墙配置详解（UFW 规则、`hive-firewall` 工具） |
| [FAIL2BAN.md](./FAIL2BAN.md) | 入侵防护配置（fail2ban 监狱、`hive-fail2ban` 工具） |
| [SECURITY-SUMMARY.md](./SECURITY-SUMMARY.md) | 安全配置全览 |

### 服务端文档（VPS 部署）

| 文档 | 内容 |
|------|------|
| [management/00-overview.md](./management/00-overview.md) | 整体架构与部署顺序 |
| [management/01-foreign-vps.md](./management/01-foreign-vps.md) | 境外 VPS：frps + EasyTier 中继 |
| [management/02-china-vps.md](./management/02-china-vps.md) | 中国 VPS：Node Registry + Prometheus + Grafana |
| [management/03-cloudflare-tokens.md](./management/03-cloudflare-tokens.md) | 获取 Cloudflare 凭证 |
| [management/04-tailscale-key.md](./management/04-tailscale-key.md) | 配置 Tailscale OAuth Client |
| [management/05-airport-roadmap.md](./management/05-airport-roadmap.md) | 自有节点平台：现状与未做项 |
| [management/06-v1-compatible-infra-roadmap.md](./management/06-v1-compatible-infra-roadmap.md) | `v1.0.0` 旧镜像的管理侧限制（当前镜像已越过该边界） |
| [management/07-local-dev.md](./management/07-local-dev.md) | 本地开发与调试 |
| [management/08-deploy-and-rollback.md](./management/08-deploy-and-rollback.md) | 管理平面发布与回滚 |
| [management/08-db-migration-backup.md](./management/08-db-migration-backup.md) | 数据库迁移、备份与恢复 |
| [DEPLOY-K8S.md](./DEPLOY-K8S.md) | Kubernetes 部署（Zadig） |

### API

| 文档 | 内容 |
|------|------|
| [NODE-REGISTRY-API.md](./NODE-REGISTRY-API.md) | Node Registry API（外部路径带 `/api` 前缀） |

---

## 架构速览

```
[终端用户]
     ↓  ws+TLS
[Cloudflare Edge]
     ↓  CF Tunnel
[cloudflared]  ← 主接入，节点无需公网 IP
     ↓
[nginx]        ← 监听 127.0.0.1:10077，WebSocket /ray → xray
     ↓
[xray-core]    ← VLESS+WS 监听 127.0.0.1:10079
     ↓
[本地互联网出口]

─────────── 下游入口（网关 / 热点）───────────
[LAN 或 WiFi 客户端] → [Mihomo TPROXY] → 直连，或转到上游出口

─────────── 管理平面 ───────────
[Tailscale mesh]   → 主管理通道（SSH / Ansible / Prometheus）
[EasyTier mesh]    → 备用管理通道（registry 从 172.20.0.0/16 按 MAC 发号）
[FRP tunnel]       → 应急 SSH（依赖境外 VPS）
[Cloudflare Mesh]  → WARP Connector，可选；失败不中断首启

─────────── 节点标识 ───────────
hostname     = hive-<mac6>（有线网卡 MAC 去掉冒号后的末 6 位）
SSH host key = 随机 Ed25519（hive-regen-hostkeys.sh，标记 /etc/hive/random-hostkeys-v1）
xray UUID    = 随机 UUID，首次写入 /etc/hive/xray-uuid 后保持
FRP port     = 10000 + (md5(无冒号 MAC) 前 8 位十六进制整数 % 50000)，范围 10000–59999
EasyTier IP  = POST /nodes/allocate-easytier，同一 MAC 重刷领回同一地址
设备凭证     = openssl rand -hex 32，POST /nodes/enroll 成功后写入 /etc/hive/device-token
```

---

## 关键路径速查

| 路径 | 说明 |
|------|------|
| `/etc/hive/config.env` | 共享凭证（CF Token、Tailscale OAuth 等） |
| `/etc/hive/node-info` | 节点信息汇总（provision 后生成） |
| `/etc/hive/provisioned` | provision 完成标记 |
| `/etc/hive/device-token` | 设备凭证（enroll 成功后写入，之后作 Bearer） |
| `/etc/hive/xray-uuid` | 随机 xray UUID（首次写入后保持） |
| `/var/log/provision-node.log` | provision 全量日志 |
| `/etc/nginx/sites-available/hive` | nginx 节点配置（监听 10077，转发至 xray） |
| `/etc/xray/config.json` | xray 转发配置（监听 10079） |
| `/etc/cloudflared/config.yml` | CF Tunnel 配置 |
| `/etc/cloudflared/cert.json` | CF Tunnel 凭证（Tunnel Secret） |
| `/etc/frp/frpc.toml` | FRP 客户端配置 |
| `/etc/default/armbian-ramlog` | ramlog 配置（日志写入 RAM，128M） |
| `/etc/default/armbian-zram-config` | zram 配置（zstd 压缩 swap） |
| `/etc/systemd/journald.conf.d/hive.conf` | journald 日志大小限制（30M） |
