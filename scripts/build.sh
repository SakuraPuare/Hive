#!/bin/bash
# RK3528 一键构建脚本 - 集成所有优化
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARMBIAN_DIR="${ROOT_DIR}/armbian-build/build"

echo "🚀 RK3528 Armbian 优化构建脚本"
echo "=============================="

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

# ccache 编译缓存配置
CCACHE_DIR="/tmp/armbian-ccache"
mkdir -p "$CCACHE_DIR"

export CCACHE_DIR="$CCACHE_DIR"
export CCACHE_MAXFILES=0
export CCACHE_COMPRESS=1
export CCACHE_COMPRESSLEVEL=3
export CCACHE_HARDLINK=1
export CCACHE_BASEDIR="$(pwd)"

# 检查并配置 ccache
if command -v ccache >/dev/null 2>&1; then
  echo "  ccache: 已启用"
  # 首次使用时配置
  ccache --set-config=cache_dir="$CCACHE_DIR" 2>/dev/null || true
  ccache --set-config=max_size=20G 2>/dev/null || true
  ccache --set-config=compression=true 2>/dev/null || true
else
  echo "  ccache: 未安装（建议：sudo apt install ccache）"
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

# 编译器优化参数（针对 RK3528 Cortex-A53）
export KERNEL_EXTRA_CFLAGS="
  -O2
  -march=armv8-a
  -mtune=cortex-a53
  -fomit-frame-pointer
"

# 系统性能优化（如果有权限）
if [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
  echo 40 > /proc/sys/vm/dirty_ratio 2>/dev/null || true
  echo 10 > /proc/sys/vm/dirty_background_ratio 2>/dev/null || true
  echo "  系统参数: 已优化"
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

# 复制优化内核配置（默认使用优化版本）
echo "设置优化内核配置..."
cp "${ROOT_DIR}/linux-rk35xx-vendor-optimized.config" \
    "${ARMBIAN_DIR}/config/kernel/linux-rk35xx-vendor-optimized.config"

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

MIRROR_ARGS=""
if [ -n "$REGIONAL_MIRROR" ]; then
  MIRROR_ARGS="REGIONAL_MIRROR=${REGIONAL_MIRROR}"
  echo "镜像源: REGIONAL_MIRROR=${REGIONAL_MIRROR}"
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

# 执行优化构建
time ./compile.sh build \
    BOARD="${BOARD:-nanopi-zero2}" \
    BRANCH="${BRANCH:-vendor}" \
    RELEASE="${RELEASE:-trixie}" \
    BUILD_MINIMAL=no \
    KERNEL_CONFIGURE="${KERNEL_CONFIGURE:-linux-rk35xx-vendor-optimized}" \
    COMPRESS_OUTPUTIMAGE=yes \
    ${MIRROR_ARGS} \
    "$@"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 构建完成统计
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "✅ 构建完成！"
echo "时间: $(date)"

# 显示 ccache 统计
if command -v ccache >/dev/null 2>&1; then
  echo ""
  echo "缓存统计:"
  ccache -s | grep -E "(cache hit|cache size)" 2>/dev/null || echo "ccache 统计不可用"
fi

# 显示输出文件
echo ""
echo "输出文件:"
ls -lh output/images/*.img* 2>/dev/null || echo "未找到输出镜像"

echo ""
echo "🎉 RK3528 镜像构建成功！"
echo "💡 提示：后续构建将因 ccache 缓存而更快"
