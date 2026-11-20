# 服务端部署概览

## 架构

Tailscale 与 Node Registry 两条线都落到同一台管理 VPS（[02-china-vps.md](./02-china-vps.md) 里的中国 VPS）。Tailscale 用来跑 Ansible，并让 Prometheus 抓取节点指标。Registry 由本机 nginx 的 `/api/` 反代；02 也可以用 Cloudflare Tunnel 转到 `127.0.0.1:8080`。

```
全球边缘节点（Rockchip ARM）
    │
    ├─── cloudflared + nginx + xray ──► Cloudflare Edge ──► 用户（Clash/Mihomo、VLESS）
    │
    ├─── Tailscale ────────────► 管理 VPS
    │                             ├── Ansible（经 Tailscale 管节点）
    │                             ├── Prometheus + Grafana + Alertmanager
    │                             └── node-exporter（本机）
    │
    ├─── Node Registry 注册 ───► nginx `/api/` 或 CF Tunnel ──► hive-registry（127.0.0.1:8080）
    │
    ├─── EasyTier ─────────────► 境外 VPS（中继）
    │
    └─── FRP ──────────────────► 境外 VPS（frps）
```

`management/setup-vps.sh` 会启动 Prometheus、Grafana、Alertmanager，并用 nginx 分别暴露在 `/prometheus/`、`/grafana/`、`/alertmanager/`。Registry UI 在 `/`。这三个监控进程只监听 `127.0.0.1`。

用户流量进节点的路径是 cloudflared → nginx → Xray。Registry 签发 Clash/Mihomo 与 VLESS 订阅，见 [NODE-REGISTRY-API.md](../NODE-REGISTRY-API.md)。

---

## 部署顺序

```
Step 1  境外 VPS   → frps + EasyTier relay
Step 2  Cloudflare → 获取 API Token、Account ID、Zone ID、根域名
Step 3  Tailscale  → 创建 OAuth Client Secret、配置 ACL
Step 4  管理 VPS   → Node Registry + nginx + Prometheus + Grafana + Alertmanager
                    cloudflared 暴露 Registry 的步骤见 02
Step 5  填写 .env  → 编译镜像 → 烧录 SD 卡 → 上电
```

单机 `setup-vps.sh` 之外，可以把 Registry 与 UI 部署到 Kubernetes，见 [DEPLOY-K8S.md](../DEPLOY-K8S.md)。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-foreign-vps.md](./01-foreign-vps.md) | 境外 VPS：frps + EasyTier 中继 |
| [02-china-vps.md](./02-china-vps.md)     | 中国 VPS：Node Registry + Prometheus + Grafana + cloudflared |
| [03-cloudflare-tokens.md](./03-cloudflare-tokens.md) | 获取 CF API Token、Account ID、Zone ID、`CF_DOMAIN` |
| [04-tailscale-key.md](./04-tailscale-key.md)         | 配置 Tailscale OAuth Client Secret 与 ACL |
| [05-airport-roadmap.md](./05-airport-roadmap.md)     | 自有节点平台：现状与未做项 |
| [06-v1-compatible-infra-roadmap.md](./06-v1-compatible-infra-roadmap.md) | `v1.0.0` 节点兼容基础设施 Roadmap |
| [07-local-dev.md](./07-local-dev.md) | 本地开发与调试 |
| [08-deploy-and-rollback.md](./08-deploy-and-rollback.md) | 管理平面发布与回滚 |
| [08-db-migration-backup.md](./08-db-migration-backup.md) | 数据库迁移、备份与恢复 |
| [DEPLOY-K8S.md](../DEPLOY-K8S.md) | Kubernetes 部署（Zadig），单机之外的另一种形态 |

---

## 服务端口汇总

### 境外 VPS

与 [01-foreign-vps.md](./01-foreign-vps.md) 里的 `frps.toml`、EasyTier `--listeners` 一致。

| 端口 | 服务 | 对外开放 |
|------|------|----------|
| 7000/tcp | frps 主端口（节点连入） | 是 |
| 10000–60000/tcp | frps 映射端口（应急 SSH）。节点 `remotePort` 在 10000–59999，`allowPorts` 与 ufw 开到 60000 | 是 |
| 11010/tcp+udp | EasyTier relay | 是 |
| 7500/tcp | frps 管理面板 | 否（`127.0.0.1`，经 SSH 隧道） |

### 管理 VPS

监听地址来自 `management/docker-compose.yml`、`management/nginx/nginx.conf` 和 `management/setup-vps.sh`。

| 端口 | 服务 | 对外开放 |
|------|------|----------|
| 80/tcp | nginx：`/` Registry UI，`/api/` → Registry，`/prometheus/`、`/grafana/`、`/alertmanager/` | 监听所有接口；公网入口按 02 走 CF Tunnel |
| 8080/tcp | hive-registry | 否（`127.0.0.1`） |
| 4230/tcp | Prometheus | 否（`127.0.0.1`） |
| 4231/tcp | Grafana | 否（`127.0.0.1`） |
| 9093/tcp | Alertmanager | 否（`127.0.0.1`） |
| 9100/tcp | 本机 node-exporter | Prometheus 抓取 `localhost:9100`；仓库未改其监听地址 |

边缘节点的 node-exporter 不在上表里。Prometheus 经 Tailscale 抓取节点 `:9100`（`management/scripts/update-targets.sh`），ACL 见 [04-tailscale-key.md](./04-tailscale-key.md)。

---

## .env 填写检查表

完成 Step 1–4 后，项目根目录 `.env`（从 `.env.example` 复制）按下面的变量填写。`NODE_REGISTRY_URL` 留空时，节点跳过注册。

```bash
# 境外 VPS（01-foreign-vps.md 完成后填）
FRP_SERVER_ADDR=
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=
# 逗号分隔。无 scheme 的主机名会补成 tcp://主机:11010；也可写 tcp://主机:11010
EASYTIER_PEERS=
EASYTIER_NETWORK_NAME=
EASYTIER_SECRET=

# Cloudflare（03-cloudflare-tokens.md 完成后填）
CF_API_TOKEN=
CF_ACCOUNT_ID=
CF_ZONE_ID=
CF_DOMAIN=

# Tailscale（04-tailscale-key.md 完成后填）
# OAuth Client Secret，形如 tskey-client-xxxxx
TAILSCALE_OAUTH_SECRET=

# 节点请求 ${NODE_REGISTRY_URL}/nodes/register（provision-node.sh）
# setup-vps.sh 的 nginx 会剥离 /api/：填到 /api，末尾不加 /
NODE_REGISTRY_URL=https://yourdomain.com/api
# 02 的 CF Tunnel 若直接转到 127.0.0.1:8080，则不要带 /api：
# NODE_REGISTRY_URL=https://registry.yourdomain.com
```
