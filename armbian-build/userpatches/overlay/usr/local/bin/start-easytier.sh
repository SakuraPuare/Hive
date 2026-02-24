#!/bin/bash
# EasyTier 启动包装脚本
# 从 /etc/edge/node-info 读取确定性 IP，确保每次重启 IP 不变
# 由 easytier.service 调用

set -e

NODE_INFO="/etc/edge/node-info"
CONFIG_ENV="/etc/edge/config.env"

# 等待 node-info 存在（provision-node.sh 尚未跑完时可能不存在）
for i in $(seq 1 30); do
    [ -f "$NODE_INFO" ] && break
    echo "start-easytier: waiting for node-info... ($i/30)"
    sleep 5
done

if [ ! -f "$NODE_INFO" ]; then
    echo "start-easytier: node-info not found, cannot start"
    exit 1
fi

source "$NODE_INFO"
source "$CONFIG_ENV"

echo "start-easytier: ${HOSTNAME} @ ${EASYTIER_IP}/8"

exec /usr/local/bin/easytier-core \
    --network-name  "${EASYTIER_NETWORK_NAME}" \
    --network-secret "${EASYTIER_SECRET}" \
    --peers         "tcp://${EASYTIER_RELAY}:11010" \
    --ipv4          "${EASYTIER_IP}/8" \
    --hostname      "${HOSTNAME}"
