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
4. 为每个频段写一份 NetworkManager keyfile，**按选中网卡 MAC 绑定**（`hive-hotspot-5g` / `hive-hotspot-2g`，权限 600）：
   - 5G：`band=a` + `channel=36`（免 DFS）+ `key-mgmt=sae` + `pmf=2`（WPA3 强制管理帧保护）；开 5G 前 `iw reg set <国家码>`（默认 CN，5G AP 必需）。
   - 2.4G：`band=bg` + `key-mgmt=wpa-psk`（WPA2）。
   - 两频用 `ipv4.method=shared` 各占一个网段（5G=`10.42.1.1/24`、2.4G=`10.42.0.1/24`），各自起 dnsmasq 发 DHCP/DNS 并 NAT，互不冲突。
5. **防火墙互通**：UFW `deny incoming`+`deny forward` 会挡热点流量。dispatcher 脚本 `90-hive-hotspot` 在每个热点连接 up 时按实际 AP 接口动态放行转发、DHCP(67)、DNS(53)，down 时撤销（接口名持久化到 `/run` 供 down 时精确清理）。

## 配置（可选，`/etc/hive/config.env` 或构建时 `.env` 覆盖）

| 变量 | 默认 | 说明 |
|------|------|------|
| `HOTSPOT_COUNTRY` | `CN` | 5GHz AP 必需的国家码（CN/US 下 36-48 免 DFS） |
| `HOTSPOT_5G_CHANNEL` | `36` | 5G 信道，建议 36/40/44/48（免 DFS） |
| `HOTSPOT_PREFER_BAND` | `5` | 单卡偏好频段：`5`（优先 5G WPA3）或 `2.4` |

## 依赖

镜像构建时已自动安装：`wpasupplicant`（NM 的 AP 后端，trixie 默认，支持 WPA3-SAE，**无需** hostapd）、`dnsmasq-base`、`iw`、WiFi 固件（`armbian-firmware-full` 等）。

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

- **5G 热点起不来** —— 多半是国家码没设（`iw reg get` 显示 `country 00`）或信道选了 DFS 段。脚本默认 `iw reg set CN` + channel 36，若仍失败检查卡是否真支持 5G AP（`iw phy` 的 Band 2 是否有非 disabled 频率）。
- **客户端连上但不能上网** —— 检查节点本身有没有上行（`ping 8.8.8.8`），以及 `ufw status` 里该 AP 接口的 route allow 规则是否在。
- **换了网卡后 SSID 没变** —— 正常。SSID/密码绑节点身份 MAC（eth0），非无线网卡 MAC，换卡不影响。
- **想让单卡也强制 2.4G** —— 在 `/etc/hive/config.env` 设 `HOTSPOT_PREFER_BAND=2.4` 后重跑脚本。
