# Shared mainline U-Boot / A/B hooks for Hive RK3528 boards.
function post_family_config__hive_rk3528_mainline_uboot() {
	if [[ "$BOARD" == nanopi-zero2 && "$BRANCH" == vendor ]]; then
		return 0
	fi

	display_alert "$BOARD" "HIVE: switching to mainline U-Boot v2026.07-rc4 for ${BRANCH}" "info"

	declare -g BOOTCONFIG="${BOARD}-rk3528_defconfig"
	declare -g BOOTSOURCE="https://github.com/u-boot/u-boot"
	declare -g BOOTBRANCH="tag:v2026.07-rc4"
	declare -g BOOTPATCHDIR="hive-v2026.07"  # Shared Python 3 build-host compatibility.
	[[ "${HIVE_AB:-no}" != yes ]] || declare -g BOOTPATCHDIR="hive-v2026.07 hive-ab-env12m-v2026.07"
    if [[ "$BOARD" == nanopi-r28s ]]; then
        declare -g BOOTPATCHDIR="hive-r28s-v2026.07 ${BOOTPATCHDIR}"
        # Keep kernel, initramfs and DTB in each root slot, including vendor images.
        declare -g BOOTSIZE=0
        declare -g BOOTFS_TYPE=""
    fi
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
function post_config_uboot_target__hive_rk3528_sd_warmup() {
	[[ "$BOARD" == nanopi-zero2 && "$BRANCH" == vendor ]] && return 0
	[[ "$BOOTCONFIG" == "${BOARD}-rk3528_defconfig" ]] || return 0

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

# Opt-in A/B firmware boot policy. Keep the original image profile available.
function post_config_uboot_target__zz_hive_ab() {
    [[ "${HIVE_AB:-no}" == yes ]] || return 0
    [[ "$BOOTCONFIG" == "${BOARD}-rk3528_defconfig" ]] || return 1
    python3 - .config "${USERPATCHES_PATH}/hive-ab-boot.cmd" <<'PYCODE'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
cmd = ' '.join(line.strip() for line in pathlib.Path(sys.argv[2]).read_text().splitlines() if line.strip() and not line.lstrip().startswith('#'))
values = {
    'CONFIG_ENV_IS_NOWHERE': 'n', 'CONFIG_ENV_IS_IN_MMC': 'y',
    'CONFIG_ENV_REDUNDANT': 'y',
    'CONFIG_ENV_SIZE': '0x8000', 'CONFIG_ENV_OFFSET': '0xc00000', 'CONFIG_ENV_OFFSET_REDUND': '0xc10000',
    'CONFIG_CMD_SAVEENV': 'y', 'CONFIG_CMD_NVEDIT_LOAD': 'y', 'CONFIG_CMD_SETEXPR': 'y', 'CONFIG_CMD_PART': 'y',
    'CONFIG_CMD_FS_GENERIC': 'y', 'CONFIG_FS_EXT4': 'y', 'CONFIG_CMD_FDT': 'y',
    'CONFIG_BOOTCOMMAND': json.dumps(cmd),
}
lines = [line for line in p.read_text().splitlines() if line.split('=', 1)[0] not in values and not any(line == '# '+key+' is not set' for key in values)]
p.write_text('\n'.join(lines + [key+'='+value for key, value in values.items()])+'\n')
PYCODE
}

# `post_config_uboot_target` 写完的值只是候选：紧随其后的 `make olddefconfig`
# 可能因依赖不满足把它们丢掉，而 extension method 的返回值被 Armbian 忽略
# （extensions.sh: "return 0 # always success"），静默跳过照样能产出镜像。
# 编译完成后用最终 .config 复核一遍，并把结果作为 stamp 写进 rootfs，
# 由 scripts/check-uboot-env.sh 在建厂镜像时对照二进制二次校验。
function post_uboot_custom_postprocess__zz_hive_ab_env() {
    [[ "${HIVE_AB:-no}" == yes ]] || return 0
    [[ "$BOOTCONFIG" == "${BOARD}-rk3528_defconfig" ]] || return 0
    local stamp="${USERPATCHES_PATH}/overlay/usr/lib/hive/uboot-env"
    local want
    for want in \
        'CONFIG_ENV_IS_IN_MMC=y' \
        'CONFIG_ENV_REDUNDANT=y' \
        'CONFIG_ENV_SIZE=0x8000' \
        'CONFIG_ENV_OFFSET=0xc00000' \
        'CONFIG_ENV_OFFSET_REDUND=0xc10000' \
        'CONFIG_CMD_SAVEENV=y' \
        'CONFIG_CMD_SETEXPR=y' \
        'CONFIG_CMD_PART=y' \
        'CONFIG_CMD_FDT=y'; do
        grep -qxF -- "$want" .config 2>/dev/null ||
            exit_with_error "HIVE A/B: u-boot .config lacks '$want' after olddefconfig; the environment would not persist (reset loop on first boot)"
    done
    ! grep -qxF 'CONFIG_ENV_IS_NOWHERE=y' .config ||
        exit_with_error "HIVE A/B: u-boot .config still has CONFIG_ENV_IS_NOWHERE=y; the environment would not persist"
    mkdir -p "$(dirname "$stamp")"
    printf '%s\n' \
        'CONFIG_ENV_IS_IN_MMC=y' \
        'CONFIG_ENV_REDUNDANT=y' \
        'CONFIG_ENV_SIZE=0x8000' \
        'CONFIG_ENV_OFFSET=0xc00000' \
        'CONFIG_ENV_OFFSET_REDUND=0xc10000' \
        'CONFIG_CMD_SAVEENV=y' \
        'CONFIG_CMD_SETEXPR=y' \
        'CONFIG_CMD_PART=y' \
        'CONFIG_CMD_FDT=y' > "$stamp"
    display_alert "$BOARD" "HIVE: A/B environment verified in u-boot .config" "info"
}
