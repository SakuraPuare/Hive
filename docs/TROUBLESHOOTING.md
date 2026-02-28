# 故障排查指南

本文档覆盖 Hive Node 常见故障的诊断和修复方法。

---

## 一、Provision 故障

### 1.1 Provision 卡住或超时

**症状**：`journalctl -u provision-node.service` 显示等待网络，长时间无进展。

**诊断**：

```bash
# 查看 provision 日志
journalctl -u provision-node.service -f

# 检查网络连通性
ip route show
ip route get 8.8.8.8
ping -c 4 8.8.8.8

# 检查 DNS
nslookup api.cloudflare.com
```

**常见原因**：
- 网线未插好 / DHCP 未分配 IP
- 路由器 DNS 异常

**修复**：

```bash
# 手动获取 DHCP
dhclient eth0

# 手动 DNS 测试
curl -sf "https://api.cloudflare.com/client/v4/user" \
    -H "Authorization: Bearer <CF_TOKEN>" | jq .success
```

---

### 1.2 Provision 失败（`set -e` 导致提前退出）

**症状**：provision 日志在某一行后无输出，服务状态为 `failed`。

**诊断**：

```bash
# 查看退出状态
journalctl -u provision-node.service | grep -E "exit|failed"

# 详细追踪（bash -x）
bash -x /usr/local/bin/provision-node.sh 2>&1 | tee /tmp/provision-debug.log

# 查看 provision 日志
cat /var/log/provision-node.log
```

**常见原因**：
- CF API Token 无效或权限不足
- Tailscale OAuth 失败
- 依赖命令（`jq`、`python3`）缺失

---

### 1.3 SSH Host Key 权限错误

**症状**：SSH 服务无法启动，日志显示 `Permissions 0644 for '...ssh_host_ed25519_key' are too open`。

**诊断**：

```bash
ls -la /etc/ssh/ssh_host_*
journalctl -u ssh.service
```

**修复**：

```bash
chmod 600 /etc/ssh/ssh_host_*_key
systemctl restart ssh
```

**根本原因**：`cp -r` 不保留权限位，已在 `customize-image.sh` 中改为 `cp -a` 修复（重新构建镜像解决根因）。

---

### 1.4 CF Tunnel 创建失败

**症状**：provision 日志显示 `CF Tunnel creation failed` 或 `already_exists`。

**诊断**：

```bash
# 测试 CF API Token
curl -s -G "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/tunnels" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    --data-urlencode "is_deleted=false" | jq '.success, .errors'

# 查看 provision 日志中 CF 相关输出
grep -A 5 "CF Tunnel" /var/log/provision-node.log
```

**常见错误**：

| 错误 | 原因 | 修复 |
|------|------|------|
| `403 Forbidden` | Token 权限不足 | 确认 Token 有 `Cloudflare Tunnel:Edit` 权限 |
| `tunnel already exists` | 幂等处理已自动处理 | 检查 `/etc/cloudflared/cert.json` 是否存在 |
| `No tunnel secret` | cert.json 丢失 | 脚本会自动删除旧 tunnel 并重建 |

---

### 1.5 Tailscale 认证失败

**症状**：`tailscale up` 失败，日志显示 `401` 或 `requested tags [] are invalid`。

**诊断**：

```bash
# 检查 OAuth token 交换
TS_CLIENT_ID=$(echo "${TAILSCALE_OAUTH_SECRET}" | sed 's/tskey-client-\([^-]*\)-.*/\1/')
curl -sf -X POST "https://api.tailscale.com/api/v2/oauth/token" \
    -d "client_id=${TS_CLIENT_ID}" \
    -d "client_secret=${TAILSCALE_OAUTH_SECRET}" | jq .

# 查看 tailscale 状态
tailscale status
journalctl -u tailscaled -f
```

**常见错误**：

| 错误 | 原因 | 修复 |
|------|------|------|
| `401 Unauthorized` | OAuth Secret 错误 | 检查 `.env` 中 `TAILSCALE_OAUTH_SECRET` |
| `requested tags are invalid` | ACL 未配置 | 在 Tailscale Admin → Access Controls 添加 `tagOwners` |
| `403 Insufficient permissions` | OAuth Scope 不足 | 重新创建 OAuth Client，勾选 `devices:write` |

