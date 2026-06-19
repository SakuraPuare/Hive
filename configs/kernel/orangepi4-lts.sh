#!/bin/bash
# orangepi4-lts (Rockchip RK3399 / 2×Cortex-A72 + 4×Cortex-A53) 内核配置优化
#
# 基线: Armbian linux-rockchip64-current.config
# 目的: 禁用香橙派 Pi 4 LTS 路由器/VPN 网关场景不需要的驱动和子系统，减少编译时间
#
# 注意: 香橙派 Pi 4 LTS 板载 WiFi/BT 是 Spreadtrum 芯片，WiFi 走 SDIO 的
#       in-tree 内核模块 sprdwl_ng（CONFIG_SPRDWL_NG / CONFIG_WLAN_UWE5622），
#       由 board 配置的 MODULES_CURRENT="sprdbt_tty sprdwl_ng" 开机加载；
#       蓝牙走 UART 的 sprdbt_tty。这些 WiFi 符号必须保留，否则板载无线失效。
#       板载有线网卡是 RK3399 内置 GMAC + RTL8211F GbE PHY，保留不禁用。
#
# 用法: ./apply.sh <input.config> <output.config>
set -e

BASE="$1"
OUT="$2"

if [ -z "$BASE" ] || [ -z "$OUT" ]; then
  echo "用法: $0 <base-config> <output-config>"
  exit 1
fi

cp "$BASE" "$OUT"

# ── 辅助函数 ─────────────────────────────────────────────────────────────

disable() {
  local key="$1"
  sed -i "s/^${key}=[ym]$/# ${key} is not set/" "$OUT"
}

set_val() {
  local key="$1" val="$2"
  sed -i "s/^${key}=.*$/${key}=${val}/" "$OUT"
}

force() {
  # 强制设值：无论原本是 =x / # is not set / 整行不存在，都落定为指定值（幂等）。
  local key="$1" val="${2:-y}"
  sed -i "/^${key}=/d; /^# ${key} is not set$/d" "$OUT"
  echo "${key}=${val}" >> "$OUT"
}

# ── 过大的默认值（RK3399 是 6 核嵌入式，不需要服务器级配置）────────────────

set_val CONFIG_NR_CPUS 8   # 原值 256，RK3399 只有 6 核（2×A72 + 4×A53）
disable CONFIG_NUMA        # NUMA — 多路服务器才需要
disable CONFIG_XEN         # Xen 虚拟化 — 嵌入式不需要

# ── 过时网络协议 ──────────────────────────────────────────────────────────

disable CONFIG_ATALK       # AppleTalk — 已废弃的苹果局域网协议
disable CONFIG_X25         # X.25 — 上世纪的分组交换网络
disable CONFIG_LAPB        # LAPB — X.25 的链路层
disable CONFIG_PHONET      # Phonet — Nokia 手机内部总线协议

# ── WiFi 驱动（板载是 Spreadtrum SDIO，可插 USB 卡的 MT7921U 保留）──────────

# Atheros（需要 PCIe 插槽）
disable CONFIG_ATH9K       # Atheros 9xxx — 802.11n PCIe
disable CONFIG_ATH10K      # Atheros 10k — 802.11ac PCIe
disable CONFIG_ATH11K      # Atheros 11k — 802.11ax PCIe
disable CONFIG_ATH12K      # Atheros 12k — 802.11be PCIe

# Broadcom legacy（PCIe 老卡，板载 WiFi 是 Spreadtrum 不依赖这些）
disable CONFIG_B43         # Broadcom 43xx legacy（PCIe，非板载）
disable CONFIG_B43LEGACY   # Broadcom 43xx 更老的版本
disable CONFIG_BRCMSMAC    # Broadcom SoftMAC — PCIe 老卡

# Intel（x86 笔记本 WiFi 卡，ARM 板子不可能用到）
disable CONFIG_IPW2100     # Intel PRO/Wireless 2100
disable CONFIG_IWLWIFI     # Intel WiFi 主驱动
disable CONFIG_IWLDVM      # Intel DVM 固件接口
disable CONFIG_IWLMVM      # Intel MVM 固件接口

# Ralink/MediaTek legacy（rt2x00 系列，现代 MT76 保留）
disable CONFIG_RT2X00      # Ralink rt2x00 框架
disable CONFIG_RT2800PCI   # Ralink PCIe
disable CONFIG_RT2500USB   # Ralink USB 老卡
disable CONFIG_RT73USB     # Ralink USB 老卡
disable CONFIG_RT2800USB   # Ralink USB

# ── 整个媒体子系统（headless 边缘节点不需要任何视频/电视/采集功能）─────────
# 禁顶层 MEDIA_SUPPORT，olddefconfig 会级联清除其下全部子项：
#   V4L 摄像头、DVB 卫星/有线电视前端、USB 视频采集卡、调谐器、红外遥控、SDR
# 注意：RK3399 的 ISP/MIPI-CSI 摄像头也走 MEDIA，本项目作为网关不接摄像头，可关闭

disable CONFIG_MEDIA_SUPPORT

# ── 过时/罕见文件系统（只保留 ext4、btrfs、xfs、f2fs）────────────────────

disable CONFIG_JFS_FS            # JFS — IBM 的老文件系统
disable CONFIG_GFS2_FS           # GFS2 — Red Hat 集群文件系统
disable CONFIG_OCFS2_FS          # OCFS2 — Oracle 集群文件系统
disable CONFIG_NILFS2_FS         # NILFS2 — 日志结构文件系统，无人用
disable CONFIG_HFS_FS            # HFS — 老 Mac 文件系统
disable CONFIG_HFSPLUS_FS        # HFS+ — Mac 文件系统

