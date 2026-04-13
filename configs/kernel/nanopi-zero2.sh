#!/bin/bash
# nanopi-zero2 (RK3528) 内核配置优化
#
# 基线: Armbian linux-rk35xx-vendor.config (kernel 6.1)
# 目的: 禁用 RK3528 路由器/VPN 网关场景不需要的驱动和子系统，减少编译时间
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
  # 将 CONFIG_XXX=y/m 改为 # CONFIG_XXX is not set
  local key="$1"
  sed -i "s/^${key}=[ym]$/# ${key} is not set/" "$OUT"
}

enable() {
  # 将 # CONFIG_XXX is not set 改为 CONFIG_XXX=y
  local key="$1"
  sed -i "s/^# ${key} is not set$/${key}=y/" "$OUT"
}

set_val() {
  local key="$1" val="$2"
  sed -i "s/^${key}=.*$/${key}=${val}/" "$OUT"
}

# ── 过时网络协议（嵌入式路由器不需要）──────────────────────────────────

disable CONFIG_ATALK       # AppleTalk — 已废弃的苹果局域网协议
disable CONFIG_X25         # X.25 — 上世纪的分组交换网络
disable CONFIG_LAPB        # LAPB — X.25 的链路层
disable CONFIG_PHONET      # Phonet — Nokia 手机内部总线协议

# ── WiFi 驱动（RK3528 板子无 PCIe/mPCIe 插槽，只用板载 WiFi）──────────

# Atheros（需要 PCIe 插槽的老卡）
disable CONFIG_ATH5K       # Atheros 5xxx — 802.11a/bg PCIe
disable CONFIG_ATH9K       # Atheros 9xxx — 802.11n PCIe
disable CONFIG_ATH10K      # Atheros 10k — 802.11ac PCIe
disable CONFIG_ATH11K      # Atheros 11k — 802.11ax PCIe

# Broadcom legacy（需要 PCIe 的老驱动，brcmfmac 保留）
disable CONFIG_B43         # Broadcom 43xx legacy
disable CONFIG_B43LEGACY   # Broadcom 43xx 更老的版本
disable CONFIG_BRCMSMAC    # Broadcom SoftMAC — PCIe 老卡

# Intel iwlwifi 保留 — AX210 网卡需要 (iwlwifi + iwlmvm)

# Marvell（老旧 SDIO/USB WiFi）
disable CONFIG_MWIFIEX     # Marvell WiFiEx 主驱动
disable CONFIG_MWIFIEX_SDIO
disable CONFIG_MWIFIEX_USB

# Ralink/MediaTek legacy（rt2x00 系列，现代 MT76 保留）
disable CONFIG_RT2X00      # Ralink rt2x00 框架
disable CONFIG_RT2800PCI   # Ralink PCIe
disable CONFIG_RT2500USB   # Ralink USB 老卡
disable CONFIG_RT73USB     # Ralink USB 老卡
disable CONFIG_RT2800USB   # Ralink USB

# ── USB 视频采集卡（路由器/VPN 网关不需要）─────────────────────────────

disable CONFIG_VIDEO_GO7007
disable CONFIG_VIDEO_GO7007_USB
disable CONFIG_VIDEO_HDPVR       # Hauppauge HD PVR
disable CONFIG_VIDEO_PVRUSB2     # Hauppauge PVR USB2
disable CONFIG_VIDEO_STK1160_COMMON
disable CONFIG_VIDEO_AU0828      # Auvitek AU0828
disable CONFIG_VIDEO_CX231XX     # Conexant CX231xx
disable CONFIG_VIDEO_CX231XX_ALSA
disable CONFIG_VIDEO_CX231XX_DVB
disable CONFIG_VIDEO_EM28XX      # Empia EM28xx
disable CONFIG_VIDEO_EM28XX_V4L2
disable CONFIG_VIDEO_EM28XX_ALSA
disable CONFIG_VIDEO_EM28XX_DVB

# ── DVB 卫星/有线电视前端芯片（嵌入式不需要）──────────────────────────

