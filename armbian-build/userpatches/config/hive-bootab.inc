# Shared boot-payload A/B policy for Hive MMC boards.
# Opt-in A/B firmware boot policy. Keep the original image profile available.
function post_config_uboot_target__zz_hive_ab() {
    [[ "${HIVE_AB:-no}" == yes ]] || return 0
    case "$BOARD:$BOOTCONFIG" in
        nanopi-zero2:nanopi-zero2-rk3528_defconfig|nanopi-r28s:nanopi-r28s-rk3528_defconfig|nanopi-r3s-lts:nanopi-r3s-lts-rk3566_defconfig) ;;
        *) exit_with_error "Hive A/B: unsupported board/bootloader $BOARD:$BOOTCONFIG"; return 1;;
    esac
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
    local stamp="${USERPATCHES_PATH}/overlay/usr/lib/hive/uboot-env"
    local want key
    for want in \
        'CONFIG_ENV_IS_IN_MMC=y' \
        'CONFIG_ENV_REDUNDANT=y' \
        'CONFIG_CMD_SAVEENV=y' \
        'CONFIG_CMD_SETEXPR=y' \
        'CONFIG_CMD_PART=y' \
        'CONFIG_CMD_FDT=y'; do
        grep -qxF -- "$want" .config 2>/dev/null ||
            exit_with_error "HIVE A/B: u-boot .config lacks '$want' after olddefconfig; the environment would not persist (reset loop on first boot)"
    done
    ! grep -qxF 'CONFIG_ENV_IS_NOWHERE=y' .config ||
        exit_with_error "HIVE A/B: u-boot .config still has CONFIG_ENV_IS_NOWHERE=y; the environment would not persist"
    # Copy the values that survived olddefconfig instead of repeating the
    # constants. fw_setenv finds its offsets through this stamp, so a second
    # copy here is exactly how a build that moved the environment silently
    # keeps writing where the bootloader no longer reads.
    mkdir -p "$(dirname "$stamp")"
    : > "$stamp"
    for key in CONFIG_ENV_IS_IN_MMC CONFIG_ENV_REDUNDANT CONFIG_ENV_SIZE \
        CONFIG_ENV_OFFSET CONFIG_ENV_OFFSET_REDUND CONFIG_CMD_SAVEENV \
        CONFIG_CMD_SETEXPR CONFIG_CMD_PART CONFIG_CMD_FDT; do
        value=$(sed -n "s/^${key}=//p" .config | head -n 1)
        [ -n "$value" ] ||
            exit_with_error "HIVE A/B: .config has no ${key}; the environment stamp would be incomplete"
        printf '%s=%s\n' "$key" "$value" >> "$stamp"
    done
    [ -s "$stamp" ] ||
        exit_with_error "HIVE A/B: the environment stamp came out empty"
    display_alert "$BOARD" "HIVE: A/B environment verified in u-boot .config" "info"
}
