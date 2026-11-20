# Hive 自有节点平台：现状与未做项

本文按当前 `management/registry` 与 `management/registry-ui` 的实现整理。计费、租约和订阅失效见 [subscription-enforcement.md](../subscription-enforcement.md)，网关见 [GATEWAY.md](../GATEWAY.md)。

[06-v1-compatible-infra-roadmap.md](./06-v1-compatible-infra-roadmap.md) 写的是「边缘节点停在 `v1.0.0`、服务端先不做心跳和套餐」时的约束。当前 Registry 已经越过那条边界，以本页和订阅授权文档为准。

---

## 一、结论

系统已经不只是节点资产表。节点控制面、线路、套餐、客户订阅和客户门户都在代码里，管理后台也有对应页面。

它现在能做：

- 设备注册、enroll、心跳，以及按心跳 / Prometheus 判断在线
- 线路、订阅分组、套餐，以及按客户订阅签发 Clash/Mihomo 与 VLESS
- 客户注册登录、下单、工单、公告、认领设备、邀请返利
- 管理员 RBAC、审计、订单与优惠码

它还没有：

- 节点排水（drain）、节点标签
- 独立的入口（inbound）对象
- sing-box、Shadowrocket、Surge、Hiddify 的专用订阅模板
- 第三方支付回调
- 心跳里的镜像版本、xray 版本、ASN、带宽

---

## 二、节点控制面

### 接入

- `POST /nodes/enroll`：设备先保存 64 位 token，再调用 enroll。服务端只存哈希；相同 token 可以重试拿回丢失的响应，不同 token 不能轮换凭据。同一 IP 每分钟 20 次。
- `POST /nodes/register`：按 MAC 幂等注册或更新，调用方要带设备凭据。必填 `mac`、`hostname`、`cf_url`、`xray_uuid`，还可带 `mac6`、`tunnel_id`、`frp_port`、`mesh_tunnel_id`、`mesh_ip`、`tailscale_ip`。首次写入 `registered_at`；每次注册都更新 `last_seen`。Tailscale 地址为空时首次记为 `pending`。EasyTier 地址由 Registry 按 MAC 分配，不在请求体里。认领码只铸造一次，明文只在当次响应里返回。
- `POST /admin/nodes/{mac}/credential`：管理员签发设备凭据（`node:write`）。

### 心跳与在线

- `POST /nodes/heartbeat` 使用设备凭据。它更新 `last_seen`；`country` 非空才覆盖，避免旧 agent 把已有国家抹掉。
- 请求体可以带 `cpu_pct`、`mem_pct`、`disk_pct`、`uptime_sec`、`services`、`addresses`。服务状态和地址快照缺省时不新造样本。
- 心跳把 `node_status_checks` 标为 `online`，并写入 CPU、内存、磁盘、运行时间。`latency_ms` 在心跳里写成空。
- Prometheus 探测（`job="hives"`，约 60 秒）补抓取延迟和同类指标。节点只有心跳、Prometheus 没有序列时，5 分钟内的状态行保持不动，更老的行才标 `offline`。
- `last_seen` 会随心跳更新，不再只靠注册。节点列表里的 `probe_status` 来自 `node_status_checks`，没有记录时是 `unknown`。

心跳不包含镜像版本、xray 版本、ASN 或带宽。延迟是 Prometheus 的 `scrape_duration_seconds`，不是对节点做的拨测 RTT。

### 管理员能改的节点字段

`PATCH /nodes/{mac}` 允许：`location`、`note`、`tailscale_ip`、`easytier_ip`、`frp_port`、`enabled`、`status`、`weight`、`region`、`mesh_tunnel_id`、`mesh_ip`、`gateway_enabled`、`gateway_direction`、`gateway_upstream_mode`、`gateway_upstream_nodes`、`bound_subscription_id`、`exit_enabled`、`exit_direction`、`subscription_sync`、`country_override`。

- `exit_direction` 只能是 `overseas`（出海）或 `domestic`（回国）。
- `gateway_direction` 可以是 `auto`、`domestic`、`overseas`、`global`、`direct`。
- `weight` 能保存。网关挑选上游时按 `weight` 从高到低、再按 `hostname` 排序；订阅导出不按 `weight` 取舍节点。
- 实际是否作为 Xray 出口：`exit_enabled && owner_exit_enabled && enabled && status == active`。`owner_exit_enabled` 由设备所有者在门户修改，不在上面的管理员字段列表里。

删除节点只删除节点行和 `device_credentials`，并写审计。不会改 UFW 上的 FRP 放行。

### 远程操作与 OTA

- 管理端把命令放进 `node_commands`，设备用 `GET /nodes/{mac}/commands` 拉取，再用 `POST /nodes/{mac}/commands/{id}/ack` 回执。
- 单节点的服务状态来自最近一次心跳，不是实时 RPC：`GET /admin/nodes/{mac}/services`。只选一台设备时，后台用这份明细，不再走批量用的通用服务下拉；多台设备仍用原来的批量服务命令。
- OTA 包、分片上传和 rollout 在 `/admin/ota/*`。设备用 `GET /nodes/{mac}/ota-version`、`POST /nodes/{mac}/ota-ack` 和 `GET /nodes/{mac}/ota-bundle/{sha}` 配合升级。
- 管理后台页面：节点、节点状态、网关、OTA。

