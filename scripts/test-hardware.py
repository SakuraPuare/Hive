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
            self.assertIn('resize2fs /dev/mmcblk0p2', calls)
            self.assertNotIn('-N 1', calls)

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

    def test_every_external_call_in_provisioning_is_bounded(self):
        # provisioning talks to Cloudflare, Tailscale and the registry on the
        # node's first boot. An unbounded curl hangs until systemd kills the
        # unit, and a killed oneshot never writes the provisioned marker, so the
        # whole flow replays on every boot.
        source = (BIN / 'provision-node.sh').read_text()
        joined = re.sub(r'\\\n\s*', ' ', source)
        unbounded = [line.strip() for line in joined.splitlines()
                     if 'curl ' in line and '--max-time' not in line and '--connect-timeout' not in line]
        self.assertEqual(unbounded, [])

    def test_bare_curl_calls_cannot_abort_provisioning(self):
        # set -e is active. A curl that is neither captured nor guarded aborts
        # the script on any non-zero exit, before the diagnostic stages run.
        source = (BIN / 'provision-node.sh').read_text()
        for number, line in enumerate(source.splitlines(), 1):
            if not re.match(r'\s+curl ', line):
                continue
            block = '\n'.join(source.splitlines()[number - 1:number + 8])
            captured = '=$(' in source.splitlines()[number - 2] if number > 1 else False
            guarded = re.search(r'\|\|\s*(true|echo|\{)', block)
            self.assertTrue(captured or guarded, f'line {number} aborts provisioning: {line.strip()}')

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
        self.assertEqual((plan['root_mib'], plan['data_mib']), ('4096', '512'))
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
with (Path(os.environ['HIVE_TEST_ROOT'])/'ip-calls').open('a') as out:
    out.write(' '.join(sys.argv[1:])+'\n')
''')
        for name in ['hive-command-agent', 'hive-hotspot.sh', 'hive-node-info']:
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

    def gateway_fixture(self, default_route=''):
        # Relocate paths only; run the production WAN/LAN selection and keyfile
        # writer against a mocked NetworkManager.
        for path in ['etc/hive', 'etc/NetworkManager/system-connections', 'run', 'sys/class/net']:
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
''')
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
        for path in ['/etc/NetworkManager/system-connections', '/etc/hive', '/run/', '/sys/class/net']:
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
