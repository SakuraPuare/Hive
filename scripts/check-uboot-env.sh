#!/usr/bin/env bash
# 校验 A/B 引导环境真的可用：U-Boot 必须能把 hive_active/hive_pending/
# hive_tries 持久化到 MMC 上的冗余环境区。只查 bootcmd 里有没有 HIVE_AB_V1
# 不够——那个串只能证明脚本进了二进制，不能证明 env 驱动、saveenv、setexpr
# 和偏移量存在。缺任何一项都会导致首启 saveenv 失败 → reset 循环，或者
# 固件 OTA 永远无法 arm（fw_setenv 写到 U-Boot 不读的位置）。
#
# 用法: check-uboot-env.sh <u-boot-rockchip.bin> <usr/lib/hive/uboot-env>
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: $0 <u-boot-rockchip.bin> <usr/lib/hive/uboot-env>" >&2; exit 2; }
UBOOT="$1"
STAMP="$2"

die() { echo "A/B boot environment invalid: $*" >&2; exit 1; }

[ -f "$UBOOT" ] || die "missing U-Boot binary: $UBOOT"
[ -s "$STAMP" ] || die "missing environment stamp: $STAMP (u-boot must be built with HIVE_AB=yes; clear the u-boot build cache if it came from cache)"

# 1) 编译期配置（post_uboot_custom_postprocess 在 olddefconfig 之后从 .config 抄出）。
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
    grep -qxF -- "$want" "$STAMP" || die "build config lacks '$want'"
done

# 2) 二进制里必须真的编进了对应代码路径（--gc-sections 会丢掉未引用函数，
#    所以这些串缺席就意味着功能缺席）。
BLOB=$(strings -a "$UBOOT")
require() {
    [[ "$BLOB" == *"$1"* ]] || die "$2 ('$1' not found in $UBOOT)"
}
require 'HIVE_AB_V1' 'the Hive A/B boot script is not compiled in'
require 'save environment variables to persistent storage' 'saveenv command is missing (CONFIG_CMD_SAVEENV off or environment is volatile)'
require 'Invalid ENV offset in MMC' 'MMC environment driver is missing (CONFIG_ENV_IS_IN_MMC off)'
require 'Writing to %sMMC(' 'redundant environment save path is missing'
require 'Reading from %sMMC(' 'redundant environment load path is missing (CONFIG_ENV_REDUNDANT off)'
require '*** Error - No Valid Environment Area found' 'redundant environment recovery is missing'
require 'set environment variable as the result of eval expression' 'setexpr is missing (hive_tries could not be decremented)'
require 'print partition UUID' 'part uuid is missing (slot root device could not be resolved)'
require "boot Linux kernel 'Image' format from memory" 'booti is missing'
require 'flattened device tree utility commands' 'fdt is missing (boot medium detection would fail)'

echo "A/B boot environment OK: $(basename "$UBOOT")"
