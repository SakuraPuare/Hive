#!/usr/bin/env python3
"""Board detection, memory profiles and TF growth using isolated fake devices."""
import json
import os
import re
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
BIN = REPO / 'armbian-build/userpatches/overlay/usr/local/bin'


class HardwareTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='hive-hardware-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.mockdir = self.root / 'bin'
        self.mockdir.mkdir()
        self.env = dict(os.environ, HIVE_TEST_ROOT=str(self.root), PATH=str(self.mockdir)+':'+os.environ['PATH'])

    def run_script(self, text, expected=0, *args):
        script = self.root / 'script'
        script.write_text(text)
        r = subprocess.run(['bash', str(script), *args], env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, expected, r.stdout+r.stderr)
        return r

    def mock(self, name, text):
        p = self.mockdir / name
        p.write_text(text)
        p.chmod(0o755)

    def test_hardware_identity_uses_actual_device_tree(self):
        source = (BIN / 'hive-board').read_text().replace('/proc/device-tree/compatible', str(self.root / 'compatible'))
        for compatible, board in [('friendlyarm,nanopi-zero2','nanopi-zero2'),
                                  ('friendlyarm,nanopi-r28s','nanopi-r28s'),
                                  ('friendlyelec,nanopi-r28s','nanopi-r28s')]:
            (self.root / 'compatible').write_bytes(compatible.encode()+b'\0rockchip,rk3528\0')
            result = self.run_script(source+'\nhive_detect_board && echo "$HIVE_BOARD:$HIVE_LAYOUT"')
            self.assertEqual(result.stdout.strip(), f'{board}:{board}-bootab-v1')
        (self.root / 'compatible').write_bytes(b'friendlyarm,nanopi-r3s\0rockchip,rk3566\0')
        self.run_script(source+'\nhive_detect_board', 1)

    def test_memory_profile_tracks_ram_not_board_name(self):
        source = (REPO / 'armbian-build/userpatches/overlay/usr/lib/systemd/system-generators/hive-memory-generator').read_text()
        source = source.replace('/proc/meminfo', str(self.root / 'meminfo'))
        for kib, maxmem in [(930000, '224M'), (1010000, '224M'), (1990000, '300M')]:
            out = self.root / str(kib)
            (self.root / 'meminfo').write_text(f'MemTotal: {kib} kB\n')
            self.run_script(source, 0, str(out))
            self.assertIn('MemoryMax='+maxmem, (out/'xray.service.d/50-hive-memory.conf').read_text())
            self.assertIn('GOMEMLIMIT=', (out/'hive-mihomo.service.d/50-hive-memory.conf').read_text())
            self.assertEqual((out/'cloudflared.service.d/50-hive-memory.conf').exists(), kib < 1572864)

    def fixture_growth(self, capacity=32_000_000_000, expanded=False):
        start = 32768 + 3328*2048
        size = (capacity//512-34-start)//2048*2048 if expanded else 512*2048
        layout = {'partitiontable': {'label':'gpt','sectorsize':512,'partitions':[
            {'name':'hive-root','start':32768,'size':3328*2048},
            {'name':'hive-data','start':start,'size':size}]}}
        (self.root/'layout').write_text(json.dumps(layout))
        (self.root/'capacity').write_text(str(capacity//512))
        (self.root/'size').write_text(str(size))
        self.mock('sfdisk', r'''#!/usr/bin/env python3
import os,sys
from pathlib import Path
r=Path(os.environ['HIVE_TEST_ROOT']); args=sys.argv[1:]
with (r/'calls').open('a') as f: f.write('sfdisk '+' '.join(args)+'\n')
if '--json' in args: print((r/'layout').read_text())
elif '-N' in args:
    assert args[args.index('-N')+1] == '2'
    (r/'size').write_text(sys.stdin.read().strip().split('=')[1])
''')
        self.mock('blockdev', '''#!/bin/sh
case "$2" in *p2) cat "$HIVE_TEST_ROOT/size";; *) cat "$HIVE_TEST_ROOT/capacity";; esac
''')
        self.mock('findmnt', '#!/bin/sh\nexit 1\n')
        # A 512 MiB filesystem, i.e. the factory size before the first grow.
        self.mock('tune2fs', '#!/bin/sh\nprintf "Block count:             131072\\nBlock size:               4096\\n"\n')
        for tool in ['partx','sync','e2fsck','resize2fs']:
            self.mock(tool, '#!/bin/sh\necho "'+tool+' $*" >> "$HIVE_TEST_ROOT/calls"\n')
        return (BIN/'hive-data-grow').read_text()

    def test_32gb_and_64gb_grow_only_data_partition(self):
        for capacity in [32_000_000_000,64_000_000_000]:
            source = self.fixture_growth(capacity)
            self.run_script(source, 0, '/dev/mmcblk0')
            new_size = int((self.root/'size').read_text())
            self.assertGreater(new_size,512*2048)
            self.assertLessEqual((32768+3328*2048+new_size+34)*512, capacity)
            calls = (self.root/'calls').read_text()
            self.assertIn('-N 2 /dev/mmcblk0', calls)
            self.assertIn('e2fsck -pf /dev/mmcblk0p2', calls)
            self.assertIn('resize2fs /dev/mmcblk0p2', calls)
            self.assertNotIn('-N 1', calls)

    def test_second_boot_never_resizes_an_already_grown_filesystem(self):
        # Every mount of /data moves the superblock's last-mount time while
        # `e2fsck -p` on a clean filesystem leaves the last-check time alone, so a
        # second resize2fs run aborts with "Please run 'e2fsck -f' first" and
        # hive-data never mounts /data again. The grown filesystem must stay put.
        source = self.fixture_growth(expanded=True)
        self.mock('tune2fs', '#!/bin/sh\nsectors=$(cat "$HIVE_TEST_ROOT/size")\n'
                             'printf "Block count:             %s\\n" "$((sectors/8))"\n'
                             'printf "Block size:               4096\\n"\n')
        self.run_script(source, 0, '/dev/mmcblk0')
        calls = (self.root/'calls').read_text()
        self.assertNotIn('resize2fs', calls)
        self.assertNotIn('e2fsck', calls)

    def test_growth_resumes_filesystem_resize_after_gpt_write(self):
        source = self.fixture_growth(expanded=True)
        self.run_script(source, 0, '/dev/mmcblk0')
        calls = (self.root/'calls').read_text()
        self.assertNotIn('-N', calls)
        self.assertIn('partx --update --nr 2', calls)
        self.assertIn('resize2fs', calls)

    def test_non_hive_and_mounted_layouts_are_never_changed(self):
        source = self.fixture_growth()
        layout = json.loads((self.root/'layout').read_text())
        layout['partitiontable']['partitions'][0]['name'] = 'another-system'
        (self.root/'layout').write_text(json.dumps(layout))
        self.run_script(source, 1, '/dev/mmcblk0')
        self.assertNotIn('-N', (self.root/'calls').read_text())
        (self.root/'calls').unlink()
        self.mock('findmnt', '#!/bin/sh\nexit 0\n')
        self.run_script(source, 1, '/dev/mmcblk0')
        self.assertFalse((self.root/'calls').exists())

    def test_real_gpt_growth_preserves_other_partitions_and_uuid(self):
        # Sparse regular file, not a loop/block device. Exercise the actual sfdisk
        # syntax used on first boot and verify both system partitions are intact.
        image = self.root/'gpt.img'
        with image.open('wb') as f: f.truncate(64*1024**2)
        def sfdisk(*args, data=None):
            return subprocess.run(['sfdisk', *args, str(image)],input=data,text=True,capture_output=True,check=True).stdout
        sfdisk(data='label: gpt\nstart=32768,size=16384,name="hive-root"\nsize=32768,name="hive-data"\n')
        before = json.loads(sfdisk('--json'))['partitiontable']['partitions']
        with image.open('r+b') as f: f.truncate(96*1024**2)
        sfdisk('--no-reread','--no-tell-kernel','--relocate','gpt-bak-std')
        sfdisk('--no-reread','--no-tell-kernel','-N','2',data='size=100000\n')
        after = json.loads(sfdisk('--json'))['partitiontable']['partitions']
        self.assertEqual(before[0],after[0])
        self.assertEqual(before[1]['uuid'],after[1]['uuid'])
        self.assertEqual(before[1]['start'],after[1]['start'])
        self.assertEqual(after[1]['size'],100000)

    def test_identity_prefers_soc_ethernet_over_wifi_and_pcie(self):
        net = self.root/'net'; net.mkdir()
        dt = self.root/'device-tree'; (dt/'aliases').mkdir(parents=True)
        (dt/'soc/ethernet').mkdir(parents=True)
        (dt/'aliases/ethernet0').write_bytes(b'/soc/ethernet\0')
        for name in ['a-wifi','b-pcie','z-soc','virtual']:
            path=net/name; path.mkdir(); (path/'type').write_text('1\n')
            if name!='virtual': (path/'device').mkdir()
            if name=='a-wifi': (path/'wireless').mkdir()
        (net/'z-soc/device/of_node').symlink_to(dt/'soc/ethernet')
        source=(BIN/'hive-board').read_text().replace('/sys/class/net',str(net)).replace('/proc/device-tree',str(dt))
        result=self.run_script(source+'\nhive_identity_interface')
        self.assertEqual(result.stdout.strip(),'z-soc')

    def bootstrap_fixture(self):
        builder=(REPO/'scripts/build-ota-bootstrap.sh').read_text()
        builder=builder.replace('ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)', 'ROOT_DIR="'+str(self.root)+'"')
        builder=builder.replace('OVERLAY="$ROOT_DIR/armbian-build/userpatches/overlay"', 'OVERLAY="'+str(REPO/'armbian-build/userpatches/overlay')+'"')
        builder=builder.replace('"$ROOT_DIR/scripts/install-ota-agent.sh"','"'+str(REPO/'scripts/install-ota-agent.sh')+'"')
        self.run_script(builder,0,'test')
        import tarfile
        with tarfile.open(self.root/'output/ota/hive-ota-bootstrap-test.tar.gz') as archive:
            archive.extractall(self.root,filter='data')
        kit=self.root/'hive-ota-bootstrap-test'
        device=self.root/'device'
        (device/'etc/hive').mkdir(parents=True)
        (device/'etc/hive/config.env').write_text('NODE_REGISTRY_URL=https://registry.invalid\n')
        (device/'etc/hive/node-info').write_text('MAC=aabbccddeeff\n')
        (device/'etc/hive/device-token').write_text('preserve-device-secret')
        (device/'usr/local/bin').mkdir(parents=True)
        (device/'usr/local/bin/hive-updater').write_text('old updater')
        (self.root/'compatible').write_bytes(b'friendlyarm,nanopi-zero2\0')
        board=kit/'files/usr/local/bin/hive-board'
        board.write_text(board.read_text().replace('/proc/device-tree/compatible',str(self.root/'compatible')))
        import hashlib
        (kit/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+str(f.relative_to(kit))+'\n' for f in sorted((kit/'files').rglob('*')) if f.is_file()))
        installer=(kit/'install.sh').read_text().replace('[ "$EUID" -eq 0 ]','true')
        installer=installer.replace('kit=$(cd "$(dirname "$0")" && pwd)','kit="'+str(kit)+'"')
        for prefix in ['/etc/hive','/var/lib/hive']:
            installer=installer.replace(prefix,str(device)+prefix)
        installer=installer.replace('$kit/files'+str(device)+'/', '$kit/files/')
        installer=installer.replace('"/$path"','"'+str(device)+'/$path"').replace('"/${path}.bootstrap.XXXXXX"','"'+str(device)+'/${path}.bootstrap.XXXXXX"')
        installer=installer.replace('-C / ', '-C "'+str(device)+'" ').replace('-C /\n','-C "'+str(device)+'"\n')
        self.mock('uname','#!/bin/sh\necho aarch64\n')
        self.mock('systemctl',r'''#!/bin/sh
if [ "$1" = daemon-reload ] && [ -f "$HIVE_TEST_ROOT/fail-reload" ]; then rm "$HIVE_TEST_ROOT/fail-reload"; exit 1; fi
case "$1" in is-enabled) echo disabled; exit 1;; is-active) [ "$2" = --quiet ] && exit 0; echo inactive; exit 3;; esac
exit 0
''')
        return installer,device

    def test_bootstrap_check_does_not_install_or_change_identity(self):
        installer,device=self.bootstrap_fixture()
        self.run_script(installer,0,'--check')
        self.assertEqual((device/'usr/local/bin/hive-updater').read_text(),'old updater')
        self.assertEqual((device/'etc/hive/device-token').read_text(),'preserve-device-secret')
        self.assertFalse((device/'var/lib/hive').exists())

    def test_bootstrap_install_preserves_identity_and_public_key_mismatch_refuses(self):
        installer,device=self.bootstrap_fixture()
        self.run_script(installer,0,'--install')
        self.assertIn('do_install()', (device/'usr/local/bin/hive-updater').read_text())
        self.assertEqual((device/'etc/hive/device-token').read_text(),'preserve-device-secret')
        self.assertEqual((device/'usr/local/bin/hive-updater').stat().st_mode&0o777,0o755)
        (device/'etc/hive/ota-pubkey.pem').write_text('different installed key')
        self.run_script(installer,1,'--install')
        self.assertEqual((device/'etc/hive/ota-pubkey.pem').read_text(),'different installed key')

    def test_bootstrap_failure_restores_previous_files(self):
        installer,device=self.bootstrap_fixture()
        (self.root/'fail-reload').touch()
        self.run_script(installer,1,'--install')
        self.assertTrue(list((device/'var/lib/hive').glob('ota-bootstrap.*/previous.tar')))
        self.assertEqual((device/'usr/local/bin/hive-updater').read_text(),'old updater')
        self.assertFalse((device/'etc/hive/ota-pubkey.pem').exists())
        self.assertEqual((device/'etc/hive/device-token').read_text(),'preserve-device-secret')

    def test_relay_whitelist_never_uses_mihomo_fake_ips(self):
        # 实测事故：本机 DNS 被 mihomo TUN 劫持后 getent 返回 198.18.0.9/12，
        # setup-firewall.sh 把这两个假地址写进了 ufw（ALLOW 198.18.0.9/udp），
        # 真实中继 IP 的 UDP 回包反而被 BLOCK，EasyTier 握手超时、节点在 mesh
        # 里假在线。所以解析必须走 DoH 并显式过滤 fake-IP 段。
        source = (BIN / 'setup-firewall.sh').read_text()
        self.assertIn('223.5.5.5/resolve', source)
        self.assertIn("grep -vE '^198\\.18\\.'", source)
        # 直接把 getent 的结果喂给 ufw 就是原始 bug 的形态。
        for line in source.splitlines():
            if 'ufw allow in proto udp from' in line and 'IP' in line:
                self.assertNotIn('getent', line)

    def test_cloudflared_key_failure_still_installs_local_deb(self):
        source = (REPO / 'armbian-build/userpatches/customize-image.sh').read_text()
        setup = source[source.index('cloudflared_keyring='):source.index('# 3. 安装运行时依赖')]
        install = source[source.index('install_cloudflared_deb() {'):source.index('# cloudflare-warp 没有任何国内镜像')]
        for path in ['etc/apt/sources.list.d', 'usr/share/keyrings', 'var/cache/hive-debs']:
            (self.root / path).mkdir(parents=True)
        deb = self.root / 'var/cache/hive-debs/cloudflared_2026.11.0_arm64.deb'
        deb.write_bytes(b'local package')
        self.mock('curl', '#!/bin/sh\nexit 22\n')
        self.mock('apt-get', '#!/bin/sh\ncase "$*" in *cloudflared_*.deb*) echo "$*" > "$HIVE_TEST_ROOT/installed";; *) exit 100;; esac\n')
        script = 'set -e\n' + setup + install
        for path in ['/usr/share/keyrings', '/etc/apt/sources.list.d', '/var/cache/hive-debs']:
            script = script.replace(path, str(self.root) + path)
        self.run_script(script)
        self.assertIn(str(deb), (self.root / 'installed').read_text())
        deb.unlink()
        self.run_script(script, 1)

    def test_package_index_refreshes_and_offline_prefetch_uses_last_version(self):
        import gzip
        import hashlib
        source = (REPO / 'scripts/download-binaries.sh').read_text()
        fetch = source[source.index('fetch_raw() {'):source.index('# resolve_latest_tag')]
        prefetch = source[source.index('prefetch_repo_deb() {'):source.index('\nprefetch_repo_deb "pkg.cloudflareclient.com"')]
        cache, remote, overlay = [self.root / name for name in ['cache', 'remote', 'debs']]
        for path in [cache, remote, overlay]:
            path.mkdir()
        self.mock('curl', r'''#!/usr/bin/env python3
import os, shutil, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT'])
args = sys.argv[1:]
if (r/'offline').exists():
    sys.exit(22)
url = args[-1]
name = 'Packages.gz' if url.endswith('Packages.gz') else url.rsplit('/', 1)[-1]
shutil.copyfile(r/'remote'/name, args[args.index('-o')+1])
with (r/'downloads').open('a') as out:
    out.write(name+'\n')
''')
        script = ('set -e\nBIN_CACHE="' + str(cache) + '"\nWARP_DEBS="' + str(overlay) + '"\n'
                  + fetch + prefetch + '\nprefetch_repo_deb example.test trixie cloudflare-warp\n')
        def publish(version):
            name = f'cloudflare-warp_{version}_arm64.deb'
            data = version.encode()
            (remote / name).write_bytes(data)
            metadata = (f'Package: cloudflare-warp\nArchitecture: arm64\nVersion: {version}\n'
                        f'Filename: pool/{name}\nSHA256: {hashlib.sha256(data).hexdigest()}\n\n')
            (remote / 'Packages.gz').write_bytes(gzip.compress(metadata.encode()))
            return name
        old = publish('2026.10.0')
        self.run_script(script)
        new = publish('2026.11.0')
        self.run_script(script)
        self.assertEqual([p.name for p in overlay.iterdir()], [new])
        self.assertEqual((overlay / new).read_bytes(), b'2026.11.0')
        (self.root / 'offline').touch()
        self.run_script(script)
        self.assertEqual((overlay / new).read_bytes(), b'2026.11.0')
        downloads = (self.root / 'downloads').read_text().splitlines()
        self.assertEqual(downloads.count('Packages.gz'), 2)
        self.assertEqual(downloads.count(old), 1)
        self.assertEqual(downloads.count(new), 1)
        (cache / 'cloudflare-warp-trixie-Packages.gz').unlink()
        result = self.run_script(script)
        self.assertIn('无缓存', result.stdout)
        self.assertEqual((overlay / new).read_bytes(), b'2026.11.0')

    def test_every_external_call_in_provisioning_is_bounded(self):
        # provisioning talks to Cloudflare, Tailscale and the registry on the
        # node's first boot. An unbounded curl hangs until systemd kills the
        # unit, and a killed oneshot never writes the provisioned marker, so the
        # whole flow replays on every boot.
        source = (BIN / 'provision-node.sh').read_text()
        joined = re.sub(r'\\\n\s*', ' ', source)
        unbounded = [line.strip() for line in joined.splitlines()
                     if 'curl ' in line and not line.lstrip().startswith('#')
                     and '--max-time' not in line and '--connect-timeout' not in line]
        self.assertEqual(unbounded, [])

    def test_bare_curl_calls_cannot_abort_provisioning(self):
        # set -e is active. A curl captured into a variable still aborts the script
        # when it exits non-zero, unless the assignment is guarded or the value
        # comes through a pipeline. Multi-line calls hid two unguarded POSTs from
        # this check until a real boot died on curl 35 at the Cloudflare Mesh step.
        source = (BIN / 'provision-node.sh').read_text()
        joined = re.sub(r'\\\n\s*', ' ', source)
        offenders = []
        for line in joined.splitlines():
            if 'curl ' not in line or '=$(' not in line:
                continue
            if re.search(r'\|\s*jq\b', line):  # pipeline status is jq's
                continue
            if '||' in line or line.lstrip().startswith('if ! ') or 'if ! ' in line:
                continue
            offenders.append(line.strip())
        self.assertEqual(offenders, [])

    def test_provisioning_budget_fits_inside_the_unit_timeout(self):
        # The script gives up on its own budget first; systemd is the backstop
        # and must not fire earlier, or the operator loses the reason.
        source = (BIN / 'provision-node.sh').read_text()
        budget = int(re.search(r'PROVISION_BUDGET:-(\d+)', source).group(1))
        unit = (REPO / 'armbian-build/userpatches/overlay/etc/systemd/system/provision-node.service').read_text()
        timeout = int(re.search(r'^TimeoutStartSec=(\d+)', unit, re.M).group(1))
        self.assertGreater(timeout, budget * 1.4)

    def factory_plan(self, *args, env=None):
        source = self.root / 'source.img'
        source.write_bytes(b'')
        extra = dict(self.env)
        extra['HIVE_FACTORY_PLAN_ONLY'] = '1'
        if env:
            extra.update(env)
        r = subprocess.run(['bash', str(REPO / 'scripts/build-factory-image.sh'), str(source),
                            str(self.root / 'out'), '1.0.0', *args],
                           env=extra, capture_output=True, text=True)
        return r

    def test_factory_image_geometry_matches_the_runtime_contract(self):
        # hive-firmware refuses a disk whose first partition does not start at
        # 32768, and the boot script reserves the first 16 MiB for GPT, U-Boot
        # and both environment copies. build-factory-image.sh must lay out
        # exactly that, so the numbers are checked against the runtime, not
        # repeated.
        r = self.factory_plan('nanopi-zero2')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        plan = dict(line.split('=', 1) for line in r.stdout.split())
        start_root = int(plan['start_root'])
        root_mib = int(plan['root_mib'])
        root_sectors = int(plan['root_sectors'])
        self.assertEqual(root_sectors, root_mib * 2048)
        self.assertEqual(int(plan['start_data']), start_root + root_sectors)
        self.assertEqual(int(plan['factory_mib']),
                         int(plan['boot_area_mib']) + root_mib + int(plan['data_mib']) + 1)
        firmware = (BIN / 'hive-firmware').read_text()
        runtime_start = re.search(r'p1/start"\)"\s*=\s*(\d+)\s*\]', firmware)
        self.assertIsNotNone(runtime_start)
        self.assertEqual(int(runtime_start.group(1)), start_root)
        # The bootloader must fit in the reserved area ahead of the first
        # partition, otherwise flashing it overwrites the root filesystem.
        self.assertLess(12 * 1024 * 1024, int(plan['boot_area_mib']) * 1024 * 1024)

    def test_factory_image_rejects_impossible_geometry(self):
        for env in [{'HIVE_ROOT_MIB': '512'}, {'HIVE_DATA_MIB': '128'},
                    {'HIVE_ROOT_MIB': '4g'}, {'HIVE_DATA_MIB': '8192x'}]:
            with self.subTest(env=env):
                r = self.factory_plan('nanopi-zero2', env=env)
                self.assertNotEqual(r.returncode, 0, f'{env} was accepted')
        # An unset or empty override means "use the default", not "zero".
        r = self.factory_plan('nanopi-zero2', env={'HIVE_ROOT_MIB': '', 'HIVE_DATA_MIB': ''})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        plan = dict(line.split('=', 1) for line in r.stdout.split())
        self.assertEqual((plan['root_mib'], plan['data_mib']), ('6144', '512'))
        for version in ['../escape', '.hidden', 'has space', 'x' * 65]:
            with self.subTest(version=version):
                source = self.root / 'source.img'
                source.write_bytes(b'')
                r = subprocess.run(['bash', str(REPO / 'scripts/build-factory-image.sh'),
                                    str(source), str(self.root / 'out'), version, 'nanopi-zero2'],
                                   env=dict(self.env, HIVE_FACTORY_PLAN_ONLY='1'),
                                   capture_output=True, text=True)
                self.assertNotEqual(r.returncode, 0, f'version {version!r} was accepted')

    def test_factory_image_refuses_to_run_without_root(self):
        if os.geteuid() == 0:
            self.skipTest('running as root')
        source = self.root / 'source.img'
        source.write_bytes(b'')
        r = subprocess.run(['bash', str(REPO / 'scripts/build-factory-image.sh'), str(source),
                            str(self.root / 'out'), '1.0.0', 'nanopi-zero2'],
                           env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('sudo', r.stdout + r.stderr)

    def test_boot_policy_contains_matching_kernel_dtb(self):
        for board, dtb in [('nanopi-zero2','rk3528-nanopi-zero2.dtb'), ('nanopi-r28s','rk3528-nanopi-rev03.dtb')]:
            text = subprocess.check_output([str(REPO/'scripts/render-ab-boot.sh'),board],text=True)
            self.assertIn('/boot/dtb.${hive_slot}/rockchip/'+dtb,text)
            self.assertIn('${hive_slot}',text)  # Not expanded by the host shell.

    def easytier_launcher(self, node_info, config_env):
        text = (BIN / 'start-easytier.sh').read_text()
        (self.root / 'node-info').write_text(node_info)
        (self.root / 'config.env').write_text(config_env)
        text = text.replace('NODE_INFO="/etc/hive/node-info"', 'NODE_INFO="' + str(self.root / 'node-info') + '"')
        text = text.replace('CONFIG_ENV="/etc/hive/config.env"', 'CONFIG_ENV="' + str(self.root / 'config.env') + '"')
        text = text.replace('/usr/local/bin/hive-node-info', str(BIN / 'hive-node-info'))
        text = text.replace('/usr/local/bin/easytier-core', str(self.root / 'fake-core'))
        (self.root / 'fake-core').write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "' + str(self.root / 'core-args') + '"\n')
        (self.root / 'fake-core').chmod(0o755)
        return text

    def test_easytier_refuses_to_start_without_its_identity(self):
        # An empty EASYTIER_IP expands to "--ipv4 /16" and an empty secret to
        # "--network-secret ''". easytier-core exits on the bad argument and
        # Restart=always turns that into a restart every ten seconds with only
        # an argument error in the journal.
        for node_info, config_env in [
            ('HOSTNAME=hive-abcdef\n', 'EASYTIER_NETWORK_NAME=hive\nEASYTIER_SECRET=s3cret\n'),
            ('HOSTNAME=hive-abcdef\nEASYTIER_IP=172.20.1.5\n', 'EASYTIER_NETWORK_NAME=hive\n'),
            ('HOSTNAME=hive-abcdef\nEASYTIER_IP=172.20.1.5\n', 'EASYTIER_NETWORK_NAME=hive\nEASYTIER_SECRET=\n'),
        ]:
            with self.subTest(node_info=node_info, config_env=config_env):
                result = self.run_script(self.easytier_launcher(node_info, config_env), expected=1)
                self.assertIn('缺少必需配置', result.stderr)
                self.assertFalse((self.root / 'core-args').exists())

    def test_easytier_starts_with_complete_identity(self):
        result = self.run_script(self.easytier_launcher(
            'HOSTNAME=hive-abcdef\nEASYTIER_IP=172.20.1.5\n',
            'EASYTIER_NETWORK_NAME=hive\nEASYTIER_SECRET=s3cret\n'))
        args = (self.root / 'core-args').read_text().split()
        self.assertIn('172.20.1.5/16', args)
        self.assertIn('s3cret', args)

    def test_easytier_waits_for_provisioning_to_assign_its_ip(self):
        # 重新注册/重刷的设备开机时 node-info 里还没有 EASYTIER_IP，而 provision-node
        # 正在跑（留下 /etc/hive/provisioning）。此时必须等它写完再启动，而不是当场
        # exit 1 —— 那会被 Restart=always 放大成每 10s 一次的重启风暴。
        marker = self.root / 'provisioning'
        node_info = self.root / 'node-info'
        marker.write_text('')
        text = self.easytier_launcher(
            'HOSTNAME=hive-abcdef\n',
            'EASYTIER_NETWORK_NAME=hive\nEASYTIER_SECRET=s3cret\n')
        text = text.replace('PROVISIONING_MARKER="/etc/hive/provisioning"',
                            f'PROVISIONING_MARKER="{marker}"')
        script = self.root / 'script'
        script.write_text(text)
        proc = subprocess.Popen(['bash', str(script)], env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(2)
            self.assertIsNone(proc.poll(), 'launcher exited instead of waiting for provisioning')
            node_info.write_text('HOSTNAME=hive-abcdef\nEASYTIER_IP=172.20.1.5\n')
            marker.unlink()
            out, err = proc.communicate(timeout=30)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.communicate()
        self.assertEqual(proc.returncode, 0, out + err)
        self.assertIn('172.20.1.5/16', (self.root / 'core-args').read_text().split())

    # ── 启动排序不变量 ────────────────────────────────────────────────────────
    UNITS = REPO / 'armbian-build/userpatches/overlay/etc/systemd/system'

    # 出网才能工作的单元：必须 Wants= 且 After= network-online.target。
    NETWORK_UNITS = (
        'provision-node.service',    # 注册/enroll 走 registry
        'hive-mihomo.service',        # 拉订阅 + 上游代理
        'hive-clash-sync.service',    # 从 registry 拉网关配置
        'hive-xray-sync.service',     # 从 registry 拉订阅
        'hive-command-agent.service', # 心跳/命令轮询
        'hive-updater.service',       # OTA 轮询 + 管理面探测
        'hive-firmware-confirm.service',  # 试启动确认要访问 registry
        'cloudflared.service',        # CF Tunnel 控制面
        'easytier.service',           # 中继/peer
        'frpc.service',               # FRPS
    )

    # 断网也必须能起来/必须立即生效的单元：绝不能等网络，否则设备离线时
    # 防火墙不生效、热点不开、/data 不挂、回滚不跑。
    OFFLINE_UNITS = (
        'hive-firewall.service', 'hive-fail2ban.service',
        'hive-gateway.service', 'hive-hotspot.service',
        'hive-hotspot-5g.service', 'hive-hotspot-5g-dnsmasq.service',
        'hive-data.service', 'hive-ota-recover.service', 'hive-regen-hostkeys.service',
        'hive-subscription-guard.service', 'xray.service', 'xray-exporter.service',
    )

    # 上游软件包单元（我们只启用+配置），用 drop-in 加排序。
    PACKAGE_ONLINE_DROPINS = (
        'tailscaled.service.d/10-hive-online.conf',
        'warp-svc.service.d/10-hive-online.conf',
    )

    @staticmethod
    def unit_directives(text):
        directives = {}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith(('#', '[', ';')) or '=' not in line:
                continue
            key, _, value = line.partition('=')
            directives.setdefault(key.strip(), []).extend(value.split())
        return directives

    def test_network_units_wait_for_real_connectivity(self):
        for unit in self.NETWORK_UNITS:
            with self.subTest(unit=unit):
                d = self.unit_directives((self.UNITS / unit).read_text())
                self.assertIn('network-online.target', d.get('After', []),
                              f'{unit} 必须在 network-online.target 之后启动')
                self.assertIn('network-online.target', d.get('Wants', []),
                              f'{unit} 必须 Wants=network-online.target，否则这个 target 不会被拉进事务')
        for dropin in self.PACKAGE_ONLINE_DROPINS:
            with self.subTest(dropin=dropin):
                d = self.unit_directives((self.UNITS / dropin).read_text())
                self.assertIn('network-online.target', d.get('After', []))
                self.assertIn('network-online.target', d.get('Wants', []))
        # 目标本身必须真的等连通性，否则上面所有声明都是摆设：镜像启用
        # NetworkManager-wait-online，并把 nm-online 的 -s（只等 NM 启动完成）
        # 换成等实际连接。
        image = (REPO / 'armbian-build/userpatches/customize-image.sh').read_text()
        self.assertIn('systemctl enable NetworkManager-wait-online.service', image)
        wait_online = (self.UNITS / 'NetworkManager-wait-online.service.d/10-hive-connectivity.conf').read_text()
        self.assertIn('ExecStart=', wait_online.splitlines())  # 先清空发行版默认值
        execs = [value for value in wait_online.splitlines() if value.startswith('ExecStart=/usr/bin/nm-online')]
        self.assertTrue(execs, 'drop-in 必须显式设置 nm-online')
        self.assertNotIn('-s', execs[0].split(), 'nm-online 不能带 -s，否则不等连通性')
        self.assertIn('-t', execs[0].split(), 'nm-online 必须有超时，离线时不能让 target 永久挂住')

    def test_provisioning_retries_until_the_network_appears(self):
        # 客户先通电、后插网线：provision-node 第一次必然失败。没有重试它就一直是
        # 未注册状态直到有人手动重启（实测就是这样）。所以单元必须自愈地重试。
        d = self.unit_directives((self.UNITS / 'provision-node.service').read_text())
        self.assertEqual(d.get('Restart'), ['on-failure'])
        self.assertTrue(d.get('RestartSec'), '重试间隔必须显式给定')
        # 默认启动频率限制（5 次/10s）会把 60s 一次的重试掐死
        self.assertEqual(d.get('StartLimitIntervalSec'), ['0'],
                         '必须关掉启动频率限制，否则重试会被掐死在第一分钟')

    def enrollment_fixture(self, mode='success'):
        # Execute the real bootstrap up to hostname provisioning, relocating only
        # absolute device paths. curl is the boundary to an isolated fake registry.
        for path in ['etc/hive', 'var/log', 'usr/local/bin', 'sys/class/net/eth0']:
            (self.root / path).mkdir(parents=True)
        (self.root / 'etc/hive/config.env').write_text(
            'NODE_REGISTRY_URL=https://registry.invalid\nNODE_REGISTRY_API_SECRET=\n')
        (self.root / 'usr/local/bin/hive-board').write_text(
            'hive_identity_interface() { echo eth0; }\n')
        (self.root / 'sys/class/net/eth0/address').write_text('aa:bb:cc:dd:ee:ff\n')
        (self.root / 'response-mode').write_text(mode)
        for name in ['ip', 'sleep']:
            self.mock(name, '#!/bin/sh\nexit 0\n')
        # Run real fsync/rename while recording their ordering and supporting a
        # persistence failure between receipt of the response and publication.
        for name in ['sync', 'mv']:
            self.mock(name, '#!/usr/bin/env python3\n' +
                      f'tool = {name!r}\nreal = {shutil.which(name)!r}\n' + r'''
import json, os, subprocess, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
target = Path(args[-1])
failure = r / 'fail-persist'
if failure.exists() and target.name.startswith(failure.read_text()):
    sys.exit(1)
result = subprocess.run([real, *args])
if result.returncode:
    sys.exit(result.returncode)
event = {'op': tool, 'path': str(target.relative_to(r))}
if tool == 'mv': event['source'] = str(Path(args[-2]).relative_to(r))
with (r / 'enrollment-events').open('a') as out:
    out.write(json.dumps(event) + '\n')
''')
        self.mock('curl', r'''#!/usr/bin/env python3
import json, os, re, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
assert 'https://registry.invalid/nodes/enroll' in args
request = json.loads(args[args.index('-d') + 1])
proof = r / 'etc/hive/enrollment-token'
assert proof.read_text().strip() == request['token']
assert re.fullmatch('[0-9a-fA-F]{64}', request['token'])
assert proof.stat().st_mode & 0o777 == 0o600
assert not (r / 'etc/hive/device-token').exists()
with (r / 'enrollment-events').open('a') as out:
    out.write(json.dumps({'op': 'request', **request}) + '\n')
server = r / 'registry-enrollment'
if not server.exists():
    server.write_text(json.dumps({'mac': request['mac'], 'token': request['token'], 'claim_code': 'ABCD-1234'}))
accepted = json.loads(server.read_text())
mode = (r / 'response-mode').read_text()
if mode == 'lost':
    print('000', end='')
    sys.exit(28)
if mode == 'conflict' or accepted['token'] != request['token']:
    code, response = '409', {'error': 'credential does not match'}
elif mode == 'wrong-token':
    code, response = '200', {**accepted, 'token': 'f' * 64}
elif mode == 'error-with-token':
    code, response = '500', accepted
else:
    code, response = '200', accepted
Path(args[args.index('-o') + 1]).write_text(json.dumps(response))
print(code, end='')
''')
        source = (BIN / 'provision-node.sh').read_text().split('# 设主机名：', 1)[0]
        for prefix in ['/etc/', '/var/log/', '/usr/local/bin/', '/sys/class/net/']:
            source = source.replace(prefix, str(self.root) + prefix)
        return source + '\nprintf "%s\\n" "$NODE_REGISTRY_API_SECRET" > "$HIVE_TEST_ROOT/resumed-token"\n'

    def enrollment_events(self):
        path = self.root / 'enrollment-events'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def assert_enrollment_secret_synced(self, events, name):
        path = 'etc/hive/' + name
        rename = next(i for i, event in enumerate(events)
                      if event['op'] == 'mv' and event['path'] == path)
        self.assertEqual(events[rename - 1], {'op': 'sync', 'path': events[rename]['source']})
        self.assertEqual(events[rename + 1], {'op': 'sync', 'path': 'etc/hive'})
        self.assertEqual((self.root / path).stat().st_mode & 0o777, 0o600)
        return rename

    def test_enrollment_lost_response_retries_same_durable_secret(self):
        source = self.enrollment_fixture('lost')
        self.run_script(source, 1)
        proof = (self.root / 'etc/hive/enrollment-token').read_text().strip()
        self.assertRegex(proof, r'^[0-9a-f]{64}$')
        self.assertFalse((self.root / 'etc/hive/device-token').exists())
        self.assertFalse((self.root / 'etc/hive/claim-code').exists())
        self.assertFalse((self.root / 'etc/hive/provision-blocked').exists())
        before = self.enrollment_events()
        published = self.assert_enrollment_secret_synced(before, 'enrollment-token')
        first_request = next(i for i, event in enumerate(before) if event['op'] == 'request')
        self.assertLess(published + 1, first_request)
        self.assertEqual(len([event for event in before if event['op'] == 'request']), 6)

        # A fresh provisioning process must recover, not skip enrollment because
        # it found the pending proof, and must clear stale user-visible blocking.
        (self.root / 'etc/hive/provision-blocked').write_text('stale failure')
        (self.root / 'response-mode').write_text('success')
        self.run_script(source)
        events = self.enrollment_events()
        requests = [event for event in events if event['op'] == 'request']
        self.assertEqual(len(requests), 7)
        self.assertEqual({request['token'] for request in requests}, {proof})
        self.assertEqual((self.root / 'resumed-token').read_text().strip(), proof)
        self.assertEqual((self.root / 'etc/hive/device-token').read_text().strip(), proof)
        self.assertEqual((self.root / 'etc/hive/claim-code').read_text().strip(), 'ABCD-1234')
        self.assertFalse((self.root / 'etc/hive/provision-blocked').exists())
        claim = self.assert_enrollment_secret_synced(events, 'claim-code')
        credential = self.assert_enrollment_secret_synced(events, 'device-token')
        self.assertLess(claim + 1, credential)
        self.assertFalse(list((self.root / 'etc/hive').glob('*.tmp.*')))
        self.run_script(source)
        self.assertEqual(len([event for event in self.enrollment_events() if event['op'] == 'request']), 7)

    def test_enrollment_persistence_failure_never_sends_unflushed_proof(self):
        source = self.enrollment_fixture()
        (self.root / 'fail-persist').write_text('enrollment-token')
        self.run_script(source, 1)
        self.assertFalse(any(event['op'] == 'request' for event in self.enrollment_events()))
        self.assertFalse((self.root / 'etc/hive/device-token').exists())
        self.assertFalse((self.root / 'etc/hive/enrollment-token').exists())

    def test_enrollment_claim_persistence_failure_resumes_with_same_proof(self):
        source = self.enrollment_fixture()
        (self.root / 'fail-persist').write_text('claim-code')
        self.run_script(source, 1)
        proof = (self.root / 'etc/hive/enrollment-token').read_text().strip()
        self.assertFalse((self.root / 'etc/hive/device-token').exists())
        (self.root / 'fail-persist').unlink()
        self.run_script(source)
        self.assertEqual((self.root / 'etc/hive/device-token').read_text().strip(), proof)
        self.assertEqual((self.root / 'etc/hive/claim-code').read_text().strip(), 'ABCD-1234')

    def test_enrollment_conflict_stops_without_publishing_device_token(self):
        source = self.enrollment_fixture('conflict')
        self.run_script(source)
        self.assertTrue((self.root / 'etc/hive/provision-blocked').read_text().startswith('409 '))
        self.assertTrue((self.root / 'etc/hive/enrollment-token').exists())
        self.assertFalse((self.root / 'etc/hive/device-token').exists())
        self.assertFalse((self.root / 'resumed-token').exists())
        self.assertEqual(len([event for event in self.enrollment_events() if event['op'] == 'request']), 1)

    def test_enrollment_rejects_wrong_token_and_unsuccessful_http_response(self):
        source = self.enrollment_fixture('wrong-token')
        for mode in ['wrong-token', 'error-with-token']:
            with self.subTest(mode=mode):
                (self.root / 'response-mode').write_text(mode)
                self.run_script(source, 1)
                self.assertFalse((self.root / 'etc/hive/device-token').exists())
                self.assertFalse((self.root / 'etc/hive/claim-code').exists())

    def test_enrollment_preserves_invalid_pending_proof_for_recovery(self):
        source = self.enrollment_fixture()
        proof = self.root / 'etc/hive/enrollment-token'
        proof.write_text('interrupted-or-legacy-secret')
        self.run_script(source, 1)
        self.assertEqual(proof.read_text(), 'interrupted-or-legacy-secret')
        self.assertFalse(any(event['op'] == 'request' for event in self.enrollment_events()))

    def test_fail2ban_logrotate_has_exactly_one_config(self):
        # Armbian 的 fail2ban 包自带 /etc/logrotate.d/fail2ban（同一个日志文件）。
        # 再放一份独立的 fail2ban-hive 会被 logrotate 判成 duplicate log entry 并整体
        # exit 1 —— 真机实测 logrotate.service 每次开机都是 failed。
        overlay = (REPO / 'armbian-build/userpatches/overlay/etc/logrotate.d/fail2ban').read_text()
        self.assertIn('/var/log/fail2ban.log', overlay)
        self.assertIn('rotate 30', overlay)
        script = (BIN / 'setup-fail2ban.sh').read_text()
        self.assertNotIn('cat > /etc/logrotate.d/fail2ban-hive', script,
                         '不能再写独立 stanza，否则和发行版配置撞车')
        self.assertIn('rm -f /etc/logrotate.d/fail2ban-hive', script,
                      '旧固件留下的重复配置必须被清掉')
        # 构建用户 umask 002 时 overlay 文件会带 0664 落盘，logrotate 直接拒绝并让整个
        # logrotate.service 失败（实测 error: Ignoring fail2ban because it is writable
        # by group or others）。镜像构建必须把轮转配置的权限统一回 0644。
        image = (REPO / 'armbian-build/userpatches/customize-image.sh').read_text()
        self.assertIn('chmod 0644 /etc/logrotate.d/*', image)
        self.assertIn('chmod 0644 /etc/logrotate.d/fail2ban', script)

    def test_units_with_provisioned_configs_skip_instead_of_timing_out(self):
        # 工厂镜像预启用 cloudflared/frpc，但它们的配置由 provisioning 生成；以前是
        # ExecStartPre 里死等 → 90s 后被 systemd 判超时（首启日志里的 FAILED）。改用
        # ConditionPathExists 干净跳过，provision 写完配置后 enable --now 即可启动。
        for unit, config in [('cloudflared.service', '/etc/cloudflared/config.yml'),
                             ('frpc.service', '/etc/frp/frpc.toml')]:
            with self.subTest(unit=unit):
                text = (self.UNITS / unit).read_text()
                directives = self.unit_directives(text)
                self.assertEqual(directives.get('ConditionPathExists'), [config])
                self.assertNotIn('until [ -f', text, '不能再用阻塞等待，系统会判超时失败')


    def test_offline_capable_units_never_wait_for_the_network(self):
        for unit in self.OFFLINE_UNITS:
            with self.subTest(unit=unit):
                d = self.unit_directives((self.UNITS / unit).read_text())
                self.assertNotIn('network-online.target', d.get('After', []),
                                 f'{unit} 断网时也必须启动/生效，不能排在 network-online.target 之后')
                self.assertNotIn('network-online.target', d.get('Wants', []),
                                 f'{unit} 断网时也必须启动/生效，不能 Wants=network-online.target')

    def test_node_info_preserves_gateway_topology_without_evaluation(self):
        info = self.root / 'node-info'
        marker = self.root / 'evaluated'
        expected = ['eth0', 'eth1 eth2', '10.42.2.1']
        malicious = f'$(touch {marker})'
        cases = [
            ('GATEWAY_WAN_IFACE=eth0\nGATEWAY_LAN_IFACES=eth1 eth2\n'
             'GATEWAY_LAN_IP=10.42.2.1\n', expected),
            ("GATEWAY_WAN_IFACE='eth0'\nGATEWAY_LAN_IFACES=eth1\\ eth2\n"
             "GATEWAY_LAN_IP='10.42.2.1'\n", expected),
            (f'GATEWAY_WAN_IFACE={malicious}\n'
             f'GATEWAY_LAN_IFACES={malicious}\n'
             f'GATEWAY_LAN_IP={malicious}\n', [malicious] * 3),
        ]
        for content, values in cases:
            with self.subTest(content=content):
                info.write_text(content + f'BASH_ENV={marker}\n')
                source = (BIN / 'hive-node-info').read_text()
                source += '\nunset GATEWAY_WAN_IFACE GATEWAY_LAN_IFACES GATEWAY_LAN_IP BASH_ENV\n'
                source += 'hive_load_node_info "$HIVE_TEST_ROOT/node-info"\n'
                source += (r'''printf '%s\0' "${GATEWAY_WAN_IFACE-}" "${GATEWAY_LAN_IFACES-}" "${GATEWAY_LAN_IP-}" "${BASH_ENV-}"''' + '\n')
                result = self.run_script(source)
                self.assertEqual(result.stdout.split('\0'), values + ['', ''])
                self.assertFalse(marker.exists())

    def hotspot_fixture(self, bands='2g 5g', prefer='5'):
        # Relocate paths only; run actual detection, activation and ACK logic.
        for path in ['etc/hive', 'etc/NetworkManager/system-connections',
                     'usr/local/bin', 'run', 'tmp', 'sys/class/net']:
            (self.root / path).mkdir(parents=True)
        if bands:
            net = self.root / 'sys/class/net/wlan0'
            (net / 'phy80211').mkdir(parents=True)
            (net / 'device/driver').mkdir(parents=True)
            (net / 'address').write_text('02:00:00:00:00:01\n')
        (self.root / 'bands').write_text(bands)
        (self.root / 'etc/hive/config.env').write_text('NODE_REGISTRY_URL=https://registry.invalid\n')
        (self.root / 'etc/hive/device-token').write_text('test-device-token')
        (self.root / 'etc/hive/node-info').write_text('MAC=aabbccddeeff\n')
        (self.root / 'etc/hive/default-hotspot-psk').write_text('default-test-password')
        (self.root / 'services.json').write_text('{}')
        (self.root / 'nm-active.json').write_text('[]')
        params = {'ssid2g': 'Command 2G', 'ssid5g': 'Command 5G',
                  'psk': 'command-password', 'preferBand': prefer}
        (self.root / 'commands.json').write_text(json.dumps(
            [{'id': 42, 'action': 'hotspot-config', 'params': json.dumps(params)}]))
        for name in ['logger', 'chown', 'sysctl', 'sleep', 'ufw', 'journalctl']:
            self.mock(name, '#!/bin/sh\nexit 0\n')
        # mihomo 的 DNS 端口是否在听由 dns1053 文件模拟；订阅门禁是否存在由 gate 文件模拟。
        self.mock('iptables', r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
with (r/'iptables-calls').open('a') as out:
    out.write(' '.join(args)+'\n')
if '-C' in args and 'hive-subscription' in args:
    sys.exit(0 if (r/'gate').exists() else 1)
sys.exit(1 if '-C' in args else 0)
''')
        self.mock('ss', r'''#!/usr/bin/env python3
import os
from pathlib import Path
if (Path(os.environ['HIVE_TEST_ROOT'])/'dns1053').exists():
    print('UNCONN 0 0 0.0.0.0:1053 0.0.0.0:*')
''')
        self.mock('curl', r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
if '-d' in args:
    assert args[-1].endswith('/nodes/aabbccddeeff/commands/42/ack')
    with (r/'acks').open('a') as out:
        out.write(json.dumps(json.loads(args[args.index('-d')+1]))+'\n')
else:
    print((r/'commands.json').read_text())
''')
        self.mock('iw', r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
if sys.argv[1] == 'phy':
    print('Supported interface modes:\n\t * AP\nBand 1:')
    bands = (Path(os.environ['HIVE_TEST_ROOT'])/'bands').read_text().split()
    if '2g' in bands: print(' * 2412 MHz [1]')
    if '5g' in bands: print(' * 5745 MHz [149]')
''')
        self.mock('systemctl', r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
state = json.loads((r/'services.json').read_text())
if args[0] == 'restart':
    failure = r/'failed-service'
    if failure.exists() and failure.read_text() == args[1]: sys.exit(1)
    state[args[1]] = True
elif args[0] == 'stop':
    for service in args[1:]: state[service] = False
elif args[0] == 'is-active':
    sys.exit(0 if state.get(args[-1], False) else 3)
elif args[0] == 'show' and 'SubState' in args:
    substate = r/'mihomo-substate'
    print(substate.read_text().strip() if substate.exists()
          else ('running' if state.get(args[-1], False) else 'dead'))
(r/'services.json').write_text(json.dumps(state))
''')
        self.mock('nmcli', r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
state = json.loads((r/'nm-active.json').read_text())
if args[:2] == ['connection', 'up']:
    if (r/'fail-nm').exists(): sys.exit(1)
    state = [args[2]]
elif args[:2] in [['connection', 'down'], ['connection', 'delete']]:
    state = [name for name in state if name != args[2]]
elif args[:2] == ['device', 'disconnect']: state = []
elif args[-2:] == ['device', 'status']: print('wlan0')
(r/'nm-active.json').write_text(json.dumps(state))
''')
        self.mock('ip', r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
with (r/'ip-calls').open('a') as out:
    out.write(' '.join(args)+'\n')
state = r/'ip-rules'
lines = state.read_text().splitlines() if state.exists() else []
def save(): state.write_text('\n'.join(lines)+('\n' if lines else ''))
if args[:2] == ['rule', 'show']:
    print('\n'.join(lines))
elif args[:2] == ['rule', 'add']:
    kind, target, pref = args[2], args[3], args[-1]
    line = f'{pref}:\t{kind} {target} lookup main'
    if line not in lines: lines.append(line)
    save()
elif args[:2] == ['rule', 'del']:
    kind, target = args[2], args[3]
    pref = args[args.index('pref')+1] if 'pref' in args else None
    lines[:] = [l for l in lines
                if not (f'{kind} {target} lookup main' in l
                        and (pref is None or l.startswith(pref+':')))]
    save()
''')
        for name in ['hive-command-agent', 'hive-hotspot.sh', 'hive-node-info',
                     'hive-hotspot-dns.sh', 'hive-hotspot-firewall.sh']:
            source = (BIN / name).read_text()
            for path in ['/tmp/', '/etc/', '/run/', '/sys/class/net', '/usr/local/bin/']:
                source = source.replace(path, str(self.root) + path)
            target = self.root / 'usr/local/bin' / name
            target.write_text(source)
            target.chmod(0o755)
        return (self.root / 'usr/local/bin/hive-command-agent').read_text()

    def test_hotspot_command_reports_5g_failure_and_cleans_ap(self):
        agent = self.hotspot_fixture()
        for service in ['hive-hotspot-5g.service', 'hive-hotspot-5g-dnsmasq.service']:
            with self.subTest(service=service):
                # Failed restart must not count as applied even if old units
                # remain active until the hotspot script cleans them up.
                (self.root / 'services.json').write_text(json.dumps({
                    'hive-hotspot-5g.service': True,
                    'hive-hotspot-5g-dnsmasq.service': True}))
                (self.root / 'failed-service').write_text(service)
                self.run_script(agent)
                ack = json.loads((self.root / 'acks').read_text().splitlines()[-1])
                self.assertEqual(ack['status'], 'failed')
                self.assertIn('hotspot apply failed', ack['result'])
                self.assertFalse(any(json.loads((self.root / 'services.json').read_text()).values()))
                self.assertEqual(json.loads((self.root / 'nm-active.json').read_text()), [])
                self.assertIn('addr flush dev wlan0', (self.root / 'ip-calls').read_text())
                self.assertNotIn('WIFI_IFACE', (self.root / 'etc/hive/node-info').read_text())

    def test_hotspot_command_reports_success_after_applying_5g(self):
        self.run_script(self.hotspot_fixture())
        ack = json.loads((self.root / 'acks').read_text())
        self.assertEqual(ack['status'], 'done')
        state = json.loads((self.root / 'services.json').read_text())
        self.assertTrue(state['hive-hotspot-5g.service'])
        self.assertTrue(state['hive-hotspot-5g-dnsmasq.service'])
        config = (self.root / 'etc/hostapd/hive-5g.conf').read_text()
        self.assertIn('ssid=Command 5G\n', config)
        self.assertIn('sae_password=command-password\n', config)
        self.assertIn('WIFI_IFACE_5G=wlan0\n', (self.root / 'etc/hive/node-info').read_text())

    def test_hotspot_command_reports_2g_activation_failure(self):
        agent = self.hotspot_fixture(prefer='2.4')
        (self.root / 'fail-nm').touch()
        self.run_script(agent)
        self.assertEqual(json.loads((self.root / 'acks').read_text())['status'], 'failed')
        self.assertEqual(json.loads((self.root / 'nm-active.json').read_text()), [])
        self.assertNotIn('WIFI_IFACE', (self.root / 'etc/hive/node-info').read_text())

    def test_hotspot_command_accepts_intentionally_unassigned_5g(self):
        self.run_script(self.hotspot_fixture(prefer='2.4'))
        self.assertEqual(json.loads((self.root / 'acks').read_text())['status'], 'done')
        self.assertEqual(json.loads((self.root / 'nm-active.json').read_text()), ['hive-hotspot-2g'])
        self.assertFalse(any(json.loads((self.root / 'services.json').read_text()).values()))
        self.assertIn('WIFI_IFACE_2G=wlan0\n', (self.root / 'etc/hive/node-info').read_text())

    def test_hotspot_command_accepts_unsupported_5g_fallback(self):
        self.run_script(self.hotspot_fixture(bands='2g'))
        self.assertEqual(json.loads((self.root / 'acks').read_text())['status'], 'done')
        self.assertEqual(json.loads((self.root / 'nm-active.json').read_text()), ['hive-hotspot-2g'])

    def test_hotspot_without_wireless_hardware_remains_optional(self):
        self.run_script(self.hotspot_fixture(bands=''))
        self.assertEqual(json.loads((self.root / 'acks').read_text())['status'], 'done')
        self.assertFalse(any(json.loads((self.root / 'services.json').read_text()).values()))
        self.assertEqual(json.loads((self.root / 'nm-active.json').read_text()), [])

    def test_hotspot_without_mihomo_gets_public_dns_and_direct_egress(self):
        # 没有 mihomo（未配置 / 已停用）时热点也必须能上网：dnsmasq 不能把上游
        # 指向没人监听的 127.0.0.1#1053，热点网段还需要直连 SNAT 与转发放行。
        self.run_script(self.hotspot_fixture(bands='5g'))
        conf = (self.root / 'etc/hive/dnsmasq-5g.conf').read_text()
        self.assertIn('server=223.5.5.5\n', conf)
        self.assertIn('server=119.29.29.29\n', conf)
        self.assertNotIn('127.0.0.1#1053', conf)
        calls = (self.root / 'iptables-calls').read_text()
        self.assertIn('-t nat -A POSTROUTING -s 10.42.1.0/24 ! -o Meta '
                      '-m comment --comment hive-hotspot-nat -j MASQUERADE', calls)
        self.assertIn('-I FORWARD 1 -i wlan0 -s 10.42.1.0/24 '
                      '-m comment --comment hive-hotspot -j ACCEPT', calls)

    def test_hotspot_with_mihomo_keeps_fake_ip_dns(self):
        agent = self.hotspot_fixture(bands='5g')
        (self.root / 'etc/mihomo').mkdir(parents=True, exist_ok=True)
        (self.root / 'etc/mihomo/config.yaml').write_text('mixed-port: 7890\n')
        (self.root / 'services.json').write_text(json.dumps({'hive-mihomo': True}))
        (self.root / 'dns1053').touch()
        self.run_script(agent)
        conf = (self.root / 'etc/hive/dnsmasq-5g.conf').read_text()
        self.assertIn('server=127.0.0.1#1053\n', conf)
        self.assertNotIn('223.5.5.5', conf)
        # 门禁不在（正常代理分流）：热点包该走 TUN，不能插直连策略路由。
        self.assertNotIn('rule add from 10.42.1.0/24 lookup main', (self.root / 'ip-calls').read_text())

    def test_hotspot_start_post_uses_ready_dns_and_stop_post_falls_back(self):
        self.run_script(self.hotspot_fixture(bands='5g'))
        (self.root / 'etc/mihomo').mkdir(parents=True, exist_ok=True)
        (self.root / 'etc/mihomo/config.yaml').write_text('mixed-port: 7890\n')
        (self.root / 'mihomo-substate').write_text('start-post\n')
        (self.root / 'dns1053').touch()
        self.mock('sleep', '#!/bin/sh\necho unexpected-wait >&2\nexit 1\n')
        dns = (self.root / 'usr/local/bin/hive-hotspot-dns.sh').read_text()
        firewall = (self.root / 'usr/local/bin/hive-hotspot-firewall.sh').read_text()
        result = self.run_script(dns, 0, '--wait')
        self.assertNotIn('unexpected-wait', result.stderr)
        conf = self.root / 'etc/hive/dnsmasq-5g.conf'
        self.assertIn('server=127.0.0.1#1053\n', conf.read_text())
        self.run_script(firewall)
        self.assertNotIn('10.42.1.0/24 lookup main', (self.root / 'ip-rules').read_text())
        (self.root / 'mihomo-substate').write_text('stop-post\n')
        self.run_script(dns)
        self.run_script(firewall)
        self.assertIn('server=223.5.5.5\n', conf.read_text())
        self.assertIn('10.42.1.0/24 lookup main', (self.root / 'ip-rules').read_text())

    def test_hotspot_with_blocked_gate_bypasses_mihomo(self):
        # 实测：门禁在、交付配置末端是 MATCH,REJECT 时，热点客户端 DHCP/DNS 都正常但
        # HTTPS 全超时。热点网段必须从 TUN 摘到 main 表直连，DNS 同步用公共 DNS
        # （fake-IP 在 main 表不可路由）。
        agent = self.hotspot_fixture(bands='5g')
        (self.root / 'services.json').write_text(json.dumps({'hive-mihomo': True}))
        (self.root / 'dns1053').touch()
        (self.root / 'gate').touch()
        self.run_script(agent)
        conf = (self.root / 'etc/hive/dnsmasq-5g.conf').read_text()
        self.assertIn('server=223.5.5.5\n', conf)
        self.assertNotIn('127.0.0.1#1053', conf)
        calls = (self.root / 'ip-calls').read_text()
        self.assertIn('rule add from 10.42.1.0/24 lookup main pref 8000', calls)
        self.assertIn('rule add from 10.42.0.0/24 lookup main pref 8000', calls)
        # 本机到公共解析器的查询也要绕开 dns-hijack，否则客户端仍拿 fake-IP。
        self.assertIn('rule add to 223.5.5.5 lookup main pref 7000', calls)
        self.assertIn('rule add to 119.29.29.29 lookup main pref 7000', calls)
        # 回程（对端回包）也必须放行，否则 TCP SYN 出得去、连不上。
        self.assertIn('-I FORWARD 1 -o wlan0 -m conntrack --ctorigsrc 10.42.1.0/24 '
                      '-m comment --comment hive-hotspot-ret -j ACCEPT',
                      (self.root / 'iptables-calls').read_text())

    def test_hotspot_gate_release_removes_the_bypass(self):
        agent = self.hotspot_fixture(bands='5g')
        (self.root / 'etc/mihomo').mkdir(parents=True, exist_ok=True)
        (self.root / 'etc/mihomo/config.yaml').write_text('mixed-port: 7890\n')
        (self.root / 'services.json').write_text(json.dumps({'hive-mihomo': True}))
        (self.root / 'dns1053').touch()
        (self.root / 'ip-rules').write_text('8000:\tfrom 10.42.1.0/24 lookup main\n'
                                           '8000:\tfrom 10.42.0.0/24 lookup main\n')
        self.run_script(agent)
        rules = (self.root / 'ip-rules').read_text()
        self.assertNotIn('10.42.1.0/24 lookup main', rules)
        self.assertNotIn('10.42.0.0/24 lookup main', rules)
        self.assertIn('server=127.0.0.1#1053\n', (self.root / 'etc/hive/dnsmasq-5g.conf').read_text())

    def test_hotspot_without_config_falls_back_to_direct(self):
        # 用户场景：mihomo 进程还在（内存里还有旧配置）、config.yaml 却没了 ——
        # 这种"没有 mihomo 配置"的状态下热点必须直连，不能等 mihomo 吐 fake-IP。
        agent = self.hotspot_fixture(bands='5g')
        (self.root / 'services.json').write_text(json.dumps({'hive-mihomo': True}))
        (self.root / 'dns1053').touch()
        self.run_script(agent)
        conf = (self.root / 'etc/hive/dnsmasq-5g.conf').read_text()
        self.assertIn('server=223.5.5.5\n', conf)
        self.assertNotIn('127.0.0.1#1053', conf)
        self.assertIn('rule add from 10.42.1.0/24 lookup main pref 8000',
                      (self.root / 'ip-calls').read_text())

    def test_2g_hotspot_is_exempt_from_the_subscription_block(self):
        self.run_script(self.hotspot_fixture(prefer='2.4'))
        calls = (self.root / 'iptables-calls').read_text()
        self.assertIn('-I FORWARD 1 -i wlan0 -s 10.42.0.0/24 '
                      '-m comment --comment hive-hotspot -j ACCEPT', calls)

    def gateway_fixture(self, default_route=''):
        # Relocate paths only; run the production WAN/LAN selection and keyfile
        # writer against a mocked NetworkManager.
        for path in ['etc/hive', 'etc/NetworkManager/system-connections', 'etc/sysctl.d', 'run', 'sys/class/net']:
            (self.root / path).mkdir(parents=True, exist_ok=True)
        for iface, mac in [('eth0', '02:00:00:00:00:10'), ('eth1', '02:00:00:00:00:11')]:
            net = self.root / 'sys/class/net' / iface
            (net / 'device').mkdir(parents=True)
            (net / 'address').write_text(mac + '\n')
            (net / 'operstate').write_text('up\n')
        (self.root / 'etc/hive/node-info').write_text('MAC=aabbccddeeff\n')
        (self.root / 'etc/hive/config.env').write_text('')
        (self.root / 'default-route').write_text(default_route)
        (self.root / 'nm-state.json').write_text(json.dumps(
            {'connections': {}, 'active': [], 'interfaces': ['eth0', 'eth1']}))
        for name in ['logger', 'chown']:
            self.mock(name, '#!/bin/sh\nexit 0\n')
        self.mock('ip', r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT'])
dev = (r/'default-route').read_text().strip()
args = sys.argv[1:]
if args[:3] == ['route', 'show', 'default'] and dev:
    print('default via 192.0.2.1 dev ' + dev)
elif '-4' in args and 'addr' in args and 'eth0' in args:
    print('2: eth0    inet 192.168.5.226/24 brd 192.168.5.255 scope global eth0')
elif '-4' in args and 'route' in args and 'show' in args and 'eth0' in args:
    print('192.168.5.0/24 proto kernel scope link src 192.168.5.226')
''')
        self.mock('iptables', r'''#!/bin/sh
echo "$@" >> "$HIVE_TEST_ROOT/iptables-calls"
case " $* " in *" -C "*) exit 1;; esac
exit 0
''')
        self.mock('sysctl', '#!/bin/sh\nexit 0\n')
        self.mock('nmcli', r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT']); args = sys.argv[1:]
state = json.loads((r/'nm-state.json').read_text())
def save(): (r/'nm-state.json').write_text(json.dumps(state))
with (r/'nm-calls').open('a') as out: out.write(' '.join(args)+'\n')
fields = ''
if '-t' in args: args.remove('-t')
if '-f' in args:
    i = args.index('-f'); fields = args[i+1]; del args[i:i+2]
if args[:2] == ['connection', 'show'] and len(args) == 2:
    for name, conn in state['connections'].items():
        if fields == 'NAME,DEVICE':
            print(name + ':' + conn.get('device', ''))
        elif fields == 'NAME':
            print(name)
    sys.exit(0)
if args[:2] == ['connection', 'show'] and len(args) == 3:
    conn = state['connections'][args[2]]
    if fields == 'ipv4.method':
        print('ipv4.method:' + conn['method'])
    elif fields == 'connection.interface-name':
        print('connection.interface-name:' + conn['iface'])
    sys.exit(0)
if args[:2] == ['connection', 'modify']:
    state['connections'][args[2]]['method'] = args[4]
    save(); sys.exit(0)
if args[:2] == ['connection', 'delete']:
    state['connections'].pop(args[2], None); save(); sys.exit(0)
if args[:2] == ['connection', 'up']:
    state['active'] = [args[2]]; save(); sys.exit(0)
if args == ['connection', 'reload']:
    sys.exit(0)
if args == ['device', 'status']:
    print('\n'.join(state['interfaces']))
    sys.exit(0)
sys.exit(1)
''')
        source = (BIN / 'hive-gateway.sh').read_text()
        for path in ['/etc/NetworkManager/system-connections', '/etc/hive', '/etc/sysctl.d', '/run/', '/sys/class/net']:
            source = source.replace(path, str(self.root) + path)
        return source

    def test_gateway_drops_lan_profile_from_the_former_lan_port(self):
        # A profile left on a port that later became WAN keeps method=shared and
        # autoconnect-priority=50; NM would turn the upstream port into a shared
        # gateway on the next boot and take the node offline.
        source = self.gateway_fixture(default_route='eth1')
        keyfiles = self.root / 'etc/NetworkManager/system-connections'
        stale = keyfiles / 'hive-lan-eth1.nmconnection'
        stale.write_text('[connection]\nid=hive-lan-eth1\ninterface-name=eth1\n\n[ipv4]\nmethod=shared\n')
        (self.root / 'nm-state.json').write_text(json.dumps({
            'connections': {'hive-lan-eth1': {'iface': 'eth1', 'device': '', 'method': 'shared'}},
            'active': [], 'interfaces': ['eth0', 'eth1']}))

        self.run_script(source)

        self.assertFalse(stale.exists())
        self.assertTrue((keyfiles / 'hive-lan-eth0.nmconnection').exists())
        connections = json.loads((self.root / 'nm-state.json').read_text())['connections']
        self.assertNotIn('hive-lan-eth1', connections)
        self.assertIn('connection delete hive-lan-eth1', (self.root / 'nm-calls').read_text())
        info = (self.root / 'etc/hive/node-info').read_text()
        self.assertIn('GATEWAY_WAN_IFACE=eth1', info)
        self.assertIn('GATEWAY_LAN_IFACES=eth0', info)

    def test_gateway_fixes_wan_profile_that_is_not_active(self):
        # At boot the WAN has no default route yet, so its profile is inactive.
        # Looking it up by DEVICE found nothing and a method=shared profile kept
        # the upstream port configured as a gateway.
        source = self.gateway_fixture(default_route='eth0')
        (self.root / 'nm-state.json').write_text(json.dumps({
            'connections': {'Wired connection 1': {'iface': 'eth0', 'device': '', 'method': 'shared'}},
            'active': [], 'interfaces': ['eth0', 'eth1']}))

        self.run_script(source)

        connections = json.loads((self.root / 'nm-state.json').read_text())['connections']
        self.assertEqual(connections['Wired connection 1']['method'], 'auto')

    def test_single_wired_node_is_not_turned_into_a_bypass_gateway(self):
        # One-arm (bypass) gateway is WIP: a single wired NIC must stay a plain
        # node, and leftovers from the withdrawn implementation must be removed
        # so the node does not keep forwarding/NATing for its L2 peers.
        source = self.gateway_fixture()
        shutil.rmtree(self.root / 'sys/class/net/eth1')
        (self.root / 'nm-state.json').write_text(json.dumps({
            'connections': {}, 'active': [], 'interfaces': ['eth0']}))
        (self.root / 'etc/sysctl.d/99-hive-one-arm.conf').write_text('net.ipv4.ip_forward=1\n')
        (self.root / 'etc/hive/node-info').write_text(
            'MAC=aabbccddeeff\n'
            'GATEWAY_ONE_ARM_IFACE=eth0\n'
            'GATEWAY_ONE_ARM_IP=192.168.5.226\n'
            'GATEWAY_ONE_ARM_NET=192.168.5.0/24\n')
        # The leftover rules exist: -C succeeds until the matching -D runs, so the
        # cleanup loops terminate instead of spinning forever.
        self.mock('iptables', r'''#!/bin/sh
root="$HIVE_TEST_ROOT"
echo "$@" >> "$root/iptables-calls"
key=$(printf '%s' "$*" | sed 's/ -[CD] / /' | cksum | cut -d' ' -f1)
case " $* " in
  *" -C "*hive-one-arm*)
    [ -e "$root/del.$key" ] && exit 1
    exit 0 ;;
  *" -D "*hive-one-arm*)
    touch "$root/del.$key"
    exit 0 ;;
  *" -C "*) exit 1 ;;
esac
exit 0
''')

        result = self.run_script(source)

        self.assertIn('WIP', result.stdout)
        info = (self.root / 'etc/hive/node-info').read_text()
        self.assertNotIn('GATEWAY_ONE_ARM_', info)
        self.assertNotIn('GATEWAY_LAN_IFACES=', info)
        self.assertFalse((self.root / 'etc/sysctl.d/99-hive-one-arm.conf').exists())
        self.assertFalse((self.root / 'etc/NetworkManager/system-connections/'
                                     'hive-lan-eth0.nmconnection').exists())
        calls = (self.root / 'iptables-calls').read_text()
        self.assertIn('-D FORWARD -i eth0 -m comment --comment hive-one-arm-in -j ACCEPT', calls)
        self.assertIn('-D FORWARD -o eth0 -m comment --comment hive-one-arm-out -j ACCEPT', calls)
        self.assertIn('-t nat -D POSTROUTING -s 192.168.5.0/24 -o eth0 '
                      '-m comment --comment hive-one-arm-nat -j MASQUERADE', calls)
        self.assertNotIn('-I FORWARD', calls)
        self.assertNotIn('-A POSTROUTING', calls)

    def test_single_wired_node_with_wireless_keeps_the_hotspot_path(self):
        # One wired NIC *plus* a wireless card is not the WIP bypass case: it is
        # the normal WiFi hotspot topology and must not be reported as one.
        source = self.gateway_fixture()
        shutil.rmtree(self.root / 'sys/class/net/eth1')
        wlan = self.root / 'sys/class/net/wlan0'
        (wlan / 'phy80211').mkdir(parents=True)
        (wlan / 'device').mkdir(parents=True)
        (wlan / 'address').write_text('02:00:00:00:00:01\n')
        (wlan / 'operstate').write_text('up\n')
        (self.root / 'nm-state.json').write_text(json.dumps({
            'connections': {}, 'active': [], 'interfaces': ['eth0', 'wlan0']}))

        result = self.run_script(source)

        self.assertIn('WiFi 热点下游走原有网关路径', result.stdout)
        self.assertNotIn('WIP', result.stdout)
        info = (self.root / 'etc/hive/node-info').read_text()
        self.assertNotIn('GATEWAY_', info)
        self.assertFalse((self.root / 'etc/sysctl.d/99-hive-one-arm.conf').exists())
        calls = (self.root / 'iptables-calls').read_text() if (self.root / 'iptables-calls').exists() else ''
        self.assertNotIn('-I FORWARD', calls)
        self.assertNotIn('-A POSTROUTING', calls)

    def test_gateway_prunes_lan_profiles_after_a_port_disappears(self):
        # A removed USB NIC or a switch back to a single port leaves keyfiles
        # bound to an interface that no longer exists; NM may still activate one
        # and give that port a shared 10.42.2.1/24.
        source = self.gateway_fixture()
        keyfiles = self.root / 'etc/NetworkManager/system-connections'
        stale = keyfiles / 'hive-lan-eth1.nmconnection'
        stale.write_text('[connection]\nid=hive-lan-eth1\ninterface-name=eth1\n\n[ipv4]\nmethod=shared\n')
        (self.root / 'nm-state.json').write_text(json.dumps({
            'connections': {'hive-lan-eth1': {'iface': 'eth1', 'device': '', 'method': 'shared'}},
            'active': [], 'interfaces': ['eth0']}))
        shutil.rmtree(self.root / 'sys/class/net/eth1')

        self.run_script(source)

        self.assertFalse(stale.exists())
        self.assertNotIn('hive-lan-eth1',
                         json.loads((self.root / 'nm-state.json').read_text())['connections'])

    def test_firewall_fails_when_a_concurrent_writer_dropped_rules(self):
        # ufw rewrites /etc/ufw/user.rules on every command, so a second writer
        # (hive-hotspot at first boot, live-verified on hardware) can drop rules
        # that setup-firewall.sh already added. Leaving that state behind means
        # SSH is open to the world and Prometheus cannot scrape 9100, so the unit
        # must fail and let the next boot retry instead of reporting success.
        (self.root / 'etc/hive').mkdir(parents=True)
        (self.root / 'etc/hive/config.env').write_text('')
        self.env['UFW_LOCK'] = str(self.root / 'ufw.lock')
        for name in ['ip', 'iptables', 'ip6tables', 'sysctl', 'getent', 'curl',
                     'logger', 'conntrack']:
            self.mock(name, '#!/bin/sh\nexit 0\n')
        self.mock('ufw', r'''#!/bin/sh
case "$1 $2" in
  "show added") printf '%s\n' "ufw allow in on lo";;
esac
exit 0
''')
        source = (BIN / 'setup-firewall.sh').read_text()
        source = source.replace('/etc/hive/', str(self.root / 'etc/hive') + '/')

        result = self.run_script(source, 1)

        self.assertIn('Node Exporter - EasyTier', result.stderr)
        self.assertIn('关键防火墙规则仍未生效', result.stderr)

    def test_provisioning_budget_uses_monotonic_uptime_not_wall_clock(self):
        # First boot on hardware: the RTC is unreadable and NTP jumps the clock from
        # the image build time to now after enrollment. bash's SECONDS then reports
        # 5666s for a couple of minutes of work and aborts provisioning. The budget
        # must be a /proc/uptime delta, independent of SECONDS and of clock jumps.
        text = (BIN / 'provision-node.sh').read_text()
        snippet = ('PROVISION_START_UPTIME=1000\n'
                   + text[text.index('PROVISION_BUDGET='):text.index('# 等待网络就绪')])
        uptime = self.root / 'uptime'
        uptime.write_text('1005.00 2000.00\n')
        snippet = snippet.replace('/proc/uptime', str(uptime))

        still_running = snippet + '''
export SECONDS=999999
PROVISION_BUDGET=600
budget_exceeded "cloudflare"
echo "still-running"
'''
        self.assertEqual(self.run_script(still_running).stdout.strip(), 'still-running')

        uptime.write_text('1700.00 2700.00\n')
        expired = snippet + '''
export SECONDS=5
PROVISION_BUDGET=600
budget_exceeded "cloudflare"
echo "must-not-continue"
'''
        result = self.run_script(expired, 1)
        self.assertIn('超出时间预算', result.stdout)
        self.assertNotIn('must-not-continue', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
