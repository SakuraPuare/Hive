#!/bin/bash
# nanopi-r3s (RK3566) 内核配置优化
#
# 基线: Armbian linux-rockchip64-current.config (kernel 6.18)
# 目的: 禁用 RK3566 双千兆路由器/VPN 网关场景不需要的驱动和子系统，减少编译时间
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
  # 强制设值：无论该符号原本是 =x / # is not set / 整行不存在，都落定为指定值。
  # 用于必须显式兜底、不能依赖 select 推导的符号（如 CONFIG_I2C）。
  local key="$1" val="${2:-y}"
  sed -i "/^${key}=/d; /^# ${key} is not set$/d" "$OUT"
  echo "${key}=${val}" >> "$OUT"
}

# ── 过大的默认值（R3S 是 4 核嵌入式，不需要服务器级配置）────────────────

set_val CONFIG_NR_CPUS 8   # 原值 256，R3S 只有 4 核
disable CONFIG_NUMA        # NUMA — 多路服务器才需要
disable CONFIG_XEN         # Xen 虚拟化 — 嵌入式不需要

# ── 过时网络协议 ──────────────────────────────────────────────────────────

disable CONFIG_ATALK       # AppleTalk — 已废弃的苹果局域网协议
disable CONFIG_X25         # X.25 — 上世纪的分组交换网络
disable CONFIG_LAPB        # LAPB — X.25 的链路层
disable CONFIG_PHONET      # Phonet — Nokia 手机内部总线协议

# ── WiFi 驱动（R3S 无 PCIe/mPCIe 插槽，无板载 WiFi）─────────────────────

# Atheros（需要 PCIe 插槽）
disable CONFIG_ATH9K       # Atheros 9xxx — 802.11n PCIe
disable CONFIG_ATH10K      # Atheros 10k — 802.11ac PCIe
disable CONFIG_ATH11K      # Atheros 11k — 802.11ax PCIe
disable CONFIG_ATH12K      # Atheros 12k — 802.11be PCIe

# Broadcom legacy（brcmfmac 保留给 USB dongle）
disable CONFIG_B43         # Broadcom 43xx legacy
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

# ── 整个媒体子系统（路由器/VPN 网关不需要任何视频/电视/采集功能）──────────
# 禁顶层 MEDIA_SUPPORT，olddefconfig 会级联清除其下全部子项：
#   V4L 摄像头、DVB 卫星/有线电视前端、USB 视频采集卡、调谐器、红外遥控、SDR
#
# ⚠ 兜底 I2C：本精简 config 未显式写入 CONFIG_I2C，它原本仅靠 DRM 和
#   MEDIA_SUPPORT 的 `select I2C` 撑着。本脚本同时关掉 DRM+MEDIA，会让 I2C
#   失去全部 selector，olddefconfig 随即把它归零，连带 regmap-i2c 等编译失败。
#   故必须显式 force 启用。（注：rockchip64-current(6.18) 树的 rockchip PHY
#   未裸用 v4l2_subdev.entity，无需像 zero2 那样禁摄像头 PHY。）
force CONFIG_I2C y

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

# ── 显示/GPU（纯 headless，不需要 HDMI 输出）─────────────────────────────

disable CONFIG_DRM               # 关掉整个 DRM 子系统
disable CONFIG_FB                # Framebuffer
disable CONFIG_FB_TFT            # SPI TFT 小屏

# Mali GPU 驱动必须随 DRM 一起关：它 select DMA_SHARED_BUFFER，但其 fence 代码
# （mali_kbase_csf_kcpu.c:kcpu_fence_timeout_dump）引用了仅在 CONFIG_SYNC_FILE
# 下才有定义的符号。DRM=y 时 SYNC_FILE 被间接 select 上，故默认 config 能编过；
# 一旦关掉 DRM，olddefconfig 重算使 SYNC_FILE=n，Mali 驱动随即编译失败。
# headless 节点不需要 GPU，连驱动一起关，既消除编译错误又省编译时间。
disable CONFIG_MALI_BIFROST      # Mali Bifrost 框架（RK3566 Mali-G52）
disable CONFIG_MALI_MIDGARD      # Mali Midgard 框架（rockchip 改版，连带子项）

