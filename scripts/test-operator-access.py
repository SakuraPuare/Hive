#!/usr/bin/env python3
"""Operator SSH stays key-only: failed key import must not open a password, and SSH is not offered on LAN or hotspot."""
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
BIN = REPO / 'armbian-build/userpatches/overlay/usr/local/bin'
KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl alpha'
KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtTz7l3Z2m0n1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d6 beta'
KEY_C = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCguestonlyexamplekeymaterial1234567890 gamma'


class OperatorAccessTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='hive-operator-access-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.mockdir = self.root / 'bin'
        self.mockdir.mkdir()
        self.env = dict(os.environ, HIVE_TEST_ROOT=str(self.root), PATH=str(self.mockdir) + os.pathsep + os.environ['PATH'])
        (self.root / 'github').mkdir()
        (self.root / 'fail').mkdir()
        self.mock('curl', '''#!/usr/bin/env python3
import os, sys
from pathlib import Path
root = Path(os.environ['HIVE_TEST_ROOT'])
url = sys.argv[-1]
with (root / 'curl-urls').open('a') as fh:
    fh.write(url + '\\n')
user = url.rstrip('/').rsplit('/', 1)[-1].removesuffix('.keys')
if (root / 'fail' / user).exists() or not (root / 'github' / user).is_file():
    sys.exit(22)
sys.stdout.write((root / 'github' / user).read_text())
''')

    def mock(self, name, text):
        path = self.mockdir / name
        path.write_text(text)
        path.chmod(0o755)

    def install(self, args, expected=0):
        result = subprocess.run(
            ['bash', str(BIN / 'hive-install-operator-keys'), *args],
            env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def dest(self):
        return self.root / 'authorized_keys'

    def give(self, user, body):
        (self.root / 'github' / user).write_text(body)

    def test_full_fetch_replaces_keys(self):
        self.dest().write_text(KEY_A + '\n')
        self.give('ops', KEY_B + '\n' + KEY_C + '\n# not a key\nroot:1234\n')
        self.install(['--dest', str(self.dest()), '--github', 'ops'])
        self.assertEqual(self.dest().read_text().splitlines(), [KEY_B, KEY_C])
        self.assertEqual(stat.S_IMODE(self.dest().stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.dest().parent.stat().st_mode) & 0o777, 0o700)

    def test_failed_fetch_keeps_existing_key(self):
        self.dest().write_text(KEY_A + '\n')
        (self.root / 'fail' / 'ops').write_text('1')
        result = self.install(['--dest', str(self.dest()), '--github', 'ops'])
        self.assertEqual(self.dest().read_text(), KEY_A + '\n')
        self.assertIn('Password login stays disabled', result.stdout)

    def test_failed_fetch_without_a_key_does_not_succeed(self):
        (self.root / 'fail' / 'ops').write_text('1')
        result = self.install(['--dest', str(self.dest()), '--github', 'ops'], expected=1)
        self.assertFalse(self.dest().exists())
        self.assertIn('Refusing to enable password login', result.stderr)
        self.assertNotIn('1234', result.stdout + result.stderr)

    def test_partial_fetch_does_not_replace_keys(self):
        self.dest().write_text(KEY_A + '\n')
        self.give('alpha', KEY_B + '\n')
        (self.root / 'fail' / 'beta').write_text('1')
        self.install(['--dest', str(self.dest()), '--github', 'alpha, beta'])
        self.assertEqual(self.dest().read_text(), KEY_A + '\n')

    def test_rejected_username_is_not_requested(self):
        result = self.install(['--dest', str(self.dest()), '--github', '../x'], expected=1)
        urls = (self.root / 'curl-urls').read_text() if (self.root / 'curl-urls').exists() else ''
        self.assertNotIn('../', urls)
        self.assertIn('rejected', result.stderr)

    def test_local_file_installs_when_github_fails(self):
        self.dest().write_text(KEY_A + '\n')
        keyfile = self.root / 'local.pub'
        keyfile.write_text('not a key\n' + KEY_B + '\n')
        (self.root / 'fail' / 'ops').write_text('1')
        self.install(['--dest', str(self.dest()), '--github', 'ops', '--file', str(keyfile)])
        self.assertEqual(self.dest().read_text().splitlines(), [KEY_B])

    def test_shipped_sshd_policy_is_key_only(self):
        text = (REPO / 'armbian-build/userpatches/overlay/etc/ssh/sshd_config.d/99-hive-hardening.conf').read_text()
        for line in (
            'PermitRootLogin prohibit-password',
            'PasswordAuthentication no',
            'KbdInteractiveAuthentication no',
            'AuthenticationMethods publickey',
            'PermitEmptyPasswords no',
        ):
            self.assertIn(line + '\n', text + ('\n' if text.endswith('\n') else ''))
        self.assertNotIn('PasswordAuthentication yes', text)
        self.assertNotIn('PermitRootLogin yes', text)

    def test_firewall_ssh_is_operator_paths_only(self):
        self.mock('ufw', '''#!/usr/bin/env python3
import os, sys
from pathlib import Path
Path(os.environ['HIVE_TEST_ROOT'], 'ufw-calls').open('a').write(' '.join(sys.argv[1:]) + '\\n')
''')
        script = (BIN / 'setup-firewall.sh').read_text()
        script = script.replace('/etc/hive/config.env', str(self.root / 'no-config'))
        script = script.replace('/etc/hive/hotspot-5g.env', str(self.root / 'no-hotspot'))
        path = self.root / 'setup-firewall.sh'
        path.write_text(script)
        result = subprocess.run(['bash', str(path)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = (self.root / 'ufw-calls').read_text().splitlines()
        text = '\n'.join(calls)
        self.assertIn('limit from 100.64.0.0/10 to any port 22 proto tcp', text)
        self.assertIn('limit from 172.20.0.0/16 to any port 22 proto tcp', text)
        self.assertIn('limit from fd7a:115c:a1e0::/48 to any port 22 proto tcp', text)
        self.assertIn('allow in on lo', text)
        for line in calls:
            args = line.split()
            if {'192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'} & set(args) and ('22' in args or 'ssh' in args):
                self.fail(line)
            if args[:2] in (['limit', 'ssh'], ['allow', 'ssh'], ['allow', '22'], ['allow', 'OpenSSH']):
                self.fail(line)
            if 'limit' in args and 'ssh' in args and 'from' not in args:
                self.fail(line)


if __name__ == '__main__':
    unittest.main()
