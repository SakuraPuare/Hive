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

force() {
  # 强制设值：无论该符号原本是 =x / # is not set / 整行不存在，都落定为指定值。
  # 用于必须显式兜底、不能依赖 select 推导的符号（如 CONFIG_I2C）。
  local key="$1" val="${2:-y}"
  sed -i "/^${key}=/d; /^# ${key} is not set$/d" "$OUT"
  echo "${key}=${val}" >> "$OUT"
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

# ── WiFi 热点（AP 模式）驱动保活 ──────────────────────────────────────────
# Zero2 是唯一可外接 USB 无线网卡的板子，需支持"插卡自动开热点"：
#   - MT AX5400 (MediaTek MT7921AU) → mt7921u；mt76 AP 模式成熟可靠（首选）
#   - AX210NGW  (Intel AX210)       → iwlwifi+iwlmvm；AP 模式较弱（次选）
# 基线 linux-rk35xx-vendor.config 已含这些符号(=m)，此处显式 force 兜底，
# 防止将来 base config 变动或 olddefconfig 级联裁剪悄悄丢掉热点能力。
# force 会先删除旧行再追加，幂等；若某符号在该内核不存在，olddefconfig 自动忽略。
force CONFIG_CFG80211 m            # 80211 配置层（mac80211/驱动依赖）
force CONFIG_MAC80211 m            # 软 MAC 层（AP/hostapd 模式在此实现）
force CONFIG_WLAN_VENDOR_MEDIATEK y
force CONFIG_MT7921U m             # MT7921 USB（AX5400），自动 select mt76 connac 链
force CONFIG_WLAN_VENDOR_INTEL y
force CONFIG_IWLWIFI m             # Intel 无线核心
force CONFIG_IWLMVM m              # AX210 走 mvm op-mode

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

# ── 整个媒体子系统（路由器/VPN 网关不需要任何视频/电视/采集功能）──────────
# 禁顶层 MEDIA_SUPPORT，olddefconfig 会级联清除其下全部子项：
#   V4L 摄像头、DVB 卫星/有线电视前端、USB 视频采集卡、调谐器、红外遥控、SDR
# 比逐个点名禁子项彻底得多，也不必跟上游改名。
#
# ⚠ 兜底 I2C：本精简 config 未显式写入 CONFIG_I2C，它原本仅靠 DRM 和
#   MEDIA_SUPPORT 的 `select I2C` 撑着（drivers/{gpu/drm,media}/Kconfig）。
#   本脚本同时关掉 DRM+MEDIA，会让 I2C 失去全部 selector，olddefconfig
#   随即把它归零，连带 regmap-i2c / rk806-i2c(PMIC) / rockpi_mcu 全部编译
#   失败。故必须显式 force 启用，使 I2C 不再依赖这两个子系统。
force CONFIG_I2C y

disable CONFIG_MEDIA_SUPPORT

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

# Mali GPU 驱动必须随 DRM 一起关：它 select DMA_SHARED_BUFFER，但其 fence 代码
# （mali_kbase_csf_kcpu.c:kcpu_fence_timeout_dump）引用了仅在 CONFIG_SYNC_FILE
# 下才有定义的符号。DRM=y 时 SYNC_FILE 被间接 select 上，故默认 config 能编过；
# 一旦关掉 DRM，olddefconfig 重算使 SYNC_FILE=n，Mali 驱动随即编译失败。
# headless 节点不需要 GPU，连驱动一起关，既消除编译错误又省编译时间。
disable CONFIG_MALI_BIFROST      # Mali Bifrost 框架（RK3528 Mali-G57）
disable CONFIG_MALI_MIDGARD      # Mali Midgard 框架（rockchip 改版，连带子项）

# 关 MEDIA 后必须连带关这些 rockchip MIPI/CSI 摄像头 PHY：它们裸用
# v4l2_subdev.entity / media_pad（受 CONFIG_MEDIA_CONTROLLER 保护），但 Kconfig
# 仅 `depends on ARCH_ROCKCHIP && OF`，不依赖 MEDIA。MEDIA=n 时该成员消失而驱动
# 仍被编译 → phy-rockchip-samsung-dcphy.c / csi2-dphy 等编译失败。headless 节点
# 不接摄像头，直接关掉。
disable CONFIG_PHY_ROCKCHIP_SAMSUNG_DCPHY  # Samsung MIPI DCPHY
disable CONFIG_PHY_ROCKCHIP_CSI2_DPHY      # CSI2 D-PHY（含 -hw）
disable CONFIG_PHY_ROCKCHIP_MIPI_RX        # MIPI RX（基线未启用，防御性禁用）

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

# ── 其他嵌入式不需要的总线/外设子系统 ──────────────────────────────────────

disable CONFIG_CAN               # CAN 总线 — 车载/工业现场总线，路由器不需要
disable CONFIG_W1                # 1-Wire — DS18B20 之类单总线传感器，不需要
# HAMRADIO（业余无线电 AX.25/NetRom）在 6.1 vendor 基线未启用，无需处理

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
