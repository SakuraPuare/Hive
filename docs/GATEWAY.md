# 透明代理网关（路由器角色）

节点不仅是"梯子的出口"（远端客户端经 CF Tunnel/VLESS 连进来从本节点出网），还可以同时充当"梯子的入口"：**任何设备只要连上本节点、流量经过本节点，就自动获得透明代理服务**，无需在客户端装任何软件。

实现核心是 **Mihomo（Clash.Meta）** 跑在节点上，用 **TPROXY** 只接管 LAN/AP 的转发流量（本机自身出站不进代理），按分流规则决定直连还是经上游出口节点代理。配置由 registry 面板动态下发，节点侧还会把旧模板里的 `tun:` 幂等改写成 `tproxy-port`。

## 适用场景

| 设备 | 角色 |
|------|------|
| **NanoPi R3S**（双千兆口） | 路由器：WAN 口接上游路由器自动 DHCP，LAN 口给下游设备发 DHCP + 透明代理 |
| 有 WiFi 网卡的设备 | WiFi 热点的下游客户端同样自动走透明代理 |
| 单网口、无无线设备 | 单臂网关：同网段客户端手动把默认网关指向本机（不提供 DHCP）；节点启用 IPv4 转发、NAT 和防火墙放行 |

> 网关角色**默认在所有设备启用**（`GATEWAY_ENABLED=on`）。无下游设备时 Mihomo 空载，几乎不占资源；这样任何设备一旦接上网卡/网线即开箱即用。

## 双网口怎么分 WAN / LAN

`hive-gateway.sh` 开机自动探测有线网卡：

- **WAN 口**：默认选"当前有默认路由的那个口"（接上游路由器，走 DHCP 客户端）。可用 `GATEWAY_WAN_IFACE` 指定。
- **LAN 口**：WAN 之外的有线口，配静态 `10.42.2.1/24` + NetworkManager `method=shared`（自带 dnsmasq 发 DHCP + NAT）。可用 `GATEWAY_LAN_IFACE` 指定。

> LAN 网段 `10.42.2.x` 起，避开 WiFi 热点占用的 `10.42.0.x`（2.4G）和 `10.42.1.x`（5G）。

下游设备插上 LAN 口即自动拿到 IP、流量自动透明代理。MOTD 会显示 WAN/LAN 口和面板地址。

## 单网口无无线：单臂网关

`hive-gateway.sh` 检测到 **恰好 1 个物理有线口且没有无线网卡** 时，不再直接退出，而是配置单臂网关：

- 不安装 DHCP 服务，不改变现有网口地址；
- 开启 `net.ipv4.ip_forward=1`；
- 为同网段客户端插入转发放行（在订阅门禁 DROP 之后）和直连路径的 `MASQUERADE`；
- 在 `/etc/hive/node-info` 写入 `GATEWAY_ONE_ARM_IFACE/IP/NET`，MOTD 显示客户端应使用的网关地址。

使用时需要客户端**手动把默认网关设为节点 IP**（例如 `192.168.5.226`），DNS 可继续用上游路由器或公共 DNS。节点地址若由上游 DHCP 下发，建议在路由器上做静态租约，避免地址变化后客户端网关失效。

如果后来插上 USB 有线网卡（变成双网口）或检测到无线网卡，脚本会清理单臂规则，按双网口 WAN/LAN 或 WiFi 热点路径处理。

## 分流方向（按节点位置配置）

每个节点的分流方向在面板里配（字段 `gateway_direction`），决定 CN 流量和其余流量分别直连还是走代理：

| 方向 | CN 流量 | 其余流量 | 适用 |
|------|---------|----------|------|
| `domestic`（境内，默认） | 直连 | 走代理（甩给境外出口） | 节点在国内，给本地 LAN 提供翻墙 |
| `overseas`（境外） | 走代理（甩给境内出口拿国内 IP） | 直连 | 节点在墙外，访问国内站点回国 |
| `global`（全局代理） | 走代理 | 走代理 | 全部流量都走代理链路 |
| `direct`（全直连） | 直连 | 直连 | 仅做智能路由 NAT，不代理 |

## 上游出口怎么选

