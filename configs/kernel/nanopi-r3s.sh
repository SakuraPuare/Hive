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

# ── USB 视频采集卡（路由器不需要）────────────────────────────────────────

disable CONFIG_VIDEO_GO7007
disable CONFIG_VIDEO_HDPVR       # Hauppauge HD PVR
disable CONFIG_VIDEO_PVRUSB2     # Hauppauge PVR USB2
disable CONFIG_VIDEO_STK1160     # STK1160 采集卡（6.18 里叫 STK1160 不带 _COMMON）
disable CONFIG_VIDEO_AU0828      # Auvitek AU0828
disable CONFIG_VIDEO_CX231XX     # Conexant CX231xx
disable CONFIG_VIDEO_EM28XX      # Empia EM28xx

# ── 过时/罕见文件系统（只保留 ext4、btrfs、xfs、f2fs）────────────────────

disable CONFIG_JFS_FS            # JFS — IBM 的老文件系统
disable CONFIG_GFS2_FS           # GFS2 — Red Hat 集群文件系统
disable CONFIG_OCFS2_FS          # OCFS2 — Oracle 集群文件系统

# ── 其他嵌入式不需要的 ───────────────────────────────────────────────────

disable CONFIG_NFC               # NFC 近场通信 — 路由器不需要

echo "✅ 已应用 nanopi-r3s 内核优化 ($(grep -c 'is not set' "$OUT" | head -1) 项禁用)"
