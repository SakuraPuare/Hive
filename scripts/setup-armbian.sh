#!/bin/bash
# 一次性初始化：clone Armbian 构建框架到 armbian-build/build/
#
# 项目结构：
#   armbian-build/
#     build/       <- Armbian 框架，由本脚本 clone（不入库）
#     userpatches/ <- 我们的自定义文件（入库）
#
# scripts/build.sh 在构建前会将 userpatches/ rsync 到 build/userpatches/
#
# 使用方法：
#   ./scripts/setup-armbian.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="${ROOT_DIR}/armbian-build/build"
ARMBIAN_REPO="https://github.com/armbian/build"

echo ">>> Checking Armbian framework at ${TARGET_DIR}..."

if [ -f "${TARGET_DIR}/compile.sh" ]; then
    echo ">>> Armbian framework already present. Pulling latest..."
    git -C "${TARGET_DIR}" pull --ff-only
    echo ">>> Done."
    exit 0
fi

echo ">>> Cloning Armbian build framework (shallow clone)..."
git clone --depth=1 "${ARMBIAN_REPO}" "${TARGET_DIR}"

echo ""
echo ">>> Armbian framework ready."
echo ">>> Build with: ./scripts/build.sh <profile>"
echo ">>> Supported profiles: nanopi-zero2, nanopi-r3s"
