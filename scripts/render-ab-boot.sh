#!/usr/bin/env bash
# Render the immutable board-specific policy; never evaluate U-Boot variables here.
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT_DIR/armbian-build/userpatches/overlay/usr/local/bin/hive-board"
hive_board_config "${1:?board required}" || { echo 'Unsupported A/B board' >&2; exit 1; }
sed -e "s|rockchip/rk3528-nanopi-zero2.dtb|$HIVE_DTB|g" \
    -e "s|console=ttyS0,1500000|console=$HIVE_CONSOLE|g" \
    "$ROOT_DIR/configs/ota/nanopi-zero2-boot.cmd"
