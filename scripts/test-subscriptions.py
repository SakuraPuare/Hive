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
import json,os,shlex,subprocess,sys
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
    elif service=='hive-mihomo' and action in ['start','restart','stop','kill']:
        if (root/('fail-mihomo-'+action)).exists():sys.exit(1)
        state['mihomo']=False;state['gateway_connections']=False;save()
        if action in ['start','restart']:
            for line in (root/'hive-mihomo.service').read_text().splitlines():
                key,sep,value=line.partition('=')
                if not sep or key not in ['ExecCondition','ExecStartPre']:continue
                result=subprocess.run(shlex.split(value))
                if result.returncode:
                    sys.exit(0 if key=='ExecCondition' and 1<=result.returncode<=254 else 1)
            state=json.loads(p.read_text());state['mihomo']=True;save()
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
    if args[-1].endswith('/accounting/state'):
        if (root/'fail-state').exists():sys.exit(22)
        print(json.dumps({'generation':str(state.get('generation',0)), 'epoch':state.get('accounting_epoch','')}))
    elif args[-1].endswith('/accounting'):
        report=json.loads(Path(args[args.index('--data-binary')+1][1:]).read_text())
        with (root/'reports').open('a') as f:f.write(json.dumps(report)+'\n')
        generation=int(report.get('generation','0')); current=state.get('generation',0)
        status=200
        if generation<current:status=410
        elif generation==current and generation and report['epoch']!=state['accounting_epoch']:status=409
        elif generation>current:
            if generation!=current+1:status=409
            else:state.update(generation=generation,accounting_epoch=report['epoch'])
        if status==200:
            counters=state.setdefault('counters',{})
            for c in report['counters']:
                key=str(generation)+'/'+report['epoch']+'/'+c['name']
                old=counters.get(key,0);value=int(c['value'])
                state['billed']=state.get('billed',0)+max(0,value-old)
                counters[key]=max(old,value)
        save()
        if (root/'lose-response').exists() and status==200:
            (root/'lose-response').unlink();sys.exit(28)
        Path(args[args.index('-o')+1]).write_text((root/'desired.json').read_text() if status==200 else '{}')
        print(status,end='')
    else:
        Path(args[args.index('-D')+1]).write_text((root/'headers').read_text())
        shutil=None
        Path(args[args.index('-o')+1]).write_text((root/'gateway.yaml').read_text())
