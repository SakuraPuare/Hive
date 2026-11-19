#!/bin/bash
# 下载预编译 arm64 二进制到 overlay 目录
# 版本号在此统一管理，从根目录运行：./scripts/download-binaries.sh
#
# 鲁棒性（homelab 网络不稳）：每个下载走 curl 多重重试（连接超时/重置/HTTP 错误
# 都重试），并把下载结果缓存到 $HOME/.cache/hive-binaries。该目录跨 CI run 持久
# （act_runner 的 HOME=/home/dev，不随每 run 重建的 workspace 哈希消失），缓存命中
# 即完全跳过网络、彻底规避抖动。强制刷新：删除该目录，或设 BIN_CACHE_REFRESH=1。
set -e


DEST="armbian-build/userpatches/overlay/usr/local/bin"
mkdir -p "$DEST"

# metacubexd 静态 Web 面板部署目录（由 nginx 托管）
WWW_METACUBEXD="armbian-build/userpatches/overlay/var/www/metacubexd"

# ── 持久缓存 + 带重试下载 ────────────────────────────────────────────────
BIN_CACHE="${BIN_CACHE_DIR:-$HOME/.cache/hive-binaries}"
mkdir -p "$BIN_CACHE"

# fetch_raw <url> <cache_key>：把原始归档下载到缓存，stdout 回显其路径
# （日志走 stderr，便于 f=$(fetch_raw ...) 捕获路径）。命中缓存(非空)即复用、不碰网络；
# 未命中则带重试下载，原子落盘（.part→正式）避免半成品污染缓存。
fetch_raw() {
  local url="$1" key="$2" cached="$BIN_CACHE/$2"
  if [ "${BIN_CACHE_REFRESH:-0}" != "1" ] && [ -s "$cached" ]; then
    echo "    [缓存命中] $key" >&2
    printf '%s' "$cached"; return 0
  fi
  echo "    [下载] $key" >&2
  curl -fL --retry 5 --retry-delay 3 --retry-all-errors --retry-connrefused \
       --connect-timeout 20 --max-time 900 \
       -o "${cached}.part" "$url"
  mv -f "${cached}.part" "$cached"
  printf '%s' "$cached"
}

# resolve_latest_tag <owner/repo> <cache_key>：解析 GitHub releases/latest 重定向得到实际
# tag（如 v0.70.0），stdout 回显。结果缓存到 <key>.tag，网络失败时回退缓存，保证离线可用
# （前提是曾解析过）。用于文件名内嵌版本号、无法走静态 latest 直链的仓库（frp / easytier）。
resolve_latest_tag() {
  local repo="$1" tagcache="$BIN_CACHE/$2.tag" url tag
  url=$(curl -fsI -o /dev/null -w '%{redirect_url}' \
        --retry 5 --retry-delay 3 --retry-all-errors --retry-connrefused \
        --connect-timeout 20 --max-time 120 \
        "https://github.com/${repo}/releases/latest" 2>/dev/null || true)
  tag="${url##*/tag/}"
  if [ -n "$tag" ] && [ "$tag" != "$url" ]; then
    printf '%s' "$tag" > "$tagcache"
    printf '%s' "$tag"; return 0
  fi
  if [ -s "$tagcache" ]; then
    echo "    [tag 解析失败，回退缓存] $2" >&2
    cat "$tagcache"; return 0
  fi
  echo "    [错误] 无法解析 $repo 的 latest tag，且无缓存" >&2
  return 1
}

# ── xray-core ──────────────────────────────────────────────────────────
# Resolve the tag so the cache key changes with the version. A plain
# "xray-latest.zip" cache key silently kept an old July 2026 Xray on the build
# host; that binary lacks `statsonlineiplist -all`, which the exit-side device
# limit needs (Xray >= 26.11.9).
XRAY_VER=$(resolve_latest_tag "XTLS/Xray-core" "xray")
echo ">>> xray ${XRAY_VER}..."
f=$(fetch_raw "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-arm64-v8a.zip" "xray-${XRAY_VER}.zip")
unzip -jo "$f" "xray" -d "${DEST}"
chmod +x "${DEST}/xray"
echo "    xray: OK (${XRAY_VER})"

