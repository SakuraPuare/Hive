# Extend the upstream Armbian R28S board (vendor 6.1 + AIC8800 SDIO Wi-Fi).
# Use the same pinned mainline bootloader as Zero2, with a local R28S DT backport.
# The Linux DTB remains the vendor board's rk3528-nanopi-rev03.dtb.
source "${USERPATCHES_PATH}/config/hive-rk3528.inc"
