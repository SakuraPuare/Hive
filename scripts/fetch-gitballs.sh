#!/bin/bash
# 预取 Armbian 构建需要的 git 裸树包（u-boot / kernel），走国内 GHCR 镜像。
#
# 为什么需要它（2026-11 实测，构建机 192.168.100.162）：
#   ghcr.io 直连 ≈150 KB/s → u-boot 包 411 MiB 要 45 min，kernel full 3.7 GiB 要 7 h；
#   ghcr.nju.edu.cn 同一个 blob 51 MB/s → 411 MiB 约 8 s。
# 但 Armbian 自带的 GHCR_MIRROR=nju 用不了：oras 会先向 <mirror>/token 换 token，nju 没有这个
# 端点（404），oras 判 not_found 后直接回落到 ghcr.io 慢速直连（见 lib/functions/general/oci-oras.sh
# 的 oci_read_ref_for / oci_pull_file）。所以这里绕开 oras：token 仍由 ghcr.io 匿名签发，manifest
# 和 blob 从镜像取，校验 sha256 后把 tar 直接放进 Armbian 的 cache/git-bundles/<u-boot|kernel>/。
# 框架在 lib/functions/general/git-oras-tree.sh 里只要发现该文件存在就完全跳过联网。
#
# 用法：
#   scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current
#   scripts/fetch-gitballs.sh --board nanopi-r28s --branch vendor --kernel-git full
#   scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current --dry-run   # 只列出要拉什么
#   scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current --rootfs-ref armbian/os/rootfs-arm64-trixie-cli:202611-93ad2762aa82-H6eccde-B5416c2
#
# 环境变量：
#   HIVE_GHCR_MIRROR   镜像主机名，默认 ghcr.nju.edu.cn；设为 direct 强制直连 ghcr.io
#   HIVE_GITBALL_CACHE 持久缓存目录，默认 $HOME/.cache/hive-gitballs（跨构建复用，框架提取完会删掉
#                      cache/git-bundles 下那份）
#
# 退出码：0 全部就绪（含“本来就不需要”）；1 有包没拿到（构建仍可继续，只是回落到慢速直连）。
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARMBIAN_DIR="${ROOT_DIR}/armbian-build/build"
CACHE_DIR="${ARMBIAN_DIR}/cache"

REGISTRY="ghcr.io"
# 镜像只在境内更快。判断依据与 build.sh 的 REGIONAL_MIRROR 相同：GITHUB_ACTIONS 在自托管
# act_runner 上也是 true，只有 GITHUB_SERVER_URL 能区分 GitHub 官方 runner。
if [ -n "${HIVE_GHCR_MIRROR:-}" ]; then
    MIRROR="$HIVE_GHCR_MIRROR"
elif [ "${GITHUB_SERVER_URL:-}" = "https://github.com" ]; then
    MIRROR=""
else
    MIRROR="ghcr.nju.edu.cn"
fi
[ "$MIRROR" = direct ] && MIRROR=""
STORE="${HIVE_GITBALL_CACHE:-$HOME/.cache/hive-gitballs}"

BOARD=""
BRANCH=""
KERNEL_GIT="shallow"
ROOTFS_REF=""
DRY_RUN=no

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --board) BOARD="${2:?--board 缺少值}"; shift 2 ;;
        --branch) BRANCH="${2:?--branch 缺少值}"; shift 2 ;;
        --kernel-git) KERNEL_GIT="${2:?--kernel-git 缺少值}"; shift 2 ;;
        --rootfs-ref) ROOTFS_REF="${2:?--rootfs-ref 缺少值}"; shift 2 ;;
        --dry-run) DRY_RUN=yes; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[ -n "$BOARD" ] && [ -n "$BRANCH" ] || { echo "必须同时给出 --board 和 --branch" >&2; exit 2; }
[ -f "${ARMBIAN_DIR}/compile.sh" ] || {
    echo "ERROR: 未找到 Armbian 框架 ${ARMBIAN_DIR}，先跑 scripts/setup-armbian.sh" >&2
    exit 1
}

warn() { echo "  ⚠ $*" >&2; }
info() { echo "  $*"; }

