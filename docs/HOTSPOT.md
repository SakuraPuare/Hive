# WiFi 热点（自动，双频）

当节点检测到**支持 AP 模式的无线网卡**时，镜像会自动开热点，把节点的上网链路共享出去。不改配置也会开机生效；热插拔同样会重新评估。

**频段策略（关键）**：WiFi 网卡是单 radio，一张卡同一时刻只能工作在一个频段，物理上**无法**用一张卡同时开 2.4G + 5G。因此：

- **单卡（常见）** —— 优先开 **5GHz（WPA3）**；卡不支持 5G 才回退 **2.4GHz（WPA2）**。`HOTSPOT_PREFER_BAND=2.4` 且该卡支持 2.4G 时只开 2.4G；卡没有 2.4G 时仍开 5G。
- **两张卡** —— 自动**双频**：5G 卡跑 **5GHz WPA3**，另一张跑 **2.4GHz WPA2**（5G 优先给 mt76）。

> 适用范围：
> - **NanoPi Zero2** —— 可外接 USB 无线网卡（如 MT AX5400 / AX210NGW）。
> - **Orange Pi 4 LTS** —— 板载 Spreadtrum UWE5622（sprdwl_ng）WiFi，焊死、不可插拔，**仅 2.4GHz**、不支持 WPA3。
>
> 逻辑**板子无关**：检测到支持 AP 的接口就自动开热点，无网卡时干净退出无副作用。
>
> ⚠️ 香橙派板载 Spreadtrum 属低端 SoC 无线，只能 2.4G WPA2、长跑可能掉线（重启 `hive-hotspot.service` 恢复），别当生产级路由器。USB 接 mt76 卡（MT AX5400）做 5G WPA3 可靠得多。

## SSID 与密码怎么来的

SSID 仍按节点**身份 MAC** 派生（与 hostname `hive-<mac6>` 同源：`/etc/hive/node-info` 里的 `MAC=`，否则取第一块非无线的非 lo 网卡，一般是 eth0）。密码**不是** MAC 哈希。

| 项 | 默认 | 说明 |
|------|------|------|
| 2.4G SSID | `Hive-<节点MAC大写>` | 例：`Hive-A4B2C1D0E5F6`。可用 `HOTSPOT_SSID_2G` 覆盖 |
| 5G SSID | `Hive-<节点MAC大写>-5G` | 例：`Hive-A4B2C1D0E5F6-5G`。可用 `HOTSPOT_SSID_5G` 覆盖 |
| 密码（两频共用） | 首次 `openssl rand -hex 16`（32 位十六进制） | 写入 `/etc/hive/default-hotspot-psk` 后反复运行沿用同一份。可用 `HOTSPOT_PSK` 覆盖 |

镜像构建会删掉 `default-hotspot-psk`，所以**新烧录的系统第一次开热点会生成新密码**；SSID 仍由 MAC 决定，重刷后不变。换无线网卡也不改默认 SSID。`HOTSPOT_PSK` 只覆盖当次生效的密码，不改写那份默认文件；把覆盖项留空后再跑脚本，会回到文件里的默认密码。

开机后可在节点上查看（MOTD 也会显示；值经 shell 引用写入，避免特殊字符被展开）：

```bash
grep -E '^WIFI_' /etc/hive/node-info
# WIFI_PSK=...
# WIFI_SSID_5G=Hive-A4B2C1D0E5F6-5G     # 5G 实际起来时
# WIFI_IFACE_5G=wlan0
# WIFI_5G_WIDTH=80
# WIFI_SSID_2G=... / WIFI_IFACE_2G=...  # 2.4G 实际起来时
# WIFI_SSID / WIFI_IFACE                # 兼容旧字段：有 2.4G 用 2.4G，否则用 5G
```

## 工作原理

