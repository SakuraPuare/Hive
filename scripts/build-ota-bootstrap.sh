#!/usr/bin/env bash
# A first-install kit for existing nodes without an OTA client. Transfer over SSH.
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
OVERLAY="$ROOT_DIR/armbian-build/userpatches/overlay"
VERSION=${1:?version required}
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || exit 1
test -s "$OVERLAY/etc/hive/ota-pubkey.pem"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
kit="$work/hive-ota-bootstrap-$VERSION"
mkdir -p "$kit/files"
for file in usr/local/bin/hive-updater usr/local/bin/hive-ota-transaction \
    usr/local/bin/hive-node-info usr/local/bin/hive-board usr/local/bin/hive-firmware \
    usr/lib/systemd/system-generators/hive-memory-generator \
    etc/systemd/system/hive-updater.service etc/systemd/system/hive-updater.timer \
    etc/systemd/system/hive-ota-recover.service etc/hive/ota-pubkey.pem; do
    install -D -m 0644 "$OVERLAY/$file" "$kit/files/$file"
done
cp "$ROOT_DIR/scripts/install-ota-agent.sh" "$kit/install.sh"
chmod 0755 "$kit/install.sh"
(cd "$kit"; find files -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
mkdir -p "$ROOT_DIR/output/ota"
archive="$ROOT_DIR/output/ota/hive-ota-bootstrap-$VERSION.tar.gz"
tar czf "$archive" -C "$work" "hive-ota-bootstrap-$VERSION"
sha256sum "$archive" > "$archive.sha256"
echo "$archive"
