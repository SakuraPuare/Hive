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

# shellcheck source=/dev/null
source /usr/local/bin/hive-node-info
hive_load_node_info "$NODE_INFO"
# shellcheck source=/dev/null
source "$CONFIG_ENV"

# 这三个值决定了整条 mesh 是否成立。空的 --ipv4 会变成 "/16"，空的
# --network-secret 会让节点出现在错误的网络里；easytier-core 随后退出，而
# Restart=always 把它变成每 10s 一次的重启循环，日志里只有参数错误。
missing=""
[ -n "${EASYTIER_IP:-}" ] || missing="${missing} EASYTIER_IP(node-info)"
[ -n "${EASYTIER_NETWORK_NAME:-}" ] || missing="${missing} EASYTIER_NETWORK_NAME(config.env)"
[ -n "${EASYTIER_SECRET:-}" ] || missing="${missing} EASYTIER_SECRET(config.env)"
if [ -n "$missing" ]; then
    echo "start-easytier: 缺少必需配置:${missing}" >&2
    echo "start-easytier: 修复前不启动，避免无意义的 Restart=always 循环" >&2
    exit 1
fi

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

echo "start-easytier: ${HOSTNAME} @ ${EASYTIER_IP}/16"

exec /usr/local/bin/easytier-core \
    --network-name   "${EASYTIER_NETWORK_NAME}" \
    --network-secret "${EASYTIER_SECRET}" \
    "${PEER_ARGS[@]}" \
    --ipv4           "${EASYTIER_IP}/16" \
    --hostname       "${HOSTNAME}" \
    --relay-network-whitelist "${EASYTIER_NETWORK_NAME}"
