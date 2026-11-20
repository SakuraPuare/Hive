# Hive Network fail2ban 入侵防护配置

本文档介绍 Hive Network 节点的 fail2ban 入侵检测和防护。监狱、白名单和封禁动作由 `/usr/local/bin/setup-fail2ban.sh` 写入，管理命令以 `/usr/local/bin/hive-fail2ban` 为准。

## 🛡️ fail2ban 概述

fail2ban 读取 systemd 日志（默认 `backend = systemd`），命中后用 UFW 封禁来源地址。

### 主要功能

- **SSH 暴力破解防护**：`sshd` 与 `sshd-aggressive`
- **端口扫描检测**：`hive-portscan` 匹配一组常见目的端口上的内核 / UFW BLOCK 记录
- **PAM 认证失败**：`pam-generic` 覆盖 sudo、su、login 等
- **与 UFW 集成**：`banaction = ufw`，封禁行是 `ufw insert 1 deny from <ip> to any`
- **白名单**：回环、私网、Tailscale CGNAT、链路本地，以及已配置时解析出的 EasyTier 中继地址

## 📂 相关文件

```
/usr/local/bin/setup-fail2ban.sh            # 写入监狱、过滤器和 UFW 动作
/usr/local/bin/hive-fail2ban                 # 管理工具（必须 root）
/etc/systemd/system/hive-fail2ban.service   # 一次性配置服务
/etc/fail2ban/jail.d/hive-*.conf            # 脚本生成的监狱
/etc/fail2ban/filter.d/hive-suspicious.conf # 端口扫描过滤器
/etc/fail2ban/action.d/ufw.conf             # 脚本写入的 UFW 封禁动作
/etc/logrotate.d/fail2ban                   # 日志轮转（只允许这一份）
/var/lib/hive/fail2ban-configured           # 配置完成标记
```

`hive-fail2ban.service` 是 oneshot。单元条件是标记文件尚不存在（`ConditionPathExists=!/var/lib/hive/fail2ban-configured`），因此只跑一次 `setup-fail2ban.sh`，成功后由 `ExecStartPost` 创建标记。它排在 `ufw.service`、`hive-firewall.service` 之后，`ssh.service` 之前。持续运行的守护进程是 `fail2ban.service`。

再次执行 `setup-fail2ban.sh` 会整份覆盖 `jail.d/hive-*.conf`、`filter.d/hive-suspicious.conf` 和 `action.d/ufw.conf`。标记还在时，手工修改会保留；删掉标记或再跑脚本会覆盖这些文件。脚本还会把 `/etc/default/ufw` 里的 `IPV6=no` 改成 `IPV6=yes`，并删除旧的 `/etc/logrotate.d/fail2ban-hive`。两份轮转指向同一个日志时，logrotate 报 duplicate log entry 并以失败退出。

## 🚫 保护策略

`hive-defaults.conf` 的默认值：`bantime = 3600`、`findtime = 600`、`maxretry = 5`、`backend = systemd`、`banaction = ufw`、`action = %(action_)s`。下面没写明的项沿用这些默认值。

SSH 两座监狱写了 `logpath = %(sshd_log)s`，但没有改 `backend`。`hive-portscan` 同样沿用 `systemd`，同时在配置里写了文件路径（见下）。

### SSH 保护

| 监狱 | 最大重试 | 封禁时间 | 查找时间 | 说明 |
|------|----------|----------|----------|------|
| sshd | 3 次 | 2 小时（7200） | 10 分钟（600） | `filter = sshd`，`port = ssh` |
| sshd-aggressive | 2 次 | 24 小时（86400） | 5 分钟（300） | `filter = sshd[mode=aggressive]` |

### PAM 认证

| 监狱 | 最大重试 | 封禁时间 | 查找时间 | 说明 |
|------|----------|----------|----------|------|
| pam-generic | 5 次 | 1 小时（3600） | 10 分钟（默认 600） | 标准过滤器 `pam-generic`，并再次指定 `backend = systemd` |

