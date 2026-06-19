#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
出厂门禁：校验 u-boot.itb 的 FIT 镜像里关键 image 的数据非空。

背景：radxa BSP u-boot 在非 Jammy 宿主(如 noble)上会编出 FIT /images/fdt
data-size=0 的空设备树 itb，mkimage 不报错照样打包，烧录后启动即
"No valid device tree binary found ... Please RESET"。本脚本解析 FIT 结构，
断言 fdt/firmware/loadables 等带 data 的子镜像 data-size 均 > 0，坏件红灯退出。

用法:
  verify-uboot.py <u-boot.itb 或 包含它的 .deb>
退出码: 0=通过, 1=校验失败(坏件), 2=用法/解析错误。
"""
import sys
import struct
import subprocess
import tempfile
import os

FDT_MAGIC = 0xD00DFEED
FDT_BEGIN_NODE, FDT_END_NODE, FDT_PROP, FDT_NOP, FDT_END = 1, 2, 3, 4, 9


def parse_fit_images(data: bytes):
    """解析 FIT(本身是 FDT)，返回 [(image路径, {prop: (len, value)})]。"""
    if struct.unpack(">I", data[:4])[0] != FDT_MAGIC:
        raise ValueError(f"不是合法 FDT/FIT (magic={data[:4].hex()})")
    off_struct, off_strings = struct.unpack(">II", data[8:16])
    size_strings, size_struct = struct.unpack(">II", data[32:40])
    p = off_struct
    cur = []
    images = {}
    while p < off_struct + size_struct:
        (tag,) = struct.unpack(">I", data[p : p + 4])
        p += 4
        if tag == FDT_BEGIN_NODE:
            end = data.index(b"\x00", p)
            cur.append(data[p:end].decode("latin1"))
            p = (end + 1 + 3) & ~3
        elif tag == FDT_END_NODE:
            cur.pop()
        elif tag == FDT_PROP:
            ln, nameoff = struct.unpack(">II", data[p : p + 8])
            p += 8
            ne = data.index(b"\x00", off_strings + nameoff)
            pname = data[off_strings + nameoff : ne].decode("latin1")
            val = data[p : p + ln]
            p = (p + ln + 3) & ~3
            path = "/".join(cur)
            images.setdefault(path, {})[pname] = (ln, val)
        elif tag == FDT_NOP:
            pass
        elif tag == FDT_END:
            break
        else:
            raise ValueError(f"未知 FDT tag {tag} @ {p-4}")
    return images


def extract_itb_from_deb(deb_path: str, workdir: str) -> str:
    """从 u-boot deb 里解出 u-boot.itb，返回其路径。

    不依赖 dpkg-deb（Arch 等宿主没有），用 ar + tar：deb 是 ar 归档，
    内含 data.tar[.xz/.gz/.zst]。先 ar 取出 data 段，再按后缀解压。
    """
    # 1) ar 列出成员，找 data.tar*
    listing = subprocess.run(
        ["ar", "t", deb_path], check=True, capture_output=True, text=True
    ).stdout.split()
    data_member = next((m for m in listing if m.startswith("data.tar")), None)
    if not data_member:
        raise FileNotFoundError("deb 内未找到 data.tar* 成员")
    # 2) ar 取出 data 段到工作目录
    data_path = os.path.join(workdir, data_member)
    with open(data_path, "wb") as f:
        subprocess.run(["ar", "p", deb_path, data_member], check=True, stdout=f)
    # 3) 按后缀选择 tar 解压选项（tar 自带 -a 自动识别压缩，多数实现支持）
    extract_dir = os.path.join(workdir, "x")
    os.makedirs(extract_dir, exist_ok=True)
    rc = subprocess.run(
        ["tar", "-xaf", data_path, "-C", extract_dir],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode
    if rc != 0:
        # 退路：显式按后缀解（个别 tar 无 -a）
        comp = {"xz": "-J", "gz": "-z", "zst": "--zstd", "bz2": "-j"}.get(
            data_member.rsplit(".", 1)[-1], ""
        )
        args = ["tar", "-xf", data_path, "-C", extract_dir]
        if comp:
            args.insert(1, comp)
        subprocess.run(args, check=True)
    # 4) 找 u-boot 产物：vendor 走 u-boot.itb(FIT)，mainline binman 走 u-boot-rockchip.bin
    found = {}
    for root, _dirs, files in os.walk(extract_dir):
        for fn in files:
            if fn in ("u-boot.itb", "u-boot-rockchip.bin"):
                found[fn] = os.path.join(root, fn)
    # 优先 itb（纯 FIT，校验最直接）；否则用 rockchip.bin（内嵌 FIT，需扫描定位）
    if "u-boot.itb" in found:
        return found["u-boot.itb"]
    if "u-boot-rockchip.bin" in found:
        return found["u-boot-rockchip.bin"]
    raise FileNotFoundError("deb 内未找到 u-boot.itb 或 u-boot-rockchip.bin")


def _fdt_has_images_node(data: bytes) -> bool:
    """快速判断一段 FDT 是否含 /images 节点（即真正的 FIT，而非硬件 DT）。"""
    try:
        off_struct = struct.unpack(">I", data[8:12])[0]
        size_struct = struct.unpack(">I", data[36:40])[0]
    except struct.error:
        return False
    p = off_struct
    end = off_struct + size_struct
    depth = 0
    while p < end and p + 4 <= len(data):
        (tag,) = struct.unpack(">I", data[p : p + 4])
        p += 4
        if tag == FDT_BEGIN_NODE:
            e = data.index(b"\x00", p)
            name = data[p:e].decode("latin1")
            p = (e + 1 + 3) & ~3
            if depth == 1 and name == "images":
                return True
            depth += 1
        elif tag == FDT_END_NODE:
            depth -= 1
        elif tag == FDT_PROP:
            ln = struct.unpack(">I", data[p : p + 4])[0]
            p = (p + 8 + ln + 3) & ~3
        elif tag == FDT_END:
            break
    return False


def find_fit_offset(data: bytes) -> int:
    """在二进制里定位内嵌 *FIT*(含 /images 的 FDT) 的偏移。

    vendor 的 u-boot.itb 开头即 FIT；mainline binman 的 u-boot-rockchip.bin
    是 idbloader+SPL(含硬件控制 DT)+真正 FIT 拼接，里面有多个 FDT magic，
    只有含 /images 节点的那个才是要校验的 u-boot FIT。
    """
    magic = struct.pack(">I", FDT_MAGIC)
    start = 0
    while True:
        idx = data.find(magic, start)
        if idx < 0:
            return -1
        if idx + 8 <= len(data):
            (totalsize,) = struct.unpack(">I", data[idx + 4 : idx + 8])
            if 40 <= totalsize <= len(data) - idx:
                seg = data[idx : idx + totalsize]
                if _fdt_has_images_node(seg):
                    return idx
        start = idx + 4


def verify_itb(itb_path: str) -> list:
    """返回问题列表(空=通过)。支持纯 FIT(itb) 与内嵌 FIT(rockchip.bin)。"""
    raw = open(itb_path, "rb").read()
    off = find_fit_offset(raw)
    if off < 0:
        return ["  ✗ 未在产物中找到合法的内嵌 FIT(FDT magic)，结构异常"]
    if off > 0:
        print(f"  (内嵌 FIT 偏移 @ 0x{off:x}，binman 单文件镜像)")
    data = raw[off:]
    images = parse_fit_images(data)
    problems = []
    checked = 0
    for path, props in images.items():
        # 只校验 /images/* 下、声明了 data 或 data-size 的子镜像
        if not path.startswith("images/") and "/images/" not in "/" + path:
            continue
        # 节点名形如 images/fdt, images/uboot, images/atf-1 ...
        seg = path.split("/")
        if len(seg) < 2 or seg[-2] != "images":
            continue
        name = seg[-1]
        has_external = "data-size" in props  # external-data 模式
        has_embedded = "data" in props
        if not (has_external or has_embedded):
            continue
        checked += 1
        if has_embedded:
            ln, _ = props["data"]
            size = ln
        else:
            _ln, val = props["data-size"]
            size = struct.unpack(">I", val[:4])[0] if len(val) >= 4 else 0
        if size <= 0:
            problems.append(f"  ✗ /images/{name}: 数据为空 (size={size})")
        else:
            print(f"  ✓ /images/{name}: size={size}")
    if checked == 0:
        problems.append("  ✗ FIT 内未找到任何带 data 的子镜像，结构异常")
    return problems


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    target = sys.argv[1]
    if not os.path.exists(target):
        print(f"❌ 文件不存在: {target}")
        return 2
    tmp = None
    try:
        if target.endswith(".deb"):
            tmp = tempfile.mkdtemp(prefix="verify-uboot-")
            itb = extract_itb_from_deb(target, tmp)
        else:
            itb = target
        print(f"🔍 校验 FIT 镜像: {itb}")
        problems = verify_itb(itb)
    except Exception as e:  # noqa: BLE001
        print(f"❌ 解析失败: {e}")
        return 2
    finally:
        if tmp:
            subprocess.run(["rm", "-rf", tmp], check=False)

    if problems:
        print("\n❌ 出厂门禁未通过 —— u-boot.itb 含空数据子镜像：")
        print("\n".join(problems))
        print(
            "\n根因提示：很可能是 radxa BSP u-boot 在非 Jammy 宿主编出空 DTB。"
            "\n该镜像烧录后会启动失败 (No valid device tree)，已阻止放行。"
        )
        return 1
    print("\n✅ 出厂门禁通过：u-boot.itb 所有子镜像数据非空。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
