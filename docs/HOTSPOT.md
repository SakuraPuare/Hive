# WiFi 热点（自动，双频）

当节点检测到**支持 AP 模式的无线网卡**时，镜像会自动开热点，把节点的上网链路共享出去。无需任何配置，开机即生效；热插拔同样即插即开。

**频段策略（关键）**：WiFi 网卡是单 radio，一张卡同一时刻只能工作在一个频段，物理上**无法**用一张卡同时开 2.4G + 5G。因此：

- **单卡（常见）** —— 优先开 **5GHz（WPA3）**；卡不支持 5G 才回退 **2.4GHz（WPA2）**。
- **两张卡** —— 自动**双频**：5G 卡跑 **5GHz WPA3**，另一张跑 **2.4GHz WPA2**（5G 优先给 mt76）。

> 适用范围：
> - **NanoPi Zero2** —— 可外接 USB 无线网卡（如 MT AX5400 / AX210NGW）。
> - **Orange Pi 4 LTS** —— 板载 Spreadtrum UWE5622（sprdwl_ng）WiFi，焊死、不可插拔，**仅 2.4GHz**、不支持 WPA3。
>
> 逻辑**板子无关**：检测到支持 AP 的接口就自动开热点，无网卡时干净退出无副作用。
>
> ⚠️ 香橙派板载 Spreadtrum 属低端 SoC 无线，只能 2.4G WPA2、长跑可能掉线（重启 `hive-hotspot.service` 恢复），别当生产级路由器。USB 接 mt76 卡（MT AX5400）做 5G WPA3 可靠得多。

## SSID 与密码怎么来的

与全仓库"一切从 MAC 确定性派生"一致，热点凭证由节点**身份 MAC**（hostname `hive-<mac6>`、SSH host key、xray UUID 同源的那块"通用 MAC"，一般是 eth0）确定性派生：

| 频段 | SSID | 加密 | 示例 |
|------|------|------|------|
| 2.4G | `Hive-<节点MAC大写>` | WPA2-PSK | `Hive-A4B2C1D0E5F6` |
| 5G | `Hive-<节点MAC大写>-5G` | WPA3-SAE | `Hive-A4B2C1D0E5F6-5G` |
| 密码（两频共用） | `sha256("hive-wifi-psk:"+MAC)` 前 16 位 | — | `af4b5250ae5b9dc3` |

特性：**每台唯一**（MAC 派生不撞）、**重刷不变**、密码 16 位十六进制对 WPA2/WPA3 均合法。

开机后可在节点上查看（MOTD 也会显示）：

```bash
grep -E '^WIFI_' /etc/hive/node-info
# WIFI_PSK=af4b5250ae5b9dc3
# WIFI_SSID_5G=Hive-A4B2C1D0E5F6-5G     # 单卡支持 5G 时
# WIFI_IFACE_5G=wlan0
# （两张卡时还会有 WIFI_SSID_2G / WIFI_IFACE_2G）
```

## 工作原理

1. **`hive-hotspot.service`**（开机）与 **udev 规则 `90-hive-hotspot.rules`**（热插拔）都会调用 `/usr/local/bin/hive-hotspot.sh`。
2. 脚本扫描所有无线网卡，用 `iw phy` 过滤出支持 AP 的，并解析每张卡支持的频段（2.4G / 5G）。
3. **频段分配**：
   - 在支持 5G 的卡里挑驱动最优者（mt76 > iwlwifi）开 **5GHz WPA3**；
   - 在剩余卡里挑最优者（mt76 > iwlwifi > sprd）开 **2.4GHz WPA2**；
   - 单卡时只能开一个，优先 5G（见上）。
4. **落地方式两频不同**：
   - 2.4G 走 NetworkManager keyfile（`hive-hotspot-2g`，`band=bg` + `key-mgmt=wpa-psk`），`ipv4.method=shared`（`10.42.0.1/24`）：NM 自带 dnsmasq 发 DHCP/DNS 并做 NAT。
   - 5G 走独立 hostapd（`hive-hotspot-5g.service`，WPA3-SAE + `pmf=2`，默认 ch149/80MHz），DHCP/DNS 由独立 dnsmasq（`hive-hotspot-5g-dnsmasq.service`，`10.42.1.1/24`）提供；开 5G 前 `iw reg set <国家码>`（默认 CN，5G AP 必需）。