代码里没有 `drain` 状态，也没有节点标签表。

---

## 三、线路、分组与订阅

面向用户的交付单位已经是线路和套餐，不再是「把节点清单公开出去」。

| 对象 | 作用 |
|------|------|
| `lines` / `line_nodes` | 线路：名称、区域、排序、启用、备注，以及绑定的节点。公开 token 可重置。 |
| `plans` / `plan_lines` | 套餐：流量、速率、设备数、天数、价格、启用、排序，以及可访问线路。 |
| `subscription_groups` | 仍保留的节点分组，导出时同样要带客户订阅 token。 |
| `customer_subscriptions` | 客户订阅实例：独立 token、独立 Xray UUID、流量、设备数、起止时间和状态。 |

导出格式只有 Clash/Mihomo YAML 和 VLESS 链接。

- 管理员全量：`GET /subscription`、`GET /subscription/clash`（`subscription:read`）。
- 客户订阅：`GET /c/{token}`、`GET /c/{token}/vless` 是出海；`GET /c/{token}/domestic`、`GET /c/{token}/domestic/vless` 是回国。两份配置不能合成一份。
- 线路：`GET /l/{token}`、`GET /l/{token}/vless`。分组：`GET /s/{token}`。查询参数 `subscription` 必须是 64 位客户订阅 token，否则 401。`direction` 省略时按出海；只有 `overseas` 和 `domestic` 合法。结果是线路或分组、套餐和已启用出口的交集，并使用客户 UUID。
- 已认领设备的主人有一份免费订阅：`GET /d/{token}`、`GET /d/{token}/vless`，只含这一台设备。门户通过 `GET /portal/devices/{mac}/subscription-access` 取 token。

重置客户订阅 token 会同时轮换 UUID。过期、停用或超额时，导出会退成无节点的直连配置，避免继续下发节点凭据。设备数限制在出口按在线源 IP 执行。细节、升级步骤和信任边界都在 [subscription-enforcement.md](../subscription-enforcement.md)。

没有单独的 `inbounds` 表，也没有 sing-box、Shadowrocket、Surge、Hiddify 模板。

---

## 四、客户、订单与门户

### 管理端

客户、套餐、订阅、订单、优惠码、工单、公告都有接口和页面。

- 客户：列表、创建、详情、修改、删除、重置密码、封禁与解封。
- 订阅：开通、修改、删除、重置 token、重置流量，以及 `activate` / `suspend` / `expire`。
- 订单：`GET /admin/orders`、`PATCH /admin/orders/{id}/status`。把状态改成 `paid` 会续期同一套餐的已有订阅，没有则创建。
- 优惠码：折扣比例或金额、次数、有效期、启用。
- 邀请返利：`GET /admin/referrals`、`PATCH /admin/referrals/{id}`。
- 流量汇总：`GET /admin/traffic/summary`，以及按客户查看流量。

客户下单走 `POST /portal/orders`，可以带 `use_balance` 用余额抵扣。没有支付宝、微信或 Stripe 一类支付回调；未付清的订单由管理员改状态。

### 客户门户

门户与管理员后台分开，导航也是另一套。

- 公开：`POST /portal/register`、`POST /portal/login`、`POST /portal/logout`、`GET /portal/plans`、`GET /portal/announcements`、忘记密码与重置密码。管理员登录、客户门户登录和重置密码按 IP 共用每分钟 5 次；忘记密码另计，每分钟 3 次。
- 登录后：资料、订阅、下单与订单、工单、邀请返利。
- 我的设备：认领、解绑、出口开关、网关、绑定或解绑订阅、命令、服务快照、地址、仪表盘。地址接口只返回 LAN 和出口地址，不返回 Tailscale、EasyTier、mesh、FRP 或节点凭据。

门户页面：首页、套餐、设备、订单、工单、邀请、公告、账号。

---

## 五、权限、审计与运维出口

管理员登录、登出、当前用户、用户、角色、权限、审计日志都在。管理员登录限流与设备 enroll、客户忘记密码是分开的。

- 客户登录失败会写审计，并有 `GET /admin/risk-events`（`customer:read`）。管理后台侧边栏没有风控事件页。
- 订阅请求有 Prometheus 计数。代码里没有按 token 保存的访问日志表。
- `GET /prometheus-targets`、`GET /labels`、`GET /health`、`GET /metrics` 仍在。
- `GET /admin/ssh-config` 只返回生成 SSH 命令用的 FRP 服务器地址，不含 token。

---

## 六、还没做、以及不必再单独立项的部分

旧草案里的这些对象已经用现有表落地，不必再平行做一套：

- 心跳快照在 `node_status_checks`，服务和地址在节点行上，没有独立心跳历史表
- 线路是 `lines` / `line_nodes`，套餐授权是 `plan_lines`
- 终端用户是 `customers`，订阅令牌在 `customer_subscriptions`
- 公告、工单、优惠码、邀请返利、客户门户都已有页面

仍然没有、后续要做才需要新设计的：

1. 节点排水和标签。
2. 独立入口对象，以及按客户端区分的订阅模板。
3. 第三方支付回调。当前闭环是余额抵扣加上管理员确认付款。
4. 心跳上报版本、ASN、带宽，或真正的拨测延迟。
5. 风控事件的管理页，以及按 token 的订阅访问日志。
