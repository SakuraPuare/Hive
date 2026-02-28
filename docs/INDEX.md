# 文档索引

## 快速入门

```
1. 准备凭证（CF Token + Tailscale OAuth + FRP 配置）
2. cp .env.example .env && vim .env
3. ./scripts/setup-armbian.sh
4. ./scripts/download-binaries.sh
5. ./scripts/build.sh
6. 烧录到 SD 卡，插电
```

---

## 文档列表

### 节点端文档

| 文档 | 内容 |
|------|------|
| [BUILD.md](./BUILD.md) | 镜像构建全流程（环境准备、构建、烧录） |
| [PROVISION.md](./PROVISION.md) | 首次启动配置详解（provision 流程、确定性 ID 生成） |
| [NODE-OPERATIONS.md](./NODE-OPERATIONS.md) | 节点日常运维（SSH、服务管理、Ansible 批量操作） |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 常见故障排查（provision 失败、SSH 问题、代理故障） |
| [FIREWALL.md](./FIREWALL.md) | 防火墙配置详解（UFW 规则、`hive-firewall` 工具） |
| [FAIL2BAN.md](./FAIL2BAN.md) | 入侵防护配置（fail2ban 监狱、`hive-fail2ban` 工具） |
| [SECURITY-SUMMARY.md](./SECURITY-SUMMARY.md) | 安全配置全览 |

### 服务端文档（VPS 部署）

| 文档 | 内容 |
|------|------|
| [00-overview.md](../management/docs/00-overview.md) | 整体架构与部署顺序 |
| [01-foreign-vps.md](../management/docs/01-foreign-vps.md) | 境外 VPS：frps + EasyTier 中继 |
| [02-china-vps.md](../management/docs/02-china-vps.md) | 中国 VPS：Node Registry + Prometheus + Grafana |
| [03-cloudflare-tokens.md](../management/docs/03-cloudflare-tokens.md) | 获取 Cloudflare 凭证 |
| [04-tailscale-key.md](../management/docs/04-tailscale-key.md) | 配置 Tailscale OAuth Client |

---

## 架构速览

```
[v2ray 用户]
     ↓  VLESS+TLS (ws)
[Cloudflare Edge]
     ↓  CF Tunnel
[cloudflared]  ← 主接入，节点无需公网 IP
     ↓
[nginx]        ← 监听 127.0.0.1:10077，WebSocket /ray → xray
     ↓
[xray-core]    ← VLESS+WS 监听 127.0.0.1:10079
     ↓
[本地互联网出口]

─────────── 管理平面（三套冗余）───────────
[Tailscale mesh]   → 主管理通道（SSH/Ansible/Prometheus）
[EasyTier mesh]    → 备用管理通道
[FRP tunnel]       → 最后防线（依赖境外 VPS）

─────────── 节点标识（从 MAC 确定性推导）───
hostname   = hive-<mac6>
SSH key    = SHA-256("hive-ssh-ed25519:<MAC>")
xray UUID  = SHA-256("hive-xray-uuid:<MAC>")
FRP port   = 10000 + MD5(<MAC>) % 50000
EasyTier   = 10.<mac6[0:2]>.<mac6[2:4]>.<mac6[4:6]>
```

---

## 关键路径速查

| 路径 | 说明 |
|------|------|
| `/etc/hive/config.env` | 共享凭证（CF Token、Tailscale OAuth 等） |
| `/etc/hive/node-info` | 节点信息汇总（provision 后生成） |
| `/etc/hive/provisioned` | provision 完成标记 |
| `/var/log/provision-node.log` | provision 全量日志 |
| `/etc/nginx/sites-available/hive` | nginx 节点配置（监听 10077，代理 xray） |
| `/etc/xray/config.json` | xray 代理配置（监听 10079） |
| `/etc/cloudflared/config.yml` | CF Tunnel 配置 |
| `/etc/cloudflared/cert.json` | CF Tunnel 凭证（Tunnel Secret） |
| `/etc/frp/frpc.toml` | FRP 客户端配置 |
| `/etc/default/armbian-ramlog` | ramlog 配置（日志写入 RAM，128M） |
| `/etc/default/armbian-zram-config` | zram 配置（压缩 swap） |
| `/etc/systemd/journald.conf.d/hive.conf` | journald 日志大小限制（30M） |
