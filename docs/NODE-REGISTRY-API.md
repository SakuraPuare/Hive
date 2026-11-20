> 认证变更：共享 Registry 密钥已停用。设备需独立 MAC 凭证，管理自动化使用 `ADMIN_API_SECRET`；升级步骤见 [审查修复与迁移](review-remediation.md)。

# Node Registry API 规范

服务运行在管理 VPS，通过宿主机 **nginx** 暴露在 `/api/` 二级目录下。

- **外部访问**（经 nginx）：`https://yourdomain.com/api/nodes`
- **内部直连**（cron/监控，无前缀）：`http://127.0.0.1:8080/nodes`
- Go 路由不含 `/api/` 前缀；nginx `proxy_pass` 剥离该前缀后转发。
- `NODE_REGISTRY_URL` 填写到 `/api` 这一级，如 `https://yourdomain.com/api`。

---

## 认证

带权限的管理接口由 `RequirePerm` 准入：先核对自动化 Bearer，再核对会话 cookie。

- **自动化 Bearer**：`Authorization: Bearer <ADMIN_API_SECRET>`。仅当 `ADMIN_API_SECRET` 非空、且与 `API_SECRET` 不同时生效，可通过所有带权限的路由。
- **会话 Cookie**：`POST /api/admin/login` 成功后浏览器携带 HttpOnly cookie `hive_admin_session`。该用户还要拥有这条路由要求的权限，否则 403。
- **旧共享密钥 `API_SECRET`**：只在 `GET /subscription` 和 `GET /subscription/clash` 上仍然有效。这两条在没有 `Authorization: Bearer`（或 Bearer 为空）时也接受 `?token=`，值可以是 `ADMIN_API_SECRET` 或旧 `API_SECRET`。其它路由不认 `API_SECRET`，也不认 `?token=`。`API_SECRET` 留空不会关闭认证。
- **设备凭证**：`POST /nodes/register`、`POST /nodes/allocate-easytier` 走 `RequireDeviceAuth`，只认 `device_credentials` 里该 MAC 的 token（`Authorization: Bearer <device token>`）。共享密钥不能代替。`provision-node.sh` 从 `/etc/hive/device-token` 读出这个 token，放进变量 `NODE_REGISTRY_API_SECRET`。

`POST /api/admin/login`、`POST /api/admin/logout`、`GET /health`、`GET /` 不走上述权限中间件。

---

## 接口列表

下表路径为**外部路径**（经 nginx，含 `/api` 前缀）。内部直连时去掉 `/api` 前缀。

| 方法 | 外部路径（nginx） | 认证 | 说明 |
|------|------|------|------|
| POST | /api/admin/login | 无 | 管理端登录（设置 `hive_admin_session` cookie） |
| POST | /api/admin/logout | 无 | 退出登录（清除 cookie） |
| POST | /api/nodes/enroll | 无（按 IP 限流 20/min） | 首启入网：登记已持久化的随机 token；同 token 可重试 |
| POST | /api/nodes/allocate-easytier | 设备 Bearer | 按 MAC 幂等分配 EasyTier IP（`172.20.1.0`–`172.20.255.254`） |
| POST | /api/nodes/register | 设备 Bearer | 节点注册（幂等）；不接受共享密钥 |
| GET | /api/nodes | 会话 `node:read` 或 `ADMIN_API_SECRET` | 列出节点，按 hostname 排序；可用 `status`、`enabled`、`region`、`search` |
| GET | /api/nodes/{mac} | 会话 `node:read` 或 `ADMIN_API_SECRET` | 单节点详情 |
| PATCH | /api/nodes/{mac} | 会话 `node:write` 或 `ADMIN_API_SECRET` | 更新允许的管理员字段（见下文） |
| DELETE | /api/nodes/{mac} | 会话 `node:delete` 或 `ADMIN_API_SECRET` | 删除节点行及其 `device_credentials` |
| GET | /api/subscription | 自动化凭证，或会话 `subscription:read` 再加 `?subscription=` | Base64 VLESS；`?direction=domestic` 为回国，空或 `overseas` 为出海 |
| GET | /api/subscription/clash | 同上 | Clash/Mihomo YAML；方向参数相同。这两条导出路由也接受旧 `API_SECRET` 和 `?token=` |
| GET | /api/s/{token} | 客户订阅 token / 分组 token | 订阅分组 Clash 配置：`?subscription=<客户Token>` 按客户额度与套餐过滤；`?token=<ADMIN_API_SECRET\|API_SECRET\|该分组 token>` 导出整组（节点 UUID，不计额度）；`?direction=domestic` 导出回国方向 |
| GET | /api/prometheus-targets | 会话 `prometheus:read` 或 `ADMIN_API_SECRET` | Prometheus file_sd JSON |
| GET | /api/labels | 会话 `label:read` 或 `ADMIN_API_SECRET` | 可打印标签 HTML |
| GET | /api/portal/devices/{mac}/dashboard | 客户会话 | 网关节点 Mihomo 面板地址 + per-node secret |
| GET | /api/portal/devices/{mac}/mihomo/{version\|connections} | 客户会话 | 只读代理节点 9090（门户内实时流量） |
| GET | /api/portal/devices/{mac}/subscription-access | 客户会话 | 取得自有设备免费订阅 token（无套餐也可用，仅主人） |
| GET | /api/d/{token} | 私有免费 token | 单台自有设备 Clash/Mihomo 配置，按出口方向分流，不扣套餐额度 |
| GET | /api/d/{token}/vless | 私有免费 token | 单台自有设备 Base64 VLESS 订阅；解绑或转移后旧 token 失效 |
| GET | /api/health | 无 | 健康检查（含数据库探活） |
| GET | /api/ | 无 | 控制台 HTML（节点计数与链接） |

