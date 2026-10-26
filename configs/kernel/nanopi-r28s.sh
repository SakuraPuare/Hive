#!/usr/bin/env bash
# R28S uses Armbian's vendor 6.1 baseline. Keep its SDIO AIC8800 extension,
# PCIe/RTL8111H and SoC drivers: the mainline Zero2 pruning is not appropriate.
set -euo pipefail
BASE=${1:?base config required}
OUT=${2:?output config required}
cp "$BASE" "$OUT"
force() {
    sed -i "/^${1}=/d; /^# ${1} is not set$/d" "$OUT"
    printf '%s=%s\n' "$1" "$2" >> "$OUT"
}
for key in TMPFS TMPFS_POSIX_ACL TMPFS_XATTR I2C CGROUPS MEMCG BLK_DEV_INITRD \
           EXT4_FS MMC MMC_DW MMC_DW_ROCKCHIP PCI PCIE_DW_ROCKCHIP \
           STMMAC_ETH DWMAC_ROCKCHIP INET IPV6 NETFILTER NF_TABLES NF_CONNTRACK \
           NF_NAT NF_TABLES_INET NF_DEFRAG_IPV4 NF_DEFRAG_IPV6 \
           IP_ADVANCED_ROUTER IP_MULTIPLE_TABLES IPV6_MULTIPLE_TABLES; do
    force "CONFIG_$key" y
done
for key in R8169 CFG80211 MAC80211 TUN NFT_CT NFT_NAT NFT_REDIR NFT_MASQ \
           NFT_TPROXY NFT_SOCKET NFT_FIB_INET NFT_FIB_IPV4 NFT_FIB_IPV6 NF_TPROXY_IPV4 NF_TPROXY_IPV6 \
           NETFILTER_XT_TARGET_TPROXY NETFILTER_XT_MATCH_SOCKET NETFILTER_XT_MATCH_MARK \
           NETFILTER_XT_MARK IP_NF_MANGLE IP6_NF_MANGLE; do
    force "CONFIG_$key" m
done
# Bound the headless image's reserved video memory without dropping vendor PHY dependencies.
force CONFIG_CMA_SIZE_MBYTES 16
echo 'Applied NanoPi R28S vendor kernel configuration'
