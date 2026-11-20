# 节点日常运维指南

本文档覆盖 Hive Node 上线后的日常管理操作，包括 SSH 接入、服务管理、批量操作和监控。

---

## 一、SSH 接入方式

每台节点有三套管理通道，按优先级排序：

| 方式 | 命令 | 可用条件 |
|------|------|----------|
| **Tailscale**（推荐）| `ssh root@hive-<mac6>` | Tailscale 网络正常 |
| **EasyTier** | `ssh root@172.20.x.x` | EasyTier mesh 正常（Registry 在 `172.20.0.0/16` 按 MAC 发号） |
| **FRP**（应急） | `ssh -p <frp_port> root@<vps-ip>` | FRP VPS 可达 |

### 获取节点连接信息

**方式一**：SSH 登录后查看 MOTD

```
 Connection Info:
 Tailscale        : ssh root@hive-a4b2c1
 EasyTier         : ssh root@172.20.1.5
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

**方式四**：管理面板

节点列表 → 行操作「SSH 命令」，或勾选多台后点「SSH 命令」，面板会给出该节点可用的 Tailscale / EasyTier / FRP 命令并支持一键复制。FRP 命令需要 registry 配置 `FRP_SERVER_ADDR`（与 `.env` 一致）。

### 节点位置

管理员「节点 → 编辑节点」与「网关」共用 `country_override`：选择国家/地区即人工固定位置；选择「自动（跟随上报）」则清空覆盖，使用心跳上报的 `country`。节点列表、节点状态、节点详情及节点选择器统一按人工覆盖 → 心跳国家 → 旧 `location` 的顺序展示；搜索和节点 CSV 导出使用同一有效位置。

旧 `location` 保留历史展示和订阅名称标签用途，仅在没有有效国家信息时作为管理员位置的回退值；不再提供第二个位置编辑框，也不据此决定网关自动分流。自动分流仍按有效国家判断：CN 出海，其它国家/地区回国。节点状态接口返回 `country` 与 `country_override`，无需数据库迁移。

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

# SSH 到 EasyTier IP（从 /etc/hive/node-info 获取，地址在 172.20.0.0/16）
ssh root@172.20.1.5
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

### 客户门户服务快照与命令结果

「我的设备」的服务状态来自 `hive-command-agent.timer` 约每 60 秒执行的普通心跳，
不是浏览器向硬件实时发起 `systemctl`。页面每 5 秒读取 registry 最新快照；
显示采样时间，超过 150 秒标记过期，不能把陈旧的 active 当作当前健康状态。
旧镜像未上报状态时，采样时间为空、所有服务显示 unknown；不存在的 systemd unit
明确显示 not-found。未安装的可选服务不等于节点整体故障。

认证客户可查询自己已认领设备（其他客户或未认领设备返回 404）：

```text
GET /api/portal/devices/{mac}/services
{"sampled_at":"2026-11-19T12:00:00Z","services":[{"name":"xray","active_state":"active","sub_state":"running","load_state":"loaded"}]}
```

接口完整返回 service-control 白名单中的各服务；`sampled_at` 是 registry 接收该次
状态心跳的 UTC 时间，不会因页面刷新或旧版心跳而更新。页面刷新不下发状态命令，
不会增加节点轮询频率。快照与控制动作共用白名单，不能查询或控制任意 unit。

### 设备凭据被 registry 拒绝时的自愈

`hive-command-agent`、`hive-clash-sync`、`hive-xray-sync` 与 `hive-updater` 收到 HTTP 401
（服务端删掉了节点行，或管理员轮换了凭据）时，会用 `/etc/hive/device-token` 调一次
幂等 `POST /nodes/enroll`，成功后立刻重试原请求；enroll 只写 mac/hostname/认领码，
随后再用 `/nodes/register` 回填 `cf_url`、`tunnel_id`、`frp_port`、`xray_uuid`、
`tailscale_ip` 等身份字段（值取自 `node-info`，`easytier_ip` 由 registry 重新分配）。

- registry 返回 409 表示设备已认领/是服务端身份，或令牌被换过：只记日志并退避
  10 分钟（`/var/lib/hive/registry-auth.attempt`），不会抢所有权，需要管理员重新下发凭据。
- 认领码由 `mac + token` 确定，重建的节点行沿用原码，客户可以照原样认领。
- 这条自愈只解决“行被删”的情况；数据库整体重置时，设备会在下一轮定时任务里逐台恢复。

### Mihomo 面板地址与一键连接

「我的设备 → Mihomo 面板」只展示自动检测到的物理网络地址：WAN 上联接口、LAN、热点地址；
Tailscale、EasyTier、Cloudflare Mesh 和 FRP 属于管理通道，不在客户 API 或页面暴露。
WAN 是物理接口在主路由表中的默认路由角色，可能是家庭路由器分配的私网地址；
热点由 `iw` 报告的 AP 模式识别，2.4G/5G 及虚拟 AP 接口都适用，不匹配固定 IP。
Hive 的无线网卡只做 AP：非 AP 模式（station/monitor 或无法读取模式）的无线接口不上报，
即使它持有默认路由也不会当作 WAN。
双网口无 AP 的设备只显示 WAN 与 LAN；旧样本无法确定角色时标为物理接口，不猜测。

「一键打开」在节点自己的 MetaCubeXD 地址中使用 `#/?hostname=…&port=9090&http=true&secret=…`
自动连接后端。面板候选只列 IPv4：节点公网 IPv6 默认被 UFW 拦截入向 9090，
列出会生成打不开的链接；IPv6 仍可在设备地址页作为观测信息查看。
密钥位于 URL fragment，不发送给 HTTP 静态资源服务器；
仍会存在于浏览器地址/历史中，勿分享完整链接。页面不在链接文字中显示密钥。