脚本注释写明这座监狱涵盖 sudo、su、login。当前配置里没有 `systemd-login`、`sudo-auth`、`systemd-auth`。这些名字对应的过滤器文件不存在；旧节点若仍启用它们，fail2ban 会因找不到 filter 而启动失败，处理见 [故障排查](/TROUBLESHOOTING)。

### 端口扫描

| 监狱 | 最大重试 | 封禁时间 | 查找时间 | 说明 |
|------|----------|----------|----------|------|
| hive-portscan | 10 次 | 1 小时（3600） | 1 分钟（60） | 过滤器 `hive-suspicious` |

`filter.d/hive-suspicious.conf` 有两条 `failregex`。第一条匹配含 `kernel:`、`IN=`、`OUT=`、`MAC=`、`SRC=` 且 `DPT` 属于下列端口的行；第二条匹配含 `UFW BLOCK`、`SRC=` 且 `DPT` 属于同一组端口的行。端口是 22、23、25、53、80、110、143、443、993、995、3389、5432、5900。监狱的 `logpath` 写成 `/var/log/kern.log` 和 `/var/log/ufw.log`。

### 白名单

`ignoreip` 由脚本拼出：

- `127.0.0.1/8`、`::1`
- `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`
- `100.64.0.0/10`（Tailscale 使用的 CGNAT；不是 `100.0.0.0/8`）
- `fe80::/10`

`EASYTIER_PEERS` 非空时，脚本去掉协议和端口，用 `getent hosts` 解析每个中继主机并追加进白名单；解析不到就原样追加该主机字段。未设置则跳过。防火墙脚本解析中继时改走 DoH，以免命中 mihomo 的 fake-IP；fail2ban 这里仍是 `getent hosts`。

## 🛠️ fail2ban 管理

`hive-fail2ban` 的每条子命令都要求 root，并且要求 `fail2ban` 处于 active。服务没在跑时，工具只提示 `systemctl start fail2ban` 然后退出。不带参数等同于 `status`。

```bash
sudo hive-fail2ban status     # 服务状态、监狱概览、配置路径
sudo hive-fail2ban jails      # 逐个监狱的 fail2ban-client status
sudo hive-fail2ban banned     # 各监狱当前封禁地址
sudo hive-fail2ban logs       # 最近 50 条
sudo hive-fail2ban test       # fail2ban-client --test，并检查 hive-* 过滤器
sudo hive-fail2ban reload     # fail2ban-client reload
sudo systemctl status fail2ban
```

`logs` 在 `/var/log/fail2ban.log` 存在时输出该文件末尾 50 行，否则使用 `journalctl -u fail2ban --lines=50`。

### 解封

`unban` 只接受点分 IPv4，不接受 CIDR，也不接受 IPv6。它在每个监狱上执行 `fail2ban-client unban <IP>`；若 `ufw status` 里还有该地址，再执行 `ufw --force delete deny from <IP>`。

```bash
sudo hive-fail2ban unban 203.0.113.100
```

自定义 UFW 动作的 `actionstop` 是空的。`systemctl stop fail2ban` 不会撤掉已经写入 UFW 的 deny，已封地址仍要 `unban` 或 `ufw delete`。

跟踪新日志：

```bash
sudo tail -f /var/log/fail2ban.log
sudo journalctl -u fail2ban -f
```

## 🔧 高级配置

手工修改会被下一次 `setup-fail2ban.sh` 覆盖。标记文件还在时，重启不会自动重跑脚本。

```bash
sudo nano /etc/fail2ban/jail.d/hive-ssh.conf
sudo nano /etc/fail2ban/jail.d/hive-services.conf
sudo nano /etc/fail2ban/jail.d/hive-suspicious.conf
sudo nano /etc/fail2ban/jail.d/hive-defaults.conf
```