---

## POST /api/admin/login

管理端登录接口。登录成功后，服务端设置 `HttpOnly` cookie（Cookie 名：`hive_admin_session`），后续请求携带 cookie 即可访问管理 API。

### 请求体

```json
{
  "username": "admin",
  "password": "..."
}
```

### 响应

```json
{ "status": "ok" }
```

---
## POST /api/admin/logout

退出登录接口。清除 `hive_admin_session` cookie。

### 响应

```json
{ "status": "ok" }
```

---

## POST /api/nodes/enroll

设备第一次上电的引导入口。共享镜像不带任何凭证，`RequireDeviceAuth` 又只认
`device_credentials` 表里该 MAC 的 token，所以没有这个入口时新设备连发号/注册都做不到，
管理面板上也永远不会出现它。

请求必须包含 `mac` 和客户端生成的 `token`（64 位十六进制随机秘密）；`mac6`、`hostname` 可选。生产设备直接运行 `provision-node.sh`，它负责完整的持久化与恢复。以下展示入网前持久化和请求顺序，**重试必须复用原文件**：

```bash
(
  set -e
  umask 077
  mkdir -p /etc/hive
  if [ ! -e /etc/hive/enrollment-token ]; then
    pending=$(mktemp /etc/hive/enrollment-token.tmp.XXXXXX)
    trap 'rm -f "$pending"' EXIT
    openssl rand -hex 32 > "$pending"
    sync "$pending"
    mv -f "$pending" /etc/hive/enrollment-token
    sync /etc/hive
  fi
  token=$(cat /etc/hive/enrollment-token)
  [[ "$token" =~ ^[0-9a-fA-F]{64}$ ]]
  sync /etc/hive/enrollment-token
  sync /etc/hive
  curl -fsS -X POST "${NODE_REGISTRY_URL}/nodes/enroll" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg mac "$MAC" --arg token "$token" '{mac:$mac,token:$token}')"
)
# → {"mac":"<请求 MAC>","token":"<原请求 token>","claim_code":"K7QF-2M9X"}
```

- 首次登记立刻写入节点行（`registered_at`/`last_seen`），面板无需等待其他置备步骤完成。
- 服务端只存现有 `device_credentials.token_hash`，不会存明文秘密。相同 token 重试返回 200，即使原响应已丢失或设备随后被认领，也不修改凭证、归属或节点配置。
- 新认领码由域分隔的 MAC + token 哈希确定性生成，格式为 Crockford `XXXX-XXXX`。重试仅当推导码的哈希仍匹配原 `claim_code_hash` 才返回明文；已有历史认领码不覆盖、不恢复。
- migration 40 起，认领码明文同时写入 `nodes.claim_code`，管理员可在节点详情的「设备认领码」卡片查看（`GET /admin/nodes/{mac}/claim-code`，需 `node:write`）。认领校验仍只使用 `claim_code_hash`；迁移前入网的历史设备没有明文，只能从设备上读取或由管理员直接分配。
- `provision-node.sh` 校验 HTTP 200 和回显 token 后，先原子持久化 `claim-code`，最后原子持久化 `device-token`（每步都是 sync 文件 → rename → sync 目录）。`enrollment-token` 单独保存，不能提前当作已完成登记的 `device-token`；恢复后清除 `provision-blocked`。
- token 缺失或格式错误返回 400；已有凭证但 token 不同/已被管理员轮换，或旧节点没有凭证且已认领/带认领历史/是服务器，返回 409。合格的旧未认领、未发证节点可登记，但保留原认领码及注册元数据。
- MAC 本身不能恢复秘密。原 token 丢失须通过管理员轮换 `POST /api/admin/nodes/{mac}/credential`，旧 token 随即不能再入网。
- 公开接口仍按来源 IP 限流 20 次/分钟。`/etc/hive` 由 hive-data 持久化并受到 OTA 路径保护；不要把每台设备的秘密打进共享镜像。

