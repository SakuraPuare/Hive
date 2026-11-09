#!/usr/bin/env bash
# Convert a freshly built Armbian image into a single-rootfs Hive factory image
# with an A/B boot payload, plus the boot payload bundle that firmware OTA
# ships. Only regular output files are accepted, never a device.
set -euo pipefail
SOURCE_IMAGE=$(realpath "${1:?source .img required}")
OUTPUT=$(realpath -m "${2:?output directory required}")
VERSION=${3:?version required}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/../armbian-build/userpatches/overlay/usr/local/bin/hive-board"
hive_board_config "${4:-nanopi-zero2}" || { echo 'Unsupported board'; exit 1; }
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || exit 1
[ -f "$SOURCE_IMAGE" ] && [ ! -b "$SOURCE_IMAGE" ] || exit 1
# One root filesystem, not two. Kernel rollback comes from the two payloads
# inside /boot, so a second copy of the whole filesystem is dead weight in the
# factory image. 3328 MiB is the measured floor for this payload: the tree
# occupies 2782 MiB and the filesystem needs headroom for metadata and for a
# future firmware payload's kernel modules.
ROOT_MIB=${HIVE_ROOT_MIB:-3328}
# The data partition ships small on purpose. hive-data-grow expands it to the
# end of the card before /data is first mounted, so every MiB reserved here is
# dead weight in the factory image that the device would have allocated anyway.
# 512 MiB is what the image carries; the floor below only guards typos.
DATA_MIB=${HIVE_DATA_MIB:-512}
[[ "$ROOT_MIB" =~ ^[0-9]+$ && "$DATA_MIB" =~ ^[0-9]+$ ]] || exit 1
[ "$ROOT_MIB" -ge 2048 ] && [ "$DATA_MIB" -ge 256 ] || exit 1
# Partition geometry is defined here and nowhere else. hive-firmware refuses a
# disk whose first partition does not start at 32768, and the boot script
# reserves the first 16 MiB for GPT, U-Boot and both environment copies, so both
# numbers are part of the on-disk contract rather than local choices.
START_ROOT=32768
ROOT_SECTORS=$((ROOT_MIB*2048))
START_DATA=$((START_ROOT+ROOT_SECTORS))
BOOT_AREA_MIB=16
FACTORY_MIB=$((BOOT_AREA_MIB+ROOT_MIB+DATA_MIB+1))
# Report the plan without touching a device. Loop mounts need root; the
# arithmetic does not, and a test can hold these numbers to the runtime checks.
if [ "${HIVE_FACTORY_PLAN_ONLY:-}" = 1 ]; then
    printf 'board=%s\nversion=%s\nroot_mib=%s\ndata_mib=%s\nboot_area_mib=%s\nstart_root=%s\nroot_sectors=%s\nstart_data=%s\nfactory_mib=%s\n' \
        "$HIVE_BOARD" "$VERSION" "$ROOT_MIB" "$DATA_MIB" "$BOOT_AREA_MIB" \
        "$START_ROOT" "$ROOT_SECTORS" "$START_DATA" "$FACTORY_MIB"
    exit 0