网关的"代理"流量要送到集群里**别的出口节点**（境外节点的现有 Xray VLESS 出口）。上游池由 registry 自动生成——列出集群所有 `exit_enabled && owner_exit_enabled && enabled && status=active` 的出口节点（默认所有节点都是出口，管理员或设备所有者可关闭），**且永远排除节点自己**（不会自己代理给自己造成回环）。

授权检查前先排除本网关，并与所绑定订阅的套餐线路取交集。若有效上游为空（例如线路只包含本网关），返回 `X-Hive-Access: blocked` 与 REJECT 配置，不会静默降级为全直连。

面板里每个节点可配 `gateway_upstream_mode`：

- **`auto`（自动，默认）**：Mihomo 的 `url-test` 组在全部上游里自动选**延迟最低**的，单点故障自动切换。
- **`manual`（手动）**：在面板里勾选指定的几个上游节点，Mihomo 暴露"手动选择"组供切换。

两个组都在下发的 Mihomo 配置里，面板上还能在 `:9090/ui` 实时手动切换。

## 可视化面板（MetaCubeXD）

Mihomo 内置 `external-controller`（Clash API）+ `external-ui` 托管 MetaCubeXD 面板：

```
http://<节点 LAN IP>:9090/ui    # 10.42.2.1 有线 LAN / 10.42.1.1 5G 热点 / 10.42.0.1 2.4G
http://<easytier_ip>:9090/ui    # 172.20.x（mesh 内）
http://<tailscale_ip>:9090/ui   # 100.64.x（tailnet 内）
```

面板可看实时连接、流量曲线、切换节点和规则。`setup-firewall.sh` 只对私网段
（`192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`）与 Tailscale CGNAT（`100.64.0.0/10`）
放行 9090，不暴露公网。

**客户门户**（`/portal/devices` 设备行的 "Mihomo 面板"）提供两条路：

- **实时流量**：registry 用 `GET /portal/devices/{mac}/mihomo/connections` 代理到节点
  9090（自动加 per-node secret），门户每 2 秒采样算瞬时速率——客户不在节点 LAN/mesh
  里也能看；节点离线/断链返回 503，前端显示"不可达"。
- **面板地址 + secret**：打开完整面板需要处在设备的 WiFi / EasyTier / Tailscale 网络内。
  secret 由服务端派生，与节点配置一致：
  `HMAC-SHA256(ADMIN_SESSION_SECRET, "hive-mihomo-secret:v2:"+MAC)`（64 hex）。

## 防回环（重要）

Mihomo 只接管 **LAN/AP 的转发流量**（`prerouting`），本机自身出站不进入 tproxy。Xray（以专用 `xray` 用户/组运行）、registry、cloudflared、tailscaled 都是真正的直连，不再需要 TUN 时代的 `SRC-IP-CIDR`/`PROCESS-NAME` 自直连规则，也不再需要 Xray 的 skgid mark/fwmark 旁路。

数据面：

1. `hive-gateway-route.service` 只在 LAN/AP `iifname` 上安装 tproxy：`fib daddr type local return`，TCP/UDP `tproxy to :7893` + `meta mark 0x2`；配套 `ip rule fwmark 0x2 lookup 100` 和 table 100 的 `local 0.0.0.0/0 dev lo`（v4/v6）。
2. 客户端 DNS 由独立 `nat` 链 `redirect to :1053` 到 mihomo `dns.listen`；`input` 链放行 marked/DNS 包，避免被 ufw 的默认拒绝规则丢掉。
3. fake-IP 只服务客户端；本机解析器不再被 mihomo 接管。Xray 出口仍保留自己的 DoH，域名解析不依赖宿主 resolver。
4. fail-closed：blocked 配置对热点源网段 `DIRECT`、其余 `MATCH,REJECT`；mihomo 停止时 `hive-gateway-route` 通过 `PartOf` 一并停止，规则撤掉后客户端直连。TUN 时代的源/进程白名单仍由 blocked 配置生成，但 tproxy 下不会命中，属于历史兜底。

## fail-closed（无有效订阅时）

