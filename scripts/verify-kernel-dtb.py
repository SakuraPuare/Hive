#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
出厂门禁：校验内核 deb（或裸 DTB）里目标板的设备树含必需节点。

背景：RK3528 的看门狗节点不在主线 6.18（v7.0 才合入 rk3528.dtsi），Hive 用
userpatches/kernel/archive/rockchip64-6.18/ 下的补丁回移。补丁目录名写错、
补丁被内核升级挤掉，或 Armbian 静默跳过时，镜像里就没有 /dev/watchdog0：
systemd 的 RuntimeWatchdogSec 空转，内核卡死不会重启，boot.cmd 的试启动计数
永远不会递减，A/B 回切失效。这条门禁把"补丁没生效"变成构建失败。

用法:
  verify-kernel-dtb.py <linux-dtb deb 或裸 .dtb> <DTB 路径后缀> <节点名> <compatible 子串>
示例:
  verify-kernel-dtb.py linux-dtb-current-rockchip64_*.deb \
      rockchip/rk3528-nanopi-zero2.dtb watchdog@ffac0000 snps,dw-wdt
退出码: 0=通过, 1=校验失败, 2=用法/解析错误。
"""
import io
import struct
import subprocess
import sys
import tarfile

FDT_MAGIC = 0xD00DFEED
FDT_BEGIN_NODE, FDT_END_NODE, FDT_PROP, FDT_NOP, FDT_END = 1, 2, 3, 4, 9


def _u32(blob, offset):
    return struct.unpack_from('>I', blob, offset)[0]


def parse_nodes(blob):
    """返回 [(路径, {属性名: 值})]。只解析节点名与属性，忽略属性语义。"""
    magic, _total, off_struct, off_strings = struct.unpack_from('>4I', blob, 0)
    if magic != FDT_MAGIC:
        raise ValueError('不是 FDT（magic 不匹配）')
    nodes, stack, pos = [], [], off_struct
    while True:
        token = _u32(blob, pos)
        pos += 4
        if token == FDT_BEGIN_NODE:
            end = blob.index(b'\0', pos)
            stack.append(blob[pos:end].decode('utf-8', 'replace'))
            pos = (end + 4) & ~3
            nodes.append(('/'.join(stack), {}))
        elif token == FDT_END_NODE:
            stack.pop()
        elif token == FDT_PROP:
            length, nameoff = _u32(blob, pos), _u32(blob, pos + 4)
            pos += 8
            value = blob[pos:pos + length]
            pos = (pos + length + 3) & ~3
            name_end = blob.index(b'\0', off_strings + nameoff)
            nodes[-1][1][blob[off_strings + nameoff:name_end].decode()] = value
        elif token == FDT_NOP:
            continue
        elif token == FDT_END:
            break
        else:
            raise ValueError(f'未知 FDT token {token}')
    return nodes


def load(source, suffix):
    """读裸 DTB，或从 deb 里按路径后缀取出成员。返回 (成员名, 字节)。"""
    if source.endswith('.dtb'):
        with open(source, 'rb') as handle:
            return source, handle.read()
    listing = subprocess.run(['dpkg-deb', '--fsys-tarfile', source],
                             check=True, capture_output=True)
    with tarfile.open(fileobj=io.BytesIO(listing.stdout)) as archive:
        for member in archive.getmembers():
            if member.isfile() and member.name.endswith(suffix):
                return member.name, archive.extractfile(member).read()
    return None, None


def main():
    if len(sys.argv) != 5:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    source, suffix, node_name, compatible = sys.argv[1:5]
    try:
        name, blob = load(source, suffix)
    except (subprocess.CalledProcessError, tarfile.TarError, OSError) as error:
        print(f'❌ DT 门禁：读取 {source} 失败：{error}', file=sys.stderr)
        return 2
    if blob is None:
        print(f'❌ DT 门禁：{source} 里找不到 {suffix}', file=sys.stderr)
        return 1
    try:
        nodes = parse_nodes(blob)
    except ValueError as error:
        print(f'❌ DT 门禁：{name} 不是有效 DTB（{error}）', file=sys.stderr)
        return 1
    for path, props in nodes:
        if path.rsplit('/', 1)[-1] != node_name:
            continue
        if compatible.encode() not in props.get('compatible', b''):
            continue
        status = props.get('status', b'').decode('utf-8', 'replace').rstrip('\x00')
        if status == 'disabled':
            continue
        print(f'✅ DT 门禁通过：{name} 的 {node_name} 可用（compatible 含 {compatible}）')
        return 0
    print(f'❌ DT 门禁：{name} 缺少可用的 {node_name}（compatible 需含 {compatible}）；'
          '内核设备树补丁没有生效', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