fi
[ "$EUID" -eq 0 ] || { echo 'Run with sudo (loop mounts are required).'; exit 1; }
for tool in losetup mount umount sfdisk mkfs.ext4 e2fsck resize2fs tune2fs rsync jq strings tar; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }
done
mkdir -p "$OUTPUT"
FACTORY="$OUTPUT/hive-${HIVE_BOARD}-factory-${VERSION}.img"
PAYLOAD="$OUTPUT/hive-${HIVE_BOARD}-boot-${VERSION}.tar"
[ ! -e "$FACTORY" ] && [ ! -e "$PAYLOAD" ] || { echo 'Output already exists'; exit 1; }
WORK=$(mktemp -d "$OUTPUT/.factory-build.XXXXXX")
SRC_LOOP="" ROOT_LOOP=""
cleanup() {
    mountpoint -q "$WORK/root" && umount "$WORK/root" || true
    mountpoint -q "$WORK/source-boot" && umount "$WORK/source-boot" || true
    mountpoint -q "$WORK/source" && umount "$WORK/source" || true
    [ -z "$ROOT_LOOP" ] || losetup -d "$ROOT_LOOP"
    [ -z "$SRC_LOOP" ] || losetup -d "$SRC_LOOP"
    rm -rf -- "$WORK"
}
trap cleanup EXIT
mkdir "$WORK/source" "$WORK/root"
SRC_LOOP=$(losetup --find --show --partscan --read-only "$SOURCE_IMAGE")
udevadm settle
# Select the root filesystem, not merely the first ext4 partition. Armbian
# puts /boot on its own ext4 partition (label armbi_boot) before root
# (armbi_root), and ab-layout only exists in root: picking by filesystem type
# alone selected the 512 MiB boot partition and failed the layout check even
# on a correctly built image. Prefer the root label, then fall back to the
# largest ext4 partition for images built without labels.
SOURCE_ROOT=$(lsblk -ln -o NAME,FSTYPE,LABEL,SIZE "$SRC_LOOP" |
    awk '$2 == "ext4" && $3 == "armbi_root" {print "/dev/"$1; exit}')
if [ -z "$SOURCE_ROOT" ]; then
    SOURCE_ROOT=$(lsblk -lnb -o NAME,FSTYPE,SIZE "$SRC_LOOP" |
        awk '$2 == "ext4" && $3+0 > best {best = $3+0; dev = "/dev/"$1} END {if (dev) print dev}')
fi
[ -n "$SOURCE_ROOT" ] || { echo 'No ext4 root filesystem in source'; exit 1; }
# /boot may live on its own partition (Armbian armbi_boot). The boot policy
# loads /boot/Image.<letter>, /boot/uInitrd.<letter> and
# /boot/dtb.<letter>/<board>.dtb from the root filesystem, so the boot
# partition has to be folded into it later.
SOURCE_BOOT=$(lsblk -ln -o NAME,FSTYPE,LABEL "$SRC_LOOP" |
    awk '$2 == "ext4" && $3 == "armbi_boot" {print "/dev/"$1; exit}')
mount -o ro,noload "$SOURCE_ROOT" "$WORK/source"
if [ -n "$SOURCE_BOOT" ]; then
    mkdir -p "$WORK/source-boot"
    mount -o ro,noload "$SOURCE_BOOT" "$WORK/source-boot"
fi
[ "$(cat "$WORK/source/usr/lib/hive/ab-layout")" = "$HIVE_LAYOUT" ] || { echo 'Source layout/board mismatch: build with HIVE_AB=yes first'; exit 1; }
UBOOT=$(find "$WORK/source/usr/lib" -name u-boot-rockchip.bin -type f -print -quit)
[ -n "$UBOOT" ] || { echo 'Hive bootloader missing'; exit 1; }
"$SCRIPT_DIR/check-uboot-env.sh" "$UBOOT" "$WORK/source/usr/lib/hive/uboot-env" || exit 1
[ "$(stat -c %s "$UBOOT")" -lt $((12*1024*1024-32768)) ] || { echo 'U-Boot overlaps reserved environment'; exit 1; }
truncate -s "${ROOT_MIB}M" "$WORK/rootfs.img"
mkfs.ext4 -q -F -O ^metadata_csum_seed,^orphan_file -L hive-root "$WORK/rootfs.img"
ROOT_LOOP=$(losetup --find --show "$WORK/rootfs.img")
mount "$ROOT_LOOP" "$WORK/root"
rsync -aHAX --numeric-ids --exclude=lost+found "$WORK/source/" "$WORK/root/"
# Fold the separate boot partition into the root filesystem: the boot policy
# loads every kernel file from there.
if mountpoint -q "$WORK/source-boot"; then
    mkdir -p "$WORK/root/boot"
    rsync -aHAX --numeric-ids --exclude=lost+found "$WORK/source-boot/" "$WORK/root/boot/"
