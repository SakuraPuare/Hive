> 认证变更：共享 Registry 密钥已停用。设备需独立 MAC 凭证，管理自动化使用 `ADMIN_API_SECRET`；升级步骤见 [审查修复与迁移](review-remediation.md)。

# Node Registry API 规范

服务运行在管理 VPS，通过宿主机 **nginx** 暴露在 `/api/` 二级目录下。

- **外部访问**（经 nginx）：`https://yourdomain.com/api/nodes`
- **内部直连**（cron/监控，无前缀）：`http://127.0.0.1:8080/nodes`
- Go 路由不含 `/api/` 前缀；nginx `proxy_pass` 剥离该前缀后转发。
- `NODE_REGISTRY_URL` 填写到 `/api` 这一级，如 `https://yourdomain.com/api`。

---

## 认证

- 管理端节点管理/订阅等接口支持两种鉴权方式（cookie 优先，其次兼容 Bearer）：
  - **Cookie 会话**：先调用 `POST /api/admin/login` 登录后，浏览器自动携带 `HttpOnly` cookie（Cookie 名：`hive_admin_session`）；后续请求只要带 cookie 即可访问。
  - **Bearer 兼容**：`Authorization: Bearer <API_SECRET>`（同时兼容 `?token=`）。用于兼容旧部署或脚本调用。
  - `API_SECRET` 通过环境变量注入服务；留空则关闭认证（开发/内网环境保持放行）。

`POST /api/admin/login`、`POST /api/admin/logout` 本身不需要额外鉴权。

---

## 接口列表

下表路径为**外部路径**（经 nginx，含 `/api` 前缀）。内部直连时去掉 `/api` 前缀。

| 方法 | 外部路径（nginx） | 认证 | 说明 |
|------|------|------|------|
| POST | /api/admin/login | 无 | 管理端登录（设置 `hive_admin_session` cookie） |
| POST | /api/admin/logout | 无 | 退出登录（清除 cookie） |
| POST | /api/nodes/enroll | 无（按 IP 限流 20/min） | 首启入网：登记已持久化的随机 token；同 token 可重试 |
| POST | /api/nodes/register | Cookie 或 Bearer | 节点注册（幂等） |
| GET | /api/nodes | Cookie 或 Bearer | 列出所有节点 |
| GET | /api/nodes/{mac} | Cookie 或 Bearer | 单节点详情 |
| PATCH | /api/nodes/{mac} | Cookie 或 Bearer | 更新 location/note/tailscale_ip/gateway_*/exit_*（含 `exit_direction`） |
| DELETE | /api/nodes/{mac} | Cookie 或 Bearer | 删除节点 |
| GET | /api/subscription | Cookie / Bearer / `?token=` | 节点订阅（Base64）；`?direction=domestic` 导出回国方向；`?token=<分组 token>` 导出该分组 |
| GET | /api/subscription/clash | Cookie / Bearer / `?token=` | Clash/Mihomo YAML 订阅；`?direction=domestic` 导出回国方向；`?token=<分组 token>` 导出该分组 |
| GET | /api/s/{token} | 客户订阅 token / 分组 token | 订阅分组 Clash 配置：`?subscription=<客户Token>` 按客户额度与套餐过滤；`?token=<ADMIN_API_SECRET\|API_SECRET\|该分组 token>` 管理员导出整组（节点 UUID，不计额度）；`?direction=domestic` 导出回国方向 |
| GET | /api/prometheus-targets | Cookie 或 Bearer | Prometheus file_sd JSON |
| GET | /api/labels | Cookie 或 Bearer | 可打印标签 HTML |
| GET | /api/portal/devices/{mac}/dashboard | 客户会话 | 网关节点 Mihomo 面板地址 + per-node secret |
| GET | /api/portal/devices/{mac}/mihomo/{version\|connections} | 客户会话 | 只读代理节点 9090（门户内实时流量） |
| GET | /api/portal/devices/{mac}/subscription-access | 客户会话 | 取得自有设备免费订阅 token（无套餐也可用，仅主人） |
| GET | /api/d/{token} | 私有免费 token | 单台自有设备 Clash/Mihomo 配置，按出口方向分流，不扣套餐额度 |
| GET | /api/d/{token}/vless | 私有免费 token | 单台自有设备 Base64 VLESS 订阅；解绑或转移后旧 token 失效 |
| GET | /api/health | Cookie 或 Bearer | 健康检查 |
| GET | /api/ | Cookie 或 Bearer | 控制台 Dashboard |

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

## POST /api/nodes/register

节点首次启动时由 `provision-node.sh` 调用。支持重复调用（幂等）：
- `location`、`note`、`registered_at` 在重新注册时**不会**被覆盖
- 其他字段每次注册都会更新

### 请求体

```json
{
  "mac":          "aabbccddeeff",
  "mac6":         "ccddeeff",
  "hostname":     "hive-ccddeeff",
  "cf_url":       "https://hive-ccddeeff.example.com",
  "tunnel_id":    "550e8400-e29b-41d4-a716-446655440000",
  "tailscale_ip": "100.64.0.1",
  "easytier_ip":  "10.204.178.193",
  "frp_port":     23456,
  "xray_uuid":    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mac` | string | ✅ | MAC 地址，12 位小写十六进制，**无冒号**（如 `aabbccddeeff`） |
