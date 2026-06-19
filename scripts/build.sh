#!/bin/bash
# Hive 镜像一键构建脚本 - 支持多板子
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARMBIAN_DIR="${ROOT_DIR}/armbian-build/build"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 板子 profile — 所有板子相关参数在此收敛
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROFILE="${1:-nanopi-zero2}"
shift 2>/dev/null || true  # 剩余参数透传给 compile.sh

case "${PROFILE}" in
  nanopi-zero2)
    BOARD="nanopi-zero2"
    # current(6.18 mainline)而非 vendor(6.1 BSP)：vendor 用 radxa u-boot
    # (next-dev-v2024.10)只保证在 Ubuntu Jammy 编译，本机 noble 容器编出空 DTB 的
    # itb（FIT /images/fdt data-size=0）导致 U-Boot 启动 "No valid device tree"。
    # current 配合 board csc 的 mainline u-boot hook（tag:v2026.07-rc4 +
    # nanopi-zero2-rk3528_defconfig）规避该问题，且 RK3528 mainline u-boot/内核已就绪。
    BRANCH="current"
    BASE_KERNEL_CONFIG="linux-rockchip64-current"
    # RK3528：4×Cortex-A53，ARMv8.0-A，无 crypto 扩展（不能照搬 R3S 的 +crc+crypto）
    EXTRA_CFLAGS="-O2 -march=armv8-a -mtune=cortex-a53 -fomit-frame-pointer"
    ;;
  nanopi-r3s)
    BOARD="nanopi-r3s"
    BRANCH="current"
    BASE_KERNEL_CONFIG="linux-rockchip64-current"
    EXTRA_CFLAGS="-O2 -march=armv8-a+crc+crypto -mtune=cortex-a55 -fomit-frame-pointer"
    ;;
  orangepi4-lts)
    BOARD="orangepi4-lts"
    BRANCH="current"
    BASE_KERNEL_CONFIG="linux-rockchip64-current"
    # RK3399 / big.LITTLE（2×Cortex-A72 + 4×Cortex-A53）：ARMv8.0-A + crc + crypto
    EXTRA_CFLAGS="-O2 -march=armv8-a+crc+crypto -mtune=cortex-a72.cortex-a53 -fomit-frame-pointer"
    ;;
  *)
    echo "ERROR: 未知 profile '${PROFILE}'"
    echo "支持的 profile: nanopi-zero2, nanopi-r3s, orangepi4-lts"
    exit 1
    ;;
esac

KERNEL_OPTIMIZE_SCRIPT="${ROOT_DIR}/configs/kernel/${PROFILE}.sh"

RELEASE="trixie"
export KERNEL_EXTRA_CFLAGS="${EXTRA_CFLAGS}"

# U-Boot / 内核版本探测会去 raw.githubusercontent.com 拉 Makefile 解析版本号，
# 该域名走 Fastly CDN，在大陆间歇性被墙/限速。Armbian 对探测结果做 memoize 缓存，
# 但默认 TTL 仅 1 小时，两次构建间隔超 1 小时缓存即失效、被迫重新联网，撞墙即失败。
# 拉长到 30 天：版本号本就由 BOOTBRANCH/KERNELBRANCH 的 tag 钉死，长期复用无副作用。
# 注意：必须作为命令行 KEY=value 传给 compile.sh —— Armbian Docker 只透传白名单环境
# 变量，build.sh 里 export 进不去容器；命令行参数则由 parse_cmdline_params 注入容器环境。
# GIT_CACHE_TTL_SECONDS="${GIT_CACHE_TTL_SECONDS:-2592000}"

echo "🚀 Hive Armbian 构建脚本"
echo "=============================="
echo "Profile: ${PROFILE}"
echo "  BOARD=${BOARD}  BRANCH=${BRANCH}  CONFIG=${BASE_KERNEL_CONFIG}(+hive 优化)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 系统环境检测与优化
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CPU_CORES=$(nproc)
TOTAL_RAM_GB=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))

echo "系统配置："
echo "  CPU: $CPU_CORES 核心"
echo "  内存: ${TOTAL_RAM_GB}GB"

# 智能并行编译配置
if [ $CPU_CORES -le 4 ]; then
  MAKE_JOBS=$((CPU_CORES + 1))
  PARALLEL_DOWNLOADS=6
elif [ $CPU_CORES -le 8 ]; then
  MAKE_JOBS=$((CPU_CORES * 2))
  PARALLEL_DOWNLOADS=12
else
  MAKE_JOBS=$((CPU_CORES + CPU_CORES / 2))
  PARALLEL_DOWNLOADS=16
fi

export CTHREADS="-j${MAKE_JOBS}"
export PARALLEL_DOWNLOADS_WORKERS=${PARALLEL_DOWNLOADS}

echo "编译优化："
echo "  编译线程: ${MAKE_JOBS}"
echo "  并行下载: ${PARALLEL_DOWNLOADS}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 文件系统 I/O 优化（仅本地构建，CI 跳过）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IS_LOCAL=true
[ "${GITHUB_ACTIONS:-}" = "true" ] && IS_LOCAL=false