fi
# Root device comes from bootargs PARTUUID, which the boot script reads from
# the partition itself.
awk '$2 != "/" && $2 != "/boot" && $2 != "/boot/efi" && $3 != "swap"' "$WORK/root/etc/fstab" > "$WORK/fstab"
cp "$WORK/fstab" "$WORK/root/etc/fstab"
printf '%s\n' "$VERSION" > "$WORK/root/usr/lib/hive/firmware-version"
for svc in armbian-resize-filesystem.service armbian-firstrun.service apt-daily-upgrade.timer unattended-upgrades.service; do
    systemctl --root="$WORK/root" mask "$svc"
done
systemctl --root="$WORK/root" enable hive-data.service hive-firmware-confirm.service hive-ota-recover.service hive-updater.timer
# The provisioning marker lives on the data partition; a fresh disk must already
# have the normal node services enabled because provisioning will be skipped.
systemctl --root="$WORK/root" enable xray.service cloudflared.service frpc.service easytier.service xray-exporter.service hive-xray-sync.timer
# Two boot payloads inside the one root filesystem. Both letters ship with the
# same kernel: the first firmware update writes the inactive letter, and the
# U-Boot attempt counter is the only thing that decides which one runs. The
# unsuffixed copies are removed so nothing can quietly load a stale kernel that
# a package manager dropped there.
#
# Armbian makes /boot/Image, /boot/uInitrd and /boot/dtb symlinks into the
# versioned files beside them. Copy through the links (-L): a copied symlink
# leaves both letters pointing at one shared target, so a firmware update could
# not replace a single letter's payload, and the payload tar would carry a
# dangling device-tree link instead of the tree.
for letter in A B; do
    cp -aL --preserve=mode,timestamps "$WORK/root/boot/Image" "$WORK/root/boot/Image.$letter"
    cp -aL --preserve=mode,timestamps "$WORK/root/boot/uInitrd" "$WORK/root/boot/uInitrd.$letter"
    cp -aL --preserve=mode,timestamps "$WORK/root/boot/dtb" "$WORK/root/boot/dtb.$letter"
done
rm -rf -- "$WORK/root/boot/Image" "$WORK/root/boot/uInitrd" "$WORK/root/boot/dtb"
# The versioned files those links pointed at are now dead weight: both letters
# own real copies, and nothing loads the originals. Dropping them keeps /boot to
# exactly two payloads and returns ~110 MiB, which the next kernel upgrade needs
# for its own /usr/lib/modules tree.
rm -rf -- "$WORK/root/boot"/vmlinuz-* "$WORK/root/boot"/uInitrd-* \
    "$WORK/root/boot"/initrd.img-* "$WORK/root/boot"/dtb-*
for letter in A B; do
    test -f "$WORK/root/boot/Image.$letter" && [ ! -L "$WORK/root/boot/Image.$letter" ] \
        || { echo "Root filesystem is missing /boot/Image.$letter as a regular file"; exit 1; }
    test -f "$WORK/root/boot/uInitrd.$letter" && [ ! -L "$WORK/root/boot/uInitrd.$letter" ] \
        || { echo "Root filesystem is missing /boot/uInitrd.$letter as a regular file"; exit 1; }
    test -d "$WORK/root/boot/dtb.$letter" && [ ! -L "$WORK/root/boot/dtb.$letter" ] \
        || { echo "Root filesystem is missing /boot/dtb.$letter as a real directory"; exit 1; }
    test -f "$WORK/root/boot/dtb.$letter/$HIVE_DTB" \
        || { echo "Root filesystem is missing /boot/dtb.$letter/$HIVE_DTB"; exit 1; }