# ── frpc ───────────────────────────────────────────────────────────────
# https://github.com/fatedier/frp/
# 文件名内嵌版本号（frp_0.70.0_linux_arm64），故先解析 latest 得到 tag
FRP_VER=$(resolve_latest_tag "fatedier/frp" "frp"); FRP_VER="${FRP_VER#v}"
echo ">>> frpc ${FRP_VER}..."
f=$(fetch_raw "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_arm64.tar.gz" "frp-${FRP_VER}.tar.gz")
tar xzf "$f" --strip-components=1 -C "${DEST}" "frp_${FRP_VER}_linux_arm64/frpc"
chmod +x "${DEST}/frpc"
echo "    frpc: OK"

# ── easytier-core ──────────────────────────────────────────────────────
# https://github.com/EasyTier/EasyTier
# 文件名内嵌 tag（easytier-linux-aarch64-v2.6.4），故先解析 latest 得到 tag
EASYTIER_VER=$(resolve_latest_tag "EasyTier/EasyTier" "easytier")
echo ">>> easytier ${EASYTIER_VER}..."
f=$(fetch_raw "https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VER}/easytier-linux-aarch64-${EASYTIER_VER}.zip" "easytier-${EASYTIER_VER}.zip")
unzip -jo "$f" "*/easytier-core" -d "${DEST}"
chmod +x "${DEST}/easytier-core"
echo "    easytier-core: OK"

# ── mihomo ─────────────────────────────────────────────────────────────
# https://github.com/MetaCubeX/mihomo
# Clash.Meta 内核，做透明代理网关；arm64 资产为 gzip 单文件
# 文件名内嵌版本（mihomo-linux-arm64-v1.19.28.gz），故先解析 latest 得到 tag
MIHOMO_VER=$(resolve_latest_tag "MetaCubeX/mihomo" "mihomo")
echo ">>> mihomo ${MIHOMO_VER}..."
f=$(fetch_raw "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VER}/mihomo-linux-arm64-${MIHOMO_VER}.gz" "mihomo-${MIHOMO_VER}.gz")
gunzip -c "$f" > "${DEST}/mihomo"
chmod +x "${DEST}/mihomo"
echo "    mihomo: OK"

# ── metacubexd ─────────────────────────────────────────────────────────
# https://github.com/MetaCubeX/metacubexd
# Clash API 的 Web 仪表盘（静态资源），解压到 var/www，由 nginx 托管
echo ">>> metacubexd latest..."
mkdir -p "${WWW_METACUBEXD}"
f=$(fetch_raw "https://github.com/MetaCubeX/metacubexd/releases/latest/download/compressed-dist.tgz" "metacubexd-latest.tgz")
tar xzf "$f" -C "${WWW_METACUBEXD}"
echo "    metacubexd: OK"

# ── xray-exporter ──────────────────────────────────────────────────────
# https://github.com/compassvpn/xray-exporter
# 读取 Xray StatsService(gRPC) 并暴露 per-user Prometheus 指标，供计费使用
echo ">>> xray-exporter latest..."
f=$(fetch_raw "https://github.com/compassvpn/xray-exporter/releases/latest/download/xray-exporter-linux-arm64" "xray-exporter-latest")
cp -f "$f" "${DEST}/xray-exporter"
chmod +x "${DEST}/xray-exporter"
echo "    xray-exporter: OK"

# ── 第三方 apt 仓库的 arm64 deb 预取（cloudflare-warp / cloudflared）──────
# 这两个源都没有国内镜像（实测 TUNA / USTC / NJU / ZJU / CERNET / PKU / SJTU / SUSTech /
# aliyun / tencent / huawei 全 404），而 chroot 里的 apt 每次构建都会重下一遍（第三方源不进
# Armbian 的 aptcache）。这里按各自的官方 Packages.gz 解析当前 arm64 版本，下载到持久缓存并
# 放进 overlay 的 /var/cache/hive-debs/；customize-image.sh 优先用 apt，apt 拉不到时回落到
# 这份本地 deb。预取失败只告警，构建仍按 apt 路径走。
WARP_RELEASE="${WARP_RELEASE:-trixie}"   # 必须与 build.sh 的 RELEASE 一致
CLOUDFLARED_SUITE="any"                  # pkg.cloudflare.com/cloudflared 没有 trixie 套件
WARP_DEBS="armbian-build/userpatches/overlay/var/cache/hive-debs"
mkdir -p "${WARP_DEBS}"