CACHE_DIR="${ARMBIAN_DIR}/cache"

if $IS_LOCAL; then
  # ── btrfs CoW 优化 ──────────────────────────────────────────────────
  # 编译产生海量随机写，btrfs 的 Copy-on-Write 会产生额外开销
  # 对 ccache 和构建缓存目录关闭 CoW（仅 btrfs 生效，其他 FS 静默跳过）
  for dir in "${CACHE_DIR}/ccache" "${CACHE_DIR}/toolchain" "${CACHE_DIR}/sources"; do
    mkdir -p "$dir"
    chattr +C "$dir" 2>/dev/null || true
  done

  # ── Docker 存储驱动检测 ─────────────────────────────────────────────
  # btrfs 根分区上 Docker 用 overlay2 有 copy-up 开销，建议切换到 btrfs 驱动
  ROOT_FS=$(df --output=fstype / 2>/dev/null | tail -1)
  DOCKER_DRIVER=$(docker info --format '{{.Driver}}' 2>/dev/null || echo "unknown")
  if [ "$ROOT_FS" = "btrfs" ] && [ "$DOCKER_DRIVER" = "overlay2" ]; then
    echo "  ⚠ Docker 存储驱动: overlay2（根分区是 btrfs）"
    echo "    建议切换到 btrfs 驱动以避免 copy-up 开销："
    echo "    sudo mkdir -p /etc/docker"
    echo '    echo '"'"'{"storage-driver":"btrfs"}'"'"' | sudo tee /etc/docker/daemon.json'
    echo "    sudo systemctl restart docker"
  else
    echo "  Docker 存储驱动: ${DOCKER_DRIVER}"
  fi

  echo "  btrfs nodatacow: 已设置（ccache/toolchain/sources）"
fi

# 内存优化策略
if [ $TOTAL_RAM_GB -ge 16 ]; then
  export USE_TMPFS=yes
  export TMPDIR="/dev/shm"
  mkdir -p /dev/shm/armbian-tmp 2>/dev/null || true
  export CCACHE_TEMPDIR="/dev/shm/armbian-tmp"
  echo "  I/O加速: tmpfs (高速内存)"
elif [ $TOTAL_RAM_GB -ge 8 ]; then
  export USE_TMPFS=no
  export TMPDIR="/tmp"
  echo "  I/O加速: 混合模式"
else
  export USE_TMPFS=no
  export TMPDIR="/tmp"
  echo "  I/O模式: 标准磁盘"
fi

