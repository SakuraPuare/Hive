# 配置 Tailscale OAuth Client Secret

设备端使用 **OAuth Client Secret**（`TAILSCALE_OAUTH_SECRET`）自动加入 tailnet。
所有 100 台设备共用同一个 Secret，无需手动审批。

OAuth Client Secret 不过期（区别于 Auth Key 最多 90 天），适合长期批量部署。

---

## 创建 OAuth Client

1. 登录 [Tailscale Admin Console](https://login.tailscale.com/admin)
2. 进入 **Settings → OAuth clients**
3. 点击 **Generate OAuth client**
4. 配置如下：

| 选项 | 值 | 说明 |
|------|----|------|
| Scopes | `devices:write` + `devices:read` | 设备注册 + API 查询（Prometheus/Ansible 复用） |
| Tags | `tag:hive` | 设备自动带此 tag，用于 Ansible 分组 |

5. 点击 **Generate**，复制 Client Secret（以 `tskey-client-` 开头）

---

## 配置 ACL（访问控制）

在 Tailscale Admin Console → **Access Controls** 里添加以下策略：

```json
{
  "tagOwners": {
    "tag:hive": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:hive:22"]
    },
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:hive:9100"]
    }
  ]
}
```

这样只有你的账号能 SSH 到节点（端口 22）和抓取 Prometheus 指标（端口 9100），节点之间互相隔离。

---

## 填入 .env

```
TAILSCALE_OAUTH_SECRET=tskey-client-xxxxx
```

---

## 验证（设备上线后）

```bash
# 在管理服务器上查看所有已接入节点
tailscale status

# 测试 SSH（用 MagicDNS hostname）
ssh root@edge-a4b2c1
```
