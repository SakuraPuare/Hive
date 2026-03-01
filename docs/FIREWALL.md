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
| 22   | SSH  | 本地网络 + Tailscale | 远程管理访问 |
| 9100 | Node Exporter | Tailscale 网络 | Prometheus 监控指标 |

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

### 修改 SSH 访问范围

编辑防火墙初始化脚本：

```bash
sudo nano /usr/local/bin/setup-firewall.sh
```

找到 SSH 配置部分，根据需要修改网络范围：

```bash
# 允许特定办公室 IP
ufw allow from YOUR_OFFICE_IP to any port 22 comment 'SSH - Office IP'

# 或者移除某些网络范围
# ufw allow from 172.16.0.0/12 to any port 22 comment 'SSH - Private Network'
```

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

### 1. SSH 密钥认证

强烈建议使用 SSH 密钥而非密码：

```bash
# 生成密钥对（在客户端）
ssh-keygen -t ed25519 -C "your-email@example.com"

# 复制公钥到节点（在客户端）
ssh-copy-id root@hive-node-ip

# 禁用密码认证（在节点上）
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload sshd
```

### 2. 更改默认端口

考虑更改 SSH 默认端口：

```bash
# 编辑 SSH 配置
sudo nano /etc/ssh/sshd_config

# 修改端口（例如改为 2222）
Port 2222

# 重启服务
sudo systemctl restart sshd

# 更新防火墙规则
sudo ufw delete allow 22
sudo ufw allow from 192.168.0.0/16 to any port 2222
```

### 3. 失效保护措施

防止防火墙配置错误导致无法访问：

1. **物理访问**：确保有设备物理访问权限
2. **带外管理**：如有可能，配置 IPMI 或串口访问
3. **测试环境**：先在测试设备验证规则

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

4. **通过其他通道访问**：
   - Tailscale: `ssh root@hive-a4b2c1`
   - FRP: `ssh -p 12345 root@your-vps`
   - 物理控制台访问

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