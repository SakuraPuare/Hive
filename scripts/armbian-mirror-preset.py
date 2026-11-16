#!/usr/bin/env python3
"""Add the `aliyun` regional mirror preset to the Armbian framework checkout.

Armbian resolves regional mirrors from a closed set: `china` (TUNA) and `bfsu`
only. When TUNA blocks the build host — 2026-11-16 实测：develop 的 IP 对 TUNA
的 apt 与 git 全站 403，而 aliyun/ustc 正常 — there is no supported way to pick
another Debian mirror, and every rootfs build dies in `apt-get update`.

`REGIONAL_MIRROR=aliyun` therefore needs two framework files patched:
main-config.sh (DOWNLOAD_MIRROR case + Debian/Ubuntu mirror) and
distro-specific.sh (Armbian apt repo). The framework checkout is untracked build
state that `make setup-armbian` replaces, so scripts/build.sh re-applies this
patch on every build where REGIONAL_MIRROR=aliyun instead of relying on a manual
edit that silently disappears.

Idempotent: each of the three insertions is skipped when its construction is
already present, so running it twice (or over a hand-patched framework) is safe.

Usage: armbian-mirror-preset.py <armbian-build-dir>
"""

import sys
from pathlib import Path

MIRROR_HOST = 'mirrors.aliyun.com'

EDITS = [
    (
        'lib/functions/configuration/main-config.sh',
        'DOWNLOAD_MIRROR=aliyun',
        '\t\tchina)',
        [
            '\t\taliyun) # hive-aliyun-preset\n',
            '\t\t\t[[ -z $DOWNLOAD_MIRROR ]] && DOWNLOAD_MIRROR=aliyun\n',
            '\t\t\t;;\n',
        ],
    ),
    (
        'lib/functions/configuration/main-config.sh',
        'mirrors.aliyun.com/debian',
        '\tif [[ $DOWNLOAD_MIRROR == "bfsu" ]]; then',
        [
            '\tif [[ $DOWNLOAD_MIRROR == "aliyun" ]]; then # hive-aliyun-preset\n',
            "\t\tDEBIAN_MIRROR='mirrors.aliyun.com/debian'\n",
            "\t\tDEBIAN_SECURITY='mirrors.aliyun.com/debian-security'\n",
            '\t\t[[ "${ARCH}" == "amd64" ]] &&\n',
            "\t\t\tUBUNTU_MIRROR='mirrors.aliyun.com/ubuntu/' ||\n",
            "\t\t\tUBUNTU_MIRROR='mirrors.aliyun.com/ubuntu-ports/'\n",
            '\tfi\n',
            '\n',
        ],
    ),
    (
        'lib/functions/rootfs/distro-specific.sh',
        'mirrors.aliyun.com/armbian',
        '\telif [[ $DOWNLOAD_MIRROR == "bfsu" ]]; then',
        [
            '\telif [[ $DOWNLOAD_MIRROR == "aliyun" ]]; then # hive-aliyun-preset\n',
            f'\t\tarmbian_mirror="{MIRROR_HOST}/armbian"\n',
        ],
    ),
]


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    root = Path(argv[1])
    if not (root / 'lib/functions/configuration/main-config.sh').is_file():
        print(f'not an Armbian framework checkout: {root}', file=sys.stderr)
        return 2

    changed = 0
    for rel, detect, anchor, block in EDITS:
        path = root / rel
        lines = path.read_text().splitlines(keepends=True)
        if any(detect in line for line in lines):
            print(f'already present: {rel} :: {detect}')
            continue
        for i, line in enumerate(lines):
            if line.rstrip('\n') == anchor:
                lines[i:i] = block
                path.write_text(''.join(lines))
                print(f'inserted: {rel} :: {anchor.strip()}')
                changed += 1
                break
        else:
            print(f'ERROR: anchor not found in {rel}: {anchor!r} '
                  '(Armbian changed its mirror resolution; update this script)',
                  file=sys.stderr)
            return 1

    print(f'aliyun mirror preset ready ({changed} insertion(s))')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