> **已知取舍**：MAC 不是秘密（机壳/MOTD 上就有），所以理论上有人可以在真机首启前
> 抢先入网并认领该 MAC。后果是**真机上线被 409 阻塞、且不会真的被对方控制**；
> 管理员在面板把该节点的凭证轮换（`POST /api/admin/nodes/{mac}/credential`）并解除
> 归属即可恢复。硬件侧没有 TPM/证书，做到"抢占也拿不到设备"需要额外的出厂凭证，
> 不在本接口范围内。

---

## POST /api/nodes/allocate-easytier

`provision-node.sh` 在拉起 EasyTier 之前调用。按 MAC 从 `172.20.1.0`–`172.20.255.254` 发号；同一 MAC 再次请求返回原地址。`172.20.0.0/24` 留给基础设施，不参与自动分配。鉴权与注册相同，使用该 MAC 的设备 token。

```bash
curl -4 -sS -X POST "${NODE_REGISTRY_URL}/nodes/allocate-easytier" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}" \
    -d "{\"mac\":\"${MAC}\"}"
# → {"mac":"<请求 MAC>","easytier_ip":"172.20.x.x"}
```

`mac` 缺失或 JSON 非法返回 400；凭证不符返回 401 `{"error":"invalid device credential"}`；地址池耗尽返回 500。

---

## POST /api/nodes/register

节点首次启动时由 `provision-node.sh` 调用，请求头里的 Bearer 是 `/etc/hive/device-token`，不是 `API_SECRET`。重复调用时：

- `location`、`note`、`registered_at` 不覆盖
- 已有 `easytier_ip` 不改；为空时服务端再分配一次并回填
- `tailscale_ip` 只在请求里非空时更新
- 请求体里的 `easytier_ip` 不会被读取。EasyTier 地址以 `allocate-easytier` 和注册响应为准

### 请求体

```json
{
  "mac":            "aabbccddeeff",
  "mac6":           "ccddeeff",
  "hostname":       "hive-ccddeeff",
  "cf_url":         "https://hive-ccddeeff.example.com",
  "tunnel_id":      "550e8400-e29b-41d4-a716-446655440000",
  "tailscale_ip":   "100.64.0.1",
  "frp_port":       23456,
  "xray_uuid":      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  "mesh_tunnel_id": "",
  "mesh_ip":        ""
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mac` | string | ✅ | MAC 地址，12 位小写十六进制，**无冒号**（如 `aabbccddeeff`）；同时用来核对设备凭证 |
| `mac6` | string | — | MAC 末 6 位。接口不检查必填；`provision-node.sh` 会传 |
| `hostname` | string | ✅ | 非空即可。设备侧使用 `hive-<mac6>` |
| `cf_url` | string | ✅ | CF Tunnel 完整访问 URL，**含 `https://`** |
| `tunnel_id` | string | — | Cloudflare Tunnel UUID；未创建时传空字符串 |
| `tailscale_ip` | string | — | Tailscale IPv4。省略或空字符串时，新节点记为 `pending`，旧节点保留原值 |
| `frp_port` | integer | — | FRP SSH 远程端口。省略时按 `0` 写入 |
| `xray_uuid` | string | ✅ | VLESS UUID |
| `mesh_tunnel_id` | string | — | Cloudflare Mesh tunnel UUID |
| `mesh_ip` | string | — | Cloudflare Mesh 地址 |

### 响应

首次注册 `status` 为 `registered`，再次注册为 `updated`。`claim_code` 只在本次新铸认领码时出现；`easytier_ip` 在分配成功时出现。

```json
{
  "status":        "registered",
  "hostname":      "hive-ccddeeff",
  "registered_at": "2026-02-28 12:00:00",
  "claim_code":    "K7QF-2M9X",
  "easytier_ip":   "172.20.1.0"
}
```

