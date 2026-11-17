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

# ── cloudflared ────────────────────────────────────────────────────────
# 缓存键必须带版本。原来用固定的 "cloudflared-latest" 当键，fetch_raw 命中缓存就再也不联网：
# 实测 2026-11 的构建机上一直是 7 月 4 日下到的 2026.6.1（36.9 MB），而上游当时已 2026.11.0。
# 和 xray 那次是同一类问题（"version the cached Xray binary"），xray/mihomo/frp/easytier 都已
# 按 tag 命名缓存键，这里补上。tag 形如 2026.11.0（无 v 前缀）。
CLOUDFLARED_VER=$(resolve_latest_tag "cloudflare/cloudflared" "cloudflared")
echo ">>> cloudflared ${CLOUDFLARED_VER}..."
f=$(fetch_raw "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VER}/cloudflared-linux-arm64" "cloudflared-${CLOUDFLARED_VER}")
cp -f "$f" "${DEST}/cloudflared"
chmod +x "${DEST}/cloudflared"
echo "    cloudflared: OK (${CLOUDFLARED_VER})"

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

# ── cloudflare-warp deb ────────────────────────────────────────────────
# pkg.cloudflareclient.com 没有任何国内镜像（实测 TUNA / USTC / NJU / ZJU / CERNET /
# PKU / SJTU / SUSTech / aliyun / tencent / huawei 全 404）。deb 77 MB，实测约 478 KB/s，
# 而 chroot 里的 apt 每次构建都重下一遍（第三方源不进 Armbian 的 aptcache）。
# 这里按官方 Packages.gz 解析出当前 arm64 版本，下载到持久缓存并放进 overlay 的
# /var/cache/hive-debs/；customize-image.sh 命中本地 deb 就不再走官方源。
# 失败只告警：预取不到时构建仍按老路径从官方源装。
WARP_RELEASE="${WARP_RELEASE:-trixie}"   # 必须与 build.sh 的 RELEASE 一致
WARP_DEBS="armbian-build/userpatches/overlay/var/cache/hive-debs"
echo ""
echo ">>> cloudflare-warp deb (${WARP_RELEASE}/arm64)..."
if ! pkgs_gz=$(fetch_raw "https://pkg.cloudflareclient.com/dists/${WARP_RELEASE}/main/binary-arm64/Packages.gz" \
        "cloudflare-warp-${WARP_RELEASE}-Packages.gz"); then
    echo "    [警告] 取 cloudflare-warp 包索引失败，跳过预取（构建时走官方源）"
else
    warp_meta="$(python3 -c '
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

def vkey(v):
    return tuple(int(p) if p.isdigit() else 0 for p in v.split("."))

cand = [s for s in stanzas
        if s.get("Package") == "cloudflare-warp" and s.get("Architecture") == "arm64"]
if not cand:
    sys.exit(1)
best = max(cand, key=lambda s: vkey(s.get("Version", "0")))
print(best["Filename"])
print(best.get("SHA256", ""))
print(best["Version"])
' "$pkgs_gz" 2>/dev/null)" || warp_meta=""

    if [ -z "$warp_meta" ]; then
        echo "    [警告] 解析 cloudflare-warp 包索引失败，跳过预取（构建时走官方源）"
    else
        warp_fn="$(printf '%s\n' "$warp_meta" | sed -n 1p)"
        warp_sha="$(printf '%s\n' "$warp_meta" | sed -n 2p)"
        warp_ver="$(printf '%s\n' "$warp_meta" | sed -n 3p)"
        if f=$(fetch_raw "https://pkg.cloudflareclient.com/${warp_fn}" "$(basename "$warp_fn")"); then
            if [ -n "$warp_sha" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$warp_sha" ]; then
                echo "    [警告] cloudflare-warp ${warp_ver} sha256 不符，跳过预取"
            else
                mkdir -p "$WARP_DEBS"
                rm -f "$WARP_DEBS"/cloudflare-warp_*.deb
                cp -f "$f" "$WARP_DEBS/$(basename "$warp_fn")"
                echo "    cloudflare-warp: OK (${warp_ver}) -> ${WARP_DEBS}/"
            fi
        else
            echo "    [警告] 下载 cloudflare-warp ${warp_ver} 失败，跳过预取"
        fi
    fi
fi

echo ""
echo ">>> All binaries downloaded:"
ls -lh "${DEST}"
ls -lh "${WARP_DEBS}" 2>/dev/null || true
echo ""
echo ">>> metacubexd 面板已部署到: ${WWW_METACUBEXD}"