# 系统性能优化（如果有权限）
if [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
  # 提高脏页比例，减少编译期间的写回中断
  echo 40 | sudo tee /proc/sys/vm/dirty_ratio > /dev/null 2>&1 || true
  echo 10 | sudo tee /proc/sys/vm/dirty_background_ratio > /dev/null 2>&1 || true
  echo "  系统参数: 已优化（dirty_ratio=40）"
else
  echo "  系统参数: 默认配置"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 环境变量和依赖检查
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo ">>> 检查构建环境..."

# 加载环境变量
if [ -f "${ROOT_DIR}/.env" ]; then
    set -a
    source "${ROOT_DIR}/.env"
    set +a
else
    echo "ERROR: .env not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# 检查 Armbian 框架
if [ ! -f "${ARMBIAN_DIR}/compile.sh" ]; then
    echo "ERROR: Armbian framework not found at ${ARMBIAN_DIR}."
    echo "Run: ./scripts/setup-armbian.sh"
    exit 1
fi

# 检查关键二进制
OVERLAY_BIN="${ROOT_DIR}/armbian-build/userpatches/overlay/usr/local/bin"
for bin in xray cloudflared frpc easytier-core; do
    if [ ! -f "${OVERLAY_BIN}/${bin}" ]; then
        echo "ERROR: ${bin} not found. Run: ./scripts/download-binaries.sh"
        exit 1
    fi
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 构建准备
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo ">>> 准备构建环境..."

# 同步 userpatches
echo "同步 userpatches..."
rsync -a --delete "${ROOT_DIR}/armbian-build/userpatches/" "${ARMBIAN_DIR}/userpatches/"

# 生成优化内核配置（基线 config + 优化脚本 → 定制 config）
# Armbian 选 config 只认 LINUXCONFIG（默认 linux-${LINUXFAMILY}-${BRANCH}），
# 且 family 配置会无条件覆盖命令行传入的 LINUXCONFIG。框架官方覆盖入口是按
# 文件名查找 userpatches/config/kernel/<LINUXCONFIG>.config（优先于框架自带），
# 所以这里用「默认名」写入 userpatches 目录，让框架自动采用优化版。
# 参考 lib/functions/compilation/kernel-config.sh:14-19
KERNEL_CONFIG_SRC_DIR="${ARMBIAN_DIR}/config/kernel"
KERNEL_CONFIG_DST_DIR="${ARMBIAN_DIR}/userpatches/config/kernel"
BASE_CONFIG_PATH="${KERNEL_CONFIG_SRC_DIR}/${BASE_KERNEL_CONFIG}.config"
OPTIMIZED_CONFIG_PATH="${KERNEL_CONFIG_DST_DIR}/${BASE_KERNEL_CONFIG}.config"

if [ ! -f "${BASE_CONFIG_PATH}" ]; then
    echo "ERROR: 基线内核配置不存在: ${BASE_CONFIG_PATH}"
    exit 1
fi

mkdir -p "${KERNEL_CONFIG_DST_DIR}"
echo "生成优化内核配置: ${BASE_KERNEL_CONFIG} → userpatches/config/kernel/${BASE_KERNEL_CONFIG}.config"
"${KERNEL_OPTIMIZE_SCRIPT}" "${BASE_CONFIG_PATH}" "${OPTIMIZED_CONFIG_PATH}"

# 渲染配置模板
echo "渲染配置模板..."

# /etc/hive/config.env — 所有共享凭证烧入镜像
envsubst < "${ROOT_DIR}/configs/hive/config.env.tpl" \
    > "${ARMBIAN_DIR}/userpatches/overlay/etc/hive/config.env"

# /etc/frp/frpc.toml — 服务端信息在构建时渲染
envsubst < "${ROOT_DIR}/configs/frp/frpc.toml.tpl" \
    > "${ARMBIAN_DIR}/userpatches/overlay/etc/frp/frpc.toml"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 镜像源配置（本地构建自动用大陆镜像）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# REGIONAL_MIRROR 可在 .env 中覆盖；CI 环境默认不切换（runner 在境外）
if [ -z "${REGIONAL_MIRROR:-}" ]; then
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    REGIONAL_MIRROR=""   # CI：用官方源，runner 在美国
  else
    REGIONAL_MIRROR="china"  # 本地：自动切换大陆镜像
  fi
fi

# REGIONAL_MIRROR=china 会同时切换 apt、git、GHCR 源
# git 源（gitee/ghproxy）需要登录或不稳定，GHCR 镜像（nju）经常 404
# 只保留 apt/download 加速，其余强制走官方
UBOOT_MIRROR="${UBOOT_MIRROR:-github}"
GITHUB_MIRROR="${GITHUB_MIRROR:-github}"
GHCR_MIRROR="${GHCR_MIRROR:-none}"

MIRROR_ARGS=""
if [ -n "$REGIONAL_MIRROR" ]; then
  MIRROR_ARGS="REGIONAL_MIRROR=${REGIONAL_MIRROR}"
  echo "镜像源: apt=${REGIONAL_MIRROR}  git/ghcr=官方（强制）"
else
  echo "镜像源: 官方（CI 环境）"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 开始构建
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "🔥 开始优化构建..."
echo "时间: $(date)"
echo ""

cd "${ARMBIAN_DIR}"

# 执行构建（USE_CCACHE=yes 让 Armbian 在 Docker 内启用 ccache）
# 优化内核 config 已写入 userpatches/config/kernel/，框架按 LINUXCONFIG 文件名
# 自动采用，无需在此传参（KERNEL_CONFIGURE 是布尔开关，旧用法传文件名无效）
#
# KERNEL_CONFIGURE=no / BUILD_DESKTOP=no 必须显式传，否则交互菜单会弹出：
#   - 不传 KERNEL_CONFIGURE → 弹"是否查看内核配置"菜单（所有板）
#   - 不传 BUILD_DESKTOP    → 有 HDMI 的板（如香橙派 Pi 4 LTS HAS_VIDEO_OUTPUT=yes）
#     会弹"是否编译桌面版"菜单；headless 边缘节点一律 no
time ./compile.sh build \
    BOARD="${BOARD}" \
    BRANCH="${BRANCH}" \
    RELEASE="${RELEASE}" \
    BUILD_MINIMAL=no \
    BUILD_DESKTOP=no \
    KERNEL_CONFIGURE=no \
    USE_CCACHE=yes \
    COMPRESS_OUTPUTIMAGE=sha,xz \
    PATCHES_TO_GIT=yes \
    UBOOT_GIT_CACHE_TTL="${GIT_CACHE_TTL_SECONDS}" \
    KERNEL_GIT_CACHE_TTL="${GIT_CACHE_TTL_SECONDS}" \
    UBOOT_MIRROR="${UBOOT_MIRROR}" \
    GITHUB_MIRROR="${GITHUB_MIRROR}" \
    GHCR_MIRROR="${GHCR_MIRROR}" \
    ${MIRROR_ARGS} \
    "$@"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 构建完成统计
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "✅ 构建完成！"
echo "时间: $(date)"

# 显示输出文件
echo ""
echo "输出文件:"
ls -lh output/images/*.img* 2>/dev/null || echo "未找到输出镜像"

echo ""
echo "🎉 ${BOARD} 镜像构建成功！"
echo "💡 提示：后续构建将因 ccache 缓存而更快"
