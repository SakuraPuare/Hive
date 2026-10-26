#!/bin/bash
# Generate random SSH host keys and rotate the legacy MAC-derived Ed25519 key once.
set -euo pipefail
umask 077
mkdir -p /etc/hive
exec 9>/run/hive-hostkeys.lock
flock 9
marker=/etc/hive/random-hostkeys-v1
if [ ! -f "$marker" ] || [ ! -s /etc/ssh/ssh_host_ed25519_key ]; then
    key_dir=$(mktemp -d /etc/ssh/.hive-hostkey.XXXXXX)
    trap 'rm -rf "$key_dir"' EXIT
    ssh-keygen -q -t ed25519 -N '' -f "$key_dir/ssh_host_ed25519_key"
    chmod 644 "$key_dir/ssh_host_ed25519_key.pub"
    mv -f "$key_dir/ssh_host_ed25519_key.pub" /etc/ssh/ssh_host_ed25519_key.pub
    mv -f "$key_dir/ssh_host_ed25519_key" /etc/ssh/ssh_host_ed25519_key
    touch "$marker"
fi
ssh-keygen -A
