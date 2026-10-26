#!/usr/bin/env python3
"""Exercise real device scripts with isolated service, Xray and Registry doubles."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
OVERLAY = REPO / 'armbian-build/userpatches/overlay'
UUID = '11111111-2222-4333-8444-555555555555'

MOCK = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['HIVE_TEST_ROOT'])
name=Path(sys.argv[0]).name; args=sys.argv[1:]
p=root/'runtime.json'; state=json.loads(p.read_text())
def save():p.write_text(json.dumps(state))
with (root/'calls').open('a') as f:f.write(name+' '+' '.join(args)+'\n')
if name=='systemctl':
    action=args[0];service=args[-1]
    if action=='show':print('epoch-'+str(state['epoch']))
    elif action=='is-active':
        if service=='hive-subscription-guard.timer':sys.exit(0 if state['guard'] else 3)
        sys.exit(0 if state['xray' if service=='xray' else 'mihomo'] else 3)
    elif service=='xray' and action in ['start','restart','stop','kill']:
        if action in ['stop','kill']:
            state['xray']=False;state['clients']=[];state['connections']=False
        elif action=='restart' or not state['xray']:
            state.update(xray=True,epoch=state['epoch']+1,clients=[],connections=False,stats=[])
        save()
    elif service=='hive-mihomo' and action in ['start','restart','stop']:
        state['mihomo']=action!='stop';state['gateway_connections']=False;save()
elif name=='xray':
    if args[0]=='run':sys.exit(0)
    action=args[1]
    if (root/('fail-'+action)).exists():sys.exit(1)
    if action=='statsquery':print(json.dumps({'stat':state['stats']}))
    elif action=='adu':
        clients=json.loads(Path(args[-1]).read_text())['inbounds'][0]['settings']['clients']
        state['clients']+=clients;save()
elif name=='curl':
    if (root/'fail-network').exists():sys.exit(22)
    if args[-1].endswith('/accounting'):
        report=json.loads(Path(args[args.index('--data-binary')+1][1:]).read_text())
        with (root/'reports').open('a') as f:f.write(json.dumps(report)+'\n')
        print((root/'desired.json').read_text())
    else:
        Path(args[args.index('-D')+1]).write_text((root/'headers').read_text())
        shutil=None
        Path(args[args.index('-o')+1]).write_text((root/'gateway.yaml').read_text())
elif name in ['iptables','ip6tables']:
    if '-C' in args:sys.exit(0 if state.get(name,False) else 1)
    if '-I' in args:state[name]=True
    if '-D' in args:state[name]=False
    save()
elif name=='mihomo':
    if (root/'fail-config-test').exists():sys.exit(1)
'''


class SubscriptionScripts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hive-subscription-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for d in ['etc/hive','etc/xray','etc/mihomo','var/lib/hive','run','bin','mock']:
            (self.root/d).mkdir(parents=True)
        self.env = dict(os.environ,HIVE_TEST_ROOT=str(self.root),PATH=str(self.root/'mock')+':'+os.environ['PATH'])
        for name in ['systemctl','xray','curl','iptables','ip6tables','mihomo']:
            p=self.root/'mock'/name;p.write_text(MOCK);p.chmod(0o755)
        for name in ['hive-node-info','hive-subscription-state','hive-xray-prepare','hive-gateway-prepare','hive-subscription-guard','hive-xray-sync','hive-clash-sync']:
            source=(OVERLAY/'usr/local/bin'/name).read_text()
            for old,new in [('/usr/local/bin',str(self.root/'bin')),('/etc/hive',str(self.root/'etc/hive')),('/etc/xray',str(self.root/'etc/xray')),('/etc/mihomo',str(self.root/'etc/mihomo')),('/var/lib/hive',str(self.root/'var/lib/hive')),('/run/hive-subscriptions',str(self.root/'run/hive-subscriptions'))]:source=source.replace(old,new)
            p=self.root/'bin'/name;p.write_text(source);p.chmod(0o755)
        (self.root/'etc/hive/config.env').write_text('NODE_REGISTRY_URL=https://registry.invalid\nNODE_REGISTRY_API_SECRET=test-token\n')
        (self.root/'etc/hive/server-token').write_text('server-only-token')
        (self.root/'etc/hive/node-info').write_text('MAC=aabbccddeeff\n')
        for rel in ['etc/xray/config.json','etc/mihomo/config.yaml']:shutil.copy(OVERLAY/rel,self.root/rel)
        self.state_write(dict(xray=True,mihomo=True,guard=True,epoch=1,clients=[],stats=[],connections=True,gateway_connections=True))
        self.desired([{'email':'sub-1','uuid':UUID}])
        (self.root/'headers').write_text('HTTP/1.1 200 OK\r\nX-Hive-Lease-Seconds: 45\r\nX-Hive-Access: active\r\n\r\n')
        (self.root/'gateway.yaml').write_text('mixed-port: 7890\nproxies: []\nrules:\n  - MATCH,DIRECT\n')

    def state(self):return json.loads((self.root/'runtime.json').read_text())
    def state_write(self,value): (self.root/'runtime.json').write_text(json.dumps(value))
    def state_update(self,**values):s=self.state();s.update(values);self.state_write(s)
    def desired(self,users): (self.root/'desired.json').write_text(json.dumps({'lease_seconds':45,'users':users}))
    def run_agent(self,name,expected=0):
        p=subprocess.run([str(self.root/'bin'/name)],env=self.env,capture_output=True,text=True,timeout=15)
        self.assertEqual(p.returncode,expected,p.stdout+p.stderr)
        return p
    def expire(self,role): (self.root/f'run/hive-subscriptions/{role}.lease').write_text('0\n')

    def test_customer_device_never_reports_even_with_device_or_legacy_key(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'123'}])
        self.run_agent('hive-xray-sync')
        self.assertFalse(self.state()['xray'])
        self.assertFalse(self.state()['connections'])
        self.assertFalse((self.root/'reports').exists())
        self.assertNotIn('curl ', (self.root/'calls').read_text())

    def test_exit_uses_only_its_separate_server_credential(self):
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.run_agent('hive-xray-sync')
        calls=(self.root/'calls').read_text()
        self.assertIn('Authorization: Bearer server-only-token',calls)
        self.assertIn('/servers/aabbccddeeff/accounting',calls)
        self.assertNotIn('customer-device-token',calls)
        self.assertNotIn('Bearer test-token',calls)

    def test_removing_server_key_stops_existing_exit_without_renewal(self):
        self.run_agent('hive-xray-sync')
        old=(self.root/'reports').read_text()
        (self.root/'etc/hive/server-token').unlink()
        self.state_update(connections=True)
        self.run_agent('hive-xray-sync')
        self.assertEqual((self.root/'reports').read_text(),old)
        self.assertFalse(self.state()['xray'])
        self.assertFalse(self.state()['connections'])

    def test_upgrade_does_not_rebill_prometheus_history(self):
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'999999'}])
        self.run_agent('hive-xray-sync')
        self.assertNotIn('999999',(self.root/'reports').read_text())

    def test_revocation_closes_existing_connections(self):
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['clients'][0]['id'],UUID)
        self.state_update(connections=True)
        old_epoch=self.state()['epoch']
        self.desired([])
        self.run_agent('hive-xray-sync')
        self.assertGreater(self.state()['epoch'],old_epoch)
        self.assertFalse(self.state()['connections'])
        self.assertEqual(self.state()['clients'],[])

    def test_revocation_restores_other_valid_subscribers(self):
        other='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        self.desired([{'email':'sub-1','uuid':UUID},{'email':'sub-2','uuid':other}])
        self.run_agent('hive-xray-sync')
        self.desired([{'email':'sub-2','uuid':other}])
        self.run_agent('hive-xray-sync')
        self.assertEqual([c['id'] for c in self.state()['clients']],[other])

    def test_outage_expires_lease_and_replays_final_traffic(self):
        self.run_agent('hive-xray-sync')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'101'}])
        (self.root/'fail-network').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertTrue(self.state()['xray'])
        self.expire('xray');self.run_agent('hive-subscription-guard')
        self.assertFalse(self.state()['xray'])
        self.assertFalse(self.state()['connections'])
        pending=list((self.root/'var/lib/hive/traffic-pending').glob('*.json'))
        self.assertTrue(any('101' in p.read_text() for p in pending))
        (self.root/'fail-network').unlink()
        self.run_agent('hive-xray-sync')
        self.assertIn('101',(self.root/'reports').read_text())
        self.assertEqual(self.state()['clients'][0]['id'],UUID)

    def test_stats_failure_immediately_stops_unmetered_access(self):
        self.run_agent('hive-xray-sync')
        (self.root/'fail-statsquery').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])

    def test_invalid_response_never_extends_lease(self):
        self.run_agent('hive-xray-sync')
        self.expire('xray')
        (self.root/'desired.json').write_text('{"users": []}')
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])

    def test_failed_add_stops_and_retries_from_clean_runtime(self):
        (self.root/'fail-adu').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        (self.root/'fail-adu').unlink()
        self.run_agent('hive-xray-sync')
        self.assertEqual(len(self.state()['clients']),1)

    def test_static_public_credentials_removed_on_startup(self):
        p=self.root/'etc/xray/config.json';config=json.loads(p.read_text())
        config['inbounds'][0]['settings']['clients']=[{'id':UUID,'email':'node-public'}]
        p.write_text(json.dumps(config))
        self.run_agent('hive-xray-prepare')
        self.assertEqual(json.loads(p.read_text())['inbounds'][0]['settings']['clients'],[])

    def test_gateway_expiry_blocks_ipv4_ipv6_and_closes_tunnels(self):
        self.run_agent('hive-clash-sync')
        self.state_update(gateway_connections=True)
        self.expire('gateway')
        self.run_agent('hive-subscription-guard')
        self.assertTrue(self.state()['iptables']);self.assertTrue(self.state()['ip6tables'])
        self.assertFalse(self.state()['gateway_connections'])
        self.assertIn('MATCH,REJECT',(self.root/'etc/mihomo/config.yaml').read_text())
        self.run_agent('hive-clash-sync')
        self.assertFalse(self.state()['iptables']);self.assertFalse(self.state()['ip6tables'])

    def test_gateway_unchanged_config_still_renews_lease(self):
        self.run_agent('hive-clash-sync')
        self.expire('gateway')
        self.run_agent('hive-clash-sync')
        self.assertGreater(int((self.root/'run/hive-subscriptions/gateway.lease').read_text()),0)

    def test_gateway_rejects_missing_lease_and_blocks_boot_fallback(self):
        (self.root/'headers').write_text('HTTP/1.1 200 OK\r\n\r\n')
        self.run_agent('hive-clash-sync',expected=1)
        self.assertTrue(self.state()['iptables'])
        self.assertIn('MATCH,REJECT',(self.root/'etc/mihomo/config.yaml').read_text())
        self.run_agent('hive-gateway-prepare')
        self.assertTrue(self.state()['ip6tables'])

if __name__=='__main__':unittest.main(verbosity=2)
