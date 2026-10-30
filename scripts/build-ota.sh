#!/bin/bash
# 打包应用层 OTA bundle
#
# 用法：
#   ./scripts/build-ota.sh <version> [--include <glob>...] [--restart <service>...]
#
# 示例：
#   # 默认 bundle（应用程序、服务单元、静态资源）
#   ./scripts/build-ota.sh 1.0.0
#
#   # 只更新指定文件
#   ./scripts/build-ota.sh 1.0.1 \
#     --include "usr/local/bin/xray" \
#     --include "usr/local/bin/mihomo" \
#     --restart xray --restart hive-mihomo
#
#   # 包含新 systemd unit（自动 daemon-reload）
#   ./scripts/build-ota.sh 1.1.0 \
#     --include "usr/local/bin/hive-new-tool" \
#     --include "etc/systemd/system/hive-new.service" \
#     --enable hive-new --restart hive-new
#
# 输出：output/ota/hive-ota-<version>.tar.gz + .sha256
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OVERLAY_DIR="${ROOT_DIR}/armbian-build/userpatches/overlay"
SIGNING_KEY="${OTA_SIGNING_KEY_PATH:-${ROOT_DIR}/keys/ota-signing.pem}"
OUTPUT_DIR="${ROOT_DIR}/output/ota"

