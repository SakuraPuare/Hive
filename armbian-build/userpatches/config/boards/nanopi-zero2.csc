# HIVE userpatches 叠加配置 — NanoPi Zero2 (RK3528)
#
# Armbian 的 config_source_board_file() 会同时 source 上游
# config/boards/nanopi-zero2.csc 与本文件(${USERPATCHES_PATH}/config/boards/)，
# 本文件在上游之后 source，故此处只追加 Hive 自有的 hook，不复制上游全文——
# 上游 csc 的后续更新(切 DTB 名/串口等)照常生效，互不覆盖。
#
# 仓库纳管说明：armbian-build/* 被 .gitignore 忽略，仅 userpatches/ 白名单，
# 所以 board 级定制必须落在这里才能持久化进仓库。

# current/edge 改用 mainline 官方 U-Boot，而非 family 默认的 radxa BSP u-boot
# (next-dev-v2024.10)。radxa u-boot 只保证在 Ubuntu Jammy 编译；在更新的 noble 容器里
# 它会编出 FIT /images/fdt data-size=0 的空设备树 itb，导致启动 "No valid device tree
# binary found ... Please RESET"。mainline u-boot 用 binman 从 DT 生成完整镜像，不依赖
# jammy。RK3528 NanoPi Zero2 由 Jonas Karlman 于 u-boot commit ebf46b588f(2026-01) 加入，
# SD/eMMC/Ethernet/USB host 真机验证通过，首个含该配置的正式 tag 为 v2026.07-rc1。
# vendor 分支不进此分支，保留 radxa u-boot 作回退。仿 nanopi-r3s.csc 的 use_mainline_uboot。
function post_family_config__hive_nanopi_zero2_mainline_uboot() {
	if [[ "$BRANCH" == "vendor" ]]; then
		return 0
	fi

	display_alert "$BOARD" "HIVE: switching to mainline U-Boot v2026.07-rc4 for ${BRANCH}" "info"

	declare -g BOOTCONFIG="nanopi-zero2-rk3528_defconfig"
	declare -g BOOTSOURCE="https://github.com/u-boot/u-boot"
	declare -g BOOTBRANCH="tag:v2026.07-rc4"
	declare -g BOOTPATCHDIR="v2026.07"        # 无该目录则不套补丁，避免误用 radxa BSP 补丁
	# 不改 BOOTDIR：BOOTSOURCEDIR 由 branch2dir(BOOTBRANCH) 按 tag 分目录，天然与 vendor 树隔离（同 R3S）

	# mainline u-boot 用 binman 把 TPL(DDR)/SPL/BL31/u-boot 打成单一 u-boot-rockchip.bin
	declare -g UBOOT_TARGET_MAP="BL31=${RKBIN_DIR}/${BL31_BLOB} ROCKCHIP_TPL=${RKBIN_DIR}/${DDR_BLOB};;u-boot-rockchip.bin"

	# 退订 radxa BSP 专用的烧写/后处理 hook，改用 mainline 单文件烧写到 LBA 64
	# （与 nanopi-r3s.csc 一致用 unset；bash unset 对同名函数同样生效）
	unset uboot_custom_postprocess write_uboot_platform write_uboot_platform_mtd

	function write_uboot_platform() {
		dd if="$1/u-boot-rockchip.bin" of="$2" seek=64 conv=notrunc status=none
	}
}

# 修复 RK3528 mainline u-boot 的 SD 冷扫描首次失败：autoboot 前预热 mmc 控制器。
# 现象：默认 BOOTCOMMAND="bootflow scan -lb" 扫描时 SD（mmc@ffc30000=mmc1）尚未
# 成功 probe（dw_mmc 冷初始化首次 -110，且 efi_mgr 全局 bootmeth 先跑污染状态），
# bootflow 在 SD 上拿不到候选 → 静默跳过 → fallback 网络 PXE。串口实测：手动
# `mmc dev 1; mmc rescan` 预热后 `bootflow scan -lb` 立即在 SD 找到 /boot.scr 进内核。
# 该 u-boot 是 ENV_IS_NOWHERE+ENV_IS_DEFAULT，环境不持久化，只能编译期改默认值。
# 落点：官方 hook post_config_uboot_target（.config 生成后、olddefconfig 前），
# 用 sed 整行替换 .config 改 BOOTCOMMAND，改完 olddefconfig 自动固化。
function post_config_uboot_target__hive_nanopi_zero2_sd_warmup() {
	[[ "$BRANCH" == "vendor" ]] && return 0
	[[ "$BOOTCONFIG" == "nanopi-zero2-rk3528_defconfig" ]] || return 0

	# mmc dev 0(空 eMMC，-110 无害且不中断) → mmc dev 1(SD，触发初始化) →
	# mmc rescan(再刷确保 ready) → bootflow scan -lb(同上游默认，仅前置预热)
	#
	# 用 sed 整行替换 .config，不用 scripts/config：后者第 8 行 CONFIG_="${CONFIG_-CONFIG_}"
	# 会读外部 CONFIG_ 环境变量，Armbian 容器内该变量被污染导致 "variable CONFIG_ to the
	# prefix" 报错。sed 直接改 .config 是 uboot.sh 老版本的 fallback 做法，稳。
	# 改完紧随的 olddefconfig（uboot.sh:209）会消化固化。
	local _bootcmd='mmc dev 0; mmc dev 1; mmc rescan; bootflow scan -lb'
	if [[ -f .config ]]; then
		sed -i "s|^CONFIG_BOOTCOMMAND=.*|CONFIG_BOOTCOMMAND=\"${_bootcmd}\"|" .config
		display_alert "$BOARD" "HIVE: BOOTCOMMAND => ${_bootcmd}" "info"
	else
		display_alert "$BOARD" "HIVE: .config 不存在，跳过 BOOTCOMMAND 预热" "wrn"
	fi
}
