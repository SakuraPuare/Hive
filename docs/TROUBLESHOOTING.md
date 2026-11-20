# 故障排查指南

本文档覆盖 Hive Node 常见故障的诊断和修复方法。

---

## 一、Provision 故障

### 1.1 Provision 卡住或超时

**症状**：`journalctl -u provision-node.service` 反复出现 `Waiting for network...`，或出现 `provision 超出时间预算`。开机时没有路由，单元会按 `RestartSec=60` 失败重试。

**诊断**：

```bash
journalctl -u provision-node.service -f

# 脚本用这条判断已经有默认路由（最多 30 次，每次 2 秒）
ip route get 8.8.8.8

# 身份网卡是有线口，优先 device-tree 的 ethernet0，忽略无线和隧道
source /usr/local/bin/hive-board
hive_identity_interface
nmcli device status

# 镜像未安装 nslookup。凭证在节点的 /etc/hive/config.env
getent hosts api.cloudflare.com
source /etc/hive/config.env
curl -sf --connect-timeout 10 --max-time 30 \
    "https://api.cloudflare.com/client/v4/user" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" | jq .success
```

**常见原因**：
- 网线未插好，或 NetworkManager 还没给身份网卡配地址
- 没有到 `8.8.8.8` 的路由
- 外部 API 过慢，累计达到 `PROVISION_BUDGET`（默认 600 秒）。日志为 `!!! provision 超出时间预算`。单元 `TimeoutStartSec=900`，正常会先看到脚本自己的预算日志

**修复**：

```bash
# <iface> 用上面 hive_identity_interface 的输出
nmcli device connect <iface>

# provisioned：成功结束；provisioning：正在跑；provision-blocked：入网 409
ls -l /etc/hive/provisioned /etc/hive/provisioning /etc/hive/provision-blocked
```

`/etc/hive/provision-blocked` 表示入网被拒绝（HTTP 409）。脚本此时 `exit 0`，systemd 不再重试。日志里的补发入口是 `POST <NODE_REGISTRY_URL>/admin/nodes/<MAC>/credential`。把补发的凭证写入 `/etc/hive/device-token` 后执行 `systemctl start provision-node.service`；脚本看到已有 `device-token` 会删掉这个标记。旧的 `enrollment-token` 在凭证已轮换后不能再入网。

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
- 找不到有线身份网卡：`No physical Ethernet interface found`
- 领取设备凭证失败，或 EasyTier 地址分配失败（日志 `!!! FATAL`，下次开机重试）
- 超出 `PROVISION_BUDGET`（默认 600 秒）
- Cloudflare、`tailscale up`、xray、热点、网关、防火墙、fail2ban 失败时脚本继续，单元不会因此变成 `failed`。Cloudflare 不可用会留下 `/etc/hive/cloudflare-unavailable`
- 缺少 `jq` 时，`set -e` 下的 `jq` 调用会让脚本退出

入网 409 的表现见 1.1：脚本写入 `/etc/hive/provision-blocked` 后正常退出。

---

### 1.3 SSH Host Key 缺失或权限错误

**症状**：SSH 无法启动。日志为 `Permissions 0644 for '...ssh_host_ed25519_key' are too open`，或 `no hostkeys available`。

镜像清洗会删掉 `/etc/ssh/ssh_host_*` 和 `/etc/hive/random-hostkeys-v1`。首启时 `hive-regen-hostkeys.service` 在 sshd 之前、以 `umask 077` 生成随机 Ed25519 host key。`provision-node.sh` 发现私钥为空时会再执行一次该脚本。

**诊断**：

```bash
ls -la /etc/ssh/ssh_host_* /etc/hive/random-hostkeys-v1
systemctl status hive-regen-hostkeys.service
journalctl -u ssh.service -u hive-regen-hostkeys.service
```

**修复**：

```bash
chmod 600 /etc/ssh/ssh_host_*_key
/usr/local/bin/hive-regen-hostkeys.sh
systemctl reset-failed ssh.service ssh.socket
systemctl restart ssh
```

---

### 1.4 CF Tunnel 创建失败

**症状**：provision 日志出现 `!!! CF Tunnel creation failed:`，或 `CF Tunnel 查询失败`。

**诊断**：

```bash
source /etc/hive/config.env
# 与 provision-node.sh 相同的列出 tunnel 请求
curl -s --connect-timeout 10 --max-time 30 -G \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/tunnels" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    --data-urlencode "is_deleted=false" | jq '.success, .errors'

# 查看 provision 日志中 CF 相关输出
grep -A 5 "CF Tunnel" /var/log/provision-node.log
```

创建失败时日志是 `!!! CF Tunnel creation failed:`。脚本随后跳过 DNS 和 cloudflared 配置，写入 `/etc/hive/cloudflare-unavailable`，并继续 Tailscale 与 EasyTier。

**常见日志**：

| 日志 | 含义 |
|------|------|
| `403 Forbidden` | `CF_API_TOKEN` 权限不足，需要 Account 的 Cloudflare Tunnel Edit，以及 Zone 的 DNS Edit |
| `Tunnel already exists: ... reusing with existing cert.json` | 同名 tunnel 且本地已有凭证，直接复用 |
| `Tunnel exists but no local cert.json, deleting to recreate` | 远端有 tunnel、本地没有凭证，删除后重建 |
| `!!! CF Tunnel creation failed:` | 本次不启用 cloudflared；查看 `/etc/hive/cloudflare-unavailable` |

---

### 1.5 Tailscale 认证失败

**症状**：`tailscale up` 失败，日志显示 `401` 或 `requested tags [] are invalid`。

**诊断**：

