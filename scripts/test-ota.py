#!/usr/bin/env python3
"""OTA failure injection in temporary directories. Never accesses block devices."""
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import tarfile
import time
import unittest
import sys
import tempfile
import importlib.util

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('device_regression', Path(__file__).with_name('test-remediation.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class OTATests(base.DeviceRegressionTests):
    def test_both_copies_of_the_protected_list_agree(self):
        # build-ota.sh refuses these paths at packaging time and
        # hive-ota-transaction refuses them again at install time, because a
        # signed bundle does not pass through the builder. Two copies of the
        # same list drift: the identity list already lost two entries that way.
        paths = [
            'boot/Image', 'usr/lib/hive/ab-layout', 'usr/lib/modules/x.ko',
            'usr/lib/systemd/system/foo.service', 'usr/local/bin/hive-data',
            'usr/local/bin/hive-board', 'usr/local/bin/hive-firmware',
            'usr/local/bin/hive-ota-transaction',
            'var/lib/hive/ota-transaction/recover.sh',
            'etc/systemd/system/hive-data.service.d/override.conf',
            'etc/systemd/system/hive-ota-recover.service.wants/x.service',
            'etc/systemd/system/hive-firmware-confirm.service',
            'etc/systemd/system/xray.service', 'usr/local/bin/hive-updater',
            'etc/test-app', 'var/www/index.html',
        ]
        runtime = base.REPO / 'armbian-build/userpatches/overlay/usr/local/bin/hive-ota-transaction'
        builder = base.REPO / 'scripts/build-ota.sh'
        probe = '''
source_runtime() {{ . "{runtime}"; ota_protected_path "$1"; }}
source_builder() {{ eval "$(sed -n '/^ota_protected_path()/,/^}}/p' "{builder}")"; ota_protected_path "$1"; }}
for p in {paths}; do
    source_runtime "$p" && a=0 || a=1
    source_builder "$p" && b=0 || b=1
    [ "$a" = "$b" ] || {{ echo "disagree on $p: runtime=$a builder=$b"; exit 1; }}
done
'''.format(runtime=runtime, builder=builder, paths=' '.join(paths))
        result = subprocess.run(['bash', '-c', probe], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    def test_boot_critical_files_are_refused_before_install(self):
        self.bundle()
        payload = self.root / 'payload'
        (payload / 'files/usr/local/bin').mkdir(parents=True)
        data = b'#!/bin/sh\nexit 1\n'
        (payload / 'files/usr/local/bin/hive-data').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'usr/local/bin/hive-data',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0755'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('boot-critical', result.stderr)
        self.assertFalse((self.root / 'etc/test-app').exists())
        self.assertFalse((self.root / 'usr/local/bin/hive-data').exists())
        self.assertFalse((self.root / 'var/lib/hive/ota-transaction/active').exists())

    def test_ota_engine_cannot_replace_itself(self):
        # ota_prepare copies /usr/local/bin/hive-ota-transaction to recover.sh
        # for every transaction. A bundle that replaces the engine decides what
        # the next boot's recovery runs, which is the same bootstrap risk that
        # already keeps hive-data and hive-firmware out of application bundles.
        self.bundle()
        payload = self.root / 'payload'
        (payload / 'files/usr/local/bin').mkdir(parents=True)
        data = b'#!/bin/sh\nexit 0\n'
        (payload / 'files/usr/local/bin/hive-ota-transaction').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'usr/local/bin/hive-ota-transaction',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0755'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('boot-critical', result.stderr)
        self.assertFalse((self.root / 'usr/local/bin/hive-ota-transaction').exists())

    def test_systemd_side_path_to_protected_unit_is_refused(self):
        self.bundle()
        payload = self.root / 'payload'
        (payload / 'files/etc/systemd/system/hive-data.service.d').mkdir(parents=True)
        data = b'[Service]\nExecStart=\nExecStart=/bin/false\n'
        (payload / 'files/etc/systemd/system/hive-data.service.d/override.conf').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'etc/systemd/system/hive-data.service.d/override.conf',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0644'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('boot-critical', result.stderr)
        self.assertFalse((self.root / 'etc/systemd/system/hive-data.service.d').exists())
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_unit_that_reboots_the_node_on_failure_is_refused(self):
        self.bundle()
        payload = self.root / 'payload'
        (payload / 'files/etc/systemd/system').mkdir(parents=True)
        data = b'[Unit]\nDescription=app\nFailureAction=reboot\n\n[Service]\nExecStart=/bin/false\n'
        (payload / 'files/etc/systemd/system/xray.service').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'etc/systemd/system/xray.service',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0644'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('整机重启', result.stdout)
        self.assertFalse((self.root / 'etc/systemd/system/xray.service').exists())
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_identity_configuration_is_refused_before_install(self):
        self.bundle()
        before = (self.root / 'etc/hive/config.env').read_text()
        payload = self.root / 'payload'
        (payload / 'files/etc/hive').mkdir(parents=True)
        data = b'NODE_REGISTRY_URL=https://attacker.invalid\n'
        (payload / 'files/etc/hive/config.env').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'etc/hive/config.env',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0644'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('identity/runtime configuration', result.stderr)
        self.assertIn('etc/hive/config.env', result.stderr)
        self.assertEqual((self.root / 'etc/hive/config.env').read_text(), before)
        self.assertFalse((self.root / 'etc/test-app').exists())
        self.assertFalse((self.root / 'var/lib/hive/ota-transaction/active').exists())

    def test_every_path_hive_data_mounts_is_refused_as_bundle_content(self):
        # hive-data bind-mounts these from /data, so bundle content here survives
        # firmware updates and carries credentials. The refusal list is supposed
        # to mirror that mount list exactly; two entries were missing, so a
        # bundle could rewrite the WiFi PSK and the nginx site.
        for target in ['etc/NetworkManager/system-connections/wifi.nmconnection',
                       'etc/nginx/sites-available/hive']:
            with self.subTest(target=target):
                self.setUp()
                self.bundle()
                payload = self.root / 'payload'
                (payload / 'files' / target).parent.mkdir(parents=True)
                data = b'[wifi-security]\npsk=bundle\n'
                (payload / 'files' / target).write_bytes(data)
                manifest = json.loads((payload / 'manifest.json').read_text())
                manifest['files'].append({'path': target,
                                          'sha256': hashlib.sha256(data).hexdigest(),
                                          'mode': '0600'})
                self.repack(manifest)
                result = self.run_script(self.script('hive-updater'), expected=1)
                self.assertIn('identity/runtime configuration', result.stderr)
                self.assertIn(target, result.stderr)
                self.assertFalse((self.root / target).exists())

    def test_a_firmware_bundle_is_refused_from_the_manual_path(self):
        # The manual path carries no assignment token, so the reboot-time
        # receipt would have nowhere to land and the registry would never learn
        # the outcome. Refusing is correct, but the operator needs to be told
        # which path to use instead of reading a generic integrity failure.
        self.bundle()
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['kind'] = 'firmware'
        manifest['version'] = '2.0'
        self.repack(manifest)
        assignment = json.loads((self.root / 'assignment.json').read_text())
        result = self.run_script(self.script('hive-updater'), '--url', assignment['url'],
                                 '--sha256', assignment['sha256'], '--version', '2.0', expected=1)
        self.assertIn('OTA 发布任务', result.stdout)
        self.assertFalse((self.root / 'var/lib/hive/firmware-pending.json').exists())

    def test_manual_path_still_installs_an_application_bundle(self):
        # --url must keep working for application bundles; refusing firmware
        # must not turn the whole manual path off.
        self.bundle()
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['version'] = '1.0'
        self.repack(manifest)
        assignment = json.loads((self.root / 'assignment.json').read_text())
        self.run_script(self.script('hive-updater'), '--url', assignment['url'],
                        '--sha256', assignment['sha256'], '--version', '1.0')
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')

    def test_a_bundle_with_an_unparsable_python_controller_is_refused(self):
        # The bash -n preflight covers shell scripts. The controller could be
        # replaced by a python3 copy that fails at import, which would leave a
        # broken updater on disk that only reports success once.
        self.bundle()
        payload = self.root / 'payload'
        data = b'#!/usr/bin/env python3\ndef broken(:\n    pass\n'
        (payload / 'files/usr/local/bin').mkdir(parents=True)
        (payload / 'files/usr/local/bin/hive-updater').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'usr/local/bin/hive-updater',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0755'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('语法错误', result.stdout)
        self.assertFalse((self.root / 'usr/local/bin/hive-updater').exists())

    def test_declared_migration_path_is_not_treated_as_bundle_content(self):
        self.bundle()
        (self.root / 'etc/xray').mkdir(parents=True)
        (self.root / 'etc/xray/config.json').write_text('operator config\n')
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['rollback_paths'] = ['etc/xray/config.json']
        self.repack(manifest)
        self.run_script(self.script('hive-updater'))
        self.assertEqual((self.root / 'etc/xray/config.json').read_text(), 'operator config\n')
        self.assertEqual(json.loads((self.root / 'acks').read_text().splitlines()[-1])['status'], 'done')

    def test_transaction_directory_cannot_be_overwritten_by_a_bundle(self):
        self.bundle()
        payload = self.root / 'payload'
        (payload / 'files/var/lib/hive/ota-transaction').mkdir(parents=True)
        data = b'#!/bin/sh\nrm -rf /\n'
        (payload / 'files/var/lib/hive/ota-transaction/recover.sh').write_bytes(data)
        manifest = json.loads((payload / 'manifest.json').read_text())
        manifest['files'].append({'path': 'var/lib/hive/ota-transaction/recover.sh',
                                  'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0755'})
        self.repack(manifest)
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('boot-critical', result.stderr)
        self.assertIn('ota-transaction/recover.sh', result.stderr)
        self.assertNotIn('rm -rf /', (self.root / 'var/lib/hive/ota-transaction/recover.sh').read_text())
        self.assertFalse((self.root / 'var/lib/hive/ota-transaction/active').exists())
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_persisted_credentials_cannot_be_installed_by_a_bundle(self):
        # These paths are bind-mounted from /data by hive-data, so bundle
        # content there survives a firmware update and outlives a rollback.
        for path in ['root/.ssh/authorized_keys', 'etc/cloudflared/cert.pem',
                     'var/lib/tailscale/tailscaled.state', 'var/lib/easytier/id']:
            with self.subTest(path=path):
                self.setUp()
                self.bundle()
                payload = self.root / 'payload'
                (payload / 'files' / path).parent.mkdir(parents=True, exist_ok=True)
                data = b'backdoor\n'
                (payload / 'files' / path).write_bytes(data)
                manifest = json.loads((payload / 'manifest.json').read_text())
                manifest['files'].append({'path': path,
                                          'sha256': hashlib.sha256(data).hexdigest(), 'mode': '0600'})
                self.repack(manifest)
                result = self.run_script(self.script('hive-updater'), expected=1)
                self.assertIn('identity/runtime configuration', result.stderr)
                self.assertIn(path, result.stderr)
                self.assertFalse((self.root / path).exists())
                self.assertFalse((self.root / 'etc/test-app').exists())

    def test_install_requires_the_persistent_data_mount(self):
        # OTA backups and receipts live on /data (hive-data bind mounts). Without
        # that mount an install would be reported as done but vanish at the next
        # slot switch, and rollback would have nothing to restore.
        self.bundle()
        layout = self.root / 'ab-layout'
        layout.write_text('nanopi-zero2-ab-v1\n')
        self.mock('mountpoint', '#!/bin/sh\nexit 1\n')
        script = self.script('hive-updater')
        # The Harness does not relocate /usr/lib/hive, so point the guard at the
        # sandbox marker instead of the host path.
        helper = self.root / 'hive-ota-transaction'
        helper.write_text(helper.read_text().replace('/usr/lib/hive/ab-layout', str(layout)))
        result = self.run_script(script, expected=1)
        self.assertIn('/data', result.stdout)
        self.assertFalse((self.root / 'etc/test-app').exists())
        self.assertFalse((self.root / 'var/lib/hive/ota-transaction/active').exists())
        # The same bundle installs once the persistent store is mounted.
        self.mock('mountpoint', '#!/bin/sh\nexit 0\n')
        script = self.script('hive-updater')
        helper.write_text(helper.read_text().replace('/usr/lib/hive/ab-layout', str(layout)))
        self.run_script(script)
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')

    def test_partial_hive_data_mount_still_refuses_install(self):
        # /data can be mounted while a later bind in hive-data failed. Transaction
        # backups would then land in the rootfs slot even though /data looks fine.
        self.bundle()
        layout = self.root / 'ab-layout'
        layout.write_text('nanopi-zero2-ab-v1\n')
        self.mock('mountpoint', '#!/bin/sh\ncase "$2" in */var/lib/hive) exit 1;; esac\nexit 0\n')
        script = self.script('hive-updater')
        helper = self.root / 'hive-ota-transaction'
        helper.write_text(helper.read_text().replace('/usr/lib/hive/ab-layout', str(layout)))
        result = self.run_script(script, expected=1)
        self.assertIn('/data', result.stdout)
        self.assertFalse((self.root / 'etc/test-app').exists())

    def test_empty_health_services_still_checks_the_restarted_units(self):
        self.bundle()
        (self.root / 'etc/test-app').write_text('old version\n')
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['health_services'] = []
        manifest['restart_services'] = ['test.service']
        self.repack(manifest)
        self.mock('systemctl', '''#!/bin/sh
[ "$1" != show ] || echo 123
case "$1 $2 $3" in "is-active --quiet test.service") exit 3;; esac
exit 0
''')
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'old version\n')
        self.assertEqual(json.loads((self.root / 'acks').read_text().splitlines()[-1])['status'], 'rolled_back')

    def probe_curl(self):
        # First /ota-version fetch is the poll; every later one is the probe.
        self.mock('curl', '''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
r=Path(os.environ['HIVE_TEST_ROOT']);args=sys.argv[1:];url=args[-1]
def emit(code):
    if '-w' in args:
        sys.stdout.write(code);sys.stdout.flush();return True
    return False
if url.endswith('/ota-version'):
    seen=r/'probe-calls'
    n=int(seen.read_text()) if seen.exists() else 0
    seen.write_text(str(n+1))
    if not (('-w' in args) and emit('200')):
        if n: sys.exit(22)
        print((r/'assignment.json').read_text())
elif url.endswith('/ota-ack'):
    payload=Path(args[args.index('--data-binary')+1][1:]).read_text()
    with (r/'acks').open('a') as f:f.write(json.dumps(json.loads(payload))+'\\n')
    if '-w' in args:emit('200')
else:
    shutil.copyfile(r/'bundle.tar.gz',args[args.index('-o')+1])
''')

    def test_broken_management_path_rolls_back_the_bundle(self):
        self.bundle()
        (self.root / 'etc/hive/device-token').write_text('test-token')
        (self.root / 'etc/test-app').write_text('old version\n')
        (self.root / 'etc/hive/ota-version').write_text('previous\n')
        self.probe_curl()
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('management endpoint unreachable', result.stderr)
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'old version\n')
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), 'previous\n')
        self.assertFalse((self.root / 'var/lib/hive/ota-installed.json').exists())
        self.assertEqual(json.loads((self.root / 'acks').read_text().splitlines()[-1])['status'], 'rolled_back')

    def test_unregistered_device_skips_the_management_probe(self):
        self.bundle()
        self.probe_curl()
        self.run_script(self.script('hive-updater'))
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')
        self.assertEqual(json.loads((self.root / 'acks').read_text().splitlines()[-1])['status'], 'done')

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

    def test_a_rejected_receipt_is_not_retried_forever(self):
        # The registry answers 409 when no pending assignment matches the
        # token, meaning the rollout was replaced while the node rebooted.
        # Retrying that receipt would block every later poll behind a body
        # that can never be accepted.
        self.bundle()
        (self.root / 'ack-code').write_text('409')
        result = self.run_script(self.script('hive-updater'))
        self.assertIn('回执已过期', result.stdout)
        self.assertFalse((self.root / 'var/lib/hive/ota-pending-ack.json').exists())
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')

    def test_a_transient_receipt_failure_keeps_the_receipt(self):
        self.bundle()
        (self.root / 'ack-code').write_text('503')
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('供下轮重试', result.stdout)
        self.assertTrue((self.root / 'var/lib/hive/ota-pending-ack.json').exists())
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')

    def test_post_hook_failure_restores_entire_application(self):
        self.failure_bundle()
        self.run_script(self.script('hive-updater'), expected=1)
        self.assert_rolled_back()
        self.assert_no_downloads()

    def test_health_failure_restores_entire_application(self):
        self.failure_bundle('health-check.sh')
        self.run_script(self.script('hive-updater'), expected=1)
        self.assert_rolled_back()

    def test_health_timeout_is_wall_clock_not_iterations(self):
        # Each round costs a probe (up to 8s) plus its sleeps, so counting
        # iterations let a bundle asking for 300 seconds hold the lock for
        # roughly 45 minutes. Give the probe a real cost and a 2s budget: the
        # wall-clock loop stops after one round, the counting loop would run
        # the budget's worth of expensive rounds.
        self.bundle()
        (self.root / 'etc/test-app').write_text('old version\n')
        (self.root / 'etc/hive/device-token').write_text('test-token')
        manifest = json.loads((self.root / 'payload/manifest.json').read_text())
        manifest['health_grace_seconds'] = 0
        manifest['health_timeout_seconds'] = 2
        manifest['health_services'] = ['never.service']
        self.repack(manifest)
        self.mock('systemctl', '#!/bin/sh\n[ "$1" != is-active ] || exit 3\nexit 0\n')
        self.mock('mock-copy', (self.root / 'mock/curl').read_text())
        self.mock('curl', '''#!/bin/sh
case "$*" in
    *ota-version*)
        n=$(cat "$HIVE_TEST_ROOT/probe-count" 2>/dev/null || echo 0)
        echo $((n+1)) > "$HIVE_TEST_ROOT/probe-count"
        [ "$n" -lt 1 ] || { sleep 5; exit 22; } ;;
esac
exec "$HIVE_TEST_ROOT/mock/mock-copy" "$@"
''')
        start = time.monotonic()
        self.run_script(self.script('hive-updater'), expected=1)
        elapsed = time.monotonic() - start
        self.assertLess(elapsed, 9, f'health check ran {elapsed:.1f}s for a 2s budget')

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

    def assert_no_downloads(self):
        self.assertFalse((self.root / 'var/lib/hive/ota-cache').exists())
        self.assertFalse(list((self.root / 'var/lib/hive').glob('ota-download.*')))

    def test_reinstall_fetches_from_server_and_keeps_no_packages(self):
        assignment = self.bundle()
        curl = self.root / 'mock/curl'
        curl.write_text(curl.read_text().replace("else:\n    shutil.copyfile", "else:\n    with (r/'downloads').open('a') as f:f.write('download\\n')\n    shutil.copyfile"))
        script = self.script('hive-updater')
        self.run_script(script)
        self.assert_no_downloads()
        args = ['--url', assignment['url'], '--sha256', assignment['sha256'], '--version', '1.0', '--force']
        self.run_script(script, *args)
        self.assert_no_downloads()
        self.assertEqual(len((self.root / 'downloads').read_text().splitlines()), 2)
        # A new installation requires the server bundle, even for the same SHA.
        (self.root / 'bundle.tar.gz').unlink()
        self.run_script(script, *args, expected=1)
        self.assert_no_downloads()
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')

    def test_invalid_signature_removes_download(self):
        self.bundle()
        (self.root / 'payload/manifest.sig').write_bytes(b'invalid signature')
        with tarfile.open(self.root / 'bundle.tar.gz', 'w:gz') as archive:
            archive.add(self.root / 'payload', arcname='bundle')
        assignment = json.loads((self.root / 'assignment.json').read_text())
        assignment['sha256'] = hashlib.sha256((self.root / 'bundle.tar.gz').read_bytes()).hexdigest()
        (self.root / 'assignment.json').write_text(json.dumps(assignment))
        self.run_script(self.script('hive-updater'), expected=1)
        self.assert_no_downloads()

    def test_low_space_stops_download_but_preserves_recovery_files(self):
        self.bundle()
        tx = self.root / 'var/lib/hive/ota-transaction/files'
        tx.mkdir(parents=True)
        (tx / 'saved').write_bytes(b'recovery backup')
        self.mock('df', '#!/bin/sh\nprintf "Avail\\n67108864\\n"\n')
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('下载空间不足', result.stdout)
        self.assertFalse((self.root / 'etc/test-app').exists())
        self.assert_no_downloads()
        self.assertEqual((tx / 'saved').read_bytes(), b'recovery backup')

    def test_download_without_content_length_is_bounded_by_kernel(self):
        self.bundle()
        self.mock('df', '#!/bin/sh\nprintf "Avail\\n67141632\\n"\n') # reserve + 32 KiB
        curl = self.root / 'mock/curl'
        curl.write_text(curl.read_text().replace("    shutil.copyfile(r/'bundle.tar.gz',args[args.index('-o')+1])", "    target=Path(args[args.index('-o')+1])\n    try:target.write_bytes(b'x'*(1024*1024))\n    except OSError:pass\n    (r/'download-size').write_text(str(target.stat().st_size))\n    sys.exit(1)"))
        self.run_script(self.script('hive-updater'), expected=1)
        self.assertLessEqual(int((self.root / 'download-size').read_text()), 32768)
        self.assert_no_downloads()

    def test_extraction_space_checked_after_download(self):
        self.bundle()
        self.mock('df', "#!/usr/bin/env python3\nimport os\nfrom pathlib import Path\nr=Path(os.environ['HIVE_TEST_ROOT'])\ndownloaded=any((r/'var/lib/hive').glob('ota-download.*/bundle.tar.gz'))\nprint('Avail');print(67108865 if downloaded else 3*1024**3)\n")
        result = self.run_script(self.script('hive-updater'), expected=1)
        self.assertIn('解压空间不足', result.stdout)
        self.assertFalse((self.root / 'etc/test-app').exists())
        self.assert_no_downloads()

    def test_startup_removes_abandoned_downloads(self):
        assignment = self.bundle()
        stale = self.root / 'var/lib/hive/ota-download.abandoned'
        stale.mkdir(); (stale / 'partial').write_bytes(b'partial download')
        # Skip installing, so startup behavior can be verified independently.
        (self.root / 'var/lib/hive/ota-installed.json').write_text(json.dumps(assignment))
        self.run_script(self.script('hive-updater'))
        self.assert_no_downloads()

    def test_killed_download_is_cleaned_on_next_start(self):
        self.bundle()
        curl = self.root / 'mock/curl'
        original = curl.read_text()
        curl.write_text(original.replace("else:\n    shutil.copyfile", "else:\n    import signal\n    Path(args[args.index('-o')+1]).write_bytes(b'partial')\n    os.kill(os.getppid(),signal.SIGKILL)\n    sys.exit(0)\n    shutil.copyfile"))
        script = self.script('hive-updater')
        self.run_script(script, expected=-9)
        self.assertTrue(list((self.root / 'var/lib/hive').glob('ota-download.*/bundle.tar.gz')))
        curl.write_text(original)
        self.run_script(script)
        self.assert_no_downloads()
        self.assertEqual((self.root / 'etc/test-app').read_text(), 'installed safely\n')


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

    def test_environment_offsets_come_from_the_build_stamp(self):
        # fw_setenv must write where the U-Boot in this image reads. Deriving the
        # offsets from the build stamp keeps a single source of truth; a
        # hardcoded copy silently strands firmware updates after any change.
        self.firmware_fixture()
        stamp = self.root / 'stamp'
        stamp.write_text('CONFIG_ENV_IS_IN_MMC=y\nCONFIG_ENV_REDUNDANT=y\n'
                         'CONFIG_ENV_SIZE=0x4000\nCONFIG_ENV_OFFSET=0x500000\n'
                         'CONFIG_ENV_OFFSET_REDUND=0x600000\n')
        runner = self.root / 'env-test'
        runner.write_text('set -uo pipefail\nHIVE_UBOOT_ENV="' + str(stamp) + '"\n'
                          'FW_DISK=/dev/mmcblk0\n'
                          'log() { echo "$*"; }\n'
                          'source "' + str(self.script('hive-firmware')) + '"\n'
                          'firmware_environment_config\n')
        result = self.run_script(runner)
        self.assertEqual(result.stdout.strip(),
                         '/dev/mmcblk0 0x500000 0x4000\n/dev/mmcblk0 0x600000 0x4000')
        stamp.write_text('CONFIG_ENV_IS_IN_MMC=y\n')
        result = self.run_script(runner, expected=1)
        self.assertEqual(result.stdout, '')

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

    def test_staging_requires_the_persistent_data_mount(self):
        # The pending marker and the receipt live on /data; arming a trial whose
        # marker the next slot cannot read would strand the update unconfirmed.
        runner = self.firmware_fixture()
        layout = self.root / 'image-tree/usr/lib/hive/ab-layout'
        helper = self.root / 'hive-ota-transaction'
        helper.write_text(helper.read_text().replace('/usr/lib/hive/ab-layout', str(layout)))
        self.mock('mountpoint', '#!/bin/sh\nexit 1\n')
        self.run_script(runner, 'stage', expected=1)
        self.assertFalse((self.root / 'environment-writes').exists())
        self.assertFalse((self.root / 'var/lib/hive/firmware-pending.json').exists())
        helper = self.root / 'hive-ota-transaction'
        self.mock('mountpoint', '#!/bin/sh\nexit 0\n')
        self.run_script(runner, 'stage')
        self.assertTrue((self.root / 'var/lib/hive/firmware-pending.json').exists())

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

    def test_failed_activation_never_claims_the_new_version(self):
        # The receipt and /etc/hive/ota-version were written before hive_active
        # was flipped. If the environment write fails or power is lost there,
        # the old slot boots again while its receipt already claims the new
        # version, so the pending marker can never be confirmed and the trial
        # rollback restores the wrong receipt.
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        self.env['TEST_SLOT'] = 'B'
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.mock('fw_setenv', '#!/bin/sh\nexit 1\n')
        self.run_script(runner, 'confirm', expected=1)
        self.assertEqual((self.root / 'etc/hive/ota-version').read_text(), '1.0\n')
        self.assertEqual(json.loads((self.root / 'var/lib/hive/ota-installed.json').read_text())['version'], '1.0')
        self.assertTrue(path.exists())

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

    def test_fallback_clears_pending_even_if_environment_write_fails(self):
        # fw_setenv failing used to abort before the pending marker was removed;
        # with FailureAction=reboot that is an endless reboot loop.
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.mock('fw_setenv', '#!/bin/sh\nexit 1\n')
        result = self.run_script(runner, 'confirm')
        self.assertFalse(path.exists())
        self.assertIn('hive_pending could not be cleared', result.stdout)
        self.assertEqual(json.loads((self.root / 'var/lib/hive/ota-pending-ack.json').read_text())['status'], 'rolled_back')

    def test_confirm_retry_budget_fits_the_unit_start_timeout(self):
        # One failing registry probe costs 20s and one failing health check
        # 60s. A fixed twelve rounds could reach TimeoutStartSec=300 and kill a
        # device that was only slow to reach the registry, which then rolls the
        # trial back. The loop must be bounded by elapsed time with headroom.
        source = (base.BIN / 'hive-firmware').read_text()
        self.assertNotIn('seq 1 12', source)
        self.assertIn('deadline=$((SECONDS + ${CONFIRM_BUDGET:-', source)
        budget = int(re.search(r'CONFIRM_BUDGET:-(\d+)', source).group(1))
        unit = (base.REPO / 'armbian-build/userpatches/overlay/etc/systemd/system/hive-firmware-confirm.service').read_text()
        start = int(re.search(r'^TimeoutStartSec=(\d+)', unit, re.M).group(1))
        # Worst single round is probe 20s + health 60s; the budget must leave
        # room for flock acquisition inside the unit's start timeout.
        self.assertLess(budget + 20 + 60 + 30, start)

    def test_node_provisioned_without_cloudflare_still_confirms(self):
        # provision-node.sh records a failed Cloudflare setup and skips enabling
        # cloudflared, because the node has no config.yml to run. Waiting for
        # that unit to become active would fail every firmware trial on such a
        # node and roll the upgrade back forever.
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        (self.root / 'etc/hive/cloudflare-unavailable').touch()
        self.env['TEST_SLOT'] = 'B'
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.mock('systemctl', '#!/bin/sh\n[ "$3" != cloudflared.service ]\n')
        self.run_script(runner, 'confirm')
        self.assertFalse(path.exists())

    def test_customer_firmware_confirms_with_xray_stopped(self):
        runner = self.firmware_fixture()
        self.run_script(runner, 'stage')
        self.env['TEST_SLOT'] = 'B'
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.mock('systemctl', '#!/bin/sh\n[ "$3" != xray.service ]\n')
        self.run_script(runner, 'confirm')
        self.assertFalse(path.exists())

    def test_exit_firmware_requires_xray_before_confirmation(self):
        runner = self.firmware_fixture()
        (self.root / 'etc/hive/server-token').write_text('server-only-token')
        self.run_script(runner, 'stage')
        self.env['TEST_SLOT'] = 'B'
        path = self.root / 'var/lib/hive/firmware-pending.json'
        pending = json.loads(path.read_text()); pending['boot_id'] = 'previous-boot'
        path.write_text(json.dumps(pending))
        self.mock('systemctl', '#!/bin/sh\n[ "$3" != xray.service ]\n')
        self.run_script(runner, 'confirm', expected=1)
        self.assertTrue(path.exists())
        self.assertNotIn('hive_active B', (self.root / 'environment-writes').read_text())


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

    def boot(self, state, fail_load='', fail_save=False, bootpath=None):
        # Execute the actual embedded Hush script using compatible Bash syntax;
        # substitute U-Boot commands, not the selection algorithm.
        script = subprocess.check_output([str(base.REPO / 'scripts/render-ab-boot.sh'), self.board], text=True)
        mock = r'''
setenv() { local key="$1"; shift; printf -v "$key" '%s' "$*"; }
setexpr() { printf -v "$1" '%s' "$((${2} - ${4}))"; }
fdt() {
    [ "$1" != get ] && return 0
    case "$3" in
        hive_bootpath) setenv "$3" "${BOOTPATH:-/soc/mmc@ffc30000}";;
        hive_sdpath) setenv "$3" /soc/mmc@ffc30000;;
        hive_emmcpath) setenv "$3" /soc/mmc@ffbf0000;;
    esac
}
mmc() { return 0; }
env() { return 0; }
part() { setenv hive_rootuuid test-uuid; }
load() { case ",${FAIL_LOAD_SLOTS:-}," in *",${hive_slot},"*) return 1;; esac; return 0; }
saveenv() {
    [ "$FAIL_SAVE" != 1 ] || return 1
    printf 'STATE:%s:%s:%s\n' "$hive_active" "${hive_pending:-}" "$hive_tries"
}
run() { eval "${!1}"; }
bootflow() { echo BOOTFLOW; }
booti() { echo "BOOT:$hive_slot"; exit 0; }
reset() { echo RESET; exit 9; }
'''
        env = dict(os.environ, hive_active=state[0], hive_pending=state[1], hive_tries=str(state[2]),
                   FAIL_LOAD_SLOTS=fail_load, FAIL_SAVE=str(int(fail_save)), **({'BOOTPATH': bootpath} if bootpath else {}))
        result = subprocess.run(['bash'], input=mock+script, env=env, text=True, capture_output=True)
        states = [line.split(':')[1:] for line in result.stdout.splitlines() if line.startswith('STATE:')]
        booted = [line.split(':')[1] for line in result.stdout.splitlines() if line.startswith('BOOT:')]
        return (states[-1] if states else state), (booted[-1] if booted else None), result

    def test_corrupt_try_counter_still_boots_the_pending_slot(self):
        # A counter the installer never writes ("x", an empty value, a negative
        # number) must not silently discard an armed trial: boot the pending
        # slot once and let the normal attempt accounting take over.
        for tries in ['x', '3abc', '', '-1']:
            with self.subTest(tries=tries):
                state, slot, result = self.boot(['A', 'B', tries])
                self.assertEqual(slot, 'B', result.stdout)
                self.assertEqual(state[1], 'B')
                self.assertEqual(int(state[2]), 0)

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
        state, slot, _ = self.boot(['A', 'B', '3'], fail_load='B')
        self.assertEqual(slot, 'A')
        self.assertEqual(state, ['A', '', '0'])

    def test_confirmed_slot_boots_without_consuming_attempts(self):
        state, slot, _ = self.boot(['B', '', '0'])
        self.assertEqual(slot, 'B')
        self.assertEqual(state, ['B', '', '0'])

    def test_environment_failure_boots_confirmed_slot_not_the_trial(self):
        # An unwritable environment must not reset-loop, but the unrecorded
        # trial slot must never be booted either.
        state, slot, result = self.boot(['A', 'B', '3'], fail_save=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(slot, 'A')
        self.assertEqual(state, ['A', 'B', '3'])
        self.assertNotIn('RESET', result.stdout)

    def test_initialization_failure_boots_factory_slot(self):
        state, slot, result = self.boot(['', '', '0'], fail_save=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(slot, 'A')
        self.assertNotIn('RESET', result.stdout)

    def test_confirmed_slot_load_failure_boots_the_other_slot(self):
        state, slot, result = self.boot(['A', '', '0'], fail_load='A')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(slot, 'B')
        self.assertEqual(state, ['A', '', '0'])

    def test_unsupported_boot_medium_scans_before_resetting(self):
        # USB rescue or rockusb: neither slot is addressable, but resetting
        # straight away repeats this branch forever.
        _, slot, result = self.boot(['A', '', '0'], bootpath='/soc/usb@ff000000')
        self.assertIsNone(slot)
        self.assertEqual(result.returncode, 9)
        self.assertIn('Unsupported boot medium', result.stdout)
        self.assertIn('BOOTFLOW', result.stdout)
        self.assertLess(result.stdout.index('BOOTFLOW'), result.stdout.index('RESET'))

    def test_both_slots_unbootable_scan_before_reset(self):
        _, slot, result = self.boot(['B', '', '0'], fail_load='A,B')
        self.assertIsNone(slot)
        self.assertEqual(result.returncode, 9)
        self.assertIn('BOOTFLOW', result.stdout)
        self.assertLess(result.stdout.index('BOOTFLOW'), result.stdout.index('RESET'))

    def test_kernel_cmdline_panic_switches_are_configured_into_the_kernel(self):
        # boot.cmd passes panic=10 oops=panic softlockup_panic=1 hardlockup_panic=1
        # plus irqchip.gicv3_pseudo_nmi=1. Every one of those needs the matching
        # CONFIG_* in the image, or the switch is silently inert -- which is what
        # happened to softlockup_panic before: the Armbian baseline defconfig has
        # no CONFIG_DEBUG_KERNEL, so the detector was never built.
        kernel = (base.REPO / 'configs/kernel/nanopi-zero2.sh').read_text()
        temp = tempfile.TemporaryDirectory(prefix='hive-kernel-config-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        script = root / 'kernel-config'
        script.write_text(kernel)
        baseline = root / 'baseline.config'
        baseline.write_text('# CONFIG_DEBUG_KERNEL is not set\n'
                            '# CONFIG_LOCKUP_DETECTOR is not set\n'
                            '# CONFIG_SOFTLOCKUP_DETECTOR is not set\n'
                            '# CONFIG_HARDLOCKUP_DETECTOR is not set\n'
                            '# CONFIG_ARM64_PSEUDO_NMI is not set\n'
                            'CONFIG_WATCHDOG=y\n')
        produced = root / 'produced.config'
        subprocess.run(['bash', str(script), str(baseline), str(produced)], check=True, capture_output=True)
        config = produced.read_text().splitlines()
        for symbol in ['DEBUG_KERNEL', 'LOCKUP_DETECTOR', 'SOFTLOCKUP_DETECTOR',
                       'BOOTPARAM_SOFTLOCKUP_PANIC', 'HARDLOCKUP_DETECTOR',
                       'BOOTPARAM_HARDLOCKUP_PANIC', 'ARM64_PSEUDO_NMI']:
            with self.subTest(symbol=symbol):
                self.assertIn(f'CONFIG_{symbol}=y', config)

    def test_r28s_vendor_kernel_also_builds_the_lockup_detectors(self):
        # R28S uses the vendor 6.1 baseline, which has ARM64_PSEUDO_NMI=y but no
        # CONFIG_DEBUG_KERNEL either; without the detectors the same boot.cmd
        # panic switches are inert there.
        temp = tempfile.TemporaryDirectory(prefix='hive-kernel-config-r28s-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        script = root / 'kernel-config'
        script.write_text((base.REPO / 'configs/kernel/nanopi-r28s.sh').read_text())
        baseline = root / 'baseline.config'
        baseline.write_text('CONFIG_ARM64_PSEUDO_NMI=y\n'
                            '# CONFIG_DEBUG_KERNEL is not set\n'
                            '# CONFIG_LOCKUP_DETECTOR is not set\n'
                            '# CONFIG_SOFTLOCKUP_DETECTOR is not set\n'
                            '# CONFIG_HARDLOCKUP_DETECTOR is not set\n'
                            'CONFIG_CMA_SIZE_MBYTES=32\n')
        produced = root / 'produced.config'
        subprocess.run(['bash', str(script), str(baseline), str(produced)], check=True, capture_output=True)
        config = produced.read_text().splitlines()
        for symbol in ['DEBUG_KERNEL', 'SOFTLOCKUP_DETECTOR', 'HARDLOCKUP_DETECTOR',
                       'BOOTPARAM_SOFTLOCKUP_PANIC', 'BOOTPARAM_HARDLOCKUP_PANIC']:
            with self.subTest(symbol=symbol):
                self.assertIn(f'CONFIG_{symbol}=y', config)

    def test_hardware_watchdog_is_armed_before_the_first_slow_boot(self):
        # The SoC watchdog is only useful if userspace opens it: dw_wdt is built
        # in but nothing in the image touched /dev/watchdog0.
        dropin = (base.REPO / 'armbian-build/userpatches/overlay/etc/systemd/system.conf.d/10-hive-watchdog.conf').read_text()
        keys = [line.split('=', 1)[0] for line in dropin.splitlines()
                if '=' in line and not line.lstrip().startswith('#')]
        self.assertIn('RuntimeWatchdogSec', keys)
        # systemd has no ShutdownWatchdogSec in [Manager]; such a key is parsed
        # and dropped, which reads as protection that does not exist.
        self.assertNotIn('ShutdownWatchdogSec', keys,
                         'systemd has no such [Manager] key; it would be ignored')


class R28SBootPolicyTests(BootPolicyTests):
    board = 'nanopi-r28s'


class BootloaderEnvGateTests(unittest.TestCase):
    STAMP = '''CONFIG_ENV_IS_IN_MMC=y
CONFIG_ENV_REDUNDANT=y
CONFIG_ENV_SIZE=0x8000
CONFIG_ENV_OFFSET=0xc00000
CONFIG_ENV_OFFSET_REDUND=0xc10000
CONFIG_CMD_SAVEENV=y
CONFIG_CMD_SETEXPR=y
CONFIG_CMD_PART=y
CONFIG_CMD_FDT=y
'''
    MARKERS = [
        'HIVE_AB_V1',
        'save environment variables to persistent storage',
        'Invalid ENV offset in MMC',
        'Writing to %sMMC(',
        'Reading from %sMMC(',
        '*** Error - No Valid Environment Area found',
        'set environment variable as the result of eval expression',
        'print partition UUID',
        "boot Linux kernel 'Image' format from memory",
        'flattened device tree utility commands',
    ]

    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory(prefix='hive-uboot-gate-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def gate(self, markers, stamp=None):
        uboot = self.root / 'u-boot-rockchip.bin'
        uboot.write_text('\n'.join(markers) + '\n')
        stamp_path = self.root / 'uboot-env'
        stamp_path.write_text(self.STAMP if stamp is None else stamp)
        return subprocess.run([str(base.REPO / 'scripts/check-uboot-env.sh'), str(uboot), str(stamp_path)],
                              text=True, capture_output=True)

    def test_accepts_bootloader_with_persistent_redundant_environment(self):
        result = self.gate(self.MARKERS)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_bootloader_without_mmc_environment(self):
        markers = [m for m in self.MARKERS if m != 'Invalid ENV offset in MMC']
        result = self.gate(markers)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('MMC environment driver', result.stderr)

    def test_rejects_bootloader_without_redundant_environment(self):
        markers = [m for m in self.MARKERS if m != 'Reading from %sMMC(']
        result = self.gate(markers)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('redundant', result.stderr)

    def test_accepts_a_different_but_self_consistent_offset(self):
        # The stamp is the build output. A checker that repeats a hardcoded
        # offset rejects a correctly built bootloader that moved the
        # environment, and worse: it would keep passing after the build moved
        # to a new offset, so fw_setenv would write where U-Boot never reads.
        result = self.gate(self.MARKERS, self.STAMP.replace('0xc00000', '0xe00000').replace('0xc10000', '0xe10000'))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_overlapping_environment_areas(self):
        result = self.gate(self.MARKERS, self.STAMP.replace('CONFIG_ENV_OFFSET_REDUND=0xc10000', 'CONFIG_ENV_OFFSET_REDUND=0xc04000'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overlaps', result.stderr)

    def test_rejects_a_stamp_without_the_environment_size(self):
        result = self.gate(self.MARKERS, self.STAMP.replace('CONFIG_ENV_SIZE=0x8000\n', ''))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CONFIG_ENV_SIZE', result.stderr)

    def test_rejects_missing_build_stamp(self):
        uboot = self.root / 'u-boot-rockchip.bin'
        uboot.write_text('\n'.join(self.MARKERS) + '\n')
        result = subprocess.run([str(base.REPO / 'scripts/check-uboot-env.sh'), str(uboot), str(self.root / 'absent')],
                                text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('environment stamp', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
