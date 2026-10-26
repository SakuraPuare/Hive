#!/usr/bin/env python3
"""OTA failure injection in temporary directories. Never accesses block devices."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import unittest
import sys
import importlib.util

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('device_regression', Path(__file__).with_name('test-remediation.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class OTATests(base.DeviceRegressionTests):
    def repack(self, manifest):
        payload = self.root / 'payload'
        (payload / 'manifest.json').write_text(json.dumps(manifest))
        subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(self.root / 'signing.pem'),
                        '-rawin', '-in', str(payload / 'manifest.json'), '-out', str(payload / 'manifest.sig')], check=True, capture_output=True)
        with tarfile.open(self.root / 'bundle.tar.gz', 'w:gz') as archive:
            archive.add(payload, arcname='bundle')
        assignment = json.loads((self.root / 'assignment.json').read_text())
        assignment['sha256'] = hashlib.sha256((self.root / 'bundle.tar.gz').read_bytes()).hexdigest()
        (self.root / 'assignment.json').write_text(json.dumps(assignment))

    def failure_bundle(self, hook='post-install.sh'):
        self.bundle()
        (self.root / 'etc/test-app').write_text('old version\n')
        (self.root / 'etc/test-app').chmod(0o600)
        (self.root / 'etc/hive/ota-version').write_text('previous\n')
        payload = self.root / 'payload'
        (payload / 'hooks').mkdir()
        script = b'exit 1\n'
        (payload / 'hooks' / hook).write_bytes(script)
        manifest = json.loads((payload / 'manifest.json').read_text())
        key = 'post_install_sha256' if hook == 'post-install.sh' else 'health_check_sha256'
        manifest['hooks'] = {key: hashlib.sha256(script).hexdigest()}
        data = b'new file\n'
        (payload / 'files/etc/new-file').write_bytes(data)
        manifest['files'].append({'path': 'etc/new-file', 'sha256': hashlib.sha256(data).hexdigest()})
        self.repack(manifest)

    def assert_rolled_back(self):
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'old version\n')
        self.assertEqual((self.root / 'etc/test-app').stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / 'etc/new-file').exists())
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), 'previous\n')
        self.assertFalse((self.root / 'var/lib/hive/ota-installed.json').exists())
        self.assertEqual(json.loads((self.root / 'acks').read_text().splitlines()[-1])['status'], 'rolled_back')

    def test_post_hook_failure_restores_entire_application(self):
        self.failure_bundle()
        self.run_script(self.script('hive-updater'), expected=1)
        self.assert_rolled_back()

    def test_health_failure_restores_entire_application(self):
        self.failure_bundle('health-check.sh')
        self.run_script(self.script('hive-updater'), expected=1)
        self.assert_rolled_back()

    def test_service_failure_restores_previous_service_files(self):
        self.bundle()
        app = self.root / 'etc/test-app'
        app.write_text('old version\n')
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['restart_services'] = ['test.service']
        self.repack(manifest)
        self.mock('systemctl', '''#!/bin/sh
if [ "$1" = restart ]; then
    cat "$HIVE_TEST_ROOT/etc/test-app" >> "$HIVE_TEST_ROOT/restarts"
    [ "$(cat "$HIVE_TEST_ROOT/etc/test-app")" = 'old version' ]
else exit 0; fi
''')
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertEqual(app.read_text(), 'old version\n')
        self.assertEqual((self.root / 'restarts').read_text().splitlines(), ['installed safely', 'old version'])

    def test_interrupted_write_is_recovered_by_saved_engine(self):
        self.bundle()
        app = self.root / 'etc/test-app'
        app.write_text('old version\n')
        self.mock('mv', '''#!/usr/bin/env python3
import os, subprocess, sys, signal
subprocess.run(['/bin/mv', *sys.argv[1:]], check=True)
if sys.argv[-1] == os.environ['HIVE_TEST_ROOT'] + '/etc/test-app':
    os.kill(os.getppid(), signal.SIGKILL)
''')
        self.run_script(self.script('hive-updater'), expected=-9)
        self.assertEqual(app.read_text(), 'installed safely\n')
        (self.root / 'mock/mv').unlink()
        saved = self.root / 'var/lib/hive/ota-transaction/recover.sh'
        self.assertTrue(saved.exists())
        # Simulate a broken replacement updater; boot recovery needs neither it
        # nor any files from the downloaded update.
        (self.root / 'hive-updater').write_text('exit 42\n')
        self.run_script(saved)
        self.assertEqual(app.read_text(), 'old version\n')
        ack = json.loads((self.root / 'var/lib/hive/ota-pending-ack.json').read_text())
        self.assertEqual(ack['status'], 'rolled_back')
        self.assertFalse(saved.parent.exists())

    def test_symlink_destination_rejected_without_modification(self):
        self.bundle()
        target = self.root / 'outside'
        target.write_text('unchanged')
        (self.root / 'etc/test-app').symlink_to(target)
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertEqual(target.read_text(), 'unchanged')

    def test_unsigned_health_hook_is_rejected(self):
        self.bundle()
        (self.root / 'payload/hooks').mkdir()
        (self.root / 'payload/hooks/health-check.sh').write_text('exit 0\n')
        self.repack(json.loads((self.root / 'payload/manifest.json').read_text()))
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_hosted_download_sends_auth_only_to_registry(self):
        assignment = self.bundle()
        assignment['url'] = '/nodes/aabbccddeeff/ota-bundle/' + assignment['sha256']
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        curl = self.root / 'mock/curl'
        source = curl.read_text().replace("else:\n    shutil.copyfile", "else:\n    (r/'download-args').write_text(json.dumps(args))\n    shutil.copyfile")
        curl.write_text(source)
        self.run_script(self.script('hive-updater'))
        args = json.loads((self.root / 'download-args').read_text())
        self.assertIn('Authorization: Bearer test-token', args)
        self.assertNotIn('-L', args)


class FirmwareTests(unittest.TestCase):
    board = "nanopi-zero2"
    setUp = base.DeviceRegressionTests.setUp
    mock = base.DeviceRegressionTests.mock
    script = base.DeviceRegressionTests.script
    run_script = base.DeviceRegressionTests.run_script

    def firmware_fixture(self):
        tree = self.root / 'image-tree/usr/lib/hive'
        tree.mkdir(parents=True)
        (tree / 'ab-layout').write_text(self.board + '-ab-v1\n')
        (tree / 'firmware-version').write_text('2.0\n')
        payload = self.root / 'firmware'
        (payload / 'files').mkdir(parents=True)
        image = payload / 'files/rootfs.img'
        with image.open('wb') as f: f.truncate(16 * 1024**2)
        subprocess.run(['mkfs.ext4', '-q', '-F', '-d', str(self.root / 'image-tree'), str(image)], check=True, capture_output=True)
        manifest = {'kind': 'firmware', 'board': self.board, 'layout': self.board + '-ab-v1', 'version': '2.0',
                    'files': [{'path': 'rootfs.img', 'sha256': hashlib.sha256(image.read_bytes()).hexdigest()}]}
        (payload / 'manifest.json').write_text(json.dumps(manifest))
        with (self.root / 'inactive-slot').open('wb') as f: f.truncate(32 * 1024**2)
        (self.root / 'active-slot').write_bytes(b'current system must remain unchanged')
        (self.root / 'etc/hive/ota-version').write_text('1.0\n')
        (self.root / 'var/lib/hive/ota-installed.json').write_text('{"version":"1.0","sha256":"old"}')
        (self.root / 'etc/hive/device-token').write_text('test-token')
        (self.root / 'assignment.json').write_text('{}')
        self.mock('blockdev', '#!/bin/sh\necho 33554432\n')
        self.mock('findmnt', '#!/bin/sh\nexit 1\n')
        self.mock('fw_printenv', '#!/bin/sh\n[ "$4" != hive_active ] || echo A\n')
        self.mock('fw_setenv', '#!/bin/sh\ncat "$4" >> "$HIVE_TEST_ROOT/environment-writes"\n')
        self.mock('dd', '#!/bin/sh\nexec /bin/dd "$@" conv=fsync,notrunc\n')
        helper = self.script('hive-ota-transaction')
        firmware = self.script('hive-firmware')
        firmware.write_text(firmware.read_text().replace('$(cat /usr/lib/hive/firmware-version)', '$(cat ' + str(tree / 'firmware-version') + ')'))
        runner = self.root / 'firmware-test'
        runner.write_text('set -uo pipefail\nexport TEST_BOARD=' + self.board + '\nsource "' + str(helper) + '"\nsource "' + str(firmware) + '"\n' + '''
firmware_layout() { hive_board_config "$TEST_BOARD"; FW_SLOT="${TEST_SLOT:-A}"; FW_OTHER=B; FW_TARGET="$HIVE_TEST_ROOT/inactive-slot"; }
log() { echo "$*"; }
flush_ack() { return 0; }
if [ "$1" = stage ]; then firmware_stage "$HIVE_TEST_ROOT/firmware" 2.0 new-sha assignment;
else firmware_confirm; fi
''')
        return runner

    def test_write_verified_before_boot_switch(self):
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        self.assertEqual((self.root / 'active-slot').read_bytes(), b'current system must remain unchanged')
        self.assertIn('hive_pending B\nhive_tries 3', (self.root / 'environment-writes').read_text())
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), '1.0\n')
        pending = json.loads((self.root / 'var/lib/hive/firmware-pending.json').read_text())
        self.assertEqual(pending['target'], 'B')

    def test_firmware_builder_produces_distinct_board_bundle(self):
        self.firmware_fixture()
        source = (base.REPO / 'scripts/build-ota.sh').read_text()
        source = source.replace('ROOT_DIR="$(dirname "$SCRIPT_DIR")"', 'ROOT_DIR="' + str(base.REPO) + '"')
        source = source.replace('OUTPUT_DIR="${ROOT_DIR}/output/ota"', 'OUTPUT_DIR="' + str(self.root / 'output') + '"')
        builder = self.root / 'build-ota'
        builder.write_text(source)
        self.run_script(builder, '2.0', '--firmware', str(self.root / 'firmware/files/rootfs.img'), '--no-sign')
        archive_path = self.root / ('output/hive-firmware-' + self.board + '-v2.0.tar.gz')
        with tarfile.open(archive_path) as archive:
            self.assertTrue(archive.getnames()[0].endswith('/manifest.json'))
            manifest = json.load(archive.extractfile(archive.getnames()[0]))
            self.assertEqual(manifest['kind'], 'firmware')
            self.assertEqual(manifest['board'], self.board)
            self.assertEqual(manifest['files'][0]['path'], 'rootfs.img')

    def test_failed_write_never_switches_boot_slot(self):
        runner = self.firmware_fixture()
        self.mock('dd', '#!/bin/sh\nexit 1\n')
        self.run_script(runner, 'stage', expected=1)
        self.assertFalse((self.root / 'environment-writes').exists())
        self.assertFalse((self.root / 'var/lib/hive/firmware-pending.json').exists())

    def test_readback_mismatch_never_switches_boot_slot(self):
        runner = self.firmware_fixture()
        self.mock('head', '#!/bin/sh\nprintf corrupted\n')
        self.run_script(runner, 'stage', expected=1)
        self.assertFalse((self.root / 'environment-writes').exists())

    def test_mounted_target_is_rejected(self):
        runner = self.firmware_fixture()
        self.mock('findmnt', '#!/bin/sh\nexit 0\n')
        self.run_script(runner, 'stage', expected=1)
        self.assertFalse((self.root / 'environment-writes').exists())

    def test_new_boot_is_confirmed_only_after_reboot_and_health_checks(self):
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        self.env['TEST_SLOT'] = 'B'
        self.run_script(runner, 'confirm', expected=1)  # Still the old boot ID.
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.run_script(runner, 'confirm')
        self.assertFalse(path.exists())
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), '2.0\n')
        self.assertIn('hive_active B', (self.root / 'environment-writes').read_text())
        self.assertEqual(json.loads((self.root / 'var/lib/hive/ota-pending-ack.json').read_text())['status'], 'done')

    def test_fallback_restores_old_receipt_and_reports_rollback(self):
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        (self.root / 'etc/hive/ota-version').write_text('2.0\n')
        self.run_script(runner, 'confirm')
        self.assertFalse(path.exists())
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), '1.0\n')
        self.assertEqual(json.loads((self.root / 'var/lib/hive/ota-pending-ack.json').read_text())['status'], 'rolled_back')


class R28SFirmwareTests(FirmwareTests):
    board = "nanopi-r28s"

    def test_zero2_manifest_is_rejected_before_writing(self):
        runner = self.firmware_fixture()
        path = self.root / 'firmware/manifest.json'
        manifest = json.loads(path.read_text())
        manifest.update(board='nanopi-zero2', layout='nanopi-zero2-ab-v1')
        path.write_text(json.dumps(manifest))
        self.run_script(runner, 'stage', expected=1)
        self.assertFalse((self.root / 'environment-writes').exists())
        self.assertEqual((self.root / 'inactive-slot').read_bytes(), bytes(32 * 1024**2))


class BootPolicyTests(unittest.TestCase):
    board = 'nanopi-zero2'

    def boot(self, state, fail_load=False, fail_save=False):
        # Execute the actual embedded Hush script using compatible Bash syntax;
        # substitute U-Boot commands, not the selection algorithm.
        script = subprocess.check_output([str(base.REPO / 'scripts/render-ab-boot.sh'), self.board], text=True)
        mock = r'''
setenv() { local key="$1"; shift; printf -v "$key" '%s' "$*"; }
setexpr() { printf -v "$1" '%s' "$((${2} - ${4}))"; }
fdt() {
    [ "$1" != get ] && return 0
    case "$3" in hive_bootpath|hive_sdpath) setenv "$3" /soc/mmc@ffc30000;; hive_emmcpath) setenv "$3" /soc/mmc@ffbf0000;; esac
}
mmc() { return 0; }
env() { return 0; }
part() { setenv hive_rootuuid test-uuid; }
load() { [ "$FAIL_LOAD" != 1 ] || [ "$hive_slot" != B ]; }
saveenv() {
    [ "$FAIL_SAVE" != 1 ] || return 1
    printf 'STATE:%s:%s:%s\n' "$hive_active" "${hive_pending:-}" "$hive_tries"
}
run() { eval "${!1}"; }
booti() { echo "BOOT:$hive_slot"; exit 0; }
reset() { echo RESET; exit 9; }
'''
        env = dict(os.environ, hive_active=state[0], hive_pending=state[1], hive_tries=str(state[2]),
                   FAIL_LOAD=str(int(fail_load)), FAIL_SAVE=str(int(fail_save)))
        result = subprocess.run(['bash'], input=mock+script, env=env, text=True, capture_output=True)
        states = [line.split(':')[1:] for line in result.stdout.splitlines() if line.startswith('STATE:')]
        booted = [line.split(':')[1] for line in result.stdout.splitlines() if line.startswith('BOOT:')]
        return (states[-1] if states else state), (booted[-1] if booted else None), result

    def test_unconfirmed_kernel_falls_back_after_three_attempts(self):
        state = ['A', 'B', '3']
        for remaining in [2, 1, 0]:
            state, slot, result = self.boot(state)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(slot, 'B')
            self.assertEqual(int(state[2]), remaining)
        state, slot, _ = self.boot(state)
        self.assertEqual(slot, 'A')
        self.assertEqual(state, ['A', '', '0'])

    def test_missing_new_kernel_falls_back_immediately(self):
        state, slot, _ = self.boot(['A', 'B', '3'], fail_load=True)
        self.assertEqual(slot, 'A')
        self.assertEqual(state, ['A', '', '0'])

    def test_confirmed_slot_boots_without_consuming_attempts(self):
        state, slot, _ = self.boot(['B', '', '0'])
        self.assertEqual(slot, 'B')
        self.assertEqual(state, ['B', '', '0'])

    def test_environment_failure_never_boots_unrecorded_trial(self):
        _, slot, result = self.boot(['A', 'B', '3'], fail_save=True)
        self.assertIsNone(slot)
        self.assertEqual(result.returncode, 9)


class R28SBootPolicyTests(BootPolicyTests):
    board = 'nanopi-r28s'


if __name__ == '__main__':
    unittest.main(verbosity=2)
