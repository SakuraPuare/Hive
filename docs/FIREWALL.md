# Hive Network 防火墙

节点用 `ufw` 做防火墙。规则由 `/usr/local/bin/setup-firewall.sh` 一次写完；日常查看和临时放行 SSH 用 `/usr/local/bin/hive-firewall`。热点、有线 LAN 的洞由别的脚本按接口补，不在这份基线里对全网开放。

入侵封禁见 [入侵防护（fail2ban）](FAIL2BAN.md)。透明代理的数据面见 [透明代理网关](GATEWAY.md)，热点见 [WiFi 热点](HOTSPOT.md)。

## 默认策略

`setup-firewall.sh` 先 `ufw --force reset`，然后：

- 入站默认拒绝，出站默认允许，转发默认拒绝
- 放行环回接口 `lo` 的入站和出站
- 启用 ufw（已建立连接由 ufw 默认规则放行）
- 配置过程中先 `ufw logging off`，结束时设为 `ufw logging medium`

出站默认是允许，不是白名单。脚本里的 `ufw allow out` 是在默认允许之上再记一笔，避免以后把出站改严时漏掉隧道端口。

## 相关文件

```
/usr/local/bin/setup-firewall.sh                         # 初始化；开头会重置全部规则
/usr/local/bin/hive-firewall                             # 查看 / 临时放行 SSH / 重置
/usr/local/bin/hive-hotspot-firewall.sh                  # 5G hostapd 的 DHCP、DNS、转发、SNAT
/etc/NetworkManager/dispatcher.d/90-hive-hotspot         # NM shared 连接 up/down 时打洞
/etc/systemd/system/hive-firewall.service                # 一次性单元
/var/lib/hive/firewall-configured                        # 成功后留下的标记
/run/hive-ufw.lock                                       # 所有上述脚本共用的 ufw 变更锁
/etc/hive/config.env                                     # EASYTIER_PEERS、FRP_SERVER_PORT、GATEWAY_TUN_IFACE
/etc/hive/hotspot-5g.env                                 # 5G AP 接口名与地址
```

`ufw` 每条命令都会整份重写 `/etc/ufw/user.rules`。`setup-firewall.sh`、`hive-hotspot-firewall.sh` 和 dispatcher 共用 `/run/hive-ufw.lock`。初始化脚本最多等 180 秒，等不到就失败退出；热点脚本和 dispatcher 单独运行时最多等 120 秒。`setup-firewall.sh` 再调用后两者时已持锁，并通过 `HIVE_UFW_LOCK_HELD=1` 让它们不要二次加锁。

`hive-firewall` 的 `allow-ssh` / `deny-ssh` 不加这把锁。`reset` 开头的 `ufw --force reset` 也不加锁，随后调用的 `setup-firewall.sh` 才会加锁。不要在初始化或热点脚本还在跑的时候用它改规则。

## 什么时候会重新配置

`hive-firewall.service` 是 oneshot，条件为标记文件不存在（`ConditionPathExists=!/var/lib/hive/firewall-configured`）。`ExecStart` 成功后 `ExecStartPost` 才创建标记。脚本末尾会复核一组关键规则，缺失就重放一次，仍然缺失则退出码 1，不写标记，下次开机再跑。

标记已经在时，开机和 `provision-node.sh` 里的 `systemctl enable --now hive-firewall` 都不会重跑脚本。要按当前 `setup-firewall.sh` 重建并重新留下标记：

```bash
sudo rm -f /var/lib/hive/firewall-configured
sudo systemctl restart hive-firewall
```

`sudo hive-firewall reset` 也会把规则跑一遍（见下文，先问确认），但它是直接执行脚本，不经过单元的 `ExecStartPost`，所以**不会**创建标记。手写的 `ufw` 规则在上述两条路径里都会被 `ufw --force reset` 清掉。

## 入站

