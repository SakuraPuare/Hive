# 获取 Cloudflare 凭证

设备端 `.env` 需要四个 CF 相关的值：
`CF_API_TOKEN`、`CF_ACCOUNT_ID`、`CF_ZONE_ID`、`CF_DOMAIN`

---

## CF_ACCOUNT_ID

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 右上角点击你的账号头像 → **My Profile** 或点击任意域名
3. 右侧栏找到 **Account ID**，复制

---

## CF_ZONE_ID

1. 进入你的域名管理页（点击 `yourdomain.com`）
2. 右侧栏 **API** 部分找到 **Zone ID**，复制

---

## CF_API_TOKEN

设备需要能创建 Tunnel 和 DNS 记录，Token 需要以下权限：

1. 进入 **My Profile → API Tokens → Create Token**
2. 选 **Create Custom Token**
3. 填写以下权限：

| 资源类型 | 权限 |
|----------|------|
| Account → Cloudflare Tunnel | Edit |
| Zone → DNS | Edit |

4. Zone Resources 选 **Specific zone → 你的域名**
5. 点击 **Continue to summary → Create Token**
6. **立刻复制**，只显示一次

---

## CF_DOMAIN

填你的根域名，不带 `www` 和子域名前缀：

```
CF_DOMAIN=yourdomain.com
```

节点的实际 URL 会自动拼成 `edge-<mac6>.yourdomain.com`。

---

## 验证 Token 是否有效

```bash
curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
     -H "Authorization: Bearer YOUR_CF_API_TOKEN" \
     -H "Content-Type: application/json" | jq .
# 应看到 "status": "active"
```

---

## 填入 .env

```
CF_API_TOKEN=<从上面复制的 Token>
CF_ACCOUNT_ID=<你的 Account ID>
CF_ZONE_ID=<你的 Zone ID>
CF_DOMAIN=yourdomain.com
```