done
# Firmware OTA ships this bundle. It carries the boot payload under its
# destination names plus the kernel modules and firmware blobs that must match
# the kernel; every other path stays with the application transaction.
mkdir -p "$WORK/payload/boot" "$WORK/payload/usr/lib/hive"
cp -aL --preserve=mode,timestamps "$WORK/root/boot/Image.A" "$WORK/payload/boot/Image"
cp -aL --preserve=mode,timestamps "$WORK/root/boot/uInitrd.A" "$WORK/payload/boot/uInitrd"
cp -aL --preserve=mode,timestamps "$WORK/root/boot/dtb.A" "$WORK/payload/boot/dtb"
cp -a "$WORK/root/usr/lib/modules" "$WORK/payload/usr/lib/modules"
[ ! -d "$WORK/root/usr/lib/firmware" ] || cp -a "$WORK/root/usr/lib/firmware" "$WORK/payload/usr/lib/firmware"
# The installer renames these to boot/Image.<letter> and boot/dtb.<letter>/,
# so the payload must carry the real files, not links into paths it omits.
test -f "$WORK/payload/boot/Image" && [ ! -L "$WORK/payload/boot/Image" ] \
    || { echo 'Boot payload carries no regular Image'; exit 1; }
test -f "$WORK/payload/boot/uInitrd" && [ ! -L "$WORK/payload/boot/uInitrd" ] \
    || { echo 'Boot payload carries no regular uInitrd'; exit 1; }
test -f "$WORK/payload/boot/dtb/$HIVE_DTB" \
    || { echo "Boot payload is missing boot/dtb/$HIVE_DTB"; exit 1; }
printf '{"board":"%s","layout":"%s","version":"%s"}\n' \
    "$HIVE_BOARD" "$HIVE_LAYOUT" "$VERSION" > "$WORK/payload/usr/lib/hive/boot-payload.json"
sync
umount "$WORK/root"
losetup -d "$ROOT_LOOP"; ROOT_LOOP=""
e2fsck -pf "$WORK/rootfs.img" || [ "$?" -eq 1 ]
# Ship only the occupied filesystem; the factory image expands it to the
# partition size, and the device never resizes it again.
resize2fs -M "$WORK/rootfs.img"
truncate -s "${FACTORY_MIB}M" "$WORK/factory.img"
sfdisk "$WORK/factory.img" <<EOF
label: gpt
unit: sectors
start=$START_ROOT, size=$ROOT_SECTORS, type=L, name="hive-root"
start=$START_DATA, size=$((DATA_MIB*2048)), type=L, name="hive-data"
EOF
dd if="$UBOOT" of="$WORK/factory.img" bs=512 seek=64 conv=notrunc status=none
cp --sparse=always "$WORK/rootfs.img" "$WORK/root.img"
resize2fs "$WORK/root.img" "${ROOT_MIB}M"
dd if="$WORK/root.img" of="$WORK/factory.img" bs=1M seek=$BOOT_AREA_MIB conv=notrunc,sparse status=none
truncate -s "${DATA_MIB}M" "$WORK/data.img"
mkfs.ext4 -q -F -L hive-data "$WORK/data.img"
dd if="$WORK/data.img" of="$WORK/factory.img" bs=1M seek=$((BOOT_AREA_MIB+ROOT_MIB)) conv=notrunc,sparse status=none
tar -C "$WORK/payload" -cf "$WORK/boot-payload.tar" boot usr
mv "$WORK/boot-payload.tar" "$PAYLOAD"
mv "$WORK/factory.img" "$FACTORY"
sha256sum "$FACTORY" "$PAYLOAD" > "$OUTPUT/hive-${HIVE_BOARD}-factory-${VERSION}.sha256"
echo "Factory image: $FACTORY"
echo "Boot payload: $PAYLOAD"
echo 'Factory image requires a full offline flash. Firmware OTA never writes the bootloader or the data partition.'

# The factory image is a raw GPT disk: 16 MiB boot area, one full root
# filesystem and the data partition. Ship an .xz beside it for handing around:
# xz is the only format balenaEtcher and rpi-imager both decompress on the fly,
# and the holes make it compress hard. memlimit keeps xz from sizing its thread
# pool for the core count alone, which is how this host ran out of memory once.
if [ "${HIVE_COMPRESS:-yes}" = yes ]; then
    xz -T0 -6 -q --memlimit-compress=60% -c "$FACTORY" > "$FACTORY.xz"
    sha256sum "$FACTORY.xz" > "$FACTORY.xz.sha256"
    echo "Factory image (compressed): $FACTORY.xz"
fi