| 端口 | 服务 | 来源 | 说明 |
|------|------|------|------|
| 22 | SSH | `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`、`100.64.0.0/10` | 四条带来源的放行。Tailscale 用 CGNAT `100.64.0.0/10`，不是整个 `100.0.0.0/8` |
| 22 | SSH | 任意 | 另外执行 `ufw limit ssh`：按 ssh 服务限速放行，不限于上表网段 |
| 9100 | Node Exporter | `100.64.0.0/10`、`172.20.0.0/16` | Tailscale 与 EasyTier 各一条 |
| 9550 | Xray Exporter | `100.64.0.0/10`、`172.20.0.0/16` | 同上 |
| 9090 | Mihomo 面板 | `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`、`100.64.0.0/10` | 不放行公网。`172.16.0.0/12` 覆盖 EasyTier 的 `172.20.0.0/16`。面板另有每节点 secret |
| 11010–11012/TCP、11010–11011/UDP | EasyTier P2P | 任意 | 不放行时直连 SYN 被丢，只能走中继。入网仍要 network secret |
| UDP（不限端口） | EasyTier 中继回包 | `EASYTIER_PEERS` 解析出的地址 | 见下一节 |
| 任意 | Cloudflare WARP / Mesh | `100.96.0.0/12` | `ufw allow from 100.96.0.0/12`，另有到该网段的出站放行 |
| 接口 `Meta`（可用 `GATEWAY_TUN_IFACE` 改名） | 旧 TUN 口 | 该接口 | `in` / `out` / `route in` / `route out`。当前网关数据面是 tproxy，不是 TUN，见 [GATEWAY](GATEWAY.md)；初始化脚本仍会写下这些规则 |

ICMP echo 不再另加规则，用 ufw 自带的 `before.rules`。

复核失败会使单元失败的，是环回、四条 SSH 来源、`9100` 两条、`9550` 两条，以及 `9090` 的 Tailscale 那一条。热点、EasyTier 中继解析失败只告警，不因此拒绝写标记。

### 下游接口上的 DHCP / DNS / 转发

这些口不对 WAN 开放，只打在下游接口上。DHCP 客户端首包源地址是 `0.0.0.0`，所以按接口放行 `udp/67`，而不是按来源网段。

- **5G（hostapd）**：不走 NetworkManager，不会触发下面的 dispatcher。`setup-firewall.sh` 在重置之后调用 `hive-hotspot-firewall.sh`，按 `/etc/hive/hotspot-5g.env` 的 `AP_IFACE` 放行该接口的转发、`udp/67` 和 `53`。脚本失败只打印告警并继续（注释写明：没有 5G 热点也算正常）。该脚本还为 5G 网段做 SNAT（出口不是 TUN 口 `Meta` 时），并处理旧固件遗留的订阅门禁；细节在 [HOTSPOT](HOTSPOT.md)。
- **2.4G 与有线 LAN**：NM shared 连接名为 `hive-hotspot-2g`、`hive-hotspot-5g` 或 `hive-lan-*` 时，dispatcher `90-hive-hotspot` 在 `up` 放行转发、`udp/67` 和 `53`，在 `down` 删除。接口名写到 `/run/hive-hotspot-ap-iface.<连接名>`，避免 down 事件拿不到接口。当前 5G 由 hostapd 托管，这条 `hive-hotspot-5g` 分支只在真的存在同名 NM 连接时生效。
- 重置会清掉上述洞。`setup-firewall.sh` 随后对**已经激活**的这三类连接再跑一次 dispatcher 的 `up`。

### EasyTier 中继 UDP

中继的 STUN 回包源端口不固定，conntrack 对不上节点发出的 UDP，会被默认入站策略丢掉。`EASYTIER_PEERS`（逗号分隔，去掉协议和端口后的主机名）里每个主机：

1. 用 DoH `https://223.5.5.5/resolve` 查 A 和 AAAA（`curl -4`，8 秒超时）
2. DoH 没有结果时才回退 `getent ahosts`
3. 丢掉 `198.18.0.0/16`（mihomo fake-IP）。节点 DNS 被劫持时 `getent` 会返回这类地址；若写进 ufw，真实中继回包仍被 `BLOCK`，EasyTier 表现为握手超时、mesh 里假在线
4. 对剩下的地址 `ufw allow in proto udp from <IP>`

没有解析到真实 IPv4 时告警，并跳过该主机的 IPv4 放行；AAAA 仍会单独尝试。这不让单元失败。`EASYTIER_PEERS` 为空则整段跳过。

## 出站（默认已允许）

脚本额外写下的出站规则：

| 目的 | 用途 |
|------|------|
| `53` | DNS |
| `123` | NTP |
| `67`、`68` | DHCP 客户端 |
| `443` | Cloudflare Tunnel 的 HTTPS，以及 Tailscale 的 TCP 回退（脚本写了两次 `443`） |
| `7844/tcp`、`7844/udp` | Cloudflare Tunnel（http2 / quic） |
| `FRP_SERVER_PORT`，未设置时 `7000` | FRP 客户端。值来自 `/etc/hive/config.env` |
| `41641/udp` | Tailscale |
| `2408/udp`、`1701/udp` | Cloudflare WARP |
| 去往 `100.96.0.0/12` | Cloudflare Mesh |