需要从对应网络访问该地址；WAN 候选不保证从公网可达。观测公网出口只用于展示，
可能经过 NAT/代理，不生成公网 9090 链接，也不改变防火墙或暴露管理端口。


手动下发 service-control 的 status 命令会在下一个 agent 周期执行实际
`systemctl status --no-pager --full --lines=5`，结果保留有界的真实状态输出（最多 850 字节，
另加服务名称前缀），而不是只显示 done。inactive/failed/not-found 是状态查询结果，
不是查询本身失败；超时或 systemctl 执行失败则回传 failed。页面每 2 秒刷新命令历史并展示回传结果；重启类命令仍是异步操作。

### 管理员单机控制与群控

节点列表行菜单的「节点控制」，或节点详情页的「控制节点」，打开的是这一台的控制对话框。勾选多台后点「控制选中节点」，对选中设备下发同一条命令。这个对话框只能下发：重启设备、同步配置、重启 Xray、重启 Mihomo，以及服务的启动、停止、重启、查看状态。不能下发任意 shell。

单台和多台的服务控制入口不同：

- 单台时，命令下拉里没有「服务控制」。下方「软件服务控制」按代理与隧道、网关与热点、安全防护、系统服务、同步与自动化分组列出白名单服务，每项可点启动、停止、重启或状态。卡片上的字来自 `GET /api/admin/nodes/{mac}/services`（直连 registry 时去掉 `/api`），是心跳快照，不是打开页面对设备实时执行 `systemctl`。具备 `node:read` 且对话框开着时约每 5 秒重读。没有采样、读取失败，或采样超过 150 秒，卡片状态显示未知；有采样时间且超过 150 秒时另外提示已过期。`load_state` 为 `not-found` 显示未安装，`sub_state` 为 `not-applicable` 显示未启用（当前拓扑）。
- 多台时仍用命令下拉里的「服务控制」，再选服务和操作，然后点「下发命令」。不显示逐服务面板。