disable CONFIG_DVB_STB6100
disable CONFIG_DVB_CX24110
disable CONFIG_DVB_STB6000
disable CONFIG_DVB_STV0288
disable CONFIG_DVB_CX22702
disable CONFIG_DVB_DIB3000MB
disable CONFIG_DVB_DIB3000MC
disable CONFIG_DVB_DIB7000M
disable CONFIG_DVB_DIB7000P
disable CONFIG_DVB_DIB9000
disable CONFIG_DVB_NXT6000
disable CONFIG_DVB_S5H1432
disable CONFIG_DVB_SP887X

# ── 过时/罕见文件系统（只保留 ext4、btrfs、xfs、f2fs）────────────────

disable CONFIG_REISERFS_FS       # ReiserFS — 已无人维护
disable CONFIG_JFS_FS            # JFS — IBM 的老文件系统
disable CONFIG_JFS_POSIX_ACL
disable CONFIG_JFS_SECURITY
disable CONFIG_JFS_STATISTICS
disable CONFIG_GFS2_FS           # GFS2 — Red Hat 集群文件系统
disable CONFIG_GFS2_FS_LOCKING_DLM
disable CONFIG_OCFS2_FS          # OCFS2 — Oracle 集群文件系统
disable CONFIG_NILFS2_FS         # NILFS2 — 日志结构文件系统，无人用
disable CONFIG_HFS_FS            # HFS — 老 Mac 文件系统
disable CONFIG_HFSPLUS_FS        # HFS+ — Mac 文件系统

# ── 音频子系统（headless 路由器不需要声音）────────────────────────────────

disable CONFIG_SOUND             # 关掉整个音频子系统（含 40+ SoC codec 驱动）

# ── 显示/GPU（纯 headless，不需要 HDMI 输出）─────────────────────────────

disable CONFIG_DRM               # 关掉整个 DRM 子系统（含 Rockchip 显示驱动、面板驱动）
disable CONFIG_FB                # Framebuffer
disable CONFIG_FB_TFT            # SPI TFT 小屏

# ── 无用输入设备（路由器不接游戏手柄/手写板/触摸屏）──────────────────────

disable CONFIG_INPUT_JOYSTICK    # 游戏手柄（~30 个子驱动）
disable CONFIG_INPUT_TABLET      # 手写板（~6 个子驱动）
disable CONFIG_INPUT_TOUCHSCREEN # 触摸屏（~80 个子驱动）

# ── 更多过时 WiFi 驱动 ───────────────────────────────────────────────────

disable CONFIG_HOSTAP            # Prism2/2.5/3 — 上古 ISA/PCI WiFi
disable CONFIG_LIBERTAS          # Marvell 88W8xxx — 老旧 USB/SDIO
disable CONFIG_LIBERTAS_USB
disable CONFIG_LIBERTAS_SDIO
disable CONFIG_LIBERTAS_SPI
disable CONFIG_WLAN_UWE5621      # Unisoc WiFi — 不相关
disable CONFIG_WLAN_UWE5622

# ── Debug/Profiling（生产镜像不需要）─────────────────────────────────────

disable CONFIG_PROFILING         # perf 基础设施
disable CONFIG_KPROBES           # 动态内核探针
disable CONFIG_DEBUG_INFO_DWARF5 # DWARF5 调试符号 — 最占编译时间和体积
disable CONFIG_DEBUG_INFO_BTF    # BTF 元数据（eBPF 工具链依赖）
disable CONFIG_SCHEDSTATS        # 调度器统计
disable CONFIG_FUNCTION_TRACER   # ftrace 函数追踪
disable CONFIG_FTRACE_SYSCALLS   # 系统调用追踪
disable CONFIG_BLK_DEV_IO_TRACE  # blktrace 块 I/O 追踪
disable CONFIG_LKDTM             # 内核崩溃测试模块 — 纯开发用

echo "✅ 已应用 nanopi-zero2 内核优化 ($(grep -c 'is not set' "$OUT" | head -1) 项禁用)"