# <repo 地址去掉 scheme> <suite> <包名>
prefetch_repo_deb() {
    local base="$1" suite="$2" pkg="$3" arch="arm64"
    local gz meta fn sha ver f index_tmp
    echo ""
    echo ">>> ${pkg} deb (${base} ${suite}/${arch})..."
    # Packages.gz 是可变索引：每次刷新，只有下载失败时才复用旧索引。
    # deb 仍通过 fetch_raw 按版本化文件名缓存，不重复下载。
    gz="${BIN_CACHE}/${pkg}-${suite}-Packages.gz"
    index_tmp=$(mktemp "${gz}.XXXXXX") || return 1
    if curl -fL --retry 5 --retry-delay 3 --retry-all-errors --retry-connrefused \
            --connect-timeout 20 --max-time 900 -o "$index_tmp" \
            "https://${base}/dists/${suite}/main/binary-${arch}/Packages.gz" &&
        gzip -t "$index_tmp"; then
        mv -f "$index_tmp" "$gz"
    else
        rm -f "$index_tmp"
        if [ ! -s "$gz" ]; then
            echo "    [警告] 取 ${pkg} 包索引失败且无缓存，跳过预取（构建时走 apt）"
            return 0
        fi
        echo "    [警告] 取 ${pkg} 包索引失败，回退缓存"
    fi
    meta="$(python3 -c '
import gzip, sys
stanzas, cur = [], {}
with gzip.open(sys.argv[1], "rt", errors="replace") as fh:
    for line in fh:
        line = line.rstrip("\n")
        if not line:
            if cur:
                stanzas.append(cur)
                cur = {}
            continue
        key, _, val = line.partition(": ")
        cur[key] = val
if cur:
    stanzas.append(cur)

pkg, arch = sys.argv[2], sys.argv[3]

def vkey(v):
    return tuple(int(p) if p.isdigit() else 0 for p in v.split("."))

cand = [s for s in stanzas
        if s.get("Package") == pkg and s.get("Architecture") == arch]
if not cand:
    sys.exit(1)
best = max(cand, key=lambda s: vkey(s.get("Version", "0")))
print(best["Filename"])
print(best.get("SHA256", ""))
print(best["Version"])
' "$gz" "$pkg" "$arch" 2>/dev/null)" || meta=""

    if [ -z "$meta" ]; then
        echo "    [警告] 解析 ${pkg} 包索引失败，跳过预取（构建时走 apt）"
        return 0
    fi
    fn="$(printf '%s\n' "$meta" | sed -n 1p)"
    sha="$(printf '%s\n' "$meta" | sed -n 2p)"
    ver="$(printf '%s\n' "$meta" | sed -n 3p)"
    if ! f=$(fetch_raw "https://${base}/${fn}" "$(basename "$fn")"); then
        echo "    [警告] 下载 ${pkg} ${ver} 失败，跳过预取"
        return 0
    fi
    if [ -n "$sha" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sha" ]; then
        echo "    [警告] ${pkg} ${ver} sha256 不符，跳过预取"
        return 0
    fi
    rm -f "${WARP_DEBS}/${pkg}_"*.deb
    cp -f "$f" "${WARP_DEBS}/$(basename "$fn")"
    echo "    ${pkg}: OK (${ver}) -> ${WARP_DEBS}/"
}

prefetch_repo_deb "pkg.cloudflareclient.com" "${WARP_RELEASE}" "cloudflare-warp"
prefetch_repo_deb "pkg.cloudflare.com/cloudflared" "${CLOUDFLARED_SUITE}" "cloudflared"

echo ""
echo ">>> All binaries downloaded:"
ls -lh "${DEST}"
ls -lh "${WARP_DEBS}" 2>/dev/null || true
echo ""
echo ">>> metacubexd 面板已部署到: ${WWW_METACUBEXD}"
