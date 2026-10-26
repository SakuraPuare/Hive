#!/bin/bash
# 生成 OTA 签名用的 Ed25519 密钥对
# 私钥：用于构建机签名 OTA bundle
# 公钥：烧入镜像，设备端校验签名
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

KEYS_DIR="${ROOT_DIR}/keys"
PRIVATE_KEY="${KEYS_DIR}/ota-signing.pem"
PUBLIC_KEY="${ROOT_DIR}/armbian-build/userpatches/overlay/etc/hive/ota-pubkey.pem"

if [ -f "$PRIVATE_KEY" ]; then
    echo "OTA 签名私钥已存在: ${PRIVATE_KEY}"
    echo "如需重新生成，请先手动删除。"
    exit 0
fi

mkdir -p "$KEYS_DIR"
mkdir -p "$(dirname "$PUBLIC_KEY")"

echo ">>> 生成 Ed25519 密钥对..."
openssl genpkey -algorithm Ed25519 -out "$PRIVATE_KEY"
chmod 600 "$PRIVATE_KEY"

openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
chmod 644 "$PUBLIC_KEY"

echo ""
echo "密钥对已生成:"
echo "  私钥（构建机用，勿提交）: ${PRIVATE_KEY}"
echo "  公钥（烧入镜像）: ${PUBLIC_KEY}"
echo ""
echo "请确保 keys/ 目录已加入 .gitignore"

if ! grep -q "^keys/" "${ROOT_DIR}/.gitignore" 2>/dev/null; then
    echo "keys/" >> "${ROOT_DIR}/.gitignore"
    echo ">>> 已自动添加 keys/ 到 .gitignore"
fi