## 管理命令

除 `help` 外，子命令都要 root（脚本检查 `EUID`）。

```bash
sudo hive-firewall status     # ufw status，外加路由和监听端口
sudo hive-firewall rules      # ufw status verbose，以及 iptables ufw-user-input 链的前几行
sudo hive-firewall logs       # /var/log/ufw.log 最后 50 行；没有该文件则 journalctl -u ufw
```

```bash
# 只接受 IPv4 或 IPv4 CIDR，例如 203.0.113.100、203.0.113.0/24。IPv6 会被拒绝。
sudo hive-firewall allow-ssh 203.0.113.100

# 删除「from 该地址 to any port 22」的 allow。删不到只告警。
sudo hive-firewall deny-ssh 203.0.113.100
```

`allow-ssh` 加的规则带当天日期的 comment。它**不会**在下次 `setup-firewall.sh` 里自动再现。

```bash
sudo hive-firewall reset
```

必须输入大写 `YES`。确认后执行 `ufw --force reset`，再跑 `setup-firewall.sh`。重置期间 SSH 可能断开；脚本自己的提示也是：丢了 SSH 就走物理控制台。

### 改 SSH 来源

来源网段写在 `setup-firewall.sh` 的 SSH 段（`192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`、`100.64.0.0/10`，以及无条件的 `ufw limit ssh`）。改完按上一节删掉标记并重启 `hive-firewall.service`。

只在 sshd 里改监听端口、或只 `ufw delete` / `ufw allow`，挡不住下一次初始化：脚本仍放行 22，并再次 `ufw limit ssh`。

### SSH 登录

镜像在 `/etc/ssh/sshd_config.d/99-hive-hardening.conf` 里固定：

- `PermitRootLogin yes`
- `PasswordAuthentication yes`
- `KbdInteractiveAuthentication no`
- `MaxAuthTries 3`，`LoginGraceTime 30`

改 `/etc/ssh/sshd_config` 主文件盖不过这份 drop-in。要关密码登录，改 drop-in 后再 `sudo systemctl reload ssh`（单元名是 `ssh`，与 `hive-firewall.service` 的 `Before=ssh.service` 一致）。root 初始密码由构建变量 `DEFAULT_ROOT_PASSWORD` 决定，见 [构建镜像](BUILD.md)。

## 排查

SSH 连不上时：

```bash
sudo ufw status verbose
sudo systemctl status ufw ssh
sudo hive-firewall logs
```

标记还在时，重启不会重跑初始化。紧急关掉防火墙：

```bash
sudo ufw disable
```

这不会删除 `/var/lib/hive/firewall-configured`。之后要恢复脚本里的规则，先删标记再 `sudo systemctl restart hive-firewall`，或在 ufw 可用时 `sudo hive-firewall reset`。

别的入口（地址以 `/etc/hive/node-info` 为准，MOTD 也会打印）：

- Tailscale：`ssh root@<TAILSCALE_HOST>`
- EasyTier：`ssh root@<EASYTIER_IP>`
- FRP：`ssh -p <FRP_PORT> root@<FRP_SERVER_ADDR>`

9100 从 Tailscale 或 EasyTier 抓不到指标时，先看规则在不在，再看有没有 `BLOCK`：

```bash
sudo ufw status | grep -E '9100|9550|9090'
sudo ss -tulpn | grep -E ':9100|:9550|:9090'
sudo grep -E 'DPT=(9100|9550|9090)' /var/log/ufw.log
```

本机可先 `curl -s http://127.0.0.1:9100/metrics | head`。环回已放行；从别的机器访问必须落在上表的来源网段里。

EasyTier 握手超时、mesh 里假在线时，看 ufw 里有没有 `198.18.` 的 UDP 放行。有的话说明中继解析走到了 fake-IP：删掉标记，确认节点能访问 `https://223.5.5.5/resolve`，再重启 `hive-firewall`。

## 相关文档

- [安全概述](SECURITY-SUMMARY.md)
- [UFW 社区文档](https://help.ubuntu.com/community/UFW)
- [iptables 常用规则](https://www.digitalocean.com/community/tutorials/iptables-essentials-common-firewall-rules-and-commands)
- [SSH 加固笔记](https://stribika.github.io/2015/01/04/secure-secure-shell.html)