### 错误响应

```json
{ "error": "mac, hostname, cf_url, xray_uuid required" }
```

HTTP 状态码：
- `200` 成功
- `400` 参数缺失或 JSON 格式错误
- `401` 设备凭证不符（`invalid device credential`）
- `500` 数据库错误

### provision-node.sh 调用示例

```bash
# NODE_REGISTRY_URL 已含 /api，如 https://yourdomain.com/api
# NODE_REGISTRY_API_SECRET 的值是 /etc/hive/device-token，不是共享 API_SECRET
curl -4 -sf --max-time 15 -X POST "${NODE_REGISTRY_URL}/nodes/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}" \
    -d "{
      \"mac\":            \"${MAC}\",
      \"mac6\":           \"${MAC6}\",
      \"hostname\":       \"${HOSTNAME}\",
      \"cf_url\":         \"https://${FULL_DOMAIN}\",
      \"tunnel_id\":      \"${TUNNEL_ID}\",
      \"tailscale_ip\":   \"${TAILSCALE_IP}\",
      \"frp_port\":       ${FRP_PORT},
      \"xray_uuid\":      \"${UUID}\",
      \"mesh_tunnel_id\": \"${MESH_TUNNEL_ID:-}\",
      \"mesh_ip\":        \"${MESH_IP:-}\"
    }"
```

脚本最多重试 6 次、间隔 5 秒；注册失败不会中止置备。请求里仍会带上 `easytier_ip`，服务端解码时忽略该字段。

---

## GET /api/nodes

返回节点列表，按 `hostname` 排序。可选查询参数：`status`、`enabled`（`0` 或 `1`）、`region`、`search`（匹配 hostname、location、note、mac）。响应是 `model.Node` 的 JSON，除下面的身份字段外，还包括出口、网关、归属和 `probe_status`。

### 响应

```json
[
  {
    "mac":          "aabbccddeeff",
    "mac6":         "ccddeeff",
    "hostname":     "hive-ccddeeff",
    "cf_url":       "https://hive-ccddeeff.example.com",
    "tunnel_id":    "550e8400-e29b-41d4-a716-446655440000",
    "tailscale_ip": "100.64.0.1",
    "easytier_ip":  "172.20.1.0",
    "frp_port":     23456,
    "xray_uuid":    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
    "location":     "JP-Tokyo",
    "note":         "机柜 B-03",
    "registered_at": "2026-02-28 12:00:00",
    "last_seen":    "2026-02-28 14:30:00"
  }
]
```

---

## GET /api/nodes/{mac}

查看单个节点，`{mac}` 为 12 位小写 MAC（无冒号）。

响应结构同上，HTTP 404 表示节点不存在。

---

## PATCH /api/nodes/{mac}

更新管理员字段。准入是带 `node:write` 的会话，或 `ADMIN_API_SECRET`。旧 `API_SECRET` 不能通过这条路由。

### 请求体

只传要改的字段。不在允许列表里的键会被丢掉；一个允许字段都没有时返回 400 `no valid fields to update`。

```json
{
  "location": "JP-Tokyo",
  "note": "机柜 B-03",
  "tailscale_ip": "100.64.0.2",
  "exit_direction": "overseas"
}
```

允许的字段：`location`、`note`、`tailscale_ip`、`easytier_ip`、`frp_port`、`enabled`、`status`、`weight`、`region`、`mesh_tunnel_id`、`mesh_ip`、`gateway_enabled`、`gateway_direction`、`gateway_upstream_mode`、`gateway_upstream_nodes`、`bound_subscription_id`、`exit_enabled`、`exit_direction`、`subscription_sync`、`country_override`。

校验：

- `exit_direction` 只能是 `overseas` 或 `domestic`
- `gateway_direction` 只能是 `auto`、`domestic`、`overseas`、`global` 或 `direct`
- `country_override` 是 ISO-3166 alpha-2，或空字符串（清空后跟随心跳上报的国家）

### 响应

```json
{ "status": "ok" }
```

---

## DELETE /api/nodes/{mac}

删除节点行，并删除 `device_credentials` 里该 MAC 的凭证。准入是带 `node:delete` 的会话，或 `ADMIN_API_SECRET`。节点不存在返回 404。设备上残留的旧 token 不能再注册；需要重新入网，或由管理员调用 `POST /api/admin/nodes/{mac}/credential` 另行签发。

---

## GET /api/subscription

返回 Base64 编码的 VLESS 订阅。

