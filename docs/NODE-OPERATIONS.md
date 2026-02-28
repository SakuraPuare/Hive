# 节点日常运维指南

本文档覆盖 Hive Node 上线后的日常管理操作，包括 SSH 接入、服务管理、批量操作和监控。

---

## 一、SSH 接入方式

每台节点有三套管理通道，按优先级排序：

| 方式 | 命令 | 可用条件 |
|------|------|----------|
| **Tailscale**（推荐）| `ssh root@hive-<mac6>` | Tailscale 网络正常 |
| **EasyTier** | `ssh root@10.x.x.x` | EasyTier mesh 正常 |
| **FRP**（应急） | `ssh -p <frp_port> root@<vps-ip>` | FRP VPS 可达 |

### 获取节点连接信息

**方式一**：SSH 登录后查看 MOTD

```
 Connection Info:
 Tailscale        : ssh root@hive-a4b2c1
 EasyTier         : ssh root@10.164.178.193
 FRP              : ssh -p 23456 root@vps.example.com
 CF Proxy         : https://hive-a4b2c1.example.com
```

**方式二**：Node Registry

```bash
curl https://registry.example.com/api/nodes | jq '.[] | {hostname, tailscale_ip, frp_port}'
```

**方式三**：直接读取节点信息文件

```bash
cat /etc/hive/node-info
```

### Tailscale SSH

```bash
# 列出所有 hive 节点
tailscale status | grep hive-

# SSH 到特定节点（MagicDNS 自动解析）
ssh root@hive-a4b2c1

# 配置 SSH 免密（在管理机上执行）
ssh-copy-id root@hive-a4b2c1
```

### EasyTier SSH

```bash
# 查看 EasyTier 节点列表（在任意已接入节点上执行）
easytier-core --version

# SSH 到 EasyTier IP（从 /etc/hive/node-info 获取）
ssh root@10.164.178.193
```

### FRP SSH（应急）

```bash
# 从 Node Registry 获取 FRP 端口
curl https://registry.example.com/api/nodes | \
    jq -r '.[] | select(.hostname=="hive-a4b2c1") | "ssh -p \(.frp_port) root@<vps>"'

# SSH 连接
ssh -p 23456 root@vps.example.com
```

---

## 二、服务管理

### 服务状态概览

登录后 MOTD 会自动显示所有服务状态。也可手动查看：

```bash
# 所有 hive 相关服务
systemctl status nginx xray cloudflared frpc easytier tailscaled \
    ufw fail2ban prometheus-node-exporter
```

### 一键自测

```bash
hive-test.sh
```

输出各服务的 PASS/FAIL/WARN 状态，包括 WebSocket 握手、CF Tunnel 可达性、FRP 连接、EasyTier mesh 等。

### 核心服务操作

```bash
# nginx（WebSocket 代理，xray 前端）
systemctl restart nginx
journalctl -u nginx -f --no-pager

# xray（代理）
systemctl restart xray
journalctl -u xray -f --no-pager

# cloudflared（CF Tunnel）
systemctl restart cloudflared
journalctl -u cloudflared -f --no-pager

# frpc（FRP 客户端）
systemctl restart frpc
journalctl -u frpc -f --no-pager

# easytier（P2P mesh）
systemctl restart easytier
journalctl -u easytier -f --no-pager

# Tailscale
systemctl restart tailscaled
tailscale status
```

### 查看 xray 代理日志

```bash
journalctl -u xray --since "1 hour ago" --no-pager
```

### CF Tunnel 状态

```bash
# Tunnel 连接状态
journalctl -u cloudflared --since "10 min ago" --no-pager

# 验证 Tunnel 可达
curl -I https://hive-a4b2c1.example.com
```

---

## 三、安全管理

### 防火墙

```bash
hive-firewall status          # 查看规则和状态
hive-firewall logs            # 查看被阻止的连接
hive-firewall allow-ssh <IP>  # 临时允许特定 IP SSH
hive-firewall deny-ssh <IP>   # 封锁特定 IP
hive-firewall reset           # 重置所有规则（危险！）
```

### fail2ban（入侵防护）

```bash
hive-fail2ban status          # 整体状态
hive-fail2ban jails           # 各监狱状态
hive-fail2ban banned          # 当前封禁 IP 列表
hive-fail2ban unban <IP>      # 解封 IP
hive-fail2ban logs            # 查看封禁日志
```

---

## 四、Tailscale 管理

```bash
# 查看连接状态
tailscale status

# 查看本机 Tailscale IP
tailscale ip -4

# 重新连接（auth key 过期时）
tailscale down
tailscale up --authkey=<new-key> --hostname=hive-a4b2c1
```