客户解绑、管理员解除/变更设备所有者、再次认领时，会同步清空原有订阅绑定并重置所有者出口偏好；重复分配给同一客户则保留其绑定与偏好。已归属客户的网关只接受该客户的订阅，遗留的跨客户绑定也会被配置接口拒绝。无主的运营方网关仍允许管理员显式绑定客户订阅；认领后必须由新所有者重新绑定。撤销配置在下次同步生效，失联时由现有短租约到期机制阻断。

`hive-gateway-prepare` 与 `hive_stop_gateway` 会把配置的 `rules` 整体换掉，客户流量一概拒绝：

```yaml
rules:
  - SRC-IP-CIDR,198.18.0.1/32,DIRECT            # 本机出站 v4：源地址就是 TUN 地址
  - SRC-IP-CIDR,fdfe:dcba:9876::1/128,DIRECT    # 本机出站 v6（auto-route 也接管 ::/1）
  - PROCESS-NAME,curl,DIRECT                    # 能匹配时的精确白名单
  - …（xray / cloudflared / easytier-core / frpc / tailscaled）
  - SRC-IP-CIDR,10.42.0.0/24,DIRECT             # WiFi 热点客户端（2.4G）
  - SRC-IP-CIDR,10.42.1.0/24,DIRECT             # WiFi 热点客户端（5G）
  - MATCH,REJECT
```

tproxy 下这些 TUN 时代的源/进程规则由 blocked 配置继续生成，但本机出站根本不进 mihomo，不会命中，属于历史兜底；真正生效的是热点源网段 `DIRECT` 和其余 `MATCH,REJECT`。`hive_gateway_block_config` 仍强制 `respect-rules: false`：否则 mihomo 自己的解析请求会被 `MATCH,REJECT` 拒掉，节点拿不到订阅、fail-closed 变自锁。v4/v6 地址推导函数仍保留给旧 TUN 配置兜底。

**WiFi 热点不受这套门禁约束**：AP 是与代理网关独立的共享上网功能，没有订阅配置时连上热点也要有网。mihomo 不运行/无配置时 `hive-gateway-route` 不安装 tproxy 规则，热点客户端直连；dnsmasq 在 1053 不在听时改用公共 DNS（`hive-hotspot-dns`）。mihomo 正常时 dnsmasq 转发到 1053，客户端拿 fake-IP，连接被 tproxy 接管；blocked 配置里的 `SRC-IP-CIDR,10.42.0.0/24`、`10.42.1.0/24,DIRECT` 让热点在 fail-closed 时仍直连。`FORWARD` 门禁 DROP 之上有双向放行（入向 AP 接口+热点网段，回程 `--ctorigsrc` 热点网段），每轮重落 DROP 都会重插。细节见 [HOTSPOT.md](HOTSPOT.md)。

**Tailscale 域名必须排除出 fake-IP**：`tailscaled` 的控制面连接绑定在物理网卡地址上（`--accept-dns=false` 也一样），实测 `SYN-SENT 192.168.5.222:36686 -> 198.18.0.20:443`——fake-IP 只有"源地址 198.18.0.1、走 TUN"的流量才有反向映射，绑定端0 的 SYN 直接出公网，于是注册 10s 超时、节点永远进不了 tailnet。安装配置时会向 `dns.fake-ip-filter` 补 `'+.tailscale.com'`/`'+.tailscale.io'`（真实地址仍按域名走规则分流）。

另外 `dns.respect-rules` 会被强制改成 `false`：交付配置里它是 `true`，于是 mihomo 自己的 DoH 也要过规则，而节点没有可用上游时终端规则是 `RULE-SET,cn_domain,REJECT`/`MATCH,REJECT`——实测 `[TCP] mihomo --> 223.5.5.5:443 match Match using REJECT`，解析全灭，tailscaled 注册 `context deadline exceeded`，节点在面板上永久离线。

## 配置项（`/etc/hive/config.env`）

```bash
GATEWAY_ENABLED=on              # on/off，默认 on
GATEWAY_WAN_IFACE=              # WAN 口名，留空自动探测
GATEWAY_LAN_IFACE=              # LAN 口名，留空自动
GATEWAY_DASHBOARD_PORT=9090     # 面板端口，默认 9090
```

分流方向与上游节点不在这里配，由 registry 面板下发（动态、按节点）。