**修复 Tailscale ACL**（在 Tailscale Admin Console 的 Access Controls 中）：

```json
{
  "tagOwners": {
    "tag:hive": ["autogroup:admin"]
  }
}
```

---

## 二、SSH 访问故障

### 2.1 无法通过 Tailscale SSH

**诊断**：

```bash
# 在管理机上
tailscale status | grep hive-

# 测试连通性
tailscale ping hive-a4b2c1
```

**常见原因**：
- 节点未完成 provision（Tailscale 还未 up）
- ACL 限制（检查 Tailscale Access Controls）
- 节点 Tailscale 服务未运行

**在节点上检查**：

```bash
tailscale status
systemctl status tailscaled
```

---

### 2.2 SSH 被 fail2ban 封禁

**症状**：SSH 连接超时或 `Connection refused`，但节点本身在线（Tailscale/EasyTier 可达）。

**诊断**：

```bash
# 查看封禁列表
fail2ban-client status sshd
hive-fail2ban banned
```

**修复**：

```bash
# 解封特定 IP
hive-fail2ban unban <IP>

# 临时禁用 fail2ban（只在紧急情况）
systemctl stop fail2ban
```

---

### 2.3 SSH Host Key Changed 警告

**症状**：`WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED`。

**原因**：
- 正常：设备重刷镜像后，SSH host key 重新生成（但 Ed25519 key 应该不变）
- 异常：可能是中间人攻击（MitM）

**处理**：

```bash
# 如果确认是自己的设备，更新 known_hosts
ssh-keygen -R hive-a4b2c1
ssh-keygen -R 100.x.x.x
```

---

## 三、代理服务故障

### 3.1 CF Tunnel 不可达

**症状**：`https://hive-a4b2c1.example.com` 返回 502 或无法访问。

**诊断**：

```bash
# 检查 cloudflared 状态
systemctl status cloudflared
journalctl -u cloudflared --since "10 min ago"

# 检查 nginx 是否在监听（CF Tunnel 的后端）
ss -tlnp | grep 10077

# 检查 xray 是否在监听（nginx 的后端）
ss -tlnp | grep 10079

# 本地 WebSocket 握手测试（期望 101）
curl -s -o /dev/null -w "%{http_code}" \
    -H "Upgrade: websocket" -H "Connection: Upgrade" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    http://127.0.0.1:10077/ray
```

**常见原因**：
- nginx 未启动 → `systemctl start nginx`
- xray 未启动 → `systemctl start xray`
- cloudflared 未连接 CF 网络 → 检查 cert.json 是否存在
- cert.json 损坏 → 删除后重新 provision

```bash
# 检查 cert.json
cat /etc/cloudflared/cert.json | jq .
cat /etc/cloudflared/config.yml
```

---

### 3.2 xray 服务崩溃

**诊断**：

```bash
systemctl status xray
journalctl -u xray -n 50 --no-pager

# 检查配置文件是否有效
/usr/local/bin/xray --config /etc/xray/config.json --test
```

**常见原因**：
- 配置文件中 `%%XRAY_UUID%%` 占位符未替换（provision 未执行）
- 内存不足（节点 RAM < 512MB）

```bash
# 检查 UUID 是否已替换
grep '%%XRAY_UUID%%' /etc/xray/config.json && echo "UUID 未替换！"
```

---

## 四、防火墙故障

### 4.1 hive-firewall.service 启动失败

**症状**：`systemctl status hive-firewall` 显示 failed。

**诊断**：

```bash
journalctl -u hive-firewall.service -n 30
bash -x /usr/local/bin/setup-firewall.sh 2>&1 | head -50
```

**已知问题**：`ufw allow in proto icmp` 语法不被 ufw 支持（返回 `ERROR: Need 'to' or 'from' clause`）。
已在 `setup-firewall.sh` 中移除该行，ufw 默认 `before.rules` 已允许 ICMP echo。

**手动触发**：

```bash
/usr/local/bin/setup-firewall.sh
systemctl start hive-firewall
```

---

### 4.2 UFW 误封 SSH

