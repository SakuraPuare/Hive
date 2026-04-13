#!/bin/bash
# 编译 QEMU 可运行的 ARM64 测试镜像
# 使用与实际板子完全相同的 customize-image.sh 和 overlay
# BRANCH=current (uefi-arm64 不支持 vendor branch)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARMBIAN_DIR="${ROOT_DIR}/armbian-build/build"

echo ">>> Building QEMU-compatible uefi-arm64 image..."
echo ">>> Uses same customize-image.sh + overlay as board builds"
echo ""

# uefi-arm64 overlay 里的 aarch64 二进制仍然兼容
if [ ! -f "${ROOT_DIR}/armbian-build/userpatches/overlay/usr/local/bin/xray" ]; then
    echo "ERROR: Missing binaries in overlay. Run ./scripts/download-binaries.sh first."
    exit 1
fi

cd "${ARMBIAN_DIR}"

time ./compile.sh build \
    BOARD="uefi-arm64" \
    BRANCH="current" \
    RELEASE="${RELEASE:-trixie}" \
    BUILD_MINIMAL=no \
    KERNEL_CONFIGURE=no \
    BUILD_DESKTOP=no \
    COMPRESS_OUTPUTIMAGE=no \
    "$@"

echo ""
echo ">>> QEMU image ready:"
ls -lh output/images/Armbian*uefi-arm64*.img 2>/dev/null || ls -lh output/images/*.img 2>/dev/null
echo ""
echo ">>> Run with: ./scripts/run-qemu.sh"