# ── ghcr 匿名 token / manifest / layer ────────────────────────────────────
# 镜像只是反向代理，所以 token 必须由 ghcr.io 签发；用镜像自己的 /token（不存在）会 404。
ghcr_token() { # <repo>: ghcr.io 匿名 pull token
    curl -fsS --retry 3 --retry-all-errors --retry-delay 2 \
        --connect-timeout 15 --max-time 60 \
        "https://${REGISTRY}/token?scope=repository:$1:pull&service=${REGISTRY}" 2>/dev/null |
        sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

# 打印 "<digest> <size>"；manifest 必须恰好一层（这些包都是单 tar 层）
manifest_layer() { # <host> <repo> <token> <tag>
    local json
    json="$(curl -fsS --retry 3 --retry-all-errors --retry-delay 2 \
        --connect-timeout 15 --max-time 60 \
        -H "Authorization: Bearer $3" \
        -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
        "https://$1/v2/$2/manifests/$4" 2>/dev/null)" || return 1
    printf '%s' "$json" | python3 -c '
import json, sys
m = json.load(sys.stdin)
layers = m.get("layers") or []
if len(layers) != 1:
    sys.exit("期望单层 artifact，实际 %d 层" % len(layers))
layer = layers[0]
print(layer["digest"], layer["size"])
'
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# 持久缓存里已经有且校验通过就不必联网
cached_copy() { # <ball_fn> <digest>
    local master="${STORE}/$1"
    [ -s "$master" ] || return 1
    [ -f "${master}.sha256" ] || return 1
    [ "$(cat "${master}.sha256")" = "$2" ] || return 1
    printf '%s' "$master"
}

# cache/git-bundles 常被上一次 root 构建创建成 root:root，安装/清理要提权。
# 非交互环境（CI、管道）只用免密 sudo；交互终端才让它问密码。
have_sudo() {
    sudo -n true 2>/dev/null && return 0
    [ -t 0 ] && sudo true 2>/dev/null && return 0
    return 1
}

install_ball() { # <src> <dest>
    local src="$1" dest="$2" dir
    dir="$(dirname "$dest")"
    if mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
        cp -f "$src" "${dest}.part" && mv -f "${dest}.part" "$dest" || return 1
    elif have_sudo; then
        sudo mkdir -p "$dir" && sudo cp -f "$src" "${dest}.part" &&
            sudo mv -f "${dest}.part" "$dest" || return 1
    else
        warn "无权写 ${dir}（需要 sudo），跳过安装"
        return 1
    fi
    printf '%s' "$dest"
}

clean_stale_parts() { # <dir>
    local dir="$1"
    [ -d "$dir" ] || return 0
    if [ -w "$dir" ]; then
        rm -rf "${dir:?}/"*.oras.pull.tmp
    elif have_sudo; then
        sudo rm -rf "${dir:?}/"*.oras.pull.tmp
    fi
}

# ── 单个包的预取 ──────────────────────────────────────────────────────────
ensure_ball() { # <oras_repo> <ball_fn> <dest_dir_rel_to_cache> [tag]
    local repo="$1" fn="$2" sub="$3" tag="${4:-latest}"
    local dest="${CACHE_DIR}/${sub}/${fn}"
    local digest="" size="" token="" meta="" host="" master="" part="" dl_started=0

    if [ -f "$dest" ]; then
        info "${fn}: 已在 cache/${sub}/，跳过"
        return 0
    fi
    clean_stale_parts "$(dirname "$dest")"

    token="$(ghcr_token "$repo")" || true
    if [ -z "$token" ]; then
        warn "${repo}: 取 ghcr.io 匿名 token 失败（网络或限流）"
        return 1
    fi

    for host in ${MIRROR:+$MIRROR} "$REGISTRY"; do
        meta="$(manifest_layer "$host" "$repo" "$token" "$tag")" || meta=""
        if [ -n "$meta" ]; then
            digest="${meta%% *}"; size="${meta##* }"
            break
        fi
        [ "$host" != "$REGISTRY" ] && warn "${host} 没有 ${repo} 的 manifest，改用 ghcr.io"
    done
    if [ -z "$digest" ]; then
        warn "${repo}: 取不到 manifest"
        return 1
    fi
    info "${fn}: ${size} 字节，sha256=${digest#sha256:}"

    if [ "$DRY_RUN" = yes ]; then
        return 0
    fi

    # 1) 持久缓存命中（跨构建、跨版本复用，省掉整次下载）
    master="$(cached_copy "$fn" "$digest")" || master=""
    if [ -n "$master" ]; then
        info "${fn}: 持久缓存命中 ${master}"
    else
        mkdir -p "$STORE"
        part="${STORE}/${fn}.part"
        rm -f "$part"

        # 2) 先镜像、后直连；镜像只代理字节，token 仍是 ghcr.io 的
        for host in ${MIRROR:+$MIRROR} "$REGISTRY"; do
            info "${fn}: 从 ${host} 下载"
            dl_started=$SECONDS
            if curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
                    --connect-timeout 20 --max-time 3600 \
                    -H "Authorization: Bearer $token" \
                    -o "$part" \
                    "https://${host}/v2/${repo}/blobs/${digest}"; then
                if [ "$(sha256_of "$part")" = "${digest#sha256:}" ]; then
                    mv -f "$part" "${STORE}/${fn}"
                    sha256_of "${STORE}/${fn}" > "${STORE}/${fn}.sha256"
                    master="${STORE}/${fn}"
                    info "${fn}: 下载完成（$((SECONDS - dl_started))s，sha256 校验通过）"
                    break
                fi
                warn "${host} 的 blob sha256 不符，丢弃"
                rm -f "$part"
            else
                warn "${host} 下载失败"
                rm -f "$part"
            fi
        done
        if [ -z "$master" ]; then
            warn "${fn}: 镜像和直连都没拿到"
            return 1
        fi
    fi

    install_ball "$master" "$dest" >/dev/null || return 1
    info "${fn}: 已放入 ${dest}"
    return 0
}

# ── u-boot 裸树包 ─────────────────────────────────────────────────────────
# 标记名来自 lib/functions/compilation/uboot-git-oras.sh（marker_rel）；它刻意与内核的不同。
prefetch_uboot() {
    if [ -f "${CACHE_DIR}/git-bare/u-boot/.git/armbian-bare-tree-done-oras" ]; then
        info "u-boot 裸树已就绪，跳过"
        return 0
    fi
    ensure_ball armbian/shallow/u-boot-git u-boot-complete.git.tar git-bundles/u-boot
}

# ── 内核裸树包 ────────────────────────────────────────────────────────────
# 版本号与模式都由框架决定：版本取 configdump 的 KERNEL_MAJOR_MINOR，模式取 KERNEL_GIT。
# 已有的裸树优先（与 kernel_git_oras.sh 的判定顺序一致）：full 树存在时框架不会用 shallow 包。
prefetch_kernel() {
    local ver="$1" full_tree="${CACHE_DIR}/git-bare/kernel"
    local marker=".git/armbian-bare-tree-done"
    if [ -f "${full_tree}/${marker}" ]; then
        info "内核 full 裸树已就绪，跳过"
        return 0
    fi
    if [ -f "${CACHE_DIR}/git-bare/shallow-kernel-${ver}/${marker}" ]; then
        info "内核 ${ver} shallow 裸树已就绪，跳过"
        return 0
    fi
    case "$KERNEL_GIT" in
        full) ensure_ball armbian/shallow/kernel-git linux-complete.git.tar git-bundles/kernel ;;
        *) ensure_ball "armbian/shallow/kernel-git-shallow-${ver}" "linux-shallow-${ver}.git.tar" git-bundles/kernel ;;
    esac
}

