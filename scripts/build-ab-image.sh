#!/usr/bin/env bash
# Convert a freshly built, A/B-capable Armbian image into a factory image
# and a rootfs payload. Only regular output files are accepted, never a device.
set -euo pipefail
SOURCE_IMAGE=$(realpath "${1:?source .img required}")
OUTPUT=$(realpath -m "${2:?output directory required}")
VERSION=${3:?version required}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/../armbian-build/userpatches/overlay/usr/local/bin/hive-board"
hive_board_config "${4:-nanopi-zero2}" || { echo 'Unsupported A/B board'; exit 1; }
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || exit 1
[ "$EUID" -eq 0 ] || { echo 'Run with sudo (loop mounts are required).'; exit 1; }
[ -f "$SOURCE_IMAGE" ] && [ ! -b "$SOURCE_IMAGE" ] || exit 1
SLOT_MIB=${HIVE_AB_SLOT_MIB:-4096}
DATA_MIB=${HIVE_AB_DATA_MIB:-8192}
[[ "$SLOT_MIB" =~ ^[0-9]+$ && "$DATA_MIB" =~ ^[0-9]+$ ]] || exit 1
[ "$SLOT_MIB" -ge 1024 ] && [ "$DATA_MIB" -ge 2048 ] || exit 1
for tool in losetup mount umount sfdisk mkfs.ext4 e2fsck resize2fs tune2fs rsync jq strings; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }
done
mkdir -p "$OUTPUT"
FACTORY="$OUTPUT/hive-${HIVE_BOARD}-ab-${VERSION}.img"
ROOTFS="$OUTPUT/hive-${HIVE_BOARD}-rootfs-${VERSION}.img"
[ ! -e "$FACTORY" ] && [ ! -e "$ROOTFS" ] || { echo 'Output already exists'; exit 1; }
WORK=$(mktemp -d "$OUTPUT/.ab-build.XXXXXX")
SRC_LOOP="" ROOT_LOOP=""
cleanup() {
    mountpoint -q "$WORK/root" && umount "$WORK/root" || true
    mountpoint -q "$WORK/source" && umount "$WORK/source" || true
    [ -z "$ROOT_LOOP" ] || losetup -d "$ROOT_LOOP"
    [ -z "$SRC_LOOP" ] || losetup -d "$SRC_LOOP"
    rm -rf -- "$WORK"
}
trap cleanup EXIT
mkdir "$WORK/source" "$WORK/root"
SRC_LOOP=$(losetup --find --show --partscan --read-only "$SOURCE_IMAGE")
udevadm settle
SOURCE_ROOT=$(lsblk -ln -o NAME,FSTYPE "$SRC_LOOP" | awk '$2 == "ext4" {print "/dev/"$1; exit}')
[ -n "$SOURCE_ROOT" ] || { echo 'No ext4 root filesystem in source'; exit 1; }
mount -o ro,noload "$SOURCE_ROOT" "$WORK/source"
[ "$(cat "$WORK/source/usr/lib/hive/ab-layout")" = "$HIVE_LAYOUT" ] || { echo 'Source layout/board mismatch: build with HIVE_AB=yes first'; exit 1; }
UBOOT=$(find "$WORK/source/usr/lib" -name u-boot-rockchip.bin -type f -print -quit)
[ -n "$UBOOT" ] || { echo 'A/B bootloader missing'; exit 1; }
"$SCRIPT_DIR/check-uboot-env.sh" "$UBOOT" "$WORK/source/usr/lib/hive/uboot-env" || exit 1
[ "$(stat -c %s "$UBOOT")" -lt $((12*1024*1024-32768)) ] || { echo 'U-Boot overlaps reserved environment'; exit 1; }
truncate -s "${SLOT_MIB}M" "$WORK/rootfs.img"
mkfs.ext4 -q -F -O ^metadata_csum_seed,^orphan_file -L hive-rootA "$WORK/rootfs.img"
ROOT_LOOP=$(losetup --find --show "$WORK/rootfs.img")
mount "$ROOT_LOOP" "$WORK/root"
rsync -aHAX --numeric-ids --exclude=lost+found "$WORK/source/" "$WORK/root/"
# Root device comes from bootargs PARTUUID, so one payload fits either slot.
awk '$2 != "/" && $2 != "/boot" && $2 != "/boot/efi" && $3 != "swap"' "$WORK/root/etc/fstab" > "$WORK/fstab"
cp "$WORK/fstab" "$WORK/root/etc/fstab"
printf '%s\n' "$VERSION" > "$WORK/root/usr/lib/hive/firmware-version"
for svc in armbian-resize-filesystem.service armbian-firstrun.service apt-daily-upgrade.timer unattended-upgrades.service; do
    systemctl --root="$WORK/root" mask "$svc"