# 启动/恢复关键文件不能通过应用 OTA 更换。回滚备份和事务标记都放在
# /var/lib/hive（由 hive-data 从 /data bind 挂载）：一旦 hive-data 系列脚本
# 或它们的 unit 被坏包替换，/data 挂不上，回滚脚本永远跑不到，设备只会无限
# 重启。这些文件只能随 A/B 固件（rootfs 槽）更新。
# 运行期在 hive-ota-transaction:ota_protected_path 再拦一次，签名包也不能覆盖。
ota_protected_path() {
    case "$1" in
        boot|boot/*|usr/lib/hive|usr/lib/hive/*|usr/lib/modules|usr/lib/modules/*) return 0 ;;
        usr/lib/systemd/system|usr/lib/systemd/system/*) return 0 ;;
        usr/local/bin/hive-data|usr/local/bin/hive-data-grow) return 0 ;;
        usr/local/bin/hive-board|usr/local/bin/hive-node-info) return 0 ;;
        usr/local/bin/hive-firmware) return 0 ;;
        # 事务目录由 hive-ota-transaction 在安装前写入，包内容不得覆盖。
        var/lib/hive/ota-transaction|var/lib/hive/ota-transaction/*) return 0 ;;
        # 前缀匹配同时覆盖 .d/ drop-in 与 .wants/ 链接：否则可以用
        # etc/systemd/system/hive-data.service.d/x.conf 绕过上面的名单。
        etc/systemd/system/hive-data.service*) return 0 ;;
        etc/systemd/system/hive-ota-recover.service*) return 0 ;;
        etc/systemd/system/hive-firmware-confirm.service*) return 0 ;;
    esac
    return 1
}

usage() {
    echo "用法: $0 <version> [选项]"
    echo ""
    echo "选项:"
    echo "  --include <path>     包含的文件（相对 overlay，可多次指定）"
    echo "  --exclude <path>     排除的文件（相对 overlay，可多次指定）"
    echo "  --restart <service>  安装后重启的服务（可多次指定）"
    echo "  --enable <service>   安装后 enable 的服务（可多次指定）"
    echo "  --pre-hook <script>  pre-install hook 脚本路径"
    echo "  --post-hook <script> post-install hook 脚本路径"
    echo "  --health-hook <file> 安装后功能检查，失败回滚"
    echo "  --backup <path>     hook 会修改的额外文件（相对根目录）"
    echo "  --firmware <image>  NanoPi Zero2/R28S A/B rootfs 镜像（自动识别板型）"
    echo "  --no-sign            跳过签名（测试用）"
    exit 1
}

VERSION="${1:-}"
[[ "${VERSION}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || usage
shift

INCLUDES=()
EXCLUDES=()
RESTART_SERVICES=()
ENABLE_SERVICES=()
PRE_HOOK=""
POST_HOOK=""
HEALTH_HOOK=""
BACKUP_PATHS=()
FIRMWARE=""
NO_SIGN=false

while [ $# -gt 0 ]; do
    case "$1" in
        --include)   INCLUDES+=("$2"); shift 2 ;;
        --exclude)   EXCLUDES+=("$2"); shift 2 ;;
        --restart)   RESTART_SERVICES+=("$2"); shift 2 ;;
        --enable)    ENABLE_SERVICES+=("$2"); shift 2 ;;
        --pre-hook)  PRE_HOOK="$2"; shift 2 ;;
        --post-hook) POST_HOOK="$2"; shift 2 ;;
        --health-hook) HEALTH_HOOK="$2"; shift 2 ;;
        --backup)    BACKUP_PATHS+=("$2"); shift 2 ;;
        --firmware)  FIRMWARE="$2"; shift 2 ;;
        --no-sign)   NO_SIGN=true; shift ;;
        *)           echo "未知选项: $1"; usage ;;
    esac
done

if [ "${NO_SIGN}" = "false" ] && [ ! -f "${SIGNING_KEY}" ]; then
    echo "ERROR: 签名私钥不存在: ${SIGNING_KEY}"
    echo "运行: ./scripts/gen-ota-keys.sh 生成密钥对"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: 需要 jq（JSON 处理工具）"
    echo "安装: sudo apt install jq  /  sudo pacman -S jq  /  brew install jq"
    exit 1
fi

# ── 构建 staging 目录 ────────────────────────────────────────────────────
STAGING=$(mktemp -d)
trap "rm -rf ${STAGING}" EXIT

BUNDLE_NAME="hive-ota-v${VERSION}"
KIND=application
BOARD=""
LAYOUT=""
if [ -n "$FIRMWARE" ]; then
    [ -f "$FIRMWARE" ] || { echo 'Firmware image not found'; exit 1; }
    LAYOUT=$(debugfs -R 'cat /usr/lib/hive/ab-layout' "$FIRMWARE" 2>/dev/null)
    case "$LAYOUT" in nanopi-zero2-ab-v1|nanopi-r28s-ab-v1) BOARD=${LAYOUT%-ab-v1};;
        *) echo 'Unsupported A/B rootfs layout'; exit 1;; esac
    KIND=firmware
    BUNDLE_NAME="hive-firmware-${BOARD}-v${VERSION}"
fi
BUNDLE_DIR="${STAGING}/${BUNDLE_NAME}"
FILES_DIR="${BUNDLE_DIR}/files"
HOOKS_DIR="${BUNDLE_DIR}/hooks"

mkdir -p "${FILES_DIR}" "${HOOKS_DIR}"

# ── 收集文件 ─────────────────────────────────────────────────────────────
echo ">>> 收集 OTA 文件..."

if [ -n "$FIRMWARE" ]; then
    [ "${#INCLUDES[@]}" -eq 0 ] && [ -z "$PRE_HOOK$POST_HOOK$HEALTH_HOOK" ] || { echo 'Firmware cannot include application files/hooks'; exit 1; }
    [ -f "$FIRMWARE" ] || { echo 'Firmware image not found'; exit 1; }
    [ "$(debugfs -R 'cat /usr/lib/hive/firmware-version' "$FIRMWARE" 2>/dev/null)" = "$VERSION" ] || { echo 'Rootfs version mismatch'; exit 1; }
    cp --sparse=always "$FIRMWARE" "$FILES_DIR/rootfs.img"
elif [ ${#INCLUDES[@]} -eq 0 ]; then
    # The bundled sync agents refuse to authorize without the lease watchdog.
    ENABLE_SERVICES+=(hive-ota-recover.service hive-updater.timer hive-subscription-guard.timer hive-xray-sync.timer hive-clash-sync.timer)
    RESTART_SERVICES=(hive-subscription-guard.timer "${RESTART_SERVICES[@]}" hive-xray-sync.timer hive-clash-sync.timer)
    # 默认仅更新应用文件，运行配置和设备身份必须通过显式迁移 hook 更新。
    cd "${OVERLAY_DIR}"
    find usr/local/bin usr/lib/systemd/system-generators etc/systemd/system etc/NetworkManager/dispatcher.d etc/update-motd.d var/www -type f ! -name ".gitkeep" | while read -r f; do
        f="${f#./}"
        SKIP=false
        for ex in "${EXCLUDES[@]+"${EXCLUDES[@]}"}"; do
            [[ "${f}" == ${ex} ]] && SKIP=true && break
        done
        ${SKIP} && continue
        if ota_protected_path "$f"; then
            echo ">>> 跳过启动/恢复关键文件: $f"
            continue
        fi
        mkdir -p "${FILES_DIR}/$(dirname "$f")"
        cp -a "${OVERLAY_DIR}/${f}" "${FILES_DIR}/${f}"
    done
    cd "${ROOT_DIR}"
else
    for inc in "${INCLUDES[@]}"; do
        case "$inc" in
            /*|../*|*/../*|..|etc/hive/*|etc/xray/*|etc/mihomo/*|etc/frp/*|etc/ssh/*)
                echo "ERROR: identity/runtime configuration must be updated by a migration hook: $inc"; exit 1 ;;
        esac
        if ota_protected_path "$inc"; then
            echo "ERROR: 启动/恢复关键文件只能随固件 OTA 更新: $inc"; exit 1
        fi
        if [ -f "${OVERLAY_DIR}/${inc}" ]; then
            mkdir -p "${FILES_DIR}/$(dirname "$inc")"
            cp -a "${OVERLAY_DIR}/${inc}" "${FILES_DIR}/${inc}"
        else
            echo "ERROR: 文件不存在: ${OVERLAY_DIR}/${inc}"; exit 1
        fi
    done
fi

# ── 复制 hooks ───────────────────────────────────────────────────────────
[ -z "$PRE_HOOK" ] || cp "$PRE_HOOK" "$HOOKS_DIR/pre-install.sh"
[ -z "$POST_HOOK" ] || cp "$POST_HOOK" "$HOOKS_DIR/post-install.sh"
[ -z "$HEALTH_HOOK" ] || cp "$HEALTH_HOOK" "$HOOKS_DIR/health-check.sh"

# ── 生成 manifest.json ──────────────────────────────────────────────────
echo ">>> 生成 manifest.json..."

RELOAD_DAEMON=false
FILE_ENTRIES="[]"

cd "${FILES_DIR}"
while IFS= read -r -d '' f; do
    f="${f#./}"
    SHA=$(sha256sum "${f}" | awk '{print $1}')
    # 从源 overlay 推导权限；二进制和脚本 0755，其余 0644
    MODE="0644"
    case "${f}" in
        usr/local/bin/*) MODE="0755" ;;
        usr/lib/systemd/system-generators/*) MODE="0755"; RELOAD_DAEMON=true ;;
        etc/NetworkManager/dispatcher.d/*) MODE="0755" ;;
        etc/update-motd.d/*) MODE="0755" ;;
    esac
    FILE_ENTRIES=$(echo "${FILE_ENTRIES}" | jq --arg p "$f" --arg s "$SHA" --arg m "$MODE" \
        '. + [{"path": $p, "sha256": $s, "mode": $m}]')
    # systemd unit → 需要 daemon-reload
    [[ "${f}" == etc/systemd/system/* ]] && RELOAD_DAEMON=true
done < <(find . -type f -print0 | sort -z)
cd "${ROOT_DIR}"

# 构造 JSON
RESTART_JSON="[]"
for svc in "${RESTART_SERVICES[@]+"${RESTART_SERVICES[@]}"}"; do
    RESTART_JSON=$(echo "${RESTART_JSON}" | jq --arg s "$svc" '. + [$s]')
done

ENABLE_JSON="[]"
for svc in "${ENABLE_SERVICES[@]+"${ENABLE_SERVICES[@]}"}"; do
    ENABLE_JSON=$(echo "${ENABLE_JSON}" | jq --arg s "$svc" '. + [$s]')
done

PRE_HOOK_SHA256=""
POST_HOOK_SHA256=""
HEALTH_HOOK_SHA256=""
[ -f "${HOOKS_DIR}/pre-install.sh" ] && PRE_HOOK_SHA256=$(sha256sum "${HOOKS_DIR}/pre-install.sh" | awk '{print $1}')
[ -f "${HOOKS_DIR}/post-install.sh" ] && POST_HOOK_SHA256=$(sha256sum "${HOOKS_DIR}/post-install.sh" | awk '{print $1}')

[ ! -f "$HOOKS_DIR/health-check.sh" ] || HEALTH_HOOK_SHA256=$(sha256sum "$HOOKS_DIR/health-check.sh" | awk '{print $1}')
BACKUP_JSON=$(printf '%s\n' "${BACKUP_PATHS[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')
for svc in "${RESTART_SERVICES[@]}"; do
    case "$svc" in hive-updater*|hive-command-agent*|hive-ota-recover*) echo "Cannot restart the running update controller: $svc"; exit 1;; esac
done
jq -n \
    --arg kind "$KIND" --arg board "$BOARD" --arg layout "$LAYOUT" \
    --arg health_hook_sha256 "$HEALTH_HOOK_SHA256" --argjson rollback_paths "$BACKUP_JSON" \
    --arg version "${VERSION}" \
    --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson files "${FILE_ENTRIES}" \
    --argjson restart_services "${RESTART_JSON}" \
    --argjson enable_services "${ENABLE_JSON}" \
    --argjson reload_daemon "${RELOAD_DAEMON}" \
    --arg pre_hook_sha256 "${PRE_HOOK_SHA256}" \
    --arg post_hook_sha256 "${POST_HOOK_SHA256}" \
    '{
        kind: $kind,
        board: $board,
        layout: $layout,
        version: $version,
        rollback_paths: $rollback_paths,
        health_grace_seconds: 5,
        health_timeout_seconds: 30,
        created_at: $created_at,
        files: $files,
        restart_services: $restart_services,
        enable_services: $enable_services,
        reload_daemon: $reload_daemon,
        hooks: {
            pre_install_sha256: $pre_hook_sha256,
            post_install_sha256: $post_hook_sha256,
            health_check_sha256: $health_hook_sha256
        }
    }' > "${BUNDLE_DIR}/manifest.json"

FILE_COUNT=$(echo "${FILE_ENTRIES}" | jq 'length')
echo "  版本: ${VERSION}"
echo "  文件数: ${FILE_COUNT}"
echo "  daemon-reload: ${RELOAD_DAEMON}"
echo "  重启服务: ${RESTART_SERVICES[*]+"${RESTART_SERVICES[*]}"}"
echo "  启用服务: ${ENABLE_SERVICES[*]+"${ENABLE_SERVICES[*]}"}"

# ── 签名 manifest ────────────────────────────────────────────────────────
if [ "${NO_SIGN}" = "false" ]; then
    echo ">>> 签名 manifest.json..."
    openssl pkeyutl -sign \
        -inkey "${SIGNING_KEY}" \
        -rawin -in "${BUNDLE_DIR}/manifest.json" \
        -out "${BUNDLE_DIR}/manifest.sig"
    echo "  签名完成"
else
    echo ">>> 跳过签名（--no-sign）"
    touch "${BUNDLE_DIR}/manifest.sig"
fi

# ── 打包 tar.gz ──────────────────────────────────────────────────────────
echo ">>> 打包 bundle..."
mkdir -p "${OUTPUT_DIR}"
BUNDLE_FILE="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
# Put the manifest first so the Registry can read metadata without scanning a
# multi-gigabyte rootfs. Devices still verify signature + every payload hash.
tar czf "${BUNDLE_FILE}" -C "${STAGING}" "${BUNDLE_NAME}/manifest.json" "${BUNDLE_NAME}/manifest.sig" "${BUNDLE_NAME}/files" "${BUNDLE_NAME}/hooks"

BUNDLE_SHA256=$(sha256sum "${BUNDLE_FILE}" | awk '{print $1}')
echo "${BUNDLE_SHA256}  ${BUNDLE_NAME}.tar.gz" > "${BUNDLE_FILE}.sha256"

BUNDLE_SIZE=$(du -h "${BUNDLE_FILE}" | awk '{print $1}')
echo ""
echo "OTA bundle 已生成:"
echo "  文件: ${BUNDLE_FILE}"
echo "  大小: ${BUNDLE_SIZE}"
echo "  SHA256: ${BUNDLE_SHA256}"
echo ""
echo "在管理后台 OTA 页面上传此更新包并分配节点，无需另建下载服务器。"