# ── rootfs 缓存包 ─────────────────────────────────────────────────────────
# 26.11 起 rootfs 缓存同样是 ghcr.io 上的 OCI 工件（rootfs-arm64-trixie-cli:<yyyymm>-<hash>），
# 由 oras 拉取，于是撞上和裸树包一样的 token/带宽问题；拉取失败直接 ERROR 43 结束整个构建，
# 而 ARTIFACT_IGNORE_CACHE=yes 会把内核一起重编，代价太大。
# 框架的 is_artifact_available_in_local_cache 只看文件是否存在，所以提前把 tar.zst 放进
# cache/rootfs/ 就能完全跳过 OCI 拉取。
#
# tag 不硬编码：它由框架的 rootfs_cache_id（配置哈希）+ yyyymm 决定，框架版本一变就跟着变
# （26.08 → 26.11 时 B 哈希从 Bc08fea 变成 B5416c2）。默认从框架自己打印的日志里取，
# 也可以用 --rootfs-ref 显式指定。
rootfs_ref_from_log() {
    local f ref tag zcmd
    # Armbian 把日志写在框架机的 output/logs 下（仓库根 output/ 里没有构建日志）。
    # 两种行都能给出 tag：oras 的 "ORAS manifest from ghcr.io/armbian/os/rootfs-…:<tag>"，
    # 以及 re-versioning 行的 "rootfs-arm64-trixie-cli(tar.zst)::<tag>"（缓存命中时只有后者）。
    for f in $(ls -t \
            "${ARMBIAN_DIR}"/output/logs/log-*.log \
            "${ARMBIAN_DIR}"/output/logs/log-*.log.ans \
            "${ROOT_DIR}"/output/logs/log-*.log 2>/dev/null | head -30); do
        ref="$(grep -ho "armbian/os/rootfs-[A-Za-z0-9._-]*:[A-Za-z0-9._-]*" "$f" 2>/dev/null | tail -n 1)"
        [ -n "$ref" ] && { printf '%s' "$ref"; return 0; }
        tag="$(grep -ho "rootfs-[A-Za-z0-9._-]*(tar\.zst)::[A-Za-z0-9._-]*" "$f" 2>/dev/null | tail -n 1)"
        [ -n "$tag" ] && { printf 'armbian/os/%s:%s' "${tag%%(*}" "${tag##*::}"; return 0; }
    done

    # 框架会把旧日志轮转成 .log.zst 并压进 archive/，新构建启动时还会清理顶层日志，
    # 所以活跃日志里常常什么都没有。扫最近的几份归档即可（每份解压后几 MB）。
    zcmd=""
    if command -v zstdcat >/dev/null 2>&1; then
        zcmd="zstdcat"
    elif command -v zstd >/dev/null 2>&1; then
        zcmd="zstd -dc"
    fi
    [ -n "$zcmd" ] || return 1
    for f in $(ls -t "${ARMBIAN_DIR}"/output/logs/archive/log-*.log.zst 2>/dev/null | head -8); do
        ref="$($zcmd "$f" 2>/dev/null | grep -o "armbian/os/rootfs-[A-Za-z0-9._-]*:[A-Za-z0-9._-]*" | tail -n 1)"
        [ -n "$ref" ] && { printf '%s' "$ref"; return 0; }
        tag="$($zcmd "$f" 2>/dev/null | grep -o "rootfs-[A-Za-z0-9._-]*(tar\.zst)::[A-Za-z0-9._-]*" | tail -n 1)"
        [ -n "$tag" ] && { printf 'armbian/os/%s:%s' "${tag%%(*}" "${tag##*::}"; return 0; }
    done
    return 1
}

