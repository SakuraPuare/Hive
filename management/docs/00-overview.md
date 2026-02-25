# 服务端部署概览

## 架构

```
全球边缘节点（RK3528A）
    │
    ├─── xray+cloudflared ──► Cloudflare Edge ──► 用户（v2ray 客户端）
    │
    ├─── Tailscale ──────────────────────────────► 管理服务器（中国 VPS）
    │                                               ├── Ansible（批量管理）
    │                                               ├── Prometheus（抓取指标）
    │                                               └── Grafana（监控面板）
    │
    ├─── Node Registry 注册 ─► Cloudflare Edge ──► 中国 VPS（registry.domain.com）
    │                                               └── Node Registry API（8080）
    │
    ├─── EasyTier ───────────────────────────────► 境外 VPS（中继节点）
    │
    └─── FRP ────────────────────────────────────► 境外 VPS（frps）
```

---

## 部署顺序

```
Step 1  境外 VPS   → frps + EasyTier relay
Step 2  Cloudflare → 获取 API Token、Account ID、Zone ID
Step 3  Tailscale  → 创建 Auth Key、配置 ACL
Step 4  中国 VPS   → Node Registry + Prometheus + Grafana + cloudflared
Step 5  填写 .env  → 编译镜像 → 烧录 SD 卡 → 上电
```

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-foreign-vps.md](./01-foreign-vps.md) | 境外 VPS：frps + EasyTier relay |
| [02-china-vps.md](./02-china-vps.md)     | 中国 VPS：Node Registry + Prometheus + Grafana + cloudflared |
| [03-cloudflare-tokens.md](./03-cloudflare-tokens.md) | 获取 CF API Token / Account ID / Zone ID |
| [04-tailscale-key.md](./04-tailscale-key.md)         | 创建 Tailscale Auth Key |

---

## 服务端口汇总

### 境外 VPS

| 端口 | 服务 | 对外开放 |
|------|------|----------|
| 7000/tcp | frps 主端口（节点连入） | 是 |
| 11010/tcp+udp | EasyTier relay | 是 |
| 7500/tcp | frps 管理面板 | 否（仅本地/SSH 隧道） |

### 中国 VPS

| 端口 | 服务 | 对外开放 |
|------|------|----------|
| 8080/tcp | Node Registry API | 否（通过 CF Tunnel） |
| 9090/tcp | Prometheus | 否（通过 Tailscale） |
| 3000/tcp | Grafana | 否（通过 Tailscale） |
| 9100/tcp | node-exporter | 否（通过 Tailscale） |

---

## .env 填写检查表

完成全部服务端部署后，`.env` 里以下变量应全部有值：

```bash
# 境外 VPS（01-foreign-vps.md 完成后填）
FRP_SERVER_ADDR=
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=
EASYTIER_PEERS=
EASYTIER_NETWORK_NAME=
EASYTIER_SECRET=

# Cloudflare（03-cloudflare-tokens.md 完成后填）
CF_API_TOKEN=
CF_ACCOUNT_ID=
CF_ZONE_ID=
CF_DOMAIN=

# Tailscale（04-tailscale-key.md 完成后填）
TAILSCALE_OAUTH_SECRET=

# 中国 VPS（02-china-vps.md 完成后填）
NODE_REGISTRY_URL=https://registry.yourdomain.com
```
