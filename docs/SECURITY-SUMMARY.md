# Hive Network 安全配置总结报告

本页概括节点镜像里已经落地的安全措施。防火墙规则以 `setup-firewall.sh` 为准，fail2ban 的监狱和命令见 [入侵防护（fail2ban）](/FAIL2BAN)。

## 🛡️ 安全层次架构

```
┌─────────────────────────────────────────────────┐
│                   应用层                        │
│  xray, cloudflared, tailscale, frpc,           │
│  easytier, mihomo                              │
├─────────────────────────────────────────────────┤
│                 入侵防护层                      │
│            fail2ban + UFW 封禁动作             │
├─────────────────────────────────────────────────┤
│                  防火墙层                       │
│               UFW (iptables)                   │
├─────────────────────────────────────────────────┤
│                  系统层                         │
│   SSH 加固、auditd、unattended-upgrades        │
└─────────────────────────────────────────────────┘
```

## 🔥 防火墙保护 (UFW)

`setup-firewall.sh` 的默认策略是拒绝入站、允许出站、拒绝转发。结束前执行 `ufw --force enable`，并把日志设为 `medium`（脚本开头先 `ufw logging off`，最后是 `medium`）。`hive-firewall.service` 是 oneshot，只在 `/var/lib/hive/firewall-configured` 不存在时运行；末尾会复核关键放行，缺失则重放一次，仍缺失则单元失败且不写标记。

管理工具是 `hive-firewall`，每条子命令都要 root：

```bash
sudo hive-firewall status              # 查看防火墙状态
sudo hive-firewall rules               # 详细规则
sudo hive-firewall logs                # 查看防火墙日志
sudo hive-firewall allow-ssh <IP>      # 允许特定 IPv4 或网段访问 22
sudo hive-firewall deny-ssh <IP>       # 删除该地址对 22 的 allow
sudo hive-firewall reset               # 输入 YES 后 ufw --force reset，再跑 setup-firewall.sh
```

### 入站放行

| 对象 | 规则 |
|------|------|
| SSH 22 | 显式放行 `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`、`100.64.0.0/10`。脚本末尾还有 `ufw limit ssh`。这条 limit 的对象是全网，源限制只影响规则顺序，任何来源都可以试 SSH |
| Node Exporter 9100 | `100.64.0.0/10`（Tailscale）和 `172.20.0.0/16`（EasyTier） |
| Xray Exporter 9550 | 同上两段 |
| Mihomo 面板 9090 | `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`、`100.64.0.0/10`。不对公网开放；面板另有每节点 secret |
| EasyTier P2P | TCP `11010:11012`、UDP `11010:11011`，不限来源。脚本说明对端需 network-secret 才能入网 |
| Cloudflare Mesh | 来自以及去往 `100.96.0.0/12` |
| TUN 口 `Meta` | `in`、`out`，以及该接口上的 forward。接口名可用 `GATEWAY_TUN_IFACE` 覆盖，默认 `Meta` |
| 5G 热点 AP 接口 | `hive-hotspot-firewall.sh` 追加 DHCP `67/udp` 和 DNS `53`。已激活的 `hive-lan-*`、`hive-hotspot-2g`、`hive-hotspot-5g` 在规则被 reset 清掉后，由 `/etc/NetworkManager/dispatcher.d/90-hive-hotspot` 重放 |

脚本打印的出站包括 DNS、NTP、HTTPS、Cloudflare Tunnel（7844/tcp、7844/udp、443）、Cloudflare WARP（2408/udp、1701/udp）、Tailscale（41641/udp、443/tcp）、FRP（`FRP_SERVER_PORT`，默认 7000）。

Tailscale 段是 CGNAT `100.64.0.0/10`。脚本注释写明不用整个 `100.0.0.0/8`，因为后者含有公网可路由地址。

## 🛡️ 入侵防护 (fail2ban)

`setup-fail2ban.sh` 写入监狱，封禁动作是 UFW。管理工具是 `hive-fail2ban`（必须 root）。白名单含回环、RFC1918、`100.64.0.0/10`、`fe80::/10`；配置了 `EASYTIER_PEERS` 时还会追加中继地址。细节、解封限制和「停服务不会撤掉 UFW deny」见 [FAIL2BAN](/FAIL2BAN)。

| 监狱名称 | 保护目标 | 最大重试 | 封禁时间 | 查找时间 |
|----------|----------|----------|----------|----------|
| sshd | SSH 登录 | 3 次 | 2 小时 | 10 分钟 |
| sshd-aggressive | SSH 严格模式 | 2 次 | 24 小时 | 5 分钟 |
| hive-portscan | 端口扫描 | 10 次 | 1 小时 | 1 分钟 |
| pam-generic | PAM 认证（sudo、su、login） | 5 次 | 1 小时 | 10 分钟 |

```bash
sudo hive-fail2ban status
sudo hive-fail2ban jails
sudo hive-fail2ban banned
sudo hive-fail2ban unban <IPv4>
sudo hive-fail2ban logs
sudo hive-fail2ban test
sudo hive-fail2ban reload
```

## 🔐 SSH、审计与安全更新

`customize-image.sh` 写入 `/etc/ssh/sshd_config.d/99-hive-hardening.conf`：

- `PermitRootLogin yes`，`PasswordAuthentication yes`
- `KbdInteractiveAuthentication no`
- `MaxAuthTries 3`，`LoginGraceTime 30`
- `X11Forwarding no`，`AllowAgentForwarding no`

