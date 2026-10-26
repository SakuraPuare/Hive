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
source "${USERPATCHES_PATH}/config/hive-rk3528.inc"