1. **`hive-hotspot.service`**（开机；oneshot，成功结束后 inactive 是正常的）与 **udev 规则 `90-hive-hotspot.rules`**（新增无线网卡时 `systemctl restart` 该单元）都会调用 `/usr/local/bin/hive-hotspot.sh`。脚本用 `/run/hive-hotspot.lock` 避免和 udev 并发。
2. 脚本扫描所有无线网卡，用 `iw phy` 过滤出支持 AP 的，并解析每张卡未禁用的频段（2.4G / 5G）。没有 `iw` 或解析不到频段时按驱动兜底：mt76 / iwlwifi 视为双频，sprd / uwe 及其余驱动视为仅 2.4G。
3. **频段分配**：
   - 在支持 5G 的卡里挑驱动最优者（mt76 > iwlwifi）开 **5GHz WPA3**；
   - 在剩余卡里挑最优者（mt76 > iwlwifi > sprd）开 **2.4GHz WPA2**；
   - 单卡时只能开一个，优先 5G（见上）。
4. **落地方式两频不同**：
   - 2.4G 走 NetworkManager keyfile（`hive-hotspot-2g`，`band=bg` + `key-mgmt=wpa-psk`），`ipv4.method=shared`（`10.42.0.1/24`）：NM 自带 dnsmasq 发 DHCP/DNS 并做 NAT。
   - 5G 不走 NM。脚本按网卡 MAC 写入 `/etc/NetworkManager/conf.d/99-hive-hotspot-5g.conf`，把该卡标成 unmanaged，再交给 hostapd（`/etc/hostapd/hive-5g.conf`，`hive-hotspot-5g.service`：`wpa_key_mgmt=SAE`、`ieee80211w=2`，默认 ch149 / 80MHz）。DHCP/DNS 由 `hive-hotspot-5g-dnsmasq.service` 读取 `/etc/hive/dnsmasq-5g.conf`（地址 `10.42.1.1/24`）。开 5G 前 `iw reg set <国家码>`（默认 CN）；hostapd 单元启动前会再设一次。5G 的 hostapd 或 dnsmasq 没起来时会停掉这两个单元并清掉接口地址，**不会退回 NM**（unmanaged 配置仍留着）。
5. **没有可用代理时，连上热点也要能上网。** `hive-hotspot-firewall.sh` 与 `hive-hotspot-dns.sh` 用同一组前置条件决定是否把热点交给 mihomo：不存在旧固件残留的 `FORWARD -m comment --comment hive-subscription -j DROP`、`/etc/mihomo/config.yaml` 非空、mihomo 的 `SubState` 为 `running` 或 `start-post`。这两个脚本不读 `GATEWAY_ENABLED`。DNS 脚本还要求本机 UDP 1053 已在监听（有 `ss` 时）；`--wait` 最多再等约 5 秒。新固件不再安装那条 DROP，它只可能来自升级前的旧版本，`hive-clash-sync` / `hive-gateway-prepare` 首次运行就会删掉。
   - **代理模式**（前置条件满足）：5G dnsmasq 上游指向 mihomo `127.0.0.1#1053`（fake-IP）。`hive-gateway-route` 仅在 `GATEWAY_ENABLED` 恰好为 `on`（未设置时也是 on）、已有 mihomo 配置、并且认到 LAN/热点接口时，对热点接口做 tproxy，客户端 TCP/UDP 进 mihomo 的 `7893`。订阅无效但配置还在时，mihomo **继续运行**直连兜底（`MATCH,直连`），热点仍走这条 tproxy，而不是下面的直连规则。`GATEWAY_ENABLED` 为 `off` / `0` / `false` / `no` 时，`hive-gateway-prepare` 退出 1，systemd 跳过启动 `hive-mihomo`；route 在取值不是 `on` 时撤掉 tproxy。热点脚本不读这个开关，mihomo 没在跑就进入直连模式。网关数据面见 [透明代理网关](/GATEWAY)。
   - **直连模式**（其余情况：没有配置、mihomo 没在跑，或旧门禁 DROP 还在）：
     - `ip rule add from 10.42.0.0/24 lookup main pref 8000` 与 `10.42.1.0/24` 的同样规则，把热点源地址送回主路由表。这是为了躲开旧固件的 TUN auto-route（出口名默认 `Meta`，由 `GATEWAY_TUN_IFACE` 指定）；当前网关配置使用 tproxy，不再写 `tun:`。
     - 5G dnsmasq 上游换成公共 DNS（223.5.5.5、119.29.29.29），并 `ip rule add to <这些地址> lookup main pref 7000`。旧配置的 `dns-hijack: any:53` 会把本机发出的 53 端口查询抓成 fake-IP；直连模式下 fake-IP 在 main 表不可路由。
     - 给 `10.42.1.0/24` 加 MASQUERADE（注释 `hive-hotspot-nat`，出口不是 `GATEWAY_TUN_IFACE` 时才 NAT）。2.4G 的 NAT 仍由 NM `shared` 完成。
   - **转发放行是双向的**：入向按「AP 接口 + 热点网段」（注释 `hive-hotspot`），回程按 `conntrack --ctorigsrc <热点网段>`（注释 `hive-hotspot-ret`）。两条都插在旧固件遗留的订阅门禁 `DROP` 之上；新固件不再落 DROP，这段只在升级窗口生效。
   - 触发点：热点生成、`setup-firewall.sh`、`hive-mihomo.service.d/10-hive-hotspot.conf`（起停；DNS 用 `--wait`）、`hive-subscription-state` 里的 `hive_refresh_hotspot` / `hive_gateway_unblock_forward`。全部幂等。
   - 2.4G 的 UFW 洞由 NM dispatcher `90-hive-hotspot` 在 `hive-hotspot-2g` up 时放行、down 时撤销（接口名记在 `/run/hive-hotspot-ap-iface.hive-hotspot-2g`）。5G 不产生 NM 连接，UFW 由 `hive-hotspot-firewall.sh` 按 `/etc/hive/hotspot-5g.env` 的接口放行 DHCP/DNS 和转发。两处写 UFW 都持有 `/run/hive-ufw.lock`。