prefetch_rootfs() {
    local ref="$1" repo tag fn
    if [ -z "$ref" ]; then
        ref="$(rootfs_ref_from_log)" || {
            info "rootfs 缓存：没有 --rootfs-ref，历史日志里也没有框架打印的 tag，跳过"
            return 0
        }
    fi
    repo="${ref%%:*}"; tag="${ref##*:}"
    fn="$(basename "$repo")_${tag}.tar.zst"
    info "rootfs 缓存包 ${repo##*/}:${tag}"
    ensure_ball "$repo" "$fn" rootfs "$tag"
}

# configdump 是唯一权威的版本来源（rockchip64 current=6.18、rk35xx vendor=6.1，硬编码会漂）
kernel_major_minor() {
    ( cd "$ARMBIAN_DIR" && ./compile.sh configdump "BOARD=${BOARD}" "BRANCH=${BRANCH}" 2>/dev/null ) |
        sed -n 's/.*"KERNEL_MAJOR_MINOR":"\([^"]*\)".*/\1/p'
}

echo ">>> git 裸树包预取（board=${BOARD} branch=${BRANCH} kernel_git=${KERNEL_GIT} mirror=${MIRROR:-direct}）"
rc=0
prefetch_uboot || rc=1

KERNEL_VER="$(kernel_major_minor)"
if [ -z "$KERNEL_VER" ]; then
    warn "configdump 没给出 KERNEL_MAJOR_MINOR，跳过内核包"
    rc=1
else
    prefetch_kernel "$KERNEL_VER" || rc=1
fi
prefetch_rootfs "$ROOTFS_REF" || rc=1

if [ "$rc" -eq 0 ]; then
    echo ">>> git 裸树包已就绪（后续构建不再联网拉这些包）"
else
    echo ">>> 部分包未预取；Armbian 会自己从 ghcr.io 拉，速度取决于到 ghcr.io 的带宽"
fi
exit "$rc"