**症状**：SSH 突然断开且无法重连。

**恢复**（需要物理控制台或其他管理通道）：

```bash
# 方式一：EasyTier（如果可用）
ssh root@10.x.x.x

# 方式二：FRP 应急
ssh -p <frp_port> root@<vps-ip>

# 临时禁用 UFW
ufw disable

# 或允许所有 SSH
ufw allow 22
```

---

## 五、fail2ban 故障

### 5.1 fail2ban 启动报错（filter 文件不存在）

**症状**：`journalctl -u fail2ban` 显示 `FileNotFoundError: [Errno 2] No such file or directory: '/etc/fail2ban/filter.d/systemd-login.conf'`。

**原因**：自定义 jail 配置引用了不存在的 filter。

**已修复**：`setup-fail2ban.sh` 已改为使用标准 filter（`pam-generic` 等）。若旧版系统仍有问题：

```bash
# 检查哪些 filter 缺失
fail2ban-client --test
journalctl -u fail2ban | grep "FileNotFoundError"

# 临时解决：禁用问题 jail
sed -i 's/^enabled = true/enabled = false/' /etc/fail2ban/jail.d/hive-services.conf
systemctl restart fail2ban
```

---

## 六、MOTD 故障

### 6.1 MOTD 不显示

**症状**：SSH 登录后无 MOTD 输出。

**诊断**：

```bash
# 检查脚本权限
ls -la /etc/update-motd.d/

# 手动运行
bash /etc/update-motd.d/42-hive-services
bash /etc/update-motd.d/41-commands
```

**修复**：

```bash
chmod +x /etc/update-motd.d/*
```

**根本原因**：镜像构建时 `cp -r` 不保留执行权限，已改为 `cp -a` + `chmod +x`。

---

### 6.2 MOTD 显示 `/usr/bin/tailscale` 等路径

**症状**：MOTD 中显示 `/usr/bin/tailscale`、`/usr/sbin/ufw` 等 `command -v` 的输出。

**原因**：`41-commands` 中的 `eval "${condition}" 2>/dev/null` 只重定向了 stderr，stdout 泄漏。

**修复**：将 `2>/dev/null` 改为 `&>/dev/null`（已修复）。

```bash
# 验证
grep '&>/dev/null' /etc/update-motd.d/41-commands
```

---

## 七、通用诊断命令

```bash
# 一键检查所有关键服务
for svc in nginx xray cloudflared frpc easytier tailscaled ufw fail2ban prometheus-node-exporter; do
    echo -n "$svc: "
    systemctl is-active "$svc" 2>/dev/null || echo "not found"
done

# 一键自测（输出 PASS/FAIL/WARN）
hive-test.sh

# 查看最近 1 小时的错误日志
journalctl -p err --since "1 hour ago" --no-pager

# 查看 provision 全量日志
cat /var/log/provision-node.log

# 网络接口状态
ip addr show
ip route show

# 确认节点信息
cat /etc/hive/node-info
hostname
```

---

## 八、调试模式

需要逐行追踪脚本执行时：

```bash
# 带调试输出执行 provision（不更改 DONE_MARKER，需先删除）
rm -f /etc/hive/provisioned
bash -x /usr/local/bin/provision-node.sh 2>&1 | tee /tmp/provision-trace.log

# 检查某个具体命令
bash -x /usr/local/bin/setup-firewall.sh 2>&1
bash -x /usr/local/bin/setup-fail2ban.sh 2>&1
```

---

## 九、联系和报告

如果以上方法无法解决问题，收集以下信息后报告：

```bash
# 生成诊断包
{
    echo "=== hostname ==="
    hostname
    echo "=== node-info ==="
    cat /etc/hive/node-info 2>/dev/null
    echo "=== service status ==="
    systemctl status xray cloudflared frpc easytier tailscaled --no-pager 2>&1
    echo "=== provision log (last 50) ==="
    tail -50 /var/log/provision-node.log 2>/dev/null
    echo "=== journal errors (1h) ==="
    journalctl -p err --since "1 hour ago" --no-pager 2>&1
} > /tmp/hive-diag-$(hostname).txt

cat /tmp/hive-diag-$(hostname).txt
```