done
systemctl --root="$WORK/root" enable hive-data.service hive-firmware-confirm.service hive-ota-recover.service hive-updater.timer
# The provisioning marker lives on the data partition; a new slot must already
# have the normal node services enabled because provisioning will be skipped.
systemctl --root="$WORK/root" enable xray.service cloudflared.service frpc.service easytier.service xray-exporter.service hive-xray-sync.timer
test -f "$WORK/root/boot/Image"
test -f "$WORK/root/boot/uInitrd"
test -f "$WORK/root/boot/dtb/$HIVE_DTB"
sync
umount "$WORK/root"
losetup -d "$ROOT_LOOP"; ROOT_LOOP=""
e2fsck -pf "$WORK/rootfs.img" || [ "$?" -eq 1 ]
# Ship only the occupied filesystem; the installer expands it to slot size.
resize2fs -M "$WORK/rootfs.img"
START_A=32768
SLOT_SECTORS=$((SLOT_MIB*2048))
START_B=$((START_A+SLOT_SECTORS))
START_DATA=$((START_B+SLOT_SECTORS))
truncate -s "$((16+2*SLOT_MIB+DATA_MIB+1))M" "$WORK/factory.img"
sfdisk "$WORK/factory.img" <<EOF
label: gpt
unit: sectors
start=$START_A, size=$SLOT_SECTORS, type=L, name="hive-rootA"
start=$START_B, size=$SLOT_SECTORS, type=L, name="hive-rootB"
start=$START_DATA, size=$((DATA_MIB*2048)), type=L, name="hive-data"
EOF
dd if="$UBOOT" of="$WORK/factory.img" bs=512 seek=64 conv=notrunc status=none
cp --sparse=always "$WORK/rootfs.img" "$WORK/rootA.img"
resize2fs "$WORK/rootA.img" "${SLOT_MIB}M"
dd if="$WORK/rootA.img" of="$WORK/factory.img" bs=1M seek=16 conv=notrunc,sparse status=none
cp --sparse=always "$WORK/rootA.img" "$WORK/rootB.img"
tune2fs -U random -L hive-rootB "$WORK/rootB.img"
dd if="$WORK/rootB.img" of="$WORK/factory.img" bs=1M seek=$((16+SLOT_MIB)) conv=notrunc,sparse status=none
truncate -s "${DATA_MIB}M" "$WORK/data.img"
mkfs.ext4 -q -F -L hive-data "$WORK/data.img"
dd if="$WORK/data.img" of="$WORK/factory.img" bs=1M seek=$((16+2*SLOT_MIB)) conv=notrunc,sparse status=none
mv "$WORK/rootfs.img" "$ROOTFS"
mv "$WORK/factory.img" "$FACTORY"
sha256sum "$FACTORY" "$ROOTFS" > "$OUTPUT/hive-${HIVE_BOARD}-ab-${VERSION}.sha256"
echo "Factory image: $FACTORY"
echo "Firmware payload: $ROOTFS"
echo 'Factory image requires a full offline flash. Firmware OTA never writes the bootloader or data partition.'
