#!/bin/bash
# 量产前清洗镜像中的唯一标识
# 在已挂载的镜像 chroot 内执行，或通过 Armbian customize-image.sh 调用
set -e

echo ">>> Sanitizing node identity..."

# SSH Host Keys（首次启动时重新生成）
rm -f /etc/ssh/ssh_host_*

# Machine ID（首次启动时重新生成）
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id

# Tailscale
rm -f /var/lib/tailscale/tailscaled.state

# 日志
journalctl --rotate 2>/dev/null || true
journalctl --vacuum-time=1s 2>/dev/null || true
find /var/log -name "*.log" -delete 2>/dev/null || true

# Shell 历史
history -c 2>/dev/null || true
rm -f /root/.bash_history /home/*/.bash_history

echo ">>> Sanitization complete. Ready for mass flashing."
