#!/usr/bin/env bash
# Run from the bootstrap kit on the node. Initial trust is the authenticated SSH
# transfer and an independently checked archive hash; later OTA uses Ed25519.
set -euo pipefail
mode=${1:---check}
case "$mode" in --check|--install) ;; *) echo 'Usage: install.sh [--check|--install]' >&2; exit 2;; esac
kit=$(cd "$(dirname "$0")" && pwd)
[ "$EUID" -eq 0 ] || { echo 'Run as root on the node' >&2; exit 1; }
[ "$(uname -m)" = aarch64 ] || { echo 'ARM64 node required' >&2; exit 1; }
for tool in curl jq openssl python3 tar sha256sum flock systemctl realpath; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
(cd "$kit"; sha256sum --quiet -c SHA256SUMS)
source "$kit/files/usr/local/bin/hive-board"
hive_detect_board || { echo 'Unsupported node board' >&2; exit 1; }
test -s /etc/hive/config.env
test -s /etc/hive/device-token
test -s /etc/hive/node-info
source /etc/hive/config.env
case "${NODE_REGISTRY_URL:-}" in http://*|https://*) ;; *) echo 'Configure NODE_REGISTRY_URL first' >&2; exit 1;; esac
source "$kit/files/usr/local/bin/hive-node-info"
hive_load_node_info /etc/hive/node-info
[[ "${MAC:-}" =~ ^[a-fA-F0-9:]{12,17}$ ]] || { echo 'Missing node MAC' >&2; exit 1; }
if [ -e /etc/hive/ota-pubkey.pem ]; then
    cmp -s /etc/hive/ota-pubkey.pem "$kit/files/etc/hive/ota-pubkey.pem" || {
        echo 'Existing signing key differs; preserve it and rebuild this kit with that public key.' >&2; exit 1;
    }
fi
openssl pkey -pubin -in "$kit/files/etc/hive/ota-pubkey.pem" -text -noout | grep -q ED25519
while read -r _ file; do
    path=${file#files/}
    [[ "$file" == files/* && "$path" != *..* ]] || exit 1
    [ "$(realpath -m "/$path")" = "/$path" ] && [ ! -L "/$path" ] || exit 1
done < "$kit/SHA256SUMS"
echo "Prerequisites OK: $HIVE_BOARD; identity/configuration will be retained."
[ "$mode" = --install ] || exit 0

umask 077
mkdir -p /var/lib/hive
exec 9>/var/lib/hive/ota.lock
flock -n 9 || { echo 'An OTA is running; retry later.' >&2; exit 75; }
[ ! -f /var/lib/hive/ota-transaction/active ] && [ ! -f /var/lib/hive/firmware-pending.json ] || {
    echo 'Finish the existing update/recovery before installing the agent.' >&2; exit 1;
}
backup=$(mktemp -d /var/lib/hive/ota-bootstrap.XXXXXX)
systemctl is-enabled hive-updater.timer > "$backup/timer-enabled" 2>/dev/null || true
systemctl is-active hive-updater.timer > "$backup/timer-active" 2>/dev/null || true
systemctl is-enabled hive-ota-recover.service > "$backup/recover-enabled" 2>/dev/null || true
: > "$backup/new-files"
: > "$backup/old-files"
while read -r _ file; do
    path=${file#files/}
    if [ -f "/$path" ]; then
        printf '%s\n' "$path" >> "$backup/old-files"
    else
        printf '%s\n' "$path" >> "$backup/new-files"
    fi
done < "$kit/SHA256SUMS"
tar cpf "$backup/previous.tar" -C / -T "$backup/old-files"
sync -f "$backup"
rollback() {
    local rc=$?
    trap - EXIT
    if [ "$rc" -ne 0 ]; then
        tar xpf "$backup/previous.tar" -C /
        while read -r path; do rm -f -- "/$path"; done < "$backup/new-files"
        systemctl daemon-reload
        if ! grep -qx enabled "$backup/recover-enabled"; then systemctl disable hive-ota-recover.service >/dev/null 2>&1 || true; fi
        if grep -qx enabled "$backup/timer-enabled"; then systemctl enable hive-updater.timer; else systemctl disable hive-updater.timer >/dev/null 2>&1 || true; fi
        if grep -qx active "$backup/timer-active"; then systemctl start hive-updater.timer; else systemctl stop hive-updater.timer || true; fi
        echo "Bootstrap failed; backup retained at $backup" >&2
    fi
    exit "$rc"
}
trap rollback EXIT
systemctl stop hive-updater.timer 2>/dev/null || true
while read -r _ file; do
    path=${file#files/}
    mode=0644
    case "$path" in usr/local/bin/*|usr/lib/systemd/system-generators/*) mode=0755;; esac
    mkdir -p "$(dirname "/$path")"
    tmp=$(mktemp "/${path}.bootstrap.XXXXXX")
    install -m "$mode" "$kit/$file" "$tmp"
    mv -f "$tmp" "/$path"
done < "$kit/SHA256SUMS"
systemctl daemon-reload
systemctl enable hive-ota-recover.service hive-updater.timer
systemctl start hive-updater.timer
systemctl is-active --quiet hive-updater.timer
sync
echo "OTA agent installed. Backup: $backup. No repartition or reboot performed."