---

## 五、xray 配置管理

### 查看当前 UUID

```bash
grep -oP '"id":\s*"\K[^"]+' /etc/xray/config.json
# 或
cat /etc/hive/node-info | grep XRAY_UUID
```

### 生成 VLESS 链接

MOTD 登录时会自动显示 VLESS 链接，格式：

```
vless://<UUID>@<cf-domain>:443?type=ws&security=tls&path=%2Fray#hive-<mac6>
```

---

## 六、批量操作（Ansible）

在管理服务器上执行：

```bash
cd /opt/rk3528-hive/ansible

# 测试连通性
ansible all -m ping

# 查看所有节点 xray 状态
ansible all -m command -a "systemctl status xray --no-pager"

# 批量重启 xray
ansible all -m systemd -a "name=xray state=restarted"

# 批量推送新 xray 配置
ansible-playbook playbooks/update-xray.yml

# 批量查看节点版本
ansible all -m command -a "xray --version"

# 批量查看节点在线时长
ansible all -m command -a "uptime"
```

### 常用 playbook

```bash
# 检查所有服务状态
ansible-playbook playbooks/service-status.yml

# 批量重启所有服务
ansible-playbook playbooks/restart-services.yml

# Ping 测试
ansible-playbook playbooks/ping.yml
```

---

## 七、监控（Prometheus + Grafana）

### Prometheus 抓取

Prometheus 通过 Node Registry 动态发现节点，target 格式为 `hostname:9100`（依赖 Tailscale MagicDNS 解析）。

```bash
# 在管理服务器查看节点列表
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job, instance, health}'
```

### Grafana 仪表板

通过 Tailscale 访问管理服务器的 Grafana：

```
http://<管理服务器 Tailscale IP>:3000
```

常用面板：
- **Node Exporter Full**（Dashboard ID: 1860）— CPU、内存、网络、磁盘
- 自定义面板：节点在线率、CF Tunnel 状态

### 节点手动指标检查

```bash
# 在节点上直接查看 metrics
curl http://127.0.0.1:9100/metrics | grep -E "^node_(cpu|memory|network).*{" | head -20
```

### Prometheus targets 手动更新（管理服务器）

```bash
# 通过 Node Registry 接口刷新（无需 cron）
curl -sf -H "Authorization: Bearer <API_SECRET>" \
    http://127.0.0.1:8080/prometheus-targets \
    > /opt/rk3528-hive/management/prometheus/targets/nodes.json

# 通知 Prometheus 热重载
curl -sf -X POST http://127.0.0.1:4230/-/reload

# 通过 Tailscale API 动态发现（update-targets.sh 脚本）
/opt/rk3528-hive/management/scripts/update-targets.sh
```

---

## 八、日志管理

```bash
# 实时跟踪所有服务日志
journalctl -f --no-hostname

# 过去 1 小时的错误
journalctl -p err --since "1 hour ago" --no-pager

# 查看特定服务日志（带时间戳）
journalctl -u xray --since "2025-01-01" --no-pager

# provision 日志（全量）
cat /var/log/provision-node.log
```

---

## 九、系统维护

### 查看系统资源

```bash
# 内存使用
free -h

# 磁盘使用（SD 卡空间）
df -h /

# CPU/内存实时监控
htop

# 进程和资源
systemctl list-units --type=service --state=running
```

### 手动安全更新

```bash
# 检查可用更新
apt list --upgradable

# 应用安全更新
apt update && apt upgrade -y

# unattended-upgrades 日志
cat /var/log/unattended-upgrades/unattended-upgrades.log
```

### 系统审计日志

```bash
# auditd 审计 SSH 相关操作
ausearch -ts today -k sshd_config
ausearch -ts today -k authorized_keys

# 失败的登录尝试
ausearch -ts today --message USER_LOGIN --success no
```

---

## 十、节点下线/回收

```bash
# 在节点上执行
tailscale logout                    # 离开 tailnet
systemctl disable --now cloudflared # 停止 CF Tunnel

# 在 Cloudflare 删除 Tunnel（可选，provision 会自动重建）
# 在 CF Dashboard 或通过 API 删除 hive-<mac6> tunnel
```

---

## 十一、常用命令速查

```bash
# 节点身份
cat /etc/hive/node-info

# 所有管理通道状态
systemctl is-active xray cloudflared frpc easytier tailscaled

# Tailscale 状态
tailscale status --peers=false

# 防火墙规则
ufw status numbered

# fail2ban 封禁列表
fail2ban-client status sshd

# 最近 SSH 登录记录
journalctl _COMM=sshd --since "24 hours ago" | grep "Accepted\|Failed"
```
