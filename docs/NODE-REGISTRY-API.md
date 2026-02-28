# Node Registry API 规范

服务运行在管理 VPS，通过宿主机 **nginx** 暴露在 `/api/` 二级目录下。

- **外部访问**（经 nginx）：`https://yourdomain.com/api/nodes`
- **内部直连**（cron/监控，无前缀）：`http://127.0.0.1:8080/nodes`
- Go 路由不含 `/api/` 前缀；nginx `proxy_pass` 剥离该前缀后转发。
- `NODE_REGISTRY_URL` 填写到 `/api` 这一级，如 `https://yourdomain.com/api`。

---

## 认证

- **所有接口**均需携带请求头 `Authorization: Bearer <API_SECRET>`
  - `API_SECRET` 通过环境变量注入服务，留空则关闭认证（开发/内网环境）

---

## 接口列表

下表路径为**外部路径**（经 nginx，含 `/api` 前缀）。内部直连时去掉 `/api` 前缀。

| 方法 | 外部路径（nginx） | 认证 | 说明 |
|------|------|------|------|
| POST | /api/nodes/register | Bearer | 节点注册（幂等） |
| GET | /api/nodes | Bearer | 列出所有节点 |
| GET | /api/nodes/{mac} | Bearer | 单节点详情 |
| PATCH | /api/nodes/{mac} | Bearer | 更新 location/note/tailscale_ip |
| DELETE | /api/nodes/{mac} | Bearer | 删除节点 |
| GET | /api/subscription | Bearer | VLESS+ws 订阅（Base64） |
| GET | /api/subscription/clash | Bearer | Clash/Mihomo YAML 订阅 |
| GET | /api/prometheus-targets | Bearer | Prometheus file_sd JSON |
| GET | /api/labels | Bearer | 可打印标签 HTML |
| GET | /api/health | Bearer | 健康检查 |
| GET | /api/ | Bearer | 控制台 Dashboard |

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

更新管理员字段（需 Authorization 头）。

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

删除节点记录（需 Authorization 头）。节点下次重启后会重新注册。

---

## GET /api/subscription

返回 Base64 编码的 VLESS+ws 订阅内容，每行一个链接。

**链接格式**：
```
vless://{xray_uuid}@{cf_domain}:443?type=ws&security=tls&sni={cf_domain}&path=%2Fray#{location_or_hostname}
```

兼容：v2rayN、NekoBox、Hiddify、v2rayNG 等主流客户端。

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
    > /opt/rk3528-hive/management/prometheus/targets/nodes.json
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