两边的名单都不含 `hive-hotspot-5g`。热点只暴露一个 `hive-hotspot` 逻辑服务：状态合并 2.4G NetworkManager AP 与 5G hostapd；启动或重启会重新执行热点配置，停止会同时关闭两个频段。

「查看状态」直接入队，不弹确认；它下发的仍是上一节的 `service-control` status，结果在命令历史里。重启设备、同步配置、重启 Xray、重启 Mihomo，以及服务的启动、停止、重启，需要 `node:write`，并在确认框里核对目标。没有 `node:write` 时，只要有 `node:read` 仍可看命令历史和服务快照。对话框里的历史读取和下发共用最多 5 个在途请求，多出来的目标排队，不是只能勾选 5 台。逐设备显示入队失败、正在入队、待执行、已发送、已完成、执行失败或已过期。入队成功只表示进了队列；设备在下一个 agent 周期执行并回传。重启类命令显示已完成，只表示设备已接受并安排重启，不是已经验证重启成功。离线设备恢复前可能过期，队列有效期 10 分钟。前端不会自动重试写操作。

对话框打开时约每 2 秒刷新命令历史和本批结果，可查看参数和回传输出。关闭后停止刷新。停止 `hive-command-agent.timer` 会中断后续心跳和命令拉取，需要通过 SSH 等其他通道恢复。


### 一键自测

```bash
hive-test.sh
```

输出各服务的 PASS/FAIL/WARN 状态，包括 WebSocket 握手、CF Tunnel 可达性、FRP 连接、EasyTier mesh 等。

### 核心服务操作

```bash
# nginx（WebSocket 转发，xray 前端）
systemctl restart nginx
journalctl -u nginx -f --no-pager

# xray（流量转发）
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

### 查看 xray 日志

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

### 获取节点连接配置

MOTD 登录时会自动显示节点连接配置（含域名、UUID 及 WebSocket 路径）。也可通过 Node Registry 订阅接口批量获取：

```bash
curl https://registry.example.com/api/subscription
```

---

## 六、批量操作（Ansible）

在管理服务器上执行。清单是 `inventory/tailscale.py`：读本机 `tailscale status --json`，把带 `tag:hive` 的节点放进组 `hive_nodes`。

```bash
cd /opt/hive/ansible

# 测试连通性
ansible hive_nodes -m ping

# 查看所有节点 xray 状态
ansible hive_nodes -m command -a "systemctl status xray --no-pager"

# 批量重启 xray
ansible hive_nodes -m systemd -a "name=xray state=restarted"

# 批量查看节点版本
ansible hive_nodes -m command -a "xray --version"