追加白名单时保留脚本生成的地址段，只在末尾加上管理地址，然后 `sudo hive-fail2ban reload`。

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12 100.64.0.0/10 fe80::/10 YOUR_OFFICE_IP
```

### 邮件通知

默认 `action = %(action_)s`，只封禁、不发信。脚本里下面三行是注释，仓库没有启用邮件：

```ini
# destemail = admin@yourdomain.com
# sender = fail2ban@hive-node
# mta = sendmail
```

要发信，在 `hive-defaults.conf` 里填写这三项，并把 `action` 改成 fail2ban 自带的 `%(action_mw)s`。

## 🔍 日志

```bash
sudo grep "Ban " /var/log/fail2ban.log | tail -10
sudo grep "Unban " /var/log/fail2ban.log | tail -10
sudo grep "Ban " /var/log/fail2ban.log | awk '{print $8}' | sort | uniq -c | sort -nr
```

轮转使用镜像里的 `/etc/logrotate.d/fail2ban`：`daily`、`rotate 30`、`compress`、`missingok`、`notifempty`，新建文件 `0640 root adm`，轮转后执行 `fail2ban-client flushlogs`。不要再放一份 `fail2ban-hive`。脚本会把这份配置的权限收成 `0644`，因为 logrotate 拒绝 group/other 可写的配置。

## ⚠️ 安全注意事项

用来登录的地址应留在 `ignoreip` 里。已经被封时：

1. **物理控制台**：`sudo hive-fail2ban unban <IPv4>`
2. **其他通道**：Tailscale 主机名是 `hive-<mac6>`（`provision-node.sh` 设置，MagicDNS 可解析）。FRP 使用 `ssh -p <frp_port> root@<vps-ip>`。白名单含 `100.64.0.0/10`，经 Tailscale 进来的源地址不会被这座 fail2ban 封禁。
3. **停守护进程不能解封**：`sudo systemctl stop fail2ban` 留下的 UFW deny 仍然生效，见上一节。

改完配置后执行 `sudo hive-fail2ban test`，再 `sudo hive-fail2ban reload`。

## 🆘 故障排除

### fail2ban 无法启动

```bash
sudo fail2ban-client --test
sudo journalctl -u fail2ban -f
sudo systemctl status ufw
```

日志若是找不到 `/etc/fail2ban/filter.d/systemd-login.conf`，说明还在用旧的 `hive-services.conf`。当前脚本只启用 `pam-generic`。临时处理和重装步骤见 [故障排查](/TROUBLESHOOTING)。

### 监狱没有命中

默认 `backend` 是 systemd，先看 `journalctl -u fail2ban`，不要先假设一定有 `/var/log/auth.log` 或 rsyslog。`hive-portscan` 的配置还写了 `/var/log/kern.log` 和 `/var/log/ufw.log`。手头有对应日志时，可以用 `fail2ban-regex` 试过滤器：

```bash
sudo fail2ban-regex /var/log/ufw.log /etc/fail2ban/filter.d/hive-suspicious.conf
```

### 误封

```bash
sudo fail2ban-client get sshd ignoreip
sudo grep "YOUR_IP" /var/log/fail2ban.log
sudo hive-fail2ban unban YOUR_IP
```

## 📊 性能影响

fail2ban 对系统性能影响极小：

- **CPU 使用**：< 1%
- **内存使用**：~10-20MB
- **磁盘 I/O**：仅日志读取
- **网络影响**：无

## 📚 相关资源

- [fail2ban 官方文档](https://www.fail2ban.org/wiki/index.php/Manual)
- [fail2ban 配置示例](https://github.com/fail2ban/fail2ban/tree/master/config)
- [UFW 与 fail2ban 集成](https://help.ubuntu.com/community/Fail2ban)
- 本仓库的防火墙策略见 [防火墙（UFW）](/FIREWALL)，总览见 [安全概述](/SECURITY-SUMMARY)

---

**注意**：fail2ban 配置涉及网络安全。修改前确认白名单和应急访问通道；`setup-fail2ban.sh` 会覆盖 `hive-*.conf`。
