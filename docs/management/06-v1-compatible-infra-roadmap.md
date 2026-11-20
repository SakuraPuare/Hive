# v1.0.0 节点兼容说明

本文说明旧镜像停在「provision 里注册一次」时，管理侧还受哪些限制。当前镜像和 Registry 已经越过这条边界。平台能力见 [05-airport-roadmap.md](./05-airport-roadmap.md)，订阅失效、计费和租约见 [subscription-enforcement.md](../subscription-enforcement.md)，旧镜像出口与网关见 [GATEWAY.md](../GATEWAY.md)，入学、注册和心跳见 [PROVISION.md](../PROVISION.md)。

---

## 一、当前镜像会做什么

`provision-node.sh` 在没有 `/etc/hive/device-token` 时先 `POST /nodes/enroll`，再把返回的设备凭据写入该文件。脚本变量名仍是 `NODE_REGISTRY_API_SECRET`；文件里已有凭据时，Bearer 用的是这把设备凭据。`POST /nodes/register` 与 `POST /nodes/heartbeat` 都校验该 MAC 的设备凭据，镜像共用的 API Secret 会被拒绝。

注册在 provision 末尾按 MAC 幂等执行。请求体包含：

- `mac`、`mac6`、`hostname`、`cf_url`、`tunnel_id`
- `tailscale_ip`、`frp_port`、`xray_uuid`
- `mesh_tunnel_id`、`mesh_ip`

`HandleRegister` 不读取请求里的 `easytier_ip`。EasyTier 地址由 Registry 按 MAC 分配；节点上已经有地址时，重注册不会用请求体覆盖它。每次成功注册都会更新 `last_seen`。

`hive-command-agent.timer` 开机约 90 秒后第一次运行，之后大约每 60 秒一次，并最多再抖动 15 秒。它 `POST /nodes/heartbeat`，带上 `cpu_pct`、`mem_pct`、`disk_pct`、`uptime_sec`，以及采得到的 `country`、`services`、`addresses`。心跳更新 `last_seen`，并把 `node_status_checks` 标为 `online`。`country` 为空时保留已有国家。心跳不写 `latency_ms`，也不上报镜像版本、xray 版本、ASN 或带宽。

Prometheus 对 `job="hives"` 大约每 60 秒探测一次，补抓取延迟和同类资源指标。节点只有心跳、Prometheus 没有序列时，5 分钟内的状态行保持不动，更老的行才标成 `offline`。延迟取的是 `scrape_duration_seconds`。

当前镜像还会拉取服务端下发的内容：

- 网关配置：`GET /nodes/{mac}/clash-config`
- 命令：`GET /nodes/{mac}/commands`，回执 `POST /nodes/{mac}/commands/{id}/ack`
- OTA：`GET /nodes/{mac}/ota-version`

出口计费走 `POST /servers/{mac}/accounting`（节点上有 `/etc/hive/server-token`），没有该文件时用设备凭据 `POST /nodes/{mac}/xray-users`。客户订阅使用 `customer_subscriptions.xray_uuid`。重置订阅链接会同时轮换这个 UUID。单次授权最长 45 秒，`hive-subscription-guard.timer` 大约每 5 秒检查租约。到期、超额、停用或 UUID 变化后，节点重启 Xray 以关掉已有连接；同节点上的其他用户会跟着短暂重连。操作步骤和信任边界以订阅授权文档为准。

只选中一台设备时，管理后台用最近一次心跳里的服务状态，批量操作仍用原来的服务命令。

---

## 二、未升级镜像仍然受的限制

`nodes.subscription_sync` 默认为 0。这类节点的 Xray 只有自身那个静态 UUID：

- 用订阅 UUID 去连会得到 `invalid request user id`
- 网关配置改用节点自身 `xray_uuid`，链路可以通，但不计费
- 节点第一次向 `/nodes/{mac}/xray-users` POST 计费快照后，该标志自动变为 1
- 管理员也可以 `PATCH /admin/nodes/{mac}` 显式设置 `subscription_sync`

不上报心跳的镜像，`last_seen` 停在注册或入学时刻，不能当作在线。它们也不上报 `country`。`gateway_direction=auto` 时要靠 `country_override`；国家和人工位置都空着时，按未知处理并回退 `domestic`。服务状态和地址快照同样没有。

这些限制只覆盖还在跑旧镜像的设备。

在 `subscription_sync=0` 的节点上，用户控制仍然是软的：禁掉订阅链接挡不住已经导入的节点级 UUID。当前镜像上的失效靠租约和 UUID 轮换，时间尺度见上一节，不要写成立刻断开。

---

## 三、原路线图对照

下面是本文原先的 R1–R12，按当前代码和文档标注。接口清单不在这里重复。

| 项 | 现在 |
|----|------|
| R1 兼容契约 | 当前契约是入学、设备凭据、注册和心跳，见 [PROVISION.md](../PROVISION.md)。旧镜像约束见上一节。 |
| R2 管理平面部署 | 部署顺序见 [00-overview.md](./00-overview.md)，本地调试见 [07-local-dev.md](./07-local-dev.md)，Kubernetes 见 [DEPLOY-K8S.md](../DEPLOY-K8S.md)。 |
| R3 迁移、备份、恢复 | 迁移在 `management/registry/internal/store/migration.go`，执行记录写入 `schema_migrations`。备份和恢复见 [08-db-migration-backup.md](./08-db-migration-backup.md)。 |
| R4 节点台账 | 已有启用、状态、权重、区域、位置、备注。网关列上游时按 `weight` 从高到低排；订阅导出不读 `weight`。migration 14 删除了未使用的城市、标签、下线原因列。国家后来改由心跳上报，可用 `country_override` 覆盖。没有排水状态。 |
| R5 服务端探测 | 心跳和 Prometheus 探测同时写 `node_status_checks`。探测不再是唯一在线来源。 |
| R6 线路 | 已有 `lines` / `line_nodes`，后台页面是 `pages/lines.tsx`。没有独立的 `inbounds` 表。 |
| R7 订阅生成 | 客户订阅、线路和分组都能导出 Clash/Mihomo 与 VLESS。线路和分组导出要带客户订阅 token。`subscription_groups` 仍保留。没有 sing-box、Shadowrocket、Surge、Hiddify 模板。 |
| R8 后台页面 | 已有节点、节点状态、线路、网关、OTA、客户、套餐、订阅、订单、审计。没有单独的订阅模板页。 |
| R9 认证、RBAC、审计 | 管理员会话和设备凭据分开。角色权限和 `audit_logs` 已在。设备凭据按 MAC 签发，管理员用 `POST /admin/nodes/{mac}/credential` 轮换。 |
| R10 监控告警 | `management/prometheus/rules/management.yml` 与 `edge-nodes.yml` 覆盖 Registry 不可达、延迟和 5xx、MySQL `/health` 503、节点离线、大面积离线，以及节点内存、CPU、磁盘。告警经 Alertmanager webhook 发出，见 [08-deploy-and-rollback.md](./08-deploy-and-rollback.md)。规则里没有「订阅生成失败」。 |
| R11 发布与回滚 | 见 [08-deploy-and-rollback.md](./08-deploy-and-rollback.md)。 |
| R12 用户系统 | `customers`、`plans`、`plan_lines`、`customer_subscriptions` 已在使用。订单由管理员把状态改成已支付后开通或续期；没有第三方支付回调。 |

原先写的「本阶段不做套餐、不做心跳、不做服务端下发」对当前镜像已经不成立。上一节的旧镜像限制仍然有效。
