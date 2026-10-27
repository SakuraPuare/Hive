#!/usr/bin/env python3
"""Isolated behavior tests. Never runs commands against the host's device files."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[1]
BIN = REPO / 'armbian-build/userpatches/overlay/usr/local/bin'


class DeviceRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hive-regression-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['etc/hive', 'etc/ssh', 'var/lib/hive', 'run', 'tmp', 'mock']:
            (self.root / name).mkdir(parents=True)
        self.node_info = self.root / 'hive-node-info'
        shutil.copyfile(BIN / 'hive-node-info', self.node_info)
        self.node_info.chmod(0o755)
        self.env = dict(os.environ, HIVE_TEST_ROOT=str(self.root),
                        PATH=str(self.root / 'mock') + ':' + os.environ['PATH'])
        (self.root / 'etc/hive/config.env').write_text('NODE_REGISTRY_URL=https://test.invalid\nNODE_REGISTRY_API_SECRET=test-token\n')
        (self.root / 'etc/hive/node-info').write_text('MAC=aabbccddeeff\n')
        self.mock('logger', '#!/bin/sh\nexit 0\n')
        self.mock('chown', '#!/bin/sh\nexit 0\n')
        self.mock('systemctl', '#!/bin/sh\n[ "$1" != show ] || echo 123\nexit 0\n')
        self.mock('curl', '''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
r=Path(os.environ['HIVE_TEST_ROOT']);args=sys.argv[1:];url=args[-1]
if url.endswith('/xray-users'):
    print((r/'desired.json').read_text())
elif url.endswith('/ota-version'):
    print((r/'assignment.json').read_text())
elif url.endswith('/ota-ack'):
    payload=Path(args[args.index('--data-binary')+1][1:]).read_text()
    with (r/'acks').open('a') as f:f.write(json.dumps(json.loads(payload))+'\\n')
    if (r/'fail-ack').exists():sys.exit(22)
else:
    shutil.copyfile(r/'bundle.tar.gz',args[args.index('-o')+1])
''')
        self.mock('xray', '''#!/usr/bin/env python3
import os,sys
from pathlib import Path
r=Path(os.environ['HIVE_TEST_ROOT']);action=sys.argv[2]
with (r/'xray-calls').open('a') as f:f.write(action+'\\n')
flag=r/('fail-'+action)
if flag.exists():flag.unlink();sys.exit(1)
''')

    def mock(self, name, body):
        path = self.root / 'mock' / name
        path.write_text(body)
        path.chmod(0o755)

    def script(self, name):
        if name in ['hive-updater', 'hive-firmware']:
            self.script('hive-ota-transaction')
            self.script('hive-board')
        text = (BIN / name).read_text()
        for helper in ['hive-ota-transaction', 'hive-firmware', 'hive-board']:
            text = text.replace('/usr/local/bin/' + helper, str(self.root / helper))
        text = text.replace('OTA_ROOT=""', 'OTA_ROOT="' + str(self.root) + '"')
        text = text.replace('/usr/local/bin/hive-node-info', str(self.node_info))
        for prefix in ['/etc/hive', '/etc/ssh', '/var/lib/hive', '/run', '/tmp/hive-ota', '/tmp/hive-xray-adu']:
            pattern = rf'(?<![A-Za-z0-9_.-]){re.escape(prefix)}(?=$|[/\s"\'])'
            text = re.sub(pattern, str(self.root) + prefix, text)
        text = text.replace('dest="/${fpath}"', 'dest="' + str(self.root) + '/${fpath}"')
        path = self.root / name
        path.write_text(text)
        return path

    def run_script(self, script, *args, expected=0):
        result = subprocess.run(['bash', str(script), *args], env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def bundle(self):
        payload = self.root / 'payload'
        (payload / 'files/etc').mkdir(parents=True)
        data = b'installed safely\n'
        (payload / 'files/etc/test-app').write_bytes(data)
        manifest = {'health_grace_seconds': 0, 'health_timeout_seconds': 1, 'version': '1.0', 'files': [{'path': 'etc/test-app', 'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0644'}]}
        (payload / 'manifest.json').write_text(json.dumps(manifest))
        key = self.root / 'signing.pem'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(key)], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(key), '-pubout', '-out', str(self.root / 'etc/hive/ota-pubkey.pem')], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(key), '-rawin', '-in', str(payload / 'manifest.json'), '-out', str(payload / 'manifest.sig')], check=True, capture_output=True)
        with tarfile.open(self.root / 'bundle.tar.gz', 'w:gz') as archive:
            archive.add(payload, arcname='bundle')
        sha = hashlib.sha256((self.root / 'bundle.tar.gz').read_bytes()).hexdigest()
        assignment = {'version': '1.0', 'sha256': sha, 'url': 'https://test.invalid/bundle', 'assignment_token': 'first'}
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        return assignment

    def test_node_info_never_executes_customer_input(self):
        proof = self.root / 'executed'
        psk = '$(touch ' + str(proof) + ')'
        info = self.root / 'etc/hive/node-info'
        info.write_text('MAC=aabbccddeeff\nWIFI_PSK=' + psk + '\nPATH=/untrusted\n')
        script = self.root / 'read-info'
        script.write_text('source "' + str(BIN / 'hive-node-info') + '"\nhive_load_node_info "$1"\nprintf "%s" "$WIFI_PSK"\n')
        self.assertEqual(self.run_script(script, str(info)).stdout, psk)
        self.assertFalse(proof.exists())
        # Run the actual hotspot state writer on an SSID/PSK with shell syntax.
        source = (BIN / 'hive-hotspot.sh').read_text()
        writer = source[source.index('# ── 7.'):source.index('# ── 8.')].replace('/etc/hive', str(self.root / 'etc/hive'))
        script.write_text('NODE_INFO="$1"; PSK="$2"; SSID_2G="$(printf %s \'x;y $HOME\')"; DONE_2G=wlan0; DONE_5G=""; NODE_MAC=aabbccddeeff\n' + writer)
        self.run_script(script, str(info), psk)
        loader = self.root / 'load-written'
        loader.write_text('source "$1"\nprintf "%s" "$WIFI_PSK"\n')
        self.assertEqual(self.run_script(loader, str(info)).stdout, psk)
        self.assertFalse(proof.exists())

    def test_random_hotspot_secret_persists(self):
        source = (BIN / 'hive-hotspot.sh').read_text()
        source = source[source.index('# Persist independently'):source.index('mkuuid()')]
        source = source.replace('/etc/hive', str(self.root / 'etc/hive'))
        script = self.root / 'psk'
        script.write_text(source + '\nprintf "%s" "$PSK"\n')
        first = self.run_script(script).stdout
        second = self.run_script(script).stdout
        self.assertEqual(first, second)
        self.assertEqual(len(first), 32)
        legacy = hashlib.sha256(b'hive-wifi-psk:aabbccddeeff').hexdigest()[:16]
        self.assertNotEqual(first, legacy)

    def test_ssh_host_key_rotation_is_random_and_idempotent(self):
        self.mock('ssh-keygen', '#!/bin/sh\n[ "$1" != -A ] || exit 0\nexec /usr/bin/ssh-keygen "$@"\n')
        script = self.script('hive-regen-hostkeys.sh')
        key = self.root / 'etc/ssh/ssh_host_ed25519_key'
        self.run_script(script)
        first = key.read_bytes()
        self.run_script(script)
        self.assertEqual(key.read_bytes(), first)
        (self.root / 'etc/hive/random-hostkeys-v1').unlink()
        self.run_script(script)
        self.assertNotEqual(key.read_bytes(), first)

    def test_ota_ack_retries_and_same_bundle_is_acknowledged(self):
        assignment = self.bundle()
        script = self.script('hive-updater')
        (self.root / 'fail-ack').touch()
        self.run_script(script, expected=1)
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')
        receipt = self.root / 'var/lib/hive/ota-pending-ack.json'
        self.assertTrue(receipt.exists())
        (self.root / 'fail-ack').unlink()
        self.run_script(script)
        self.assertFalse(receipt.exists())
        assignment['assignment_token'] = 'second'
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        (self.root / 'bundle.tar.gz').unlink()  # no download needed for the same SHA
        self.run_script(script)
        acks = [json.loads(line) for line in (self.root / 'acks').read_text().splitlines()]
        self.assertEqual(acks[-1]['assignment_token'], 'second')
        self.assertEqual(acks[-1]['status'], 'done')

    def test_ota_lock_precedes_cleanup(self):
        import fcntl
        self.bundle()
        script = self.script('hive-updater')
        lock = (self.root / 'var/lib/hive/ota.lock').open('w')
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sentinel = self.root / 'tmp/hive-ota-other'
        sentinel.mkdir(); (sentinel / 'sentinel').touch()
        self.run_script(script, expected=75)
        self.assertTrue((sentinel / 'sentinel').exists())

    def test_ota_rejects_invalid_signature(self):
        assignment = self.bundle()
        manifest = self.root / 'payload/manifest.json'
        manifest.write_text(manifest.read_text().replace('1.0', '2.0'))
        with tarfile.open(self.root / 'bundle.tar.gz', 'w:gz') as archive:
            archive.add(self.root / 'payload', arcname='bundle')
        assignment.update(version='2.0', sha256=hashlib.sha256((self.root / 'bundle.tar.gz').read_bytes()).hexdigest())
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_ota_rejects_archive_links_before_extraction(self):
        assignment = self.bundle()
        with tarfile.open(self.root / 'bundle.tar.gz', 'w:gz') as archive:
            link = tarfile.TarInfo('bundle/escape')
            link.type = tarfile.SYMTYPE
            link.linkname = str(self.root)
            archive.addfile(link)
        assignment['sha256'] = hashlib.sha256((self.root / 'bundle.tar.gz').read_bytes()).hexdigest()
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('拒绝解压', result.stdout)
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_default_bundle_excludes_personalized_configuration(self):
        # Relocate the real builder, keeping its overlay input and isolating output.
        source = (REPO / 'scripts/build-ota.sh').read_text()
        source = source.replace('ROOT_DIR="$(dirname "$SCRIPT_DIR")"', 'ROOT_DIR="' + str(REPO) + '"')
        source = source.replace('OUTPUT_DIR="${ROOT_DIR}/output/ota"', 'OUTPUT_DIR="' + str(self.root / 'output') + '"')
        script = self.root / 'build-ota'
        script.write_text(source)
        self.run_script(script, 'regression', '--no-sign')
        archive_path = next((self.root / 'output').glob('*.tar.gz'))
        with tarfile.open(archive_path) as archive:
            names = archive.getnames()
        self.assertTrue(any('/usr/local/bin/hive-updater' in name for name in names))
        with tarfile.open(archive_path) as archive:
            manifest_name = next(n for n in archive.getnames() if n.endswith('/manifest.json'))
            manifest = json.load(archive.extractfile(manifest_name))
        self.assertIn('hive-subscription-guard.timer', manifest['enable_services'])
        self.assertEqual(manifest['restart_services'][0], 'hive-subscription-guard.timer')
        for prefix in ['etc/xray/', 'etc/mihomo/', 'etc/hive/', 'etc/ssh/', 'etc/frp/']:
            self.assertFalse(any('/files/' + prefix in name for name in names), prefix)

    def test_deploy_and_rollback_replace_running_executable(self):
        live = self.root / 'registry'
        helper = self.root / 'running-helper'
        helper.write_text('#!/usr/bin/env python3\nimport time\nwhile True: time.sleep(1)\n')
        helper.chmod(0o755)
        shutil.copyfile(helper, live); live.chmod(0o755)
        process = subprocess.Popen([str(live)])

        def stop_process():
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)

        self.addCleanup(stop_process)
        time.sleep(0.2)
        backup = self.root / 'backup'; backup.mkdir()
        shutil.copyfile('/usr/bin/true', backup / 'hive-registry')
        shutil.copyfile('/usr/bin/true', self.root / 'hive-registry')
        for name in ['deploy.sh', 'rollback.sh']:
            source = (REPO / 'management/scripts' / name).read_text()
            start = source.index('registry_tmp=$(mktemp')
            end = source.index('mv -f "${registry_tmp}" "${REGISTRY_BIN}"', start)
            block = source[start:end] + 'mv -f "${registry_tmp}" "${REGISTRY_BIN}"\n'
            script = self.root / ('test-' + name)
            script.write_text('set -e\ncd "' + str(self.root) + '"\nREGISTRY_BIN="' + str(live) + '"\nBACKUP_DIR="' + str(backup) + '"\n' + block)
            self.run_script(script)
            self.assertEqual(live.read_bytes(), Path('/usr/bin/true').read_bytes())
        self.assertIsNone(process.poll())


if __name__ == '__main__':
    unittest.main(verbosity=2)
