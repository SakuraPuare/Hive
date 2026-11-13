# Hive Network 防火墙安全配置

本文档介绍 Hive Network 节点的防火墙配置和安全策略。

## 🔥 防火墙概述

Hive Network 节点使用 `ufw` (Uncomplicated Firewall) 作为防火墙管理工具，提供以下安全特性：

- **默认拒绝策略**：所有入站连接默认被阻止
- **最小权限原则**：只开放必要的服务端口
- **网络范围限制**：SSH 仅允许信任网络访问
- **连接状态跟踪**：防止连接劫持
- **速率限制**：防止 SSH 暴力破解

## 📂 相关文件

```
/usr/local/bin/setup-firewall.sh          # 防火墙初始化脚本
/usr/local/bin/hive-firewall               # 防火墙管理工具
/etc/systemd/system/hive-firewall.service # 系统服务配置
/var/lib/hive/firewall-configured         # 配置完成标记文件
```

## 🚪 开放端口列表

### 入站端口

| 端口 | 服务 | 访问范围 | 说明 |
|------|------|----------|------|
| 22   | SSH  | Tailscale `100.64.0.0/10` 与 `fd7a:115c:a1e0::/48`，EasyTier `172.20.0.0/16`，FRP 经本机 lo | 仅运营方公钥。LAN、热点不开 |
| 9100 | Node Exporter | Tailscale + EasyTier | Prometheus 监控指标 |
| 9550 | Xray Exporter | Tailscale + EasyTier | 流量指标 |

### 出站连接

| 端口/协议 | 用途 | 目标 |
|-----------|------|------|
| 53/UDP | DNS 查询 | 8.8.8.8 等 |
| 123/UDP | NTP 时间同步 | pool.ntp.org |
| 443/TCP | HTTPS | Cloudflare, 软件源 |
| 41641/UDP | Tailscale VPN | Tailscale 服务器 |
| 7000/TCP | FRP 客户端 | 您的 VPS 服务器 |

## 🛠️ 防火墙管理

### 查看状态

```bash
# 查看防火墙概况
hive-firewall status

# 查看详细规则
hive-firewall rules

# 查看防火墙日志
hive-firewall logs
```

### SSH 访问管理

```bash
# 允许特定 IP 访问 SSH
sudo hive-firewall allow-ssh 203.0.113.100

# 允许网段访问 SSH
sudo hive-firewall allow-ssh 203.0.113.0/24

# 移除 SSH 访问权限
sudo hive-firewall deny-ssh 203.0.113.100
```

### 重置防火墙（紧急情况）

```bash
# ⚠️ 警告：这会重置所有规则！
sudo hive-firewall reset
```

## 🔧 高级配置

### 手动添加规则

```bash
# 允许特定端口（临时测试）
sudo ufw allow from 192.168.1.0/24 to any port 8080

# 允许出站连接到特定端口
sudo ufw allow out 1234

# 删除规则
sudo ufw delete allow from 192.168.1.0/24 to any port 8080
```

### SSH 不要对局域网重新打开

节点 root 没有可用密码。SSH 只接受运营方公钥，并且防火墙只放行：

- Tailscale：`100.64.0.0/10`、`fd7a:115c:a1e0::/48`
- EasyTier：`172.20.0.0/16`
- FRP：转到 `127.0.0.1:22`（环回已放行）

不要执行 `ufw allow 22` 或 `ufw limit ssh`。那两条会把盒子的 LAN 和热点重新暴露出去。客户侧 `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12` 不是 SSH 来源。

`hive-firewall allow-ssh <IP>` 只给已经拿着运营方私钥的人多开一个来源，不会打开密码登录。

## 🔍 日志监控

### 实时监控

```bash
# 监控防火墙拒绝日志
sudo tail -f /var/log/ufw.log | grep BLOCK

# 监控 SSH 连接
sudo journalctl -fu ssh

# 监控所有网络连接
sudo ss -tulpn
```

### 定期检查

建议定期检查以下项目：

1. **异常 IP**：检查日志中频繁阻止的 IP
2. **服务状态**：确认所有服务正常运行
3. **规则更新**：根据需要调整访问规则

## ⚠️ 安全注意事项

### 1. 只有运营方公钥

镜像不设 root 密码，`sshd` 是 `AuthenticationMethods publickey`。导入公钥失败不会退回密码。串口 getty 已关掉，内核 log 还在。

拔下 TF 卡、挂载根分区，仍然可以改系统：根分区没有磁盘加密，改密码、写入公钥、改 sshd 都不需要原来的口令。这一层要另做引导链和加密，并先验证能启动，不要在没验证的情况下改分区。

丢了管理通道时，从 Tailscale、EasyTier 或 FRP 用运营方私钥连。串口不能登录。不要在设备上把 22 对全世界或局域网放开。


### 4. 监控告警

考虑设置监控告警：

```bash
# 创建简单的入侵检测脚本
sudo nano /usr/local/bin/check-intrusion.sh

#!/bin/bash
# 检查最近 1 小时内被阻止次数超过 50 的 IP
grep "$(date +%Y-%m-%d\ %H)" /var/log/ufw.log | \
grep BLOCK | \
awk '{print $13}' | \
cut -d= -f2 | \
sort | \
uniq -c | \
awk '$1 > 50 {print "Alert: " $2 " blocked " $1 " times"}'
```

## 🆘 故障排除

### 无法 SSH 连接

1. **检查防火墙状态**：
   ```bash
   sudo ufw status verbose
   ```

2. **检查服务状态**：
   ```bash
   sudo systemctl status ufw
   sudo systemctl status ssh
   ```

3. **临时禁用防火墙**（紧急情况）：
   ```bash
   sudo ufw --force reset
   sudo ufw disable
   ```

4. **通过其他通道访问**（运营方私钥）：
   - Tailscale: `ssh root@hive-a4b2c1`
   - EasyTier: `ssh root@172.20.x.x`
   - FRP: `ssh -p 12345 root@your-vps`
   - 串口只有启动 log，没有 root shell。拔卡能改未加密的根分区，那不是登录口，也不要当成日常入口。

### 服务无法正常工作

1. **检查端口是否开放**：
   ```bash
   sudo ss -tulpn | grep :9100
   ```

2. **测试连接**：
   ```bash
   # 从内部测试
   curl -s http://localhost:9100/metrics | head

   # 从 Tailscale 网络测试
   curl -s http://100.x.x.x:9100/metrics | head
   ```

3. **查看拒绝日志**：
   ```bash
   sudo grep "DPT=9100" /var/log/ufw.log
   ```

## 📚 相关资源

- [UFW 官方文档](https://help.ubuntu.com/community/UFW)
- [iptables 基础教程](https://www.digitalocean.com/community/tutorials/iptables-essentials-common-firewall-rules-and-commands)
- [SSH 安全加固指南](https://stribika.github.io/2015/01/04/secure-secure-shell.html)

---

**注意**：防火墙配置涉及网络安全，修改前请确保理解各项设置的含义，并做好备份和应急预案。