- 自动化请求（`ADMIN_API_SECRET`，或这两条路由上的旧 `API_SECRET` / `?token=`）导出全部节点，UUID 用节点自己的 `xray_uuid`。
- 会话请求必须再带 `?subscription=`，值为 64 位十六进制的客户订阅 token，否则 401。导出的是该订阅可见的节点，UUID 用订阅自己的身份。
- `direction` 省略或 `overseas` 为出海；`domestic` 为回国；其它值 400。

---

## GET /api/subscription/clash

返回 Clash/Mihomo YAML，准入和 `direction` 与上一条相同。模板在 `management/registry/internal/handler/clash.yaml.tmpl`。每个节点是一条 `type: vless`、`network: ws`、`port: 443` 的代理，WebSocket 路径为 `/` 加 `XRAY_PATH`（默认 `ray`）。出海方向的选择组是「境外」，url-test 组是「境外自动选择」；回国方向对应「回国」和「回国自动选择」。配置里没有 `HIVE-AUTO` / `HIVE-SELECT`。

`CF_PREFERRED_HOST` 非空时，代理的 `server` 写成该优选地址；`servername` 和 WebSocket `Host` 仍是节点自己的隧道域名。

```yaml
proxies:
  - name: "直连"
    type: direct
  - name: "<节点名>"
    type: vless
    server: hive-ccddeeff.example.com
    port: 443
    uuid: "<节点 UUID 或订阅 UUID>"
    network: ws
    tls: true
    servername: hive-ccddeeff.example.com
    ws-opts:
      path: /ray
      headers:
        Host: hive-ccddeeff.example.com
```

---

## GET /api/prometheus-targets

Prometheus `file_sd_configs` 格式，供 cron 每分钟更新：

```bash
# 直连 Go 服务（无 /api 前缀）。须为 ADMIN_API_SECRET，或带 prometheus:read 的会话。
# 旧 API_SECRET 与 ?token= 在这条路由上会 401。
curl -sf -H "Authorization: Bearer <ADMIN_API_SECRET>" \
    http://127.0.0.1:8080/prometheus-targets \
    > /opt/hive/management/prometheus/targets/nodes.json
```

只包含 `tailscale_ip` 不是 `pending` 也不是空串、且 `enabled = 1`、`status = active` 的节点。每个这样的节点至少有一条 Tailscale 目标（hostname 加 `:9100`）。`easytier_ip` 以 `172.20.` 开头时再加一条该 IP 的 `:9100` 目标。标签是 `hostname`、`cf_url`、`location`、`mac6`、`transport`（`tailscale` 或 `easytier`），没有 `instance`。

```json
[
  {
    "targets": ["hive-ccddeeff:9100"],
    "labels": {
      "hostname":  "hive-ccddeeff",
      "cf_url":    "https://hive-ccddeeff.example.com",
      "location":  "JP-Tokyo",
      "mac6":      "ccddeeff",
      "transport": "tailscale"
    }
  }
]
```

---

## GET /health

健康检查，包含数据库连通性验证。

```json
{ "status": "ok" }
```

DB 不可达时返回 HTTP 503：
```json
{ "error": "db unavailable: ..." }
```

---

## 数据模型参考

```
nodes 表（InnoDB，utf8mb4；K8s 侧数据库镜像为 mysql:8.4）

mac           VARCHAR(12)  PK    -- 12位小写无冒号 MAC
mac6          VARCHAR(6)         -- MAC 末6位（设备短 ID）
hostname      VARCHAR(64)        -- 设备侧为 hive-<mac6>
cf_url        VARCHAR(256)       -- https://hive-<mac6>.domain.com
tunnel_id     VARCHAR(64)        -- CF Tunnel UUID
tailscale_ip  VARCHAR(40)        -- Tailscale IP，'pending'=未接入
easytier_ip   VARCHAR(40)        -- EasyTier IP，自动池在 172.20.1.0–172.20.255.254
frp_port      SMALLINT UNSIGNED  -- FRP SSH 端口
xray_uuid     CHAR(36)           -- VLESS UUID
location      VARCHAR(128)       -- 管理员标注，不随重注册覆盖
note          VARCHAR(256)       -- 管理员备注，不随重注册覆盖
registered_at DATETIME           -- 首次注册时间，不随重注册覆盖
last_seen     DATETIME           -- 注册与心跳都会更新
```

后续迁移还增加了出口、网关、Mesh 和归属等列。接口实际返回的 JSON 以 `management/registry/internal/model/model.go` 里的 `Node` 为准，不限于上表。
