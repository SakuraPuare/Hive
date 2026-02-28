#!/bin/bash
# EasyTier 启动包装脚本
# 从 /etc/hive/node-info 读取确定性 IP，确保每次重启 IP 不变
# 由 easytier.service 调用

set -e

NODE_INFO="/etc/hive/node-info"
CONFIG_ENV="/etc/hive/config.env"

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

# 构造 --peers 参数：EASYTIER_PEERS 逗号分隔，单 peer 填一个即可
PEER_ARGS=()
if [ -n "${EASYTIER_PEERS}" ]; then
    IFS=',' read -ra PARSED <<< "${EASYTIER_PEERS}"
    for p in "${PARSED[@]}"; do
        p=$(echo "$p" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [ -z "$p" ] && continue
        if [[ "$p" != *://* ]]; then
            if [[ "$p" == *:* ]]; then
                p="tcp://${p}"
            else
                p="tcp://${p}:11010"
            fi
        fi
        PEER_ARGS+=(--peers "$p")
    done
fi

echo "start-easytier: ${HOSTNAME} @ ${EASYTIER_IP}/8"

exec /usr/local/bin/easytier-core \
    --network-name   "${EASYTIER_NETWORK_NAME}" \
    --network-secret "${EASYTIER_SECRET}" \
    "${PEER_ARGS[@]}" \
    --ipv4           "${EASYTIER_IP}/8" \
    --hostname       "${HOSTNAME}"
