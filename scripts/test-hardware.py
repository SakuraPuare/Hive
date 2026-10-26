#!/usr/bin/env python3
"""Board detection, memory profiles and TF growth using isolated fake devices."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
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
            self.assertEqual(result.stdout.strip(), f'{board}:{board}-ab-v1')
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
        start = 32768 + 2*4096*2048
        size = (capacity//512-34-start)//2048*2048 if expanded else 8192*2048
        layout = {'partitiontable': {'label':'gpt','sectorsize':512,'partitions':[
            {'name':'hive-rootA','start':32768,'size':4096*2048},
            {'name':'hive-rootB','start':32768+4096*2048,'size':4096*2048},
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
    assert args[args.index('-N')+1] == '3'
    (r/'size').write_text(sys.stdin.read().strip().split('=')[1])
''')
        self.mock('blockdev', '''#!/bin/sh
case "$2" in *p3) cat "$HIVE_TEST_ROOT/size";; *) cat "$HIVE_TEST_ROOT/capacity";; esac
''')
        self.mock('findmnt', '#!/bin/sh\nexit 1\n')
        for tool in ['partx','sync','e2fsck','resize2fs']:
            self.mock(tool, '#!/bin/sh\necho "'+tool+' $*" >> "$HIVE_TEST_ROOT/calls"\n')
        return (BIN/'hive-data-grow').read_text()

    def test_32gb_and_64gb_grow_only_data_partition(self):
        for capacity in [32_000_000_000,64_000_000_000]:
            source = self.fixture_growth(capacity)
            self.run_script(source, 0, '/dev/mmcblk0')
            new_size = int((self.root/'size').read_text())
            self.assertGreater(new_size,8192*2048)
            self.assertLessEqual((32768+8192*2048+new_size+34)*512, capacity)
            calls = (self.root/'calls').read_text()
            self.assertIn('-N 3 /dev/mmcblk0', calls)
            self.assertIn('resize2fs /dev/mmcblk0p3', calls)
            self.assertNotIn('-N 1', calls)
            self.assertNotIn('-N 2', calls)

    def test_growth_resumes_filesystem_resize_after_gpt_write(self):
        source = self.fixture_growth(expanded=True)
        self.run_script(source, 0, '/dev/mmcblk0')
        calls = (self.root/'calls').read_text()
        self.assertNotIn('-N', calls)
        self.assertIn('partx --update --nr 3', calls)
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
        sfdisk(data='label: gpt\nstart=32768,size=16384,name="hive-rootA"\nsize=16384,name="hive-rootB"\nsize=32768,name="hive-data"\n')
        before = json.loads(sfdisk('--json'))['partitiontable']['partitions']
        with image.open('r+b') as f: f.truncate(96*1024**2)
        sfdisk('--no-reread','--no-tell-kernel','--relocate','gpt-bak-std')
        sfdisk('--no-reread','--no-tell-kernel','-N','3',data='size=100000\n')
        after = json.loads(sfdisk('--json'))['partitiontable']['partitions']
        self.assertEqual(before[:2],after[:2])
        self.assertEqual(before[2]['uuid'],after[2]['uuid'])
        self.assertEqual(before[2]['start'],after[2]['start'])
        self.assertEqual(after[2]['size'],100000)

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

    def test_boot_policy_contains_matching_kernel_dtb(self):
        for board, dtb in [('nanopi-zero2','rk3528-nanopi-zero2.dtb'), ('nanopi-r28s','rk3528-nanopi-rev03.dtb')]:
            text = subprocess.check_output([str(REPO/'scripts/render-ab-boot.sh'),board],text=True)
            self.assertIn('/boot/dtb/rockchip/'+dtb,text)
            self.assertIn('${hive_slot}',text)  # Not expanded by the host shell.


if __name__ == '__main__':
    unittest.main(verbosity=2)
