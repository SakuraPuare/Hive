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
#   ARMBIAN_BUILD_BRANCH=v25.11 ./scripts/setup-armbian.sh  # 可选：手动固定版本分支
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="${ROOT_DIR}/armbian-build/build"
ARMBIAN_REPO="https://github.com/armbian/build"

resolve_armbian_build_branch() {
    if [ -n "${ARMBIAN_BUILD_BRANCH:-}" ]; then
        printf '%s\n' "${ARMBIAN_BUILD_BRANCH}"
        return
    fi

    echo ">>> Resolving latest Armbian release branch..." >&2

    local latest_branch
    latest_branch="$(
        git ls-remote --heads "${ARMBIAN_REPO}" 'refs/heads/v*' \
            | awk -F/ '/\/v[0-9]+(\.[0-9]+)*$/ { print $NF }' \
            | sort -V \
            | tail -n 1
    )"

    if [ -z "${latest_branch}" ]; then
        echo "ERROR: Unable to resolve latest Armbian release branch from ${ARMBIAN_REPO}." >&2
        echo "Set ARMBIAN_BUILD_BRANCH=vXX.YY and rerun ./scripts/setup-armbian.sh." >&2
        exit 1
    fi

    printf '%s\n' "${latest_branch}"
}

echo ">>> Checking Armbian framework at ${TARGET_DIR}..."

ARMBIAN_BUILD_BRANCH_RESOLVED="$(resolve_armbian_build_branch)"
echo ">>> Using Armbian build branch: ${ARMBIAN_BUILD_BRANCH_RESOLVED}"

if [ -f "${TARGET_DIR}/compile.sh" ]; then
    echo ">>> Armbian framework already present. Updating branch..."
    git -C "${TARGET_DIR}" fetch --depth=1 origin "${ARMBIAN_BUILD_BRANCH_RESOLVED}"
    git -C "${TARGET_DIR}" checkout -B "${ARMBIAN_BUILD_BRANCH_RESOLVED}" FETCH_HEAD
    echo ">>> Done."
    exit 0
fi

if [ -e "${TARGET_DIR}" ]; then
    echo "ERROR: ${TARGET_DIR} already exists but compile.sh was not found." >&2
    echo "Remove it or fix the existing Armbian build checkout, then rerun this script." >&2
    exit 1
fi

echo ">>> Cloning Armbian build framework (shallow clone)..."
git clone --depth=1 --single-branch --branch "${ARMBIAN_BUILD_BRANCH_RESOLVED}" "${ARMBIAN_REPO}" "${TARGET_DIR}"

echo ""
echo ">>> Armbian framework ready."
echo ">>> Build with: ./scripts/build.sh <profile>"
echo ">>> Supported profiles: nanopi-zero2, nanopi-r3s"