# ── 无用输入设备 ─────────────────────────────────────────────────────────

disable CONFIG_INPUT_JOYSTICK    # 游戏手柄
disable CONFIG_INPUT_TOUCHSCREEN # 触摸屏

# ── 更多过时 WiFi 驱动 ───────────────────────────────────────────────────

disable CONFIG_WLAN_UWE5621      # Unisoc WiFi — 不相关
disable CONFIG_WLAN_UWE5622

# ── 透明代理网关栈保活 ───────────────────────────────────────────────────
# R3S 是双千兆口设备，正好当 WAN/LAN 路由器；网关用 Mihomo(Clash.Meta) 的
# TUN + auto-redirect 模式接管 LAN 转发流量，依赖完整 netfilter+TPROXY+策略路由栈。
# 以下符号在 rockchip64-current(6.18) 基线通常已有(=m/=y)，此处 force 兜底，
# 防止将来 base config 变动或 olddefconfig 级联裁剪悄悄丢掉透明代理能力。
force CONFIG_TUN m                          # TUN/TAP 设备，Mihomo TUN 模式的核心
force CONFIG_NF_TABLES m                     # nftables 框架（auto-redirect 用 nft 下发规则）
force CONFIG_NFT_CT m                         # nft conntrack 匹配
force CONFIG_NFT_FIB_IPV4 m                   # nft fib 查路由 IPv4（分流判断）
force CONFIG_NFT_FIB_IPV6 m                   # nft fib 查路由 IPv6（分流判断）
force CONFIG_NFT_TPROXY m                     # nft tproxy 表达式（透明代理重定向核心）
force CONFIG_NFT_SOCKET m                     # nft socket 匹配（tproxy 配套）
force CONFIG_NETFILTER_XT_TARGET_TPROXY m     # xt TPROXY target（兼容 iptables-legacy 路径）
force CONFIG_NETFILTER_XT_MATCH_SOCKET m      # xt socket 匹配
force CONFIG_NETFILTER_XT_MATCH_MARK m        # xt mark 匹配
force CONFIG_NF_TPROXY_IPV4 m                 # tproxy 核心实现 IPv4
force CONFIG_NF_TPROXY_IPV6 m                 # tproxy 核心实现 IPv6
force CONFIG_IP_NF_MANGLE m                   # IPv4 mangle 表（打 fwmark）
force CONFIG_IP6_NF_MANGLE m                  # IPv6 mangle 表（打 fwmark）
force CONFIG_NETFILTER_XT_MARK m              # 设置 fwmark target
force CONFIG_IP_ADVANCED_ROUTER y             # 策略路由总开关（fwmark→路由表，tproxy 必需）
force CONFIG_IP_MULTIPLE_TABLES y             # 多路由表支持（策略路由，tproxy 必需）

# ── 其他嵌入式不需要的 ───────────────────────────────────────────────────

disable CONFIG_NFC               # NFC 近场通信 — 路由器不需要
disable CONFIG_CAN               # CAN 总线 — 车载/工业现场总线，路由器不需要
disable CONFIG_HAMRADIO          # 业余无线电 AX.25/NetRom — 不需要
# W1（1-Wire）在 rockchip64-current 基线未启用，无需处理

# ── Debug/Profiling（生产镜像不需要）─────────────────────────────────────

disable CONFIG_PROFILING         # perf 基础设施
disable CONFIG_KPROBES           # 动态内核探针
disable CONFIG_DEBUG_INFO_DWARF5 # DWARF5 调试符号 — 最占编译时间和体积
disable CONFIG_DEBUG_INFO_BTF    # BTF 元数据
disable CONFIG_FUNCTION_TRACER   # ftrace 函数追踪
disable CONFIG_FTRACE_SYSCALLS   # 系统调用追踪

echo "✅ 已应用 nanopi-r3s 内核优化 ($(grep -c 'is not set' "$OUT" | head -1) 项禁用)"
