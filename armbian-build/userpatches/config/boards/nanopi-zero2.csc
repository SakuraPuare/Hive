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
