# 透明代理网关（路由器角色）

节点不仅是"梯子的出口"（远端客户端经 CF Tunnel/VLESS 连进来从本节点出网），还可以同时充当"梯子的入口"：**任何设备只要连上本节点、流量经过本节点，就自动获得透明代理服务**，无需在客户端装任何软件。

实现核心是 **Mihomo（Clash.Meta）** 跑在节点上，用 **TUN + auto-redirect** 接管转发流量，按分流规则决定直连还是经上游出口节点代理。配置由 registry 面板动态下发。

## 适用场景

| 设备 | 角色 |
|------|------|
| **NanoPi R3S**（双千兆口） | 路由器：WAN 口接上游路由器自动 DHCP，LAN 口给下游设备发 DHCP + 透明代理 |
| 有 WiFi 网卡的设备 | WiFi 热点的下游客户端同样自动走透明代理 |
| 单网口设备 | 仍启用 Mihomo，接管本机转发流量（如热点下游）；无下游则空载不占流量 |

> 网关角色**默认在所有设备启用**（`GATEWAY_ENABLED=on`）。无下游设备时 Mihomo 空载，几乎不占资源；这样任何设备一旦接上网卡/网线即开箱即用。

## 双网口怎么分 WAN / LAN

`hive-gateway.sh` 开机自动探测有线网卡：

- **WAN 口**：默认选"当前有默认路由的那个口"（接上游路由器，走 DHCP 客户端）。可用 `GATEWAY_WAN_IFACE` 指定。
- **LAN 口**：WAN 之外的有线口，配静态 `10.42.2.1/24` + NetworkManager `method=shared`（自带 dnsmasq 发 DHCP + NAT）。可用 `GATEWAY_LAN_IFACE` 指定。

> LAN 网段 `10.42.2.x` 起，避开 WiFi 热点占用的 `10.42.0.x`（2.4G）和 `10.42.1.x`（5G）。

下游设备插上 LAN 口即自动拿到 IP、流量自动透明代理。MOTD 会显示 WAN/LAN 口和面板地址。

## 分流方向（按节点位置配置）

每个节点的分流方向在面板里配（字段 `gateway_direction`），决定 CN 流量和其余流量分别直连还是走代理：

| 方向 | CN 流量 | 其余流量 | 适用 |
|------|---------|----------|------|
| `domestic`（境内，默认） | 直连 | 走代理（甩给境外出口） | 节点在国内，给本地 LAN 提供翻墙 |
| `overseas`（境外） | 走代理（甩给境内出口拿国内 IP） | 直连 | 节点在墙外，访问国内站点回国 |
| `global`（全局代理） | 走代理 | 走代理 | 全部流量都走代理链路 |
| `direct`（全直连） | 直连 | 直连 | 仅做智能路由 NAT，不代理 |

## 上游出口怎么选

网关的"代理"流量要送到集群里**别的出口节点**（境外节点的现有 Xray VLESS 出口）。上游池由 registry 自动生成——列出集群所有 enabled 出口节点，**且永远排除节点自己**（不会自己代理给自己造成回环）。

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

出口节点上同时跑着 Xray 出口（freedom 直连出网）和 Mihomo 网关。为防止 Xray 的出站流量被本机 Mihomo 二次代理成死循环，做了三重隔离：

1. **不启用 auto-redirect**（避免 DNAT 到 loopback 在 RK vendor 内核上撞出 martian）；但 `auto-route: true` 会把**本机自身出站也送进 TUN**——`ip route get 1.1.1.1` 会返回 `via 198.18.0.2 dev Meta`。所以"本机流量不进 TUN"这个前提不成立。
2. 规则顶部 `PROCESS-NAME,xray/cloudflared/warp-svc/easytier-core/frpc/tailscaled,DIRECT` —— 意图是本机守护进程一律直连。**实测该规则在节点上匹配不到进程**（`find-process-mode: always` 亦然），不能作为唯一防线。
3. 上游 VLESS 出口节点地址 Mihomo 内置永远直连。

## fail-closed（无有效订阅时）

`hive-gateway-prepare` 与 `hive_stop_gateway` 会把配置的 `rules` 整体换掉，客户流量一概拒绝：

```yaml
rules:
  - SRC-IP-CIDR,198.18.0.1/32,DIRECT      # 本机出站：源地址就是 TUN 地址（见上）
  - PROCESS-NAME,curl,DIRECT              # 能匹配时的精确白名单
  - …（xray / cloudflared / easytier-core / frpc / tailscaled）
  - MATCH,REJECT
```

第一条不可省。删掉它就只剩进程名白名单，而进程名匹配在本机不可靠：节点自己到 registry 的 TLS 会落到 `MATCH,REJECT`（现象是 `SSL ... unexpected eof while reading`、`allocate-easytier` 六连败），拿不到配置又连不上 registry——fail-closed 变成自锁，节点永远无法恢复。`SRC-IP-CIDR` 从配置的 `tun.inet4-address` 推导，缺省用 mihomo 默认的 `198.18.0.1`（`hive-subscription-state` 的 `hive_tun_ipv4`）。

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
[本节点] Mihomo (TUN + auto-redirect，只接管转发流量)
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
| `hive-mihomo.service` | 跑 Mihomo（`/etc/mihomo/config.yaml`） |
| `hive-clash-sync` + `.timer` | 每 ~1 分钟从 registry 拉配置并热重载 |
| `/etc/mihomo/config.yaml` | Mihomo 运行配置（首启用内置兜底，sync 后被 registry 下发覆盖） |

## 故障排查

```bash
hive-test.sh                          # 含网关自检项（mihomo/TUN/面板/拓扑）
systemctl status hive-mihomo          # Mihomo 是否在跑
journalctl -u hive-mihomo -f          # Mihomo 日志
journalctl -u hive-clash-sync -f      # 配置同步日志
cat /etc/mihomo/config.yaml           # 当前生效配置（含上游节点/规则）
ip link show | grep -i meta           # TUN 设备是否存在
curl -s http://127.0.0.1:9090/version # Clash API 是否响应
nft list ruleset | grep -i mihomo     # auto-redirect 的 nft 规则
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