elif name in ['iptables','ip6tables']:
    if args[:2]==['-w','3']:args=args[2:]
    if (root/('fail-'+name)).exists():sys.exit(1)
    table='filter'
    if args[:1]==['-t']:table=args[1];args=args[2:]
    action=args[0];chain=args[1] if len(args)>1 else None
    rules=state.setdefault('firewall',{}).setdefault(name,[])
    spec=args[2:]
    if action=='-I' and spec and spec[0].isdigit():spec=spec[1:]
    rule=[table,chain]+spec
    if action=='-C':sys.exit(0 if rule in rules else 1)
    elif action=='-I':rules.insert(0,rule)
    elif action=='-A':rules.append(rule)
    elif action=='-D':
        if rule not in rules:sys.exit(1)
        rules.remove(rule)
    elif action in ['-F','-X']:
        rules[:]=[r for r in rules if r[0]!=table or (chain and r[1]!=chain)]
    else:sys.exit(2)
    state[name]=['filter','FORWARD','-m','comment','--comment','hive-subscription','-j','DROP'] in rules
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
        unit=(OVERLAY/'etc/systemd/system/hive-mihomo.service').read_text()
        (self.root/'hive-mihomo.service').write_text(unit.replace('/usr/local/bin',str(self.root/'bin')))
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

    def set_gateway_enabled(self,value):
        with (self.root/'etc/hive/config.env').open('a') as f:f.write(f'GATEWAY_ENABLED={value}\n')

    def seed_gateway_firewall(self,blocked=False):
        unrelated=[
            ['filter','FORWARD','-j','ts-forward'],
            ['filter','FORWARD','-i','easytier0','-j','ACCEPT'],
            ['filter','FORWARD','-m','comment','--comment','admin-policy','-j','DROP'],
            ['filter','INPUT','-m','comment','--comment','hive-subscription','-j','DROP'],
            ['nat','POSTROUTING','-o','eth0','-j','MASQUERADE'],
        ]
        owned=['filter','FORWARD','-m','comment','--comment','hive-subscription','-j','DROP']
        # Duplicate old drops must all be removed without touching another owner.
        self.state_update(firewall={name:([owned,owned] if blocked else [])+unrelated for name in ['iptables','ip6tables']})
        return {name:unrelated for name in ['iptables','ip6tables']}

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

    def test_lost_response_retries_without_double_billing(self):
        self.run_agent('hive-xray-sync')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'101'}])
        (self.root/'lose-response').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertEqual(self.state()['billed'],101)
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],101)
        self.assertGreater(self.state()['generation'],1)
        self.assertEqual(self.state()['clients'][0]['id'],UUID)

    def test_final_legacy_snapshot_is_flushed_before_generation_cutover(self):
        (self.root/'var/lib/hive/subscription-accounting-v1').touch()
        pending=self.root/'var/lib/hive/traffic-pending';pending.mkdir()
        (pending/'old.json').write_text(json.dumps({'epoch':'old','counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'50'}]}))
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'100'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],150)
        self.assertEqual(self.state()['generation'],1)
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'7'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],157)

    def test_pending_snapshots_replay_in_generation_order(self):
        self.run_agent('hive-xray-sync')
        pending=self.root/'var/lib/hive/traffic-pending'
        for epoch,generation,value in [('z-old',2,13),('a-new',3,17)]:
            (pending/(epoch+'.json')).write_text(json.dumps({'epoch':epoch,'generation':str(generation),'counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':str(value)}]}))
        self.state_update(xray=False,clients=[],stats=[])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],30)
        self.assertEqual(self.state()['generation'],4)

    def test_retired_snapshots_are_discarded_without_rebilling(self):
        self.run_agent('hive-xray-sync')
        self.state_update(xray=False,clients=[],stats=[])
        self.run_agent('hive-xray-sync')
        pending=self.root/'var/lib/hive/traffic-pending/stale.json'
        pending.write_text(json.dumps({'epoch':'old','generation':'1','counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'999'}]}))
        self.run_agent('hive-xray-sync')
        self.assertFalse(pending.exists())
        self.assertEqual(self.state().get('billed',0),0)
        self.assertEqual(self.state()['clients'][0]['id'],UUID)

    def test_failed_replay_sort_keeps_snapshots_and_does_not_advance_generation(self):
        self.run_agent('hive-xray-sync')
        pending=self.root/'var/lib/hive/traffic-pending/pending.json'
        pending.write_text(json.dumps({'epoch':self.state()['accounting_epoch'],'generation':'1','counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'123'}]}))
        mock=self.root/'mock/sort';mock.write_text('#!/bin/sh\nexit 1\n');mock.chmod(0o755)
        self.run_agent('hive-xray-sync',expected=1)
        self.assertTrue(pending.exists())
        self.assertEqual(self.state()['generation'],1)
        self.assertEqual(self.state().get('billed',0),0)
        mock.unlink()
        self.run_agent('hive-xray-sync')
        self.assertFalse(pending.exists())
        self.assertEqual(self.state()['billed'],123)

    def test_missing_generation_state_resets_runtime_before_recovery(self):
        self.run_agent('hive-xray-sync')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'101'}])
        self.run_agent('hive-xray-sync')
        old_epoch=self.state()['epoch']
        (self.root/'var/lib/hive/traffic-generation.json').unlink()
        self.run_agent('hive-xray-sync')
        self.assertGreater(self.state()['epoch'],old_epoch)
        self.assertEqual(self.state()['billed'],101)
        self.assertEqual(self.state()['generation'],2)

    def test_generation_lookup_failure_never_grants_fresh_runtime(self):
        (self.root/'fail-state').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        self.assertEqual(self.state()['clients'],[])

    def test_large_generation_remains_exact_and_overflow_stops(self):
        self.state_update(generation=9007199254740992,accounting_epoch='old')
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['generation'],9007199254740993)
        saved=json.loads((self.root/'var/lib/hive/traffic-generation.json').read_text())
        self.assertEqual(saved['generation'],'9007199254740993')
        self.state_update(generation=9223372036854775807,accounting_epoch='exhausted',xray=False,clients=[],stats=[])
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        self.assertEqual(self.state()['generation'],9223372036854775807)

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

    def test_gateway_off_entrypoints_preserve_unrelated_forwarding(self):
        self.set_gateway_enabled('off')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        xray_lease=access/'xray.lease';xray_lease.write_text('9999999999\n')
        lease=access/'gateway.lease'
        for name in ['hive-clash-sync','hive-gateway-prepare','hive-subscription-guard']:
            for previous in ['clean','blocked','leased','blocked-leased','expired']:
                with self.subTest(entrypoint=name,previous=previous):
                    lease.unlink(missing_ok=True)
                    if 'leased' in previous:lease.write_text('9999999999\n')
                    elif previous=='expired':lease.write_text('0\n')
                    expected=self.seed_gateway_firewall(blocked=previous.startswith('blocked'))
                    # Startup conditions run before there is a Mihomo process.
                    running=name!='hive-gateway-prepare'
                    self.state_update(mihomo=running,gateway_connections=running)
                    config=(self.root/'etc/mihomo/config.yaml').read_text()
                    self.run_agent(name,expected=1 if name=='hive-gateway-prepare' else 0)
                    self.assertEqual(self.state()['firewall'],expected)
                    self.assertFalse(lease.exists())
                    self.assertFalse(self.state()['mihomo'])
                    self.assertFalse(self.state()['gateway_connections'])
                    self.assertEqual((self.root/'etc/mihomo/config.yaml').read_text(),config)
                    self.assertTrue(self.state()['xray'])
                    self.assertTrue(self.state()['connections'])
                    self.assertEqual(xray_lease.read_text(),'9999999999\n')

    def test_gateway_off_aliases_skip_mihomo_service_start(self):
        for value in ['off','0','false','no','OFF']:
            with self.subTest(value=value):
                self.set_gateway_enabled(value)
                expected=self.seed_gateway_firewall(blocked=True)
                result=subprocess.run(['systemctl','restart','hive-mihomo'],env=self.env,capture_output=True,text=True,timeout=15)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertFalse(self.state()['mihomo'])
                self.assertEqual(self.state()['firewall'],expected)

    def test_gateway_off_keeps_expired_exit_enforcement(self):
        self.set_gateway_enabled('off')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        self.expire('xray')
        expected=self.seed_gateway_firewall(blocked=True)
        self.run_agent('hive-subscription-guard')
        self.assertFalse(self.state()['xray'])
        self.assertFalse(self.state()['connections'])
        self.assertFalse((access/'xray.lease').exists())
        self.assertFalse(self.state()['mihomo'])
        self.assertEqual(self.state()['firewall'],expected)

    def test_gateway_off_preserves_block_when_mihomo_cannot_stop(self):
        self.set_gateway_enabled('off')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        lease=access/'gateway.lease';lease.write_text('9999999999\n')
        (self.root/'fail-mihomo-stop').touch()
        (self.root/'fail-mihomo-kill').touch()
        self.seed_gateway_firewall(blocked=True)
        original=self.state()['firewall']
        for name in ['hive-clash-sync','hive-subscription-guard']:
            with self.subTest(entrypoint=name):
                self.run_agent(name,expected=1)
                self.assertTrue(self.state()['mihomo'])
                self.assertEqual(self.state()['firewall'],original)
                self.assertTrue(lease.exists())

    def test_gateway_on_without_authorization_still_blocks(self):
        self.set_gateway_enabled('on')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        (self.root/'fail-network').touch()
        for name in ['hive-clash-sync','hive-gateway-prepare','hive-subscription-guard']:
            with self.subTest(entrypoint=name):
                self.expire('gateway')
                unrelated=self.seed_gateway_firewall()
                self.run_agent(name,expected=1 if name=='hive-clash-sync' else 0)
                self.assertTrue(self.state()['iptables'])
                self.assertTrue(self.state()['ip6tables'])
                for tool,rules in self.state()['firewall'].items():
                    self.assertEqual(rules[1:],unrelated[tool])
                self.assertIn('MATCH,REJECT',(self.root/'etc/mihomo/config.yaml').read_text())

    def test_gateway_prepare_reports_firewall_failure_instead_of_skipping(self):
        # ExecCondition exit codes 1..254 mean "condition not met": systemd skips
        # Mihomo and reports the unit as successful. A real failure must exit 255,
        # otherwise GATEWAY_ENABLED=off and a broken firewall are indistinguishable
        # and both silently disable the gateway.
        self.set_gateway_enabled('on')
        self.seed_gateway_firewall()
        (self.root/'fail-iptables').touch()
        self.run_agent('hive-gateway-prepare',expected=255)
        (self.root/'fail-iptables').unlink()
        self.run_agent('hive-gateway-prepare')
        self.set_gateway_enabled('off')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        (access/'gateway.lease').write_text('9999999999\n')
        self.run_agent('hive-gateway-prepare',expected=1)
        self.assertFalse((access/'gateway.lease').exists())

    def test_gateway_prepare_reports_blocked_config_failure(self):
        self.set_gateway_enabled('on')
        self.seed_gateway_firewall()
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        self.expire('gateway')
        config=(self.root/'etc/mihomo/config.yaml')
        original=config.read_text()
        config.chmod(0o400)
        (self.root/'etc/mihomo').chmod(0o500)
        self.addCleanup((self.root/'etc/mihomo').chmod,0o700)
        # An unwritable /etc/mihomo must fail the unit, not skip it.
        self.run_agent('hive-gateway-prepare',expected=255)
        self.assertEqual(config.read_text(),original)
        # No configuration at all yet is a condition, not a failure: waiting for
        # hive-clash-sync must not make Mihomo look permanently broken.
        (self.root/'etc/mihomo').chmod(0o700)
        config.chmod(0o600)
        config.write_text('')
        self.run_agent('hive-gateway-prepare',expected=1)

    def test_gateway_reenable_requires_fresh_authorization(self):
        self.set_gateway_enabled('off')
        expected=self.seed_gateway_firewall(blocked=True)
        self.run_agent('hive-clash-sync')
        self.set_gateway_enabled('on')
        (self.root/'fail-network').touch()
        self.run_agent('hive-clash-sync',expected=1)
        self.assertTrue(self.state()['iptables'])
        self.assertTrue(self.state()['ip6tables'])
        (self.root/'fail-network').unlink()
        self.run_agent('hive-clash-sync')
        self.assertTrue(self.state()['mihomo'])
        self.assertEqual(self.state()['firewall'],expected)
        self.assertTrue((self.root/'run/hive-subscriptions/gateway.lease').exists())

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
