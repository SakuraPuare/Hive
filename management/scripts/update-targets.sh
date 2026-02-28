#!/bin/bash
# 从 Tailscale API 动态生成 Prometheus file_sd 目标文件
# 每台标记为 tag:hive 的节点自动出现在 Prometheus 里
#
# 部署方式（VPS 上执行一次）：
#   crontab -e
#   * * * * * /opt/hive-management/scripts/update-targets.sh

set -e

TAILNET="-"   # "-" = 当前账号默认 tailnet
OUTPUT="/opt/hive-management/prometheus/targets/nodes.json"
LOCK="/tmp/update-targets.lock"
TAG="tag:hive"

# 从环境变量或文件读取 token
if [ -z "${TAILSCALE_OAUTH_SECRET}" ]; then
    [ -f /opt/hive-management/.env ] && source /opt/hive-management/.env
fi

if [ -z "${TAILSCALE_OAUTH_SECRET}" ]; then
    echo "ERROR: TAILSCALE_OAUTH_SECRET not set" >&2
    exit 1
fi

# 防止并发执行
exec 9>"$LOCK"
flock -n 9 || exit 0

# 查询 Tailscale API，过滤 tag:hive，生成 file_sd 格式
RESULT=$(curl -sf \
    "https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices" \
    -H "Authorization: Bearer ${TAILSCALE_OAUTH_SECRET}" \
    | jq --arg tag "$TAG" '
        [.devices[]
         | select(.tags != null and any(.tags[]; . == $tag))
         | {
             "targets": [
               .name + ":9100"
             ],
             "labels": {
               "__meta_hostname": .hostname,
               "__meta_mac6": (.hostname | ltrimstr("hive-")),
               "instance": .hostname
             }
           }
        ]
    ')

# 只有查询成功才写文件（避免 API 故障清空 targets）
if echo "$RESULT" | jq -e 'type == "array"' > /dev/null 2>&1; then
    echo "$RESULT" > "$OUTPUT"
    echo "$(date): updated $(echo "$RESULT" | jq 'length') targets" \
        >> /var/log/update-targets.log
else
    echo "$(date): API query failed, keeping existing targets" \
        >> /var/log/update-targets.log
fi