## 配置

脚本先读 `/etc/hive/config.env`，再读 `/etc/hive/hotspot.env`，后者覆盖前者。构建时仓库根目录 `.env` 里的同名变量会经 `configs/hive/config.env.tpl` 写进镜像里的 `config.env`；留空等价于未设置，脚本再用内建默认值。客户门户「我的设备」远程命令里的 **Wi-Fi 热点配置** 会把表单写入 `hotspot.env`（权限 600），然后重跑 `hive-hotspot.sh`。管理端节点控制可以启停逻辑服务 `hive-hotspot`，没有这张配置表。命令排队、权限和 10 分钟有效期见 [节点操作](/NODE-OPERATIONS)。

| 变量 | 默认 | 说明 |
|------|------|------|
| `HOTSPOT_COUNTRY` | `CN` | 两位国家码。5GHz AP 必需（CN 域下 36–48 整段是 DFS+RADAR，开不了 AP） |
| `HOTSPOT_5G_CHANNEL` | `149` | 5G 信道。CN 域可用 149/153/157/161/165（非 DFS） |
| `HOTSPOT_5G_WIDTH` | `80` | 5G 频宽。脚本按 `20` / `40` / `80` 生成 hostapd 配置；其它取值或无效组合（含 165 配 80MHz）降为 20MHz |
| `HOTSPOT_PREFER_BAND` | `5` | 单卡偏好：`5` 或 `2.4`。见文首 |
| `HOTSPOT_SSID_2G` / `HOTSPOT_SSID_5G` | MAC 派生 | 留空恢复默认 SSID |
| `HOTSPOT_PSK` | 持久化随机密码 | 留空恢复 `default-hotspot-psk` |

门户和 registry 下发 `hotspot-config` 时：SSID 留空或 1–32 位可打印 ASCII，密码留空或 8–63 位可打印 ASCII，国家码两位字母，频宽 `20|40|80`，偏好 `5|2.4`。门户上的 5G 信道选项是 36、40、44、48、149、153、157、161、165；表单默认国家码 CN、信道 149、频宽 80、偏好 5G。留空的 SSID 或密码会恢复设备默认值。

在节点上改文件后重跑：

```bash
/usr/local/bin/hive-hotspot.sh
```