```bash
source /etc/hive/config.env
# 与 provision-node.sh 相同的 OAuth 交换
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
| `401 Unauthorized` | OAuth Secret 错误 | 检查节点 `/etc/hive/config.env` 的 `TAILSCALE_OAUTH_SECRET` |
| `requested tags are invalid` | ACL 未配置 | 在 Tailscale Admin → Access Controls 添加 `tagOwners` |
| `403 Insufficient permissions` | OAuth Scope 不足 | 重新创建 OAuth Client，勾选 `devices:write` |

`tailscale up` 使用 `--timeout=30s`。超时或 OAuth 换 key 失败时脚本继续，`tailscaled` 在后台重试。完整 ACL 见 [Tailscale OAuth](./management/04-tailscale-key.md)。最小 `tagOwners`：

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

**原因**：镜像构建会清掉 host key。首启由 `hive-regen-hostkeys.sh` 生成随机 Ed25519 key，`hive-data` 把 `/etc/ssh` 和 `/etc/hive` 绑在数据分区上。保留 `hive-data` 时，换槽或重刷系统盘不会改变 fingerprint；清掉数据分区才会重新生成。未清数据分区却发生变化时，先在设备上核对指纹（私钥丢失后 `hive-regen-hostkeys.sh` 也会换新 key）。

**处理**：

```bash
# 在节点上读取当前指纹，与带外渠道核对后再更新 known_hosts
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub

# 确认是自己的设备后
ssh-keygen -R hive-a4b2c1
ssh-keygen -R 100.x.x.x
```

---

## 三、转发服务故障

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
- xray 未启动 → `systemctl start xray`（它 `Requires=hive-xray-prepare.service`）
- 存在 `/etc/hive/cloudflare-unavailable`，或没有 `/etc/cloudflared/config.yml`：这次 provision 跳过了 cloudflared。删掉 `/etc/hive/provisioned` 后重跑会再申请一次
- 远端仍有同名 tunnel、本地 `cert.json` 损坏：先删掉 `cert.json`，再按上一步重跑。脚本在「远端有 tunnel、本地没有凭证」时会删除远端并重建

```bash
cat /etc/cloudflared/cert.json | jq .
cat /etc/cloudflared/config.yml
ls -l /etc/hive/cloudflare-unavailable
```

---

### 3.2 xray 服务崩溃

**诊断**：

```bash
systemctl status hive-xray-prepare.service xray.service
journalctl -u hive-xray-prepare -u xray -n 50 --no-pager

# 与 hive-xray-prepare 相同的检查方式
/usr/local/bin/xray run -test -config /etc/xray/config.json

# 进程用户是 xray；配置由 prepare 收成 root:xray、640
ls -l /etc/xray/config.json
runuser -u xray -- test -r /etc/xray/config.json && echo readable
```

**常见原因**：
- `hive-xray-prepare` 未成功：xray 单元 `Requires=` 它，prepare 失败时 xray 不会起来
- 配置不是 `root:xray`、模式 `640`，用户 `xray` 读不到
- 单元有 `MemoryHigh=200M`、`MemoryMax=300M`，超过上限会被 systemd 杀掉

当前模板的 VLESS `clients` 为空。`hive-xray-prepare` 会清空 clients；订阅用户由 `hive-xray-sync.timer` 写入。空 clients 本身不是配置损坏。

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
# 方式一：EasyTier（如果可用，地址在 172.20.0.0/16）
ssh root@172.20.x.x

# 方式二：FRP 应急
ssh -p <frp_port> root@<vps-ip>

# 临时关掉 UFW
ufw disable

# 按镜像策略给单个来源放行 22（私网与 100.64.0.0/10 已在 setup-firewall.sh 中放行）
hive-firewall allow-ssh <IP>
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

当前 `41-commands` 对条件判断使用 `&> /dev/null`，stdout 和 stderr 都重定向。旧镜像若仍只写了 `2>/dev/null`，`command -v` 的路径会漏到 MOTD。

```bash
grep -n '&> /dev/null' /etc/update-motd.d/41-commands
```

---

## 七、通用诊断命令

```bash
# 长期运行的单元。
# hive-hotspot.service 是 oneshot，成功结束后 inactive 是正常的。
# 没有 5G 热点时，hive-hotspot-5g 与 hive-hotspot-5g-dnsmasq 为 inactive 也正常。
for svc in nginx xray cloudflared frpc easytier tailscaled ufw fail2ban prometheus-node-exporter hive-mihomo hive-hotspot-5g hive-hotspot-5g-dnsmasq; do
    echo -n "$svc: "
    systemctl is-active "$svc" 2>/dev/null || echo "not found"
done

# 热点与透明代理的分项在 hive-test.sh 的 wifi-*、gateway-*；说明见 HOTSPOT.md、GATEWAY.md

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
# 已有 /etc/hive/provisioned 时脚本会立刻退出。
# 删掉标记后再跑；成功结束时脚本会重新写上该文件。
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
    echo "=== provision markers ==="
    ls -l /etc/hive/provisioned /etc/hive/provision-blocked /etc/hive/cloudflare-unavailable 2>&1
    echo "=== service status ==="
    systemctl status xray hive-xray-prepare cloudflared frpc easytier tailscaled hive-mihomo --no-pager 2>&1
    echo "=== provision log (last 50) ==="
    tail -50 /var/log/provision-node.log 2>/dev/null
    echo "=== journal errors (1h) ==="
    journalctl -p err --since "1 hour ago" --no-pager 2>&1
} > /tmp/hive-diag-$(hostname).txt

cat /tmp/hive-diag-$(hostname).txt
```