# 批量查看节点在线时长
ansible hive_nodes -m command -a "uptime"
```

仓库里没有 `playbooks/update-xray.yml`。配置重拉用管理面板的「同步配置」（动作 `resync`，重新执行 `hive-xray-sync` 与 `hive-clash-sync`）。

现有 playbook 的 `hosts` 仍写成 `tag_hive`，和 inventory 组名 `hive_nodes` 不一致，直接 `ansible-playbook` 会匹配不到主机：

- `ping.yml`：ping，并打印 `/etc/hive/node-info`。
- `service-status.yml`：只查看 xray、cloudflared、tailscaled、easytier、frpc、prometheus-node-exporter。
- `restart-services.yml`：必须带 `-e service=<单元名>` 才重启那一个单元，并要求结束后 `ActiveState=active`；不传 `service` 则什么都不做。
- `upgrade-from-v1.0.yml`：把 v1.0.0 节点的 sysctl 与 apt 源写成当前布局，不是日常重启。

---

## 七、监控（Prometheus + Grafana）

### Prometheus 抓取

Prometheus 在管理服务器上只听 `127.0.0.1:4230`。节点列表来自 Node Registry 的 `GET /prometheus-targets`（file_sd）。只包含 `enabled = 1`、`status = active`，且 `tailscale_ip` 既非空也不是 `pending` 的节点。每台先有一条 `hostname:9100`，标签 `transport=tailscale`，靠 Tailscale MagicDNS 解析。`easytier_ip` 以 `172.20.` 开头时再追加一条 `easytier_ip:9100`，`transport=easytier`。其余标签是 `hostname`、`cf_url`、`location`、`mac6`。

```bash
# 在管理服务器上查看抓取目标
curl -sf http://127.0.0.1:4230/api/v1/targets | jq '.data.activeTargets[] | {job, instance, health}'
```

### Grafana 仪表板

Grafana 使用 host 网络，HTTP 端口是 `4231`（`GF_SERVER_HTTP_PORT`）。`GF_SERVER_SERVE_FROM_SUB_PATH=true`，页面挂在 `GF_SERVER_ROOT_URL` 的路径下，默认是 `/grafana`。经 Tailscale 访问管理服务器：

```
http://<管理服务器 Tailscale IP>:4231/grafana/
```

改过 `GRAFANA_ROOT_URL` 时，路径跟那个 URL 走。

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
# 直连本机 registry（无 /api 前缀）。需要 ADMIN_API_SECRET，
# 或带 prometheus:read 的管理会话。旧共享 API_SECRET 和 ?token= 会 401。
curl -sf -H "Authorization: Bearer ${ADMIN_API_SECRET}" \
    http://127.0.0.1:8080/prometheus-targets \
    > /opt/hive/management/prometheus/targets/nodes.json

# 通知 Prometheus 热重载
curl -sf -X POST http://127.0.0.1:4230/-/reload

# 另一条来源：用 Tailscale API 写同一个 targets 文件（脚本里也会请求上面的 reload）
/opt/hive/management/scripts/update-targets.sh
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

## 十二、客户设备网络地址

客户门户「我的设备」的独立地址页读取 `GET /api/portal/devices/{mac}/addresses`，仅设备所有者可访问；接口不返回设备凭证、订阅 token、Xray UUID，也不返回 Tailscale/EasyTier/Cloudflare Mesh 地址或 FRP 主机端口，不会下发命令、重启服务。

- `hostname`、`mac`、`last_seen` 为节点身份和最后心跳；接口不返回 Cloudflare 访问链接。
- `lan` 为物理有线网卡，以及 `iw` 报告为 AP 模式的无线接口（含虚拟 AP 接口）的 IPv4/IPv6 地址（含前缀长度），最多 32 项；不包含非 AP 模式的无线接口、回环、链路本地、无 `device` 的虚拟接口及 fake-IP 地址。
- `sampled_at` 是 registry 收到网络快照的 RFC3339 时间，与 `last_seen` 独立。旧 agent 不上报时为 `null`、`lan: []`；旧心跳不会刷新已有网络样本。
- `egress.ipv4` / `egress.ipv6` 为节点分别使用 IPv4/IPv6 HTTPS 请求 Cloudflare trace 的实际 `ip=`。探测禁用环境 HTTP 代理，但仍可能经过系统透明代理、隧道或上游 NAT：这是**节点请求路径所见出口，不保证直连 WAN 地址**。
- 出口按地址族缓存并最多每小时重试一次，失败保留上次成功地址和原始时间；从未成功则为空及 `sampled_at: null`。当两族成功时间不同，`egress.sampled_at` 取较旧时间，避免把旧地址标成新采样。LAN 每次心跳重新采集，出口时间不能用于判断 LAN 新鲜度。
- 物理接口采集失败时不提交网络快照，保留上次地址及采样时间；不会把采集失败误报为新鲜的空地址列表。页面分别在 LAN 样本超过 150 秒、出口观测超过两小时时提示陈旧。
- registry 校验不通过的网络快照（地址非法、出口时间超前 registry 时钟 5 分钟以上等）只丢弃快照、保留上次样本，心跳本身照常更新 `last_seen`，不会因此显示离线。

以上为新 agent 的心跳快照，不是实时查询。打开页面不会触发外网探测；已有节点需按正常固件/应用升级流程获得采集功能。

