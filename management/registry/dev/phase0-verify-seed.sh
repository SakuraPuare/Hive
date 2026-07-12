#!/usr/bin/env bash
# Phase 0 验证种子执行器：把真机 MAC 注入 phase0-verify-seed.sql 后写库。
#
# 用法：
#   NODE_MAC=aabbccddeeff ./phase0-verify-seed.sh
# 可选（默认连本地/容器，与 seed-local-demo.sh 一致）：
#   MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DB MYSQL_CONTAINER

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_TPL="${SCRIPT_DIR}/phase0-verify-seed.sql"

if [[ -z "${NODE_MAC:-}" ]]; then
  echo "phase0-verify-seed: 必须设置 NODE_MAC（真机 12 位 MAC，无冒号小写）" >&2
  echo "  例: NODE_MAC=aabbccddeeff $0" >&2
  exit 1
fi
# 规范化：去冒号、转小写、取末 12 位（与 registry 端一致）
NODE_MAC="$(echo "${NODE_MAC}" | tr 'A-F' 'a-f' | tr -cd 'a-f0-9')"
NODE_MAC="${NODE_MAC: -12}"
if [[ "${#NODE_MAC}" -ne 12 ]]; then
  echo "phase0-verify-seed: NODE_MAC 规范化后不是 12 位: '${NODE_MAC}'" >&2
  exit 1
fi
export NODE_MAC

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-123456}"
MYSQL_DB="${MYSQL_DB:-hive_registry}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-hive-mysql}"

# 先确认该 MAC 已注册，否则计费链路无处落地
GUARD_SQL="SELECT COUNT(*) FROM nodes WHERE mac = '${NODE_MAC}';"

detect_local_client() {
  if command -v mariadb >/dev/null 2>&1; then echo "mariadb"; return; fi
  if command -v mysql   >/dev/null 2>&1; then echo "mysql";   return; fi
  echo ""
}
LOCAL_CLIENT="$(detect_local_client)"

run_sql() {  # stdin = SQL
  if [[ -n "${LOCAL_CLIENT}" ]]; then
    MYSQL_PWD="${MYSQL_PASSWORD}" "${LOCAL_CLIENT}" \
      -h "${MYSQL_HOST}" -P "${MYSQL_PORT}" -u "${MYSQL_USER}" "${MYSQL_DB}"
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fxq "${MYSQL_CONTAINER}"; then
    docker exec -i "${MYSQL_CONTAINER}" sh -lc '
      if command -v mariadb >/dev/null 2>&1; then exec mariadb -u "$0" "-p$1" "$2";
      else exec mysql -u "$0" "-p$1" "$2"; fi
    ' "${MYSQL_USER}" "${MYSQL_PASSWORD}" "${MYSQL_DB}"
  else
    echo "phase0-verify-seed: 找不到 mariadb/mysql 客户端，且容器 '${MYSQL_CONTAINER}' 未运行" >&2
    exit 1
  fi
}

registered="$(echo "${GUARD_SQL}" | run_sql -N 2>/dev/null | tail -1 | tr -cd '0-9')"
if [[ "${registered:-0}" == "0" ]]; then
  echo "phase0-verify-seed: 节点 ${NODE_MAC} 尚未注册（nodes 表无此 MAC）。" >&2
  echo "  请先让该设备上电完成注册，再运行本脚本。" >&2
  exit 1
fi

# 变量替换后写库（envsubst 只替换 \${NODE_MAC}）
if command -v envsubst >/dev/null 2>&1; then
  envsubst '${NODE_MAC}' < "${SQL_TPL}" | run_sql
else
  sed "s/\${NODE_MAC}/${NODE_MAC}/g" "${SQL_TPL}" | run_sql
fi

echo "phase0-verify-seed: 已为节点 ${NODE_MAC} 注入验证订阅。"
echo "  订阅 token = p0sub00000000000000000000000000000000000000000000000000000verify"