5. **出网与 DNS 不依赖 mihomo**（mihomo 没有配置 / `GATEWAY_ENABLED=off` / 订阅未授权时，连上热点照样要有网）。热点有两种模式，由 `hive-hotspot-firewall.sh` 与 `hive-hotspot-dns.sh` 共同决定，**判据相同**：没有旧固件残留的门禁 `FORWARD -j DROP`、`/etc/mihomo/config.yaml` 存在、mihomo 在跑 —— 三条都满足才把热点交给 mihomo。新固件不再安装该 DROP；它只可能来自升级前的旧版本，`hive-clash-sync`/`hive-gateway-prepare` 首次运行就会删掉。
   - **代理模式**（三条都满足）：dnsmasq 上游指向 mihomo `127.0.0.1#1053`（fake-IP 分流），客户端流量按 tproxy 进 mihomo。订阅无效时 mihomo 跑的是直连兜底配置（`MATCH,直连`），热点照常上网。
   - **直连模式**（其余情况）：
     - `ip rule add from 10.42.1.0/24 lookup main pref 8000` 把热点流量从 TUN 摘到主路由表（旧固件 REJECT 配置下否则 HTTPS 全超时）；`10.42.0.0/24` 同样处理。
     - dnsmasq 上游换成公共 DNS（223.5.5.5、119.29.29.29）。**只改上游还不够**：本机到这些服务器的 53 端口查询会被 mihomo 的 `dns-hijack: any:53` 抓走并回 fake-IP，所以还要 `ip rule add to <resolver> lookup main pref 7000` 让解析走真实网络。
     - 给 `10.42.1.0/24` 加 SNAT（`! -o Meta` 时才 NAT），客户端经物理上行直连出网。
   - **转发放行是双向的**：入向按「AP 接口 + 热点网段」、回程按 `conntrack --ctorigsrc <热点网段>`（出向 oif=AP 接口），两条都插在旧固件遗留的订阅门禁 `DROP` 之上；新固件不再落 DROP，这段只在升级窗口生效。
   - 触发点：热点生成、`setup-firewall.sh`、`hive-mihomo.service.d/10-hive-hotspot.conf`（起停）、网关兜底/恢复（`hive_gateway_unblock_forward`）。全部幂等。
   - 启动钩子接受 Mihomo 的 `SubState=running|start-post`；`ExecStartPost` 时单元仍是 activating，但进程已启动。DNS 脚本继续等待 1053 监听就绪；停止或失败状态仍使用公共 DNS。
   - 2.4G 的 UFW 洞由 NM dispatcher `90-hive-hotspot` 在连接 up 时放行、down 时撤销（接口名持久化到 `/run` 供精确清理）。

## 配置（可选，`/etc/hive/config.env` 或构建时 `.env` 覆盖）

| 变量 | 默认 | 说明 |
|------|------|------|
| `HOTSPOT_COUNTRY` | `CN` | 5GHz AP 必需的国家码（CN 域下 36-48 整段是 DFS+RADAR，开不了 AP） |
| `HOTSPOT_5G_CHANNEL` | `149` | 5G 信道，CN 域用 149/153/157/161/165（非 DFS） |
| `HOTSPOT_PREFER_BAND` | `5` | 单卡偏好频段：`5`（优先 5G WPA3）或 `2.4` |

## 依赖

镜像构建时已自动安装：`wpasupplicant`（2.4G 走 NM 的 AP 后端，支持 WPA3-SAE）、`hostapd`（5G 独立托管；发行版自带的 `hostapd.service` 已 mask）、`dnsmasq-base`（只取 `/usr/sbin/dnsmasq` 二进制，不起默认 service）、`iw`、WiFi 固件（`armbian-firmware-full` 等）。

内核侧各板 `configs/kernel/*.sh` 显式保活了对应 AP 驱动（zero2: `MT7921U`/`IWLWIFI`/`IWLMVM`；香橙派: `SPRDWL_NG`/`UWE5622`）+ `CFG80211`/`MAC80211`，防止内核精简误删。

## 排查

```bash
# 看两个频段热点是否激活
nmcli connection show --active | grep hive-hotspot
journalctl -t hive-hotspot       # 脚本与 dispatcher 日志

# 看网卡支持的频段与 AP 能力
iw phy phy0 info | sed -n '/Supported interface modes/,/valid interface/p'
iw reg get                       # 确认国家码已设（5G 必需）

# 手动重跑（幂等）
/usr/local/bin/hive-hotspot.sh

# 看 UFW 是否放行了 AP 接口
ufw status | grep -iE 'hive-hotspot|forward'
```

常见情况：

- **5G 热点起不来** —— 多半是国家码没设（`iw reg get` 显示 `country 00`）或信道选了 DFS 段。脚本默认 `iw reg set CN` + ch149，若仍失败检查卡是否真支持 5G AP（`iw phy` 的 Band 2 是否有非 disabled 频率）。
- **客户端连上但不能上网** —— 先看节点自己有没有上行（`ping 8.8.8.8`），再按顺序查热点侧：
  ```bash
  cat /etc/hive/dnsmasq-5g.conf          # 上游是 127.0.0.1#1053(mihomo) 还是公共 DNS
  systemctl status hive-hotspot-5g-dnsmasq hive-hotspot-5g
  ip rule | grep -E '10\.42|223\.5|119\.29'                # 直连模式的策略路由
  iptables -t nat -S POSTROUTING | grep hive-hotspot-nat   # 5G 网段 SNAT
  iptables -S FORWARD | grep hive-hotspot                  # 门禁之上的双向放行
  /usr/local/bin/hive-hotspot-dns.sh && /usr/local/bin/hive-hotspot-firewall.sh
  ```
  两个脚本幂等，重跑即可恢复；`journalctl -t hive-hotspot-dns -t hive-hotspot-firewall` 有结果日志。
- **换了网卡后 SSID 没变** —— 正常。SSID/密码绑节点身份 MAC（eth0），非无线网卡 MAC，换卡不影响。
- **想让单卡也强制 2.4G** —— 在 `/etc/hive/config.env` 设 `HOTSPOT_PREFER_BAND=2.4` 后重跑脚本。
