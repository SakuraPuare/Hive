#!/bin/bash
# /usr/local/bin/hive-regen-hostkeys.sh
# 首启早期重建 SSH host key —— 独立于 provision-node，不依赖网络，排在 ssh.service 之前。
#
# 背景：customize-image.sh 第 8 节为批量部署去唯一标识，删除 /etc/ssh/ssh_host_*。
#   若首启时 ssh.service 先于 host key 重建启动，会因 "no hostkeys available" 反复失败
#   并进入永久 failed。本脚本由 hive-regen-hostkeys.service 在 Before=ssh.service、
#   无网络依赖的早期阶段执行，确保 sshd 第一次启动就有 key（离线节点也能 SSH）。
#
# ed25519 采用基于节点 MAC 的确定性密钥（重刷镜像不改 fingerprint），与 provision-node
#   原逻辑一致；rsa/ecdsa 随机生成（仅兼容旧客户端，fingerprint 不关键）。
set -e

# 已有 ed25519 host key 则无需重建（service 侧 ConditionPathExists 也会拦，这里再兜一层）
if [ -s /etc/ssh/ssh_host_ed25519_key ]; then
    echo ">>> hive-regen-hostkeys: ed25519 host key already present, skip"
    exit 0
fi

# 取第一块非 lo 网卡的 MAC（不需要网络 up，接口存在即可读）
IFACE=$(ip -o link show | awk '$2 !~ /^lo:/ {gsub(/:$/,"",$2); print $2; exit}')
if [ -z "$IFACE" ] || [ ! -r "/sys/class/net/${IFACE}/address" ]; then
    echo ">>> hive-regen-hostkeys: no usable NIC for MAC, falling back to ssh-keygen -A"
    ssh-keygen -A
    exit 0
fi
MAC=$(tr -d ':' < "/sys/class/net/${IFACE}/address")

echo ">>> hive-regen-hostkeys: generating deterministic SSH host keys from MAC ${MAC} (${IFACE})..."
rm -f /etc/ssh/ssh_host_*

# SHA-256(domain:MAC) → 32 字节 Ed25519 seed
SEED_HEX=$(printf 'hive-ssh-ed25519:%s' "${MAC}" | sha256sum | awk '{print $1}')

# 构造 PKCS8 DER（固定前缀 + 32 字节 seed），转成 PEM
# PKCS8 Ed25519 DER 前缀：302e020100300506032b657004220420
PKCS8_B64=$(python3 -c "
import base64
der = bytes.fromhex('302e020100300506032b657004220420' + '${SEED_HEX}')
b64 = base64.b64encode(der).decode()
print('\n'.join(b64[i:i+64] for i in range(0, len(b64), 64)))
")

(umask 077; printf -- '-----BEGIN PRIVATE KEY-----\n%s\n-----END PRIVATE KEY-----\n' \
    "${PKCS8_B64}" > /etc/ssh/ssh_host_ed25519_key)

# 转成 OpenSSH 私钥格式（sshd 标准格式）
ssh-keygen -P "" -N "" -p -f /etc/ssh/ssh_host_ed25519_key

# 导出公钥
ssh-keygen -y -f /etc/ssh/ssh_host_ed25519_key > /etc/ssh/ssh_host_ed25519_key.pub
chmod 644 /etc/ssh/ssh_host_ed25519_key.pub

# RSA / ECDSA 随机生成（兼容旧客户端，fingerprint 不关键）
ssh-keygen -q -t rsa -b 3072 -N "" -f /etc/ssh/ssh_host_rsa_key
ssh-keygen -q -t ecdsa -N "" -f /etc/ssh/ssh_host_ecdsa_key

echo ">>> hive-regen-hostkeys: done. Ed25519 fingerprint bound to MAC ${MAC}"
