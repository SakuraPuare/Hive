# 配置 Tailscale OAuth Client Secret

设备端使用 **OAuth Client Secret**（`TAILSCALE_OAUTH_SECRET`）自动加入 tailnet。
同一镜像上的设备共用这一个 Secret。

首启时用它换一张 5 分钟、不可复用、已预授权且带 `tag:hive` 的 auth key，先删除 tailnet 里同 hostname 的旧设备，再执行 `tailscale up --timeout=30s --accept-dns=false`。换 key 失败时才退回直接使用 Secret，且这一步失败不中止首启。

OAuth Client Secret 不过期（区别于 Auth Key 最多 90 天），适合长期批量部署。

---

## 创建 OAuth Client

1. 登录 [Tailscale Admin Console](https://login.tailscale.com/admin)
2. 进入 **Settings → OAuth clients**
3. 点击 **Generate OAuth client**
4. 配置如下：

| 选项 | 值 | 说明 |
|------|----|------|
| Scopes | `devices:write` + `devices:read` | 签发 auth key、删除同名旧设备；`devices:read` 还供管理端 `update-targets.sh` 列出 `tag:hive` 生成 Prometheus 目标 |
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
    },
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:hive:9550"]
    }
  ]
}
```

这样只有 tailnet 管理员能 SSH 到节点（端口 22），以及抓取 Node Exporter（9100）和 Xray Exporter（9550，路径 `/scrape`）的指标，节点之间互相隔离。

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

# 测试 SSH（MagicDNS hostname 为 hive-<MAC 后 6 位>，例如 hive-a4b2c1）
ssh root@hive-a4b2c1
```
