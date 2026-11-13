#!/usr/bin/env python3
"""Deployment database scripts: a backup is only published after verification, and
restore never drops the live database before the dump has been proven importable."""
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / 'management/scripts'


class ManagementScriptTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='hive-management-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.mockdir = self.root / 'bin'
        self.mockdir.mkdir()
        self.backups = self.root / 'backups'
        self.backups.mkdir()
        self.env = dict(os.environ, HIVE_TEST_ROOT=str(self.root),
                        PATH=str(self.mockdir) + ':' + os.environ['PATH'],
                        MYSQL_HOST='db.invalid', MYSQL_PORT='3306', MYSQL_USER='hive',
                        MYSQL_PASSWORD='secret', MYSQL_DB='hive_registry',
                        BACKUP_DIR=str(self.backups), BACKUP_KEEP_DAYS='0')
        self.mock('mysqldump', r'''#!/bin/sh
echo "$*" >> "$HIVE_TEST_ROOT/dump-args"
mode=$(cat "$HIVE_TEST_ROOT/dump-mode" 2>/dev/null || echo ok)
[ "$mode" = fail ] && { echo 'mysqldump: error 2003: cannot connect' >&2; exit 1; }
[ "$mode" = empty ] && exit 0
printf 'CREATE TABLE `users` (id int);\n'
''')
        self.mock('mysql', r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
r = Path(os.environ['HIVE_TEST_ROOT'])
args = sys.argv[1:]
with (r/'mysql-calls').open('a') as out:
    out.write(' '.join(args) + '\n')
if '-e' in args:
    query = args[args.index('-e')+1]
    if 'information_schema.tables' in query:
        count = r/'table-count'
        print(count.read_text().strip() if count.exists() else '0')
    sys.exit(0)
with (r/'imported.sql').open('a') as out:
    out.write(sys.stdin.read())
''')

    def mock(self, name, body):
        path = self.mockdir / name
        path.write_text(body)
        path.chmod(0o755)

    def run_script(self, name, *args, expected=0, stdin=''):
        result = subprocess.run(['bash', str(SCRIPTS / name), *args], env=self.env,
                                input=stdin, text=True, capture_output=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def calls(self):
        log = self.root / 'mysql-calls'
        return log.read_text() if log.exists() else ''

    def test_failed_or_empty_dump_publishes_nothing(self):
        # A truncated gzip under the real name looks like a usable backup and the
        # restore path drops the database before it reads the file.
        for mode in ['fail', 'empty']:
            with self.subTest(mode=mode):
                (self.root / 'dump-mode').write_text(mode)
                self.run_script('backup-db.sh', expected=1)
                self.assertEqual(list(self.backups.glob('*.sql.gz')), [])
                self.assertEqual(list(self.backups.glob('*.partial')), [])

    def test_successful_dump_is_valid_gzip(self):
        self.run_script('backup-db.sh')
        produced = list(self.backups.glob('*.sql.gz'))
        self.assertEqual(len(produced), 1)
        with gzip.open(produced[0], 'rt') as handle:
            self.assertIn('CREATE TABLE `users`', handle.read())
        self.assertEqual(list(self.backups.glob('*.partial')), [])

    def test_restore_refuses_non_gzip_before_dropping_the_target(self):
        broken = self.root / 'broken.sql.gz'
        broken.write_text('this is not gzip\n')
        result = self.run_script('restore-db.sh', str(broken), expected=1, stdin='yes\n')
        self.assertIn('gzip', result.stderr.lower())
        self.assertNotIn('DROP DATABASE IF EXISTS `hive_registry`;', self.calls())

    def test_restore_refuses_dump_without_core_tables(self):
        dump = self.root / 'empty-schema.sql.gz'
        with gzip.open(dump, 'wt') as handle:
            handle.write('-- no schema here\n')
        (self.root / 'table-count').write_text('0\n')
        result = self.run_script('restore-db.sh', str(dump), expected=1, stdin='yes\n')
        self.assertIn('核心表', result.stderr)
        self.assertNotIn('DROP DATABASE IF EXISTS `hive_registry`;', self.calls())

    def test_backup_accepts_deployment_database_variables(self):
        # deploy.sh loads .env, which defines REGISTRY_MYSQL_*. Reading only
        # MYSQL_* silently dumped a different (often empty) server.
        for key in ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB']:
            self.env.pop(key, None)
        self.env.update({'REGISTRY_MYSQL_HOST': 'db2.invalid', 'REGISTRY_MYSQL_PORT': '3307',
                         'REGISTRY_MYSQL_USER': 'svc', 'REGISTRY_MYSQL_PASSWORD': 'pw',
                         'REGISTRY_MYSQL_DB': 'other_db'})
        self.run_script('backup-db.sh')
        args = (self.root / 'dump-args').read_text()
        self.assertIn('--host=db2.invalid', args)
        self.assertIn('--port=3307', args)
        self.assertIn('--user=svc', args)
        self.assertIn('other_db', args)
        self.assertEqual(len(list(self.backups.glob('other_db_*.sql.gz'))), 1)

    def test_tailscale_inventory_maps_only_tagged_nodes(self):
        status = {
            'Self': {'DNSName': 'vps.example.ts.net.', 'HostName': 'vps',
                     'TailscaleIPs': ['100.64.0.1'], 'Tags': ['tag:hive'], 'Online': True},
            'Peer': {
                'n1': {'DNSName': 'zero2-1.example.ts.net.', 'HostName': 'zero2-1',
                       'TailscaleIPs': ['fd7a::1', '100.64.0.2'], 'Tags': ['tag:hive'], 'Online': False},
                'n2': {'DNSName': 'laptop.example.ts.net.', 'HostName': 'laptop',
                       'TailscaleIPs': ['100.64.0.3'], 'Tags': ['tag:other'], 'Online': True},
                'n3': {'DNSName': 'untagged.example.ts.net.', 'HostName': 'untagged',
                       'TailscaleIPs': ['100.64.0.4'], 'Online': True},
            },
        }
        (self.root / 'status.json').write_text(json.dumps(status))
        script = REPO / 'ansible/inventory/tailscale.py'
        env = dict(self.env, HIVE_TAILSCALE_STATUS=str(self.root / 'status.json'))

        result = subprocess.run([sys.executable, str(script), '--list'], env=env,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(sorted(data['hive_nodes']['hosts']), ['vps', 'zero2-1'])
        self.assertEqual(data['_meta']['hostvars']['zero2-1']['ansible_host'], '100.64.0.2')
        self.assertFalse(data['_meta']['hostvars']['zero2-1']['tailscale_online'])

        result = subprocess.run([sys.executable, str(script), '--host', 'vps'], env=env,
                                text=True, capture_output=True)
        self.assertEqual(json.loads(result.stdout)['ansible_host'], '100.64.0.1')

    def test_restore_imports_the_verified_dump_into_the_target(self):
        dump = self.root / 'good.sql.gz'
        with gzip.open(dump, 'wt') as handle:
            handle.write('CREATE TABLE `users` (id int);\n')
        (self.root / 'table-count').write_text('4\n')
        self.run_script('restore-db.sh', str(dump), stdin='yes\n')
        calls = self.calls()
        verify_import = calls.index('hive_registry_verify_')
        target_drop = calls.index('DROP DATABASE IF EXISTS `hive_registry`;')
        self.assertLess(verify_import, target_drop, 'target dropped before validation import')
        imported = (self.root / 'imported.sql').read_text()
        self.assertEqual(imported.count('CREATE TABLE `users`'), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