## 工作流程

```
LAN/WiFi 设备
   │ (网关 = 本节点，DHCP 自动下发)
   ▼
[本节点] Mihomo (TUN + auto-route，只接管转发流量)
   │   ├─ 命中"直连"规则 ───────────────► 本机 WAN 直接出
   │   └─ 命中"代理"规则 ─► VLESS-WS ─► [其它 Hive 节点] Xray 出口 ─► 出网
   │
   └─ Clash API ──► MetaCubeXD 面板 (http://<lan-ip>:9090/ui)

配置来源：registry 按节点 direction/上游 生成 Mihomo 配置
          → hive-clash-sync 每 ~1 分钟拉取 + 热重载（不断流）
```

## 服务与脚本

| 组件 | 作用 |
|------|------|
| `hive-gateway.sh` + `hive-gateway.service` | 开机探测有线拓扑，配 WAN/LAN |
| `xray.service` | Xray 出口，以专用 `xray` 用户/组运行（非 root） |
| `hive-xray-prepare.service` | root oneshot：生成 Xray 配置并设成 `root:xray 640` |
| `hive-gateway-route.service` | nft tproxy（仅 LAN/AP）+ fwmark 0x2 ip rule；随 mihomo 停止 |
| `hive-mihomo.service` | 跑 Mihomo（`tproxy-port: 7893`，无 TUN） |
| `hive-clash-sync` + `.timer` | 每 ~1 分钟从 registry 拉配置并热重载 |
| `/etc/mihomo/config.yaml` | Mihomo 运行配置（首启用内置兜底，sync 后被 registry 下发覆盖） |

## 故障排查

```bash
hive-test.sh                          # 含网关自检项（mihomo/tproxy/面板/拓扑）
systemctl status hive-mihomo          # Mihomo 是否在跑
systemctl status hive-gateway-route   # tproxy nft/ip rule 是否就位
journalctl -u hive-mihomo -f          # Mihomo 日志
journalctl -u hive-clash-sync -f      # 配置同步日志
cat /etc/mihomo/config.yaml           # 当前生效配置（含上游节点/规则）
grep -E '^(tun|tproxy-port):' /etc/mihomo/config.yaml
curl -s http://127.0.0.1:9090/version # Clash API 是否响应
nft list table inet hive_gateway      # TPROXY/DNS redirect 规则
ip rule show | grep 'fwmark 0x2 lookup 100'
ps -o user= -C xray                   # 必须是 xray，不是 root
```

- **下游设备拿不到 IP**：检查 LAN 口 NM 连接 `nmcli connection show | grep hive-lan`，及 `method=shared` 是否激活。接口角色变化后旧 `hive-lan-*` 连接会被 `hive-gateway.sh` 删除；若手动改过接口用途，确认 WAN 口上没有任何 `method=shared` 的连接。
- **`hive-clash-sync` 每 15s 失败 + mihomo 反复重启 + `allocate-easytier` 六连败**：先看 `journalctl -u provision-node`。
  - `!!! FATAL: 设备 … 没有 device credential`：该 MAC 还没签发凭证，按 [Provision 文档](/PROVISION) 第六节写入 `/etc/hive/device-token`。
  - `invalid device credential`（http=401）：token 被轮换/吊销，重新签发。
  - 以上都不是的话，检查 `/etc/mihomo/config.yaml` 的 `rules` 第一条是否仍是 `SRC-IP-CIDR,<tun 地址>/32,DIRECT`；丢了它就会出现 `SSL ... unexpected eof` 这类"连 TLS 都握不完"的现象。
- **流量没走代理**：看 `/etc/mihomo/config.yaml` 的 `rules` 和上游池是否非空；`gateway_direction` 是否配对（境内应 `domestic`）。
- **面板打不开**：确认 `:9090` 可达、`/var/www/metacubexd` 非空（由 `download-binaries.sh` 预置）。
- **配置不更新**：`systemctl start hive-clash-sync` 手动触发；检查 `NODE_REGISTRY_URL` 可达。

相关：[WiFi 热点](/HOTSPOT)、[节点操作](/NODE-OPERATIONS)、[防火墙](/FIREWALL)