# ── 音频子系统（headless 路由器不需要声音）────────────────────────────────

disable CONFIG_SOUND             # 关掉整个音频子系统

# ── 显示/GPU（纯 headless，不需要 HDMI/DP 输出）──────────────────────────
# 注意: RK3399 显示走 rockchip DRM（含 analogix-dp、dw-hdmi、vop），
#       本项目作为 headless 边缘节点不接屏幕，可关闭

disable CONFIG_DRM               # 关掉整个 DRM 子系统（含 rockchip drm）
disable CONFIG_FB                # Framebuffer
disable CONFIG_FB_TFT            # SPI TFT 小屏

# ── 无用输入设备 ─────────────────────────────────────────────────────────

disable CONFIG_INPUT_JOYSTICK    # 游戏手柄
disable CONFIG_INPUT_TOUCHSCREEN # 触摸屏

# ── 更多过时 WiFi 驱动 ───────────────────────────────────────────────────
# 注意：CONFIG_WLAN_UWE5621/UWE5622 是香橙派 4 LTS 板载 WiFi 的 in-tree 驱动，
#       绝不能禁（旧版本曾误禁导致板载无线失效）。改为下方"AP 栈保活"显式保留。

# ── WiFi 热点（AP 模式）驱动保活 ──────────────────────────────────────────
# 香橙派 4 LTS 板载 Spreadtrum UWE5622（sprdwl_ng）支持 SoftAP，可开机自动开热点。
# 基线 rockchip64-current config 已含这些符号(=m)，此处显式 force 兜底，
# 防止将来 base 变动或 olddefconfig 级联裁剪悄悄丢掉板载 WiFi / 热点能力。
force CONFIG_CFG80211 m            # 80211 配置层
force CONFIG_MAC80211 m            # 软 MAC 层（AP 模式在此实现）
force CONFIG_WLAN_UWE5621 m        # Unisoc UWE5621（板载，含 sprdwl_ng）
force CONFIG_WLAN_UWE5622 m        # Unisoc UWE5622（香橙派 4 LTS 实际板载芯片）
force CONFIG_SPRDWL_NG m           # Spreadtrum WLAN 主驱动
force CONFIG_RK_WIFI_DEVICE_UWE5621 y

# ── 透明代理网关栈保活 ───────────────────────────────────────────────────
# 香橙派 4 LTS 单网口，但网关默认全启用：Mihomo(Clash.Meta) 的 TUN +
# auto-redirect 接管板载 WiFi 热点等下游的转发流量，依赖完整
# netfilter+TPROXY+策略路由栈。以下符号在 rockchip64-current(6.18) 基线
# 通常已有(=m/=y)，此处 force 兜底，防止将来 base config 变动或
# olddefconfig 级联裁剪悄悄丢掉透明代理能力。
force CONFIG_TUN m                          # TUN/TAP 设备，Mihomo TUN 模式的核心
force CONFIG_NF_TABLES m                      # nftables 框架（auto-redirect 用 nft 下发规则）
force CONFIG_NFT_CT m                          # nft conntrack 匹配
force CONFIG_NFT_FIB_IPV4 m                    # nft fib 查路由 IPv4（分流判断）
force CONFIG_NFT_FIB_IPV6 m                    # nft fib 查路由 IPv6（分流判断）
force CONFIG_NFT_TPROXY m                      # nft tproxy 表达式（透明代理重定向核心）
force CONFIG_NFT_SOCKET m                      # nft socket 匹配（tproxy 配套）
force CONFIG_NETFILTER_XT_TARGET_TPROXY m      # xt TPROXY target（兼容 iptables-legacy 路径）
force CONFIG_NETFILTER_XT_MATCH_SOCKET m       # xt socket 匹配
force CONFIG_NETFILTER_XT_MATCH_MARK m         # xt mark 匹配
force CONFIG_NF_TPROXY_IPV4 m                  # tproxy 核心实现 IPv4
force CONFIG_NF_TPROXY_IPV6 m                  # tproxy 核心实现 IPv6
force CONFIG_IP_NF_MANGLE m                    # IPv4 mangle 表（打 fwmark）
force CONFIG_IP6_NF_MANGLE m                   # IPv6 mangle 表（打 fwmark）
force CONFIG_NETFILTER_XT_MARK m               # 设置 fwmark target
force CONFIG_IP_ADVANCED_ROUTER y              # 策略路由总开关（fwmark→路由表，tproxy 必需）
force CONFIG_IP_MULTIPLE_TABLES y              # 多路由表支持（策略路由，tproxy 必需）

# ── 其他嵌入式不需要的 ───────────────────────────────────────────────────

disable CONFIG_NFC               # NFC 近场通信 — 路由器不需要
disable CONFIG_CAN               # CAN 总线 — 车载/工业现场总线，不需要
disable CONFIG_HAMRADIO          # 业余无线电 AX.25/NetRom — 不需要
disable CONFIG_W1                # 1-Wire — DS18B20 之类单总线传感器，不需要

# ── Debug/Profiling（生产镜像不需要）─────────────────────────────────────

disable CONFIG_PROFILING         # perf 基础设施
disable CONFIG_KPROBES           # 动态内核探针
disable CONFIG_DEBUG_INFO_DWARF5 # DWARF5 调试符号 — 最占编译时间和体积
disable CONFIG_DEBUG_INFO_BTF    # BTF 元数据
disable CONFIG_FUNCTION_TRACER   # ftrace 函数追踪
disable CONFIG_FTRACE_SYSCALLS   # 系统调用追踪

echo "✅ 已应用 orangepi4-lts 内核优化 ($(grep -c 'is not set' "$OUT" | head -1) 项禁用)"