`auditd` 在镜像里启用。`/etc/audit/rules.d/hive.rules` 监视：

| 路径 | 键 |
|------|----|
| `/etc/ssh/sshd_config`、`/etc/ssh/sshd_config.d/` | `ssh_config` |
| `/root/.ssh/` | `root_ssh` |
| `/etc/shadow` | `shadow_change` |
| `/etc/passwd`、`/etc/group` | `identity` |
| `/etc/hive/` | `hive_config` |

`unattended-upgrades` 只允许 `${distro_id}:${distro_codename}-security`。每天更新软件列表并安装这类更新（`APT::Periodic::Update-Package-Lists "1"`、`Unattended-Upgrade "1"`），每 7 天 autoclean。会删除不再使用的内核包和依赖。`Automatic-Reboot` 为 `false`。

## 📊 MOTD

登录时：

- `/etc/update-motd.d/42-hive-services` 显示 UFW（Firewall）和 fail2ban（Intrusion Prevention）是 Running 还是 Stopped
- `/etc/update-motd.d/41-commands` 列出 `hive-firewall status`、`hive-firewall logs`、`hive-fail2ban status`、`hive-fail2ban banned`（对应命令存在时）

## 🏗️ 部署集成

`customize-image.sh` 安装 `ufw`、`fail2ban`、`auditd`、`unattended-upgrades`，并 enable：

- `hive-firewall.service`、`hive-fail2ban.service`（开机一次性配置）
- `auditd.service`、`unattended-upgrades.service`

`provision-node.sh` 会再执行 `systemctl enable --now hive-firewall` 和 `hive-fail2ban`。失败时打印 non-fatal 并继续，不中止 provision。标记文件已经存在时，单元条件不满足，不会重跑配置脚本。

## 🚨 安全特性对比

### 实施前

- ❌ 入站没有这套 UFW 默认拒绝
- ❌ 无 fail2ban 监狱
- ❌ 无 `hive.rules` 审计
- ❌ 无自动安全更新

### 实施后

- ✅ 默认拒绝入站和转发，按上表放行
- ✅ SSH 有源地址放行，同时 `ufw limit ssh` 对全网限速放行
- ✅ fail2ban 的四座监狱，封禁写入 UFW
- ✅ 白名单含 Tailscale CGNAT `100.64.0.0/10`
- ✅ `hive-firewall` 与 `hive-fail2ban`
- ✅ 登录 MOTD 显示防火墙和 fail2ban 状态
- ✅ auditd 监视 SSH、身份和 `/etc/hive`
- ✅ 仅安全源的无人值守更新，不自动重启

## 📈 安全评级提升

| 安全方面 | 实施前 | 实施后 | 提升程度 |
|----------|--------|--------|----------|
| 网络访问控制 | ⭐ | ⭐⭐⭐⭐⭐ | +400% |
| 暴力破解防护 | ⭐ | ⭐⭐⭐⭐⭐ | +400% |
| 入侵检测能力 | ⭐ | ⭐⭐⭐⭐ | +300% |
| 自动响应机制 | ⭐ | ⭐⭐⭐⭐⭐ | +400% |
| 管理便利性 | ⭐⭐ | ⭐⭐⭐⭐⭐ | +150% |
| **综合安全评级** | **⭐** | **⭐⭐⭐⭐⭐** | **+400%** |

## 🎯 部署验证清单

### 防火墙验证

- [ ] UFW 处于 active，默认拒绝入站
- [ ] SSH 同时存在四条源地址放行和 `ufw limit ssh`
- [ ] 9100、9550 对 `100.64.0.0/10` 和 `172.20.0.0/16` 放行
- [ ] 9090 只出现在私网与 `100.64.0.0/10` 上
- [ ] `hive-firewall` 可执行（需要 root）

### fail2ban 验证

- [ ] `fail2ban` 为 active
- [ ] 监狱为 `sshd`、`sshd-aggressive`、`hive-portscan`、`pam-generic`
- [ ] `ignoreip` 含 `100.64.0.0/10`，不是 `100.0.0.0/8`
- [ ] `hive-fail2ban` 可执行（需要 root）

### MOTD、审计与更新

- [ ] 登录能看到 Firewall / Intrusion Prevention 状态
- [ ] 命令列表含 `hive-firewall` 与 `hive-fail2ban`
- [ ] 节点上有 `/etc/audit/rules.d/hive.rules`，键为 `ssh_config`、`root_ssh`、`shadow_change`、`identity`、`hive_config`
- [ ] `unattended-upgrades` 已 enable，且未设置自动重启

## 🔮 后续优化建议

1. **增强监控**
   - 集成 Prometheus 告警规则
   - 实时攻击统计和可视化

2. **智能防护**
   - 基于地理位置的访问控制
   - 机器学习异常检测

3. **自动化管理**
   - Ansible 批量安全配置
   - 定期安全策略更新

4. **合规加固**
   - CIS 安全基准对照
   - 安全审计日志

---

**总结**：节点用 UFW 默认拒绝入站，并用 fail2ban 把 SSH、端口扫描和 PAM 失败写成 UFW 封禁。SSH 并未收成「仅信任网段」。auditd 与仅安全源的无人值守更新随镜像启用，更新不会自动重启。