| `mac6` | string | ✅ | MAC 末 6 位（如 `ccddeeff`），设备短 ID |
| `hostname` | string | ✅ | 主机名，格式 `hive-<mac6>` |
| `cf_url` | string | ✅ | CF Tunnel 完整访问 URL，**含 `https://`**（如 `https://hive-ccddeeff.example.com`） |
| `tunnel_id` | string | — | Cloudflare Tunnel UUID，用于运维查询；未创建时传空字符串 |
| `tailscale_ip` | string | — | Tailscale IPv4；尚未接入时传 `"pending"` 或省略 |
| `easytier_ip` | string | — | EasyTier mesh IP（`10.x.x.x`）；未配置时省略或传空字符串 |
| `frp_port` | integer | — | FRP SSH 远程端口（10000–60000）；未配置时传 `0` 或省略 |
| `xray_uuid` | string | ✅ | VLESS UUID，标准 UUID v4 格式 |

### 响应

```json
{
  "status":        "ok",
  "hostname":      "hive-ccddeeff",
  "registered_at": "2026-02-28 12:00:00"
}
```

### 错误响应

```json
{ "error": "required: mac, hostname, xray_uuid" }
```

HTTP 状态码：
- `200` 成功
- `400` 参数缺失或 JSON 格式错误
- `500` 数据库错误

### provision-node.sh 调用示例

```bash
# NODE_REGISTRY_URL 已含 /api，如 https://yourdomain.com/api
curl -sf -X POST "${NODE_REGISTRY_URL}/nodes/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}" \
    -d "{
      \"mac\":          \"${MAC}\",
      \"mac6\":         \"${MAC6}\",
      \"hostname\":     \"${HOSTNAME}\",
      \"cf_url\":       \"https://${FULL_DOMAIN}\",
      \"tunnel_id\":    \"${TUNNEL_ID}\",
      \"tailscale_ip\": \"${TAILSCALE_IP}\",
      \"easytier_ip\":  \"${EASYTIER_IP}\",
      \"frp_port\":     ${FRP_PORT},
      \"xray_uuid\":    \"${UUID}\"
    }" || echo "Registry unavailable (non-fatal)"
```

---

## GET /api/nodes

返回所有已注册节点列表，按注册时间升序。

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
    "easytier_ip":  "10.204.178.193",
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

更新管理员字段（需 Cookie 会话或 Bearer 鉴权）。

### 请求体

所有字段均为可选，只传需要更新的字段：

```json
{
  "location":    "JP-Tokyo",
  "note":        "机柜 B-03",
  "tailscale_ip": "100.64.0.2"
}
```

| 字段 | 说明 |
|------|------|
| `location` | 地理位置标注，用于订阅显示名称 |
| `note` | 管理员备注 |
| `tailscale_ip` | 手动更新 Tailscale IP（通常节点会自动上报） |

### 响应

```json
{ "status": "ok" }
```

---

## DELETE /api/nodes/{mac}

删除节点记录（需 Cookie 会话或 Bearer 鉴权）。节点下次重启后会重新注册。

---

## GET /api/subscription

返回 Base64 编码的节点订阅内容，每行一个节点配置。

包含节点的域名、UUID、WebSocket 路径等连接参数，兼容主流客户端导入格式。

---

## GET /api/subscription/clash

返回 Clash/Mihomo 兼容的 YAML 订阅文件。

**示例输出片段**：
```yaml
proxies:
  - name: "JP-Tokyo"
    type: vless
    server: hive-ccddeeff.example.com
    port: 443
    uuid: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    network: ws
    tls: true
    servername: hive-ccddeeff.example.com
    ws-opts:
      path: /ray
      headers:
        Host: hive-ccddeeff.example.com

proxy-groups:
  - name: HIVE-AUTO
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    proxies: [...]
  - name: HIVE-SELECT
    type: select
    proxies: [HIVE-AUTO, ...]
```

---

## GET /api/prometheus-targets

Prometheus `file_sd_configs` 格式，供 cron 每分钟更新：

```bash
# 直连 Go 服务（无 /api 前缀），cron 在本机运行
curl -sf -H "Authorization: Bearer <API_SECRET>" \
    http://127.0.0.1:8080/prometheus-targets \
    > /opt/hive/management/prometheus/targets/nodes.json
```

**响应**（只包含 tailscale_ip 不为 pending 的节点，target 使用 hostname 而非 IP）：

```json
[
  {
    "targets": ["hive-ccddeeff:9100"],
    "labels": {
      "instance": "hive-ccddeeff",
      "cf_url":   "https://hive-ccddeeff.example.com",
      "location": "JP-Tokyo",
      "mac6":     "ccddeeff"
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
nodes 表（MySQL 9 InnoDB，utf8mb4）

mac           VARCHAR(12)  PK    -- 12位小写无冒号 MAC
mac6          VARCHAR(6)         -- MAC 末6位（设备短 ID）
hostname      VARCHAR(64)        -- hive-<mac6>
cf_url        VARCHAR(256)       -- https://hive-<mac6>.domain.com
tunnel_id     VARCHAR(64)        -- CF Tunnel UUID
tailscale_ip  VARCHAR(40)        -- Tailscale IP，'pending'=未接入
easytier_ip   VARCHAR(40)        -- EasyTier IP（10.x.x.x）
frp_port      SMALLINT UNSIGNED  -- FRP SSH 端口（10000-60000）
xray_uuid     CHAR(36)           -- VLESS UUID（UUID v4 格式）
location      VARCHAR(128)       -- 管理员标注，不随重注册覆盖
note          VARCHAR(256)       -- 管理员备注，不随重注册覆盖
registered_at DATETIME           -- 首次注册时间，不随重注册覆盖
last_seen     DATETIME           -- 最后一次注册/更新时间
```