远程启停不要直接操作系统里的 `hive-hotspot-5g`。白名单里只有逻辑服务 `hive-hotspot`：启动或重启会重跑 `hive-hotspot.sh`；停止会 `systemctl stop hive-hotspot-5g hive-hotspot-5g-dnsmasq`，并 `nmcli connection down hive-hotspot-2g`。

## 依赖

镜像构建时已安装：`wpasupplicant`（2.4G 的 NetworkManager AP 后端）、`hostapd`（5G；发行版自带的 `hostapd.service` 已 mask，避免空配置空跑）、`dnsmasq-base`（只取 `/usr/sbin/dnsmasq`，不起默认 service）、`iw`。固件先尝试 `armbian-firmware-full`，再尝试 `firmware-mediatek`、`firmware-iwlwifi`、`firmware-misc-nonfree`、`firmware-realtek`，某个包装不到就跳过。

内核侧各板 `configs/kernel/*.sh` 显式保活了对应 AP 驱动（zero2: `MT7921U` / `IWLWIFI` / `IWLMVM`；香橙派: `SPRDWL_NG` / `WLAN_UWE5622`）以及 `CFG80211` / `MAC80211`。

## 排查

```bash
# 2.4G 才是 NM 连接；5G 已从 NM 摘管，nmcli 里看不到 hive-hotspot-5g
nmcli connection show --active | grep hive-hotspot
systemctl status hive-hotspot-5g hive-hotspot-5g-dnsmasq
journalctl -t hive-hotspot       # 脚本与 dispatcher 日志

# 看网卡支持的频段与 AP 能力
iw phy phy0 info | sed -n '/Supported interface modes/,/valid interface/p'
iw reg get                       # 确认国家码已设（5G 必需）

# 手动重跑（幂等）。任一已分配频段没拉起来时脚本以非零退出
/usr/local/bin/hive-hotspot.sh

# 看 UFW 是否放行了 AP 接口
ufw status | grep -iE 'hive-hotspot|forward'
```

常见情况：

- **5G 热点起不来** —— 多半是国家码没设（`iw reg get` 显示 `country 00`）或信道选了 DFS 段。脚本默认 `iw reg set CN` + ch149。监管域数据库若仍是 Debian 签名，内核对不上 Armbian 的证书，`iw reg set` 会无效，构建时会把 `regulatory.db` 切到 upstream。仍失败时看卡是否真支持 5G AP（`iw phy` 的 5GHz 频段有没有未 disabled 的频率），以及 `journalctl -u hive-hotspot-5g`。失败时停掉 hostapd 与 dnsmasq 并清掉接口地址，不会改用 NM 再开一次。
- **客户端连上但不能上网** —— 先看节点自己有没有上行（`ping 8.8.8.8`），再按顺序查热点侧：
  ```bash
  cat /etc/hive/dnsmasq-5g.conf          # 上游是 127.0.0.1#1053 还是公共 DNS
  systemctl status hive-hotspot-5g-dnsmasq hive-hotspot-5g
  ip rule | grep -E '10\.42|223\.5|119\.29'                # 直连模式的策略路由
  iptables -t nat -S POSTROUTING | grep hive-hotspot-nat   # 5G 网段 MASQUERADE
  iptables -S FORWARD | grep hive-hotspot                  # 门禁之上的双向放行
  nft list table inet hive_gateway                         # 代理模式下的 tproxy
  /usr/local/bin/hive-hotspot-dns.sh && /usr/local/bin/hive-hotspot-firewall.sh
  ```
  两个脚本幂等，重跑即可恢复；`journalctl -t hive-hotspot-dns -t hive-hotspot-firewall` 有结果日志。
- **换了网卡后默认 SSID 没变** —— 正常。默认 SSID 绑节点身份 MAC，不绑无线网卡 MAC。密码以 `/etc/hive/default-hotspot-psk` 为准，换卡也不变，除非 `hotspot.env` / `config.env` 里设置了 `HOTSPOT_PSK`。
- **想让单卡改开 2.4G** —— 在 `/etc/hive/hotspot.env`（或 `config.env`）设 `HOTSPOT_PREFER_BAND=2.4` 后重跑脚本。`hotspot.env` 后读，同名变量以它为准。网卡不支持 2.4G 时仍会开 5G。
