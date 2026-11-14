#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
出厂门禁：校验最终内核 config 里 boot.cmd 依赖的符号都真的编进去了。

背景：boot.cmd 传 softlockup_panic=1 oops=panic 与 irqchip.gicv3_pseudo_nmi=1，
这些开关只在对应 CONFIG_* 存在时才生效；hard lockup 的 panic 默认值来自
CONFIG_BOOTPARAM_HARDLOCKUP_PANIC（主线没有 hardlockup_panic= 这个 cmdline 参数），
而检测器本身还需要后端（arm64 只有 perf：HARDLOCKUP_DETECTOR_PERF）。
Kconfig 对依赖不满足的符号是**静默**回退（"# CONFIG_X is not set"），优化脚本里
写了 force 也不代表最终 .config 里还在：6.18.63 出厂 deb 里 HARDLOCKUP_DETECTOR=y，
但 PERF_EVENTS=n 使 HARDLOCKUP_DETECTOR_PERF=n —— 后端不存在，检测器空转。
所以只认最终内核 config，不相信优化脚本写了什么。

用法:
  verify-kernel-config.py <linux-image deb 或裸 config 文件> SYMBOL[=VALUE]...
示例:
  verify-kernel-config.py linux-image-current-rockchip64_*.deb \
      HARDLOCKUP_DETECTOR BOOTPARAM_HARDLOCKUP_PANIC ARM64_PSEUDO_NMI
退出码: 0=通过, 1=校验失败, 2=用法/解析错误。
"""
import io
import os
import sys
import tarfile

CONFIG_PREFIX = 'config-'


def parse_config(text):
    """返回 {符号: 值}；"# CONFIG_X is not set" 不产生条目。"""
    values = {}
    for line in text.splitlines():
        if not line.startswith('CONFIG_'):
            continue
        key, sep, value = line.partition('=')
        if sep:
            values[key[len('CONFIG_'):]] = value.strip()
    return values


def _deb_data_members(path):
    """按极小 ar 解析取 deb 的 data.tar.* 载荷（不依赖 dpkg-deb，构建机/测试机通用）。"""
    with open(path, 'rb') as handle:
        if handle.read(8) != b'!<arch>\n':
            raise ValueError('不是 ar 归档（deb 的 magic 不匹配）')
        while True:
            header = handle.read(60)
            if len(header) < 60:
                return
            name = header[:16].decode('ascii', 'replace').strip().rstrip('/')
            size = int(header[48:58].decode('ascii', 'replace').strip() or 0)
            payload = handle.read(size)
            if size % 2:
                handle.read(1)
            if name.startswith('data.tar'):
                yield name, payload


def load(source):
    """读裸 config，或从内核 deb 里取 /boot/config-*。返回 (成员名, 文本)。"""
    if os.path.isdir(source):
        raise ValueError(f'{source} 是目录，需要 deb 或 config 文件')
    if source.endswith('.deb'):
        for member, payload in _deb_data_members(source):
            with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
                for entry in archive.getmembers():
                    if entry.isfile() and os.path.basename(entry.name).startswith(CONFIG_PREFIX):
                        return entry.name, archive.extractfile(entry).read().decode('utf-8', 'replace')
        return None, None
    with open(source, encoding='utf-8', errors='replace') as handle:
        return source, handle.read()


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    source, requirements = sys.argv[1], sys.argv[2:]
    try:
        name, text = load(source)
    except (tarfile.TarError, OSError, ValueError) as error:
        print(f'❌ 内核 config 门禁：读取 {source} 失败：{error}', file=sys.stderr)
        return 2
    if text is None:
        print(f'❌ 内核 config 门禁：{source} 里没有 /boot/config-*；'
              '无法确认 boot.cmd 的 panic/NMI 开关是否生效', file=sys.stderr)
        return 2
    config = parse_config(text)
    missing = []
    for item in requirements:
        symbol, sep, wanted = item.partition('=')
        wanted = wanted if sep else 'y'
        actual = config.get(symbol)
        if actual != wanted:
            missing.append(f'{symbol}={wanted}（实际 {actual if actual else "未设置"}）')
    if missing:
        print(f'❌ 内核 config 门禁：{os.path.basename(name)} 缺少 {len(missing)} 个必需符号：',
              file=sys.stderr)
        for item in missing:
            print(f'   - CONFIG_{item}', file=sys.stderr)
        return 1
    print(f'✅ 内核 config 门禁通过：{os.path.basename(name)} 含全部 {len(requirements)} 个必需符号')
    return 0


if __name__ == '__main__':
    sys.exit(main())
