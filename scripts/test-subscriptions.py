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
UUID2 = '66666666-7777-4888-8999-aaaaaaaaaaaa'

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
    if '-config' in args:
        cfg=args[args.index('-config')+1]
        if not cfg.endswith('.json'):sys.exit(23)
    if args[0]=='run':sys.exit(0)
    action=args[1]
    if (root/('fail-'+action)).exists():sys.exit(1)
    if action=='statsquery':print(json.dumps({'stat':state['stats']}))
    elif action=='statsonlineiplist':print(json.dumps({'users':state.get('online',[])}))
    elif action=='lsrules':print(json.dumps({'rules':state.get('routing_rules',[])}))
    elif action=='rmrules':
        tags=[a for a in args[2:] if not a.startswith('-')]
        state['routing_rules']=[r for r in state.get('routing_rules',[]) if r.get('ruleTag') not in tags]
        save()
    elif action=='adrules':
        cfg=json.loads(Path(args[-1]).read_text())
        state['routing_rules']=state.get('routing_rules',[])+cfg['routing']['rules']
        save()
    elif action=='adu':
        if not args[-1].endswith('.json'):sys.exit(23)
        inbound=json.loads(Path(args[-1]).read_text())['inbounds'][0]
        if not inbound.get('port'):
            # Xray 26.3.27 refuses an inbound without a port but still exits 0.
            print('Added 0 user(s) in total.')
            sys.exit(0)
        clients=inbound['settings']['clients']
        if (root/'partial-adu').exists():clients=clients[:1]
        state['clients']+=clients;save()
        print(f'Added {len(clients)} user(s) in total.')
elif name=='curl':
    if (root/'fail-network').exists():sys.exit(22)
    if args[-1].endswith(('/accounting/state','/accounting','/xray-users')):
        token='server-only-token' if '/servers/' in args[-1] else 'customer-device-token'
        if 'Authorization: Bearer '+token not in args:sys.exit(22)
    if args[-1].endswith('/accounting/state'):
        if (root/'fail-state').exists():sys.exit(22)
        print(json.dumps({'generation':str(state.get('generation',0)), 'epoch':state.get('accounting_epoch','')}))
    elif args[-1].endswith(('/accounting','/xray-users')):
        report=json.loads(Path(args[args.index('--data-binary')+1][1:]).read_text())
        with (root/'reports').open('a') as f:f.write(json.dumps(report)+'\n')
        generation=int(report.get('generation','0')); current=state.get('generation',0)
        status=200
        if generation<current:status=410
        elif generation==current and generation and report['epoch']!=state['accounting_epoch']:status=409
        elif generation>current:
            if generation!=current+1 or report['epoch']==state.get('accounting_epoch'):status=409
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
        self.state_write(dict(xray=True,mihomo=True,guard=True,epoch=1,clients=[],stats=[],connections=True,gateway_connections=True,online=[],routing_rules=[]))
        self.desired([{'email':'sub-1','uuid':UUID}])
        (self.root/'headers').write_text('HTTP/1.1 200 OK\r\nX-Hive-Lease-Seconds: 45\r\nX-Hive-Access: active\r\n\r\n')
        (self.root/'gateway.yaml').write_text('mixed-port: 7890\nproxies: []\nrules:\n  - MATCH,DIRECT\n')

    def state(self):return json.loads((self.root/'runtime.json').read_text())
    def state_write(self,value): (self.root/'runtime.json').write_text(json.dumps(value))
    def state_update(self,**values):s=self.state();s.update(values);self.state_write(s)
    def desired(self,users,device_limits=None):
        body={'lease_seconds':45,'users':users}
        if device_limits is not None:body['device_limits']=device_limits
        (self.root/'desired.json').write_text(json.dumps(body))
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

    def test_device_token_runs_xray_and_uses_legacy_endpoint(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.run_agent('hive-xray-sync')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'123'}])
        self.run_agent('hive-xray-sync')
        self.assertTrue(self.state()['xray'])
        calls=(self.root/'calls').read_text()
        self.assertIn('Authorization: Bearer customer-device-token',calls)
        self.assertIn('/nodes/aabbccddeeff/xray-users',calls)
        self.assertIn('/nodes/aabbccddeeff/accounting/state',calls)
        self.assertNotIn('/servers/aabbccddeeff/accounting',calls)
        self.assertIn('123',(self.root/'reports').read_text())
        self.assertEqual(self.state()['generation'],1)
        self.assertEqual(self.state()['billed'],123)

    def test_exit_uses_only_its_separate_server_credential(self):
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.run_agent('hive-xray-sync')
        calls=(self.root/'calls').read_text()
        self.assertIn('Authorization: Bearer server-only-token',calls)
        self.assertIn('/servers/aabbccddeeff/accounting',calls)
        self.assertNotIn('customer-device-token',calls)
        self.assertNotIn('Bearer test-token',calls)

    def assert_mode_switch_preserves_counters(self,source):
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        server_key=self.root/'etc/hive/server-token'
        if source=='device':server_key.unlink()
        self.run_agent('hive-xray-sync')
        epoch=self.state()['epoch']
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'50'}])
        self.run_agent('hive-xray-sync')
        if source=='server':server_key.unlink()
        else:server_key.write_text('server-only-token')
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'80'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['epoch'],epoch)
        self.assertEqual(self.state()['generation'],1)
        self.assertEqual(self.state()['billed'],80)
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'100'}])
        (self.root/'lose-response').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertEqual(self.state()['billed'],100)
        if source=='server':server_key.write_text('server-only-token')
        else:server_key.unlink()
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],100)
        self.assertEqual(self.state()['generation'],2)
        self.assertGreater(self.state()['epoch'],epoch)
        self.assertEqual(self.state()['clients'][0]['id'],UUID)
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        final=[report for report in reports if any(c['value']=='100' for c in report['counters'])]
        self.assertGreaterEqual(len(final),2)
        self.assertTrue(all(report['generation']=='1' and report['epoch']==f'epoch-{epoch}' for report in final))
        self.assertFalse(list((self.root/'var/lib/hive/traffic-pending').glob('*.json')))
        calls=(self.root/'calls').read_text()
        self.assertIn('/nodes/aabbccddeeff/xray-users',calls)
        self.assertIn('/servers/aabbccddeeff/accounting',calls)
        state_path='/servers/' if source=='server' else '/nodes/'
        self.assertIn(state_path+'aabbccddeeff/accounting/state',calls)

    def test_server_to_device_hot_switch_preserves_counters_and_pending_snapshots(self):
        self.assert_mode_switch_preserves_counters('server')

    def test_device_to_server_hot_switch_preserves_counters_and_pending_snapshots(self):
        self.assert_mode_switch_preserves_counters('device')

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

    def test_device_generation_zero_upgrade_flushes_before_restarting(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        (self.root/'var/lib/hive/subscription-accounting-v1').touch()
        access=self.root/'run/hive-subscriptions';access.mkdir()
        (access/'xray.applied').write_text('epoch-1\n')
        (self.root/'var/lib/hive/traffic-generation.json').write_text(json.dumps({'epoch':'epoch-1','generation':'0'}))
        pending=self.root/'var/lib/hive/traffic-pending';pending.mkdir()
        (pending/'old.json').write_text(json.dumps({'epoch':'old','generation':'0','counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'50'}]}))
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'100'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['billed'],150)
        self.assertEqual(self.state()['generation'],1)
        self.assertGreater(self.state()['epoch'],1)
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertEqual([report['generation'] for report in reports],['0','0','1'])
        self.assertEqual([report['epoch'] for report in reports[:2]],['old','epoch-1'])
        self.assertEqual(reports[-1]['counters'],[])
        calls=(self.root/'calls').read_text().splitlines()
        lookup=next(i for i,call in enumerate(calls) if '/nodes/aabbccddeeff/accounting/state' in call)
        reports_before_lookup=[call for call in calls[:lookup] if '/nodes/aabbccddeeff/xray-users' in call]
        self.assertEqual(len(reports_before_lookup),2)

    def test_device_generation_zero_cannot_bypass_existing_server_fence(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        (self.root/'var/lib/hive/subscription-accounting-v1').touch()
        access=self.root/'run/hive-subscriptions';access.mkdir()
        (access/'xray.applied').write_text('epoch-1\n')
        (self.root/'var/lib/hive/traffic-generation.json').write_text(json.dumps({'epoch':'epoch-1','generation':'0'}))
        pending=self.root/'var/lib/hive/traffic-pending';pending.mkdir()
        (pending/'old.json').write_text(json.dumps({'epoch':'old','generation':'0','counters':[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'50'}]}))
        self.state_update(generation=4,accounting_epoch='former-server',stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'100'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state().get('billed',0),0)
        self.assertEqual(self.state()['generation'],5)
        self.assertGreater(self.state()['epoch'],1)
        self.assertEqual(self.state()['clients'][0]['id'],UUID)
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertEqual([report['generation'] for report in reports],['0','0','5'])
        self.assertEqual(reports[-1]['counters'],[])
        self.assertFalse(list(pending.glob('*.json')))

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

    def test_device_retired_live_runtime_stops_before_next_generation(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.run_agent('hive-xray-sync')
        old_epoch=self.state()['epoch']
        self.state_update(generation=2,accounting_epoch='other-runtime',stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'999'}])
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        self.assertFalse((self.root/'run/hive-subscriptions/xray.lease').exists())
        self.assertEqual(self.state()['generation'],2)
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['generation'],3)
        self.assertGreater(self.state()['epoch'],old_epoch)
        self.assertEqual(self.state().get('billed',0),0)
        self.assertEqual(self.state()['clients'][0]['id'],UUID)
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        retired=[report for report in reports if any(c['value']=='999' for c in report['counters'])]
        self.assertTrue(retired)
        self.assertTrue(all(report['generation']=='1' for report in retired))

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

    def test_device_generation_lookup_failure_never_grants_fresh_runtime(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        (self.root/'fail-state').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        self.assertEqual(self.state()['clients'],[])
        self.assertEqual(self.state().get('generation',0),0)
        self.assertFalse((self.root/'run/hive-subscriptions/xray.lease').exists())

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

    def test_authorization_requires_the_users_xray_actually_accepted(self):
        # Xray 26.3.27 rejects an inbound without a port while exiting 0, so a
        # sync that trusted the exit code left every subscription unauthorized.
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['clients'],[{'email':'sub-1','id':UUID,'level':0}])
        self.assertEqual((self.root/'run/hive-subscriptions/xray.users').read_text(),f'sub-1\t{UUID}\n')

    def test_owner_only_device_access_is_free_and_has_no_device_limit(self):
        (self.root/'etc/hive/server-token').unlink()
        (self.root/'etc/hive/device-token').write_text('customer-device-token')
        self.desired([{'email':'owner-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['clients'],[{'email':'owner-1','id':UUID,'level':0}])
        self.assertEqual((self.root/'run/hive-subscriptions/xray.users').read_text(),f'owner-1\t{UUID}\n')
        self.state_update(stats=[{'name':'user>>>owner-1>>>traffic>>>uplink','value':'123'},
                                 {'name':'user>>>owner-1>>>traffic>>>downlink','value':'456'}],
                          online=[{'email':'owner-1','ips':[{'ip':'203.0.113.8','lastSeen':1}]}])
        self.run_agent('hive-xray-sync')
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertTrue(all(report['counters']==[] and report.get('online',[])==[] for report in reports))
        self.assertTrue(all(report['owner_access'] is True for report in reports))
        self.assertEqual(self.state().get('billed',0),0)
        self.assertEqual(self.state()['routing_rules'],[])
        self.assertTrue(self.state()['xray'])
        calls=(self.root/'calls').read_text()
        self.assertIn('xray api adu ',calls)
        self.assertIn("-pattern user>>>sub-",calls)
        self.assertIn('/nodes/aabbccddeeff/xray-users',calls)

    def test_owner_and_subscription_users_keep_billing_and_limits_separate(self):
        self.desired([{'email':'sub-1','uuid':UUID},{'email':'owner-1','uuid':UUID2}],
                     device_limits=[{'subscription_id':1,'device_limit':1,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['clients'],[{'email':'owner-1','id':UUID2,'level':0},
                                                 {'email':'sub-1','id':UUID,'level':0}])
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'30'},
                                 {'name':'user>>>sub-1>>>traffic>>>downlink','value':'45'},
                                 {'name':'user>>>owner-1>>>traffic>>>uplink','value':'1000'},
                                 {'name':'user>>>owner-1>>>traffic>>>downlink','value':'2000'}],
                          online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1},{'ip':'203.0.113.8','lastSeen':1}]},
                                  {'email':'owner-1','ips':[{'ip':'203.0.113.9','lastSeen':1}]}])
        self.run_agent('hive-xray-sync')
        report=json.loads((self.root/'reports').read_text().splitlines()[-1])
        self.assertEqual(report['counters'],[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'30'},
                                            {'name':'user>>>sub-1>>>traffic>>>downlink','value':'45'}])
        self.assertEqual(report['online'],[{'subscription_id':1,'ips':['203.0.113.7','203.0.113.8']}])
        self.assertEqual(self.state()['billed'],75)
        self.assertEqual([{k:v for k,v in r.items() if k!='ruleTag'} for r in self.state()['routing_rules']],
                         [{'type':'field','user':['sub-1'],'source':['203.0.113.8/32'],'outboundTag':'block'}])
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertTrue(all('owner-' not in c['name'] for report in reports for c in report['counters']))
        self.assertTrue(all(report['owner_access'] is True for report in reports))

    def test_owner_capability_is_added_to_replay_without_changing_snapshots(self):
        self.desired([{'email':'owner-1','uuid':UUID}])
        self.run_agent('hive-xray-sync')
        (self.root/'lose-response').touch()
        self.run_agent('hive-xray-sync',expected=1)
        pending=list((self.root/'var/lib/hive/traffic-pending').glob('*.json'))
        self.assertTrue(pending)
        for path in pending:
            snapshot=json.loads(path.read_text())
            self.assertNotIn('owner_access',snapshot)
            self.assertNotIn('online',snapshot)
        self.run_agent('hive-xray-sync')
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertTrue(all(report['owner_access'] is True for report in reports))
        self.assertTrue(any('online' not in report for report in reports))
        self.assertFalse(list((self.root/'var/lib/hive/traffic-pending').glob('*.json')))
        self.assertFalse(list((self.root/'run/hive-subscriptions').glob('accounting-request.*')))

    def test_owner_revocation_restarts_runtime_and_preserves_paid_counters(self):
        self.desired([{'email':'sub-1','uuid':UUID},{'email':'owner-1','uuid':UUID2}])
        self.run_agent('hive-xray-sync')
        epoch=self.state()['epoch']
        self.state_update(connections=True,
                          stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'75'},
                                 {'name':'user>>>owner-1>>>traffic>>>uplink','value':'1000'}])
        self.desired([{'email':'sub-1','uuid':UUID}])
        (self.root/'calls').write_text('')
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['epoch'],epoch+1)
        self.assertFalse(self.state()['connections'])
        self.assertEqual(self.state()['clients'],[{'email':'sub-1','id':UUID,'level':0}])
        self.assertEqual((self.root/'run/hive-subscriptions/xray.users').read_text(),f'sub-1\t{UUID}\n')
        # The restarted runtime's generation reaches the registry on its next
        # report; verify continued paid access instead of that internal timing.
        self.state_update(stats=[{'name':'user>>>sub-1>>>traffic>>>uplink','value':'25'}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['clients'],[{'email':'sub-1','id':UUID,'level':0}])
        self.assertEqual(self.state()['billed'],100)
        reports=[json.loads(line) for line in (self.root/'reports').read_text().splitlines()]
        self.assertTrue(all(report['owner_access'] is True for report in reports))
        self.assertTrue(all('owner-' not in c['name'] for report in reports for c in report['counters']))
        self.assertFalse(list((self.root/'var/lib/hive/traffic-pending').glob('*.json')))
        calls=(self.root/'calls').read_text()
        self.assertEqual(calls.count('systemctl restart xray\n'),1)
        self.assertNotIn('xray api rmu ',calls)
        self.assertIn('xray api adu ',calls)

    def test_partially_applied_users_stop_the_agent(self):
        self.desired([{'email':'sub-1','uuid':UUID},{'email':'sub-2','uuid':UUID2}])
        (self.root/'partial-adu').touch()
        self.run_agent('hive-xray-sync',expected=1)
        self.assertFalse(self.state()['xray'])
        self.assertFalse((self.root/'run/hive-subscriptions/xray.lease').exists())

    def test_static_public_credentials_removed_on_startup(self):
        p=self.root/'etc/xray/config.json';config=json.loads(p.read_text())
        config['inbounds'][0]['settings']['clients']=[{'id':UUID,'email':'node-public'}]
        p.write_text(json.dumps(config))
        self.run_agent('hive-xray-prepare')
        self.assertEqual(json.loads(p.read_text())['inbounds'][0]['settings']['clients'],[])

    def test_nginx_overwrites_client_forwarded_ip_with_cloudflare_header(self):
        # Cloudflare appends the real client IP to a client-supplied
        # X-Forwarded-For. Xray takes the first value, so nginx must replace it
        # with the authoritative CF-Connecting-IP before proxying to Xray.
        config=(OVERLAY/'etc/nginx/sites-available/hive').read_text()
        self.assertIn('proxy_set_header X-Forwarded-For $http_cf_connecting_ip;',config)
        self.assertIn('proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;',config)

    def test_xray_exit_dns_bypasses_gateway_fake_ip(self):
        # The gateway mihomo owns the system resolver and returns fake-ip
        # addresses. Freedom's UseIP would dial those fake addresses directly
        # and the TUN final rule blackholes them. Xray must use its own DoH.
        config=json.loads((OVERLAY/'etc/xray/config.json').read_text())
        self.assertIn('https://223.5.5.5/dns-query',config['dns']['servers'])
        p=self.root/'etc/xray/config.json'
        cfg=json.loads(p.read_text())
        cfg.pop('dns',None)
        p.write_text(json.dumps(cfg))
        self.run_agent('hive-xray-prepare')
        self.assertIn('dns',json.loads(p.read_text()))

    def test_device_limit_blocks_new_ip_and_reports_online(self):
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1},{'ip':'203.0.113.8','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':2,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['routing_rules'],[{'type':'field','ruleTag':'hive-devlimit-1','user':['sub-1'],'source':['203.0.113.8/32'],'outboundTag':'block'}])
        report=json.loads((self.root/'reports').read_text().splitlines()[-1])
        self.assertEqual(report['online'],[{'subscription_id':1,'ips':['203.0.113.7','203.0.113.8']}])

    def test_device_limit_reconciles_rules(self):
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1},{'ip':'203.0.113.8','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':2,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(len(self.state()['routing_rules']),1)
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':1,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['routing_rules'],[])

    def test_device_limit_zero_removes_rules(self):
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1},{'ip':'203.0.113.8','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':2,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(len(self.state()['routing_rules']),1)
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':0,'used':2,'allowed_ips':[]}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['routing_rules'],[])

    def test_device_limit_query_failure_keeps_existing_rules(self):
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'203.0.113.7','lastSeen':1},{'ip':'203.0.113.8','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':2,'allowed_ips':['203.0.113.7']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(len(self.state()['routing_rules']),1)
        (self.root/'fail-statsonlineiplist').touch()
        self.run_agent('hive-xray-sync')
        self.assertEqual(len(self.state()['routing_rules']),1)

    def test_device_limit_ipv6_rule(self):
        self.state_update(online=[{'email':'sub-1','ips':[{'ip':'2001:db8::1','lastSeen':1},{'ip':'2001:db8::2','lastSeen':1}]}])
        self.desired([{'email':'sub-1','uuid':UUID}],device_limits=[{'subscription_id':1,'device_limit':1,'used':2,'allowed_ips':['2001:db8::1']}])
        self.run_agent('hive-xray-sync')
        self.assertEqual(self.state()['routing_rules'],[{'type':'field','ruleTag':'hive-devlimit-1','user':['sub-1'],'source':['2001:db8::2/128'],'outboundTag':'block'}])

    def test_outage_retries_do_not_restart_mihomo_once_in_direct_fallback(self):
        # 断网且已经切成直连兜底之后，clash-sync 每 15s 还会失败一次；此时不能重写
        # 配置、重启 mihomo（真机日志里是每 15s 一对 Stopping/Starting）。转发始终
        # 放行——订阅失效只意味着不能代理，不能把下游网络一起掐掉。
        (self.root / 'fail-network').write_text('')
        access = self.root / 'run/hive-subscriptions'
        access.mkdir(parents=True, exist_ok=True)
        (access / 'gateway.direct').write_text('')
        (access / 'gateway.lease').unlink(missing_ok=True)
        self.state_update(mihomo=True)
        (self.root / 'calls').write_text('')
        for _ in range(2):
            self.run_agent('hive-clash-sync', expected=1)
        calls = (self.root / 'calls').read_text()
        self.assertNotIn('systemctl restart hive-mihomo', calls)
        self.assertNotIn('systemctl stop hive-mihomo', calls)
        self.assertFalse(self.state().get('iptables', False), '重试期间转发必须保持放行')

    def test_expired_lease_applies_direct_fallback_exactly_once(self):
        # 授权过期（文件还在）时第一次失败必须切直连兜底：写直连配置、重启 mihomo、
        # 留下 direct 标记；之后的重试不再重启。转发不阻断。
        (self.root / 'fail-network').write_text('')
        access = self.root / 'run/hive-subscriptions'
        access.mkdir(parents=True, exist_ok=True)
        self.expire('gateway')
        (self.root / 'calls').write_text('')
        self.run_agent('hive-clash-sync', expected=1)
        first = (self.root / 'calls').read_text()
        self.assertIn('systemctl restart hive-mihomo', first)
        self.assertFalse((access / 'gateway.lease').exists())
        self.assertTrue((access / 'gateway.direct').exists())
        self.assertFalse(self.state().get('iptables', False))
        text = (self.root / 'etc/mihomo/config.yaml').read_text()
        self.assertIn('- MATCH,直连', text)
        self.assertNotIn('MATCH,REJECT', text)
        (self.root / 'calls').write_text('')
        self.run_agent('hive-clash-sync', expected=1)
        second = (self.root / 'calls').read_text()
        self.assertNotIn('systemctl restart hive-mihomo', second)
        self.assertNotIn('systemctl stop hive-mihomo', second)
        # 网恢复、授权重新有效后必须清掉直连标记并恢复代理配置。
        (self.root / 'fail-network').unlink()
        self.run_agent('hive-clash-sync')
        self.assertFalse((access / 'gateway.direct').exists(), '恢复后必须清掉 direct 标记')
        self.assertFalse(self.state().get('iptables', False), '恢复后转发必须放行')

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

    def test_gateway_off_releases_forwarding_even_when_mihomo_cannot_stop(self):
        self.set_gateway_enabled('off')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        lease=access/'gateway.lease';lease.write_text('9999999999\n')
        (self.root/'fail-mihomo-stop').touch()
        (self.root/'fail-mihomo-kill').touch()
        expected=self.seed_gateway_firewall(blocked=True)
        for name in ['hive-clash-sync','hive-subscription-guard']:
            with self.subTest(entrypoint=name):
                self.run_agent(name,expected=1)
                self.assertEqual(self.state()['firewall'],expected)
                self.assertTrue(lease.exists())

    def test_gateway_on_without_authorization_degrades_to_direct(self):
        self.set_gateway_enabled('on')
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        (self.root/'fail-network').touch()
        for name in ['hive-clash-sync','hive-gateway-prepare','hive-subscription-guard']:
            with self.subTest(entrypoint=name):
                self.expire('gateway')
                unrelated=self.seed_gateway_firewall(blocked=True)
                self.run_agent(name,expected=1 if name=='hive-clash-sync' else 0)
                self.assertFalse(self.state()['iptables'])
                self.assertFalse(self.state()['ip6tables'])
                for tool,rules in self.state()['firewall'].items():
                    self.assertEqual(rules,unrelated[tool])
                self.assertIn('MATCH,直连',(self.root/'etc/mihomo/config.yaml').read_text())
                self.assertNotIn('MATCH,REJECT',(self.root/'etc/mihomo/config.yaml').read_text())

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

    def test_gateway_prepare_without_config_never_blocks_forwarding(self):
        # 没有 mihomo 配置 = 没有网关可封。此时落 FORWARD DROP 会让热点客户端完全没网，
        # 而本单元随后被跳过，规则再没人撤销（实测：删掉 config.yaml 后 AP 断网）。
        (self.root/'etc/mihomo/config.yaml').write_text('')
        expected=self.seed_gateway_firewall(blocked=True)
        self.run_agent('hive-gateway-prepare',expected=1)
        self.assertEqual(self.state()['firewall'],expected)
        self.assertFalse(self.state()['iptables'])
        self.assertFalse(self.state()['ip6tables'])

    def test_hotspot_clients_stay_above_a_legacy_forwarding_block(self):
        # 旧固件会留下 FORWARD DROP（hive-subscription）。热点放行必须插在它上面，
        # 否则 AP 客户端"连上 Wi-Fi 完全没网"（规则顺序有语义）。新固件不再重插
        # 该 DROP，但升级后的第一次启动仍可能遇到旧规则。
        (self.root/'etc/hive/hotspot-5g.env').write_text('AP_IFACE=wlan0\nAP_IP4=10.42.1.1/24\n')
        source=(OVERLAY/'usr/local/bin/hive-hotspot-firewall.sh').read_text()
        for old,new in [('/usr/local/bin',str(self.root/'bin')),('/etc/hive',str(self.root/'etc/hive')),('/run/',str(self.root/'run/'))]:
            source=source.replace(old,new)
        p=self.root/'bin'/'hive-hotspot-firewall.sh';p.write_text(source);p.chmod(0o755)
        logger=self.root/'mock'/'logger';logger.write_text('#!/bin/sh\nexit 0\n');logger.chmod(0o755)
        ipmock=self.root/'mock'/'ip'
        ipmock.write_text('#!/bin/sh\necho "$*" >> "$HIVE_TEST_ROOT/ip-calls"\nexit 0\n');ipmock.chmod(0o755)
        self.seed_gateway_firewall(blocked=True)
        subprocess.run([str(p)],env=self.env,capture_output=True,text=True,timeout=15)
        rules=self.state()['firewall']['iptables']
        drop=['filter','FORWARD','-m','comment','--comment','hive-subscription','-j','DROP']
        accept=['filter','FORWARD','-i','wlan0','-s','10.42.1.0/24','-m','comment','--comment','hive-hotspot','-j','ACCEPT']
        nat=['nat','POSTROUTING','-s','10.42.1.0/24','!','-o','Meta','-m','comment','--comment','hive-hotspot-nat','-j','MASQUERADE']
        self.assertIn(drop,rules)
        self.assertIn(accept,rules)
        self.assertIn(nat,rules)
        self.assertLess(rules.index(accept),rules.index(drop),'热点放行必须在门禁 DROP 之上')
        ret=['filter','FORWARD','-o','wlan0','-m','conntrack','--ctorigsrc','10.42.1.0/24','-m','comment','--comment','hive-hotspot-ret','-j','ACCEPT']
        self.assertIn(ret,rules,'回程回包也必须在门禁之上放行')
        self.assertLess(rules.index(ret),rules.index(drop))
        self.assertIn('rule add from 10.42.1.0/24 lookup main pref 8000',(self.root/'ip-calls').read_text())

    def test_gateway_entrypoints_remove_the_legacy_forwarding_block(self):
        # 升级后第一次启动/同步必须无条件撤掉旧固件留下的 DROP（转发只由 mihomo
        # 直连兜底接管），否则客户端会一直断网。
        self.seed_gateway_firewall(blocked=True)
        (self.root/'run/hive-subscriptions').mkdir(parents=True,exist_ok=True)
        self.expire('gateway')
        self.run_agent('hive-gateway-prepare')
        self.assertFalse(self.state()['iptables'])
        self.assertFalse(self.state()['ip6tables'])

    def test_gateway_reenable_requires_fresh_authorization(self):
        self.set_gateway_enabled('off')
        expected=self.seed_gateway_firewall(blocked=True)
        self.run_agent('hive-clash-sync')
        self.set_gateway_enabled('on')
        (self.root/'fail-network').touch()
        self.run_agent('hive-clash-sync',expected=1)
        self.assertFalse(self.state()['iptables'])
        self.assertFalse(self.state()['ip6tables'])
        self.assertIn('MATCH,直连',(self.root/'etc/mihomo/config.yaml').read_text())
        (self.root/'fail-network').unlink()
        self.run_agent('hive-clash-sync')
        self.assertTrue(self.state()['mihomo'])
        self.assertEqual(self.state()['firewall'],expected)
        self.assertTrue((self.root/'run/hive-subscriptions/gateway.lease').exists())

    def test_gateway_expiry_degrades_to_direct(self):
        self.run_agent('hive-clash-sync')
        self.state_update(gateway_connections=True)
        self.expire('gateway')
        self.run_agent('hive-subscription-guard')
        self.assertFalse(self.state().get('iptables', False));self.assertFalse(self.state().get('ip6tables', False))
        self.assertFalse(self.state()['gateway_connections'])
        self.assertIn('MATCH,直连',(self.root/'etc/mihomo/config.yaml').read_text())
        self.assertNotIn('MATCH,REJECT',(self.root/'etc/mihomo/config.yaml').read_text())
        self.run_agent('hive-clash-sync')
        self.assertFalse(self.state().get('iptables', False));self.assertFalse(self.state().get('ip6tables', False))

    def test_gateway_unchanged_config_still_renews_lease(self):
        self.run_agent('hive-clash-sync')
        self.expire('gateway')
        self.run_agent('hive-clash-sync')
        self.assertGreater(int((self.root/'run/hive-subscriptions/gateway.lease').read_text()),0)

    def test_installed_config_lets_the_node_reach_the_registry(self):
        # 实测：registry 域名是普通 .cn 名，会命中下发配置里的 cn_domain -> REJECT；
        # 而 PROCESS-NAME 在本机匹配不到（docs/GATEWAY.md），节点于是既拉不到订阅也发不出
        # 心跳，面板一直离线。源地址规则必须在装上之前就补进配置里。
        self.run_agent('hive-clash-sync')
        cfg=self.root/'etc/mihomo/config.yaml'
        rules=[line.strip() for line in cfg.read_text().splitlines()
               if line.strip().startswith('- ')]
        self.assertEqual(rules[0],'- SRC-IP-CIDR,198.18.0.1/32,DIRECT')
        # IPv6 那条同样关键：auto-route 也接管 ::/1，EasyTier 对端的 v6 直连包
        # 会带着 TUN 的 v6 源地址进来（实测 [fdfe:dcba:9876::1]:11010 -> ... REJECT）。
        self.assertIn('- SRC-IP-CIDR,fdfe:dcba:9876::1/128,DIRECT',rules)
        self.assertLess(rules.index('- SRC-IP-CIDR,198.18.0.1/32,DIRECT'),rules.index('- MATCH,DIRECT'))
        self.assertIn('mixed-port: 7890',cfg.read_text())
        # 重复同步（或 registry 模板已带该规则）不得叠加出第二条。
        again=subprocess.run(['bash','-c',f'source {self.root}/bin/hive-subscription-state; hive_gateway_self_direct {cfg}'],
                             env=self.env,capture_output=True,text=True)
        self.assertEqual(again.returncode,0,again.stdout+again.stderr)
        self.assertEqual(cfg.read_text().count('SRC-IP-CIDR,198.18.0.1/32,DIRECT'),1)
        self.assertEqual(cfg.read_text().count('SRC-IP-CIDR,fdfe:dcba:9876::1/128,DIRECT'),1)

    def test_installed_config_keeps_its_own_dns_out_of_the_rules(self):
        # 交付配置带 dns.respect-rules: true。节点没有可用上游时终端规则就是
        # RULE-SET,cn_domain,REJECT / MATCH,REJECT，mihomo 自己的 DoH 也被拒：
        # 实测 "[TCP] mihomo --> 223.5.5.5:443 match Match using REJECT"，随后
        # tailscaled 注册 "context deadline exceeded"、节点在面板上永久离线。
        (self.root/'gateway.yaml').write_text(
            'mixed-port: 7890\ndns:\n  enable: true\n  respect-rules: true\n'
            "  fake-ip-filter:\n    - 'rule-set:private_domain'\n"
            'proxies: []\nrules:\n  - MATCH,REJECT\n')
        self.run_agent('hive-clash-sync')
        text = (self.root/'etc/mihomo/config.yaml').read_text()
        self.assertIn('respect-rules: false', text)
        self.assertNotIn('respect-rules: true', text)
        # tailscaled 绑定物理网卡地址直连控制面，fake-IP 会让它 SYN 黑洞
        # （实测 SYN-SENT 192.168.5.222 -> 198.18.0.20:443，注册 10s 超时）。
        # Tailscale 域名必须拿到真实地址。
        self.assertEqual(text.count("'+.tailscale.com'"), 1)
        self.assertEqual(text.count("'+.tailscale.io'"), 1)
        # 再同步一次不得叠加。
        self.run_agent('hive-clash-sync')
        again = (self.root/'etc/mihomo/config.yaml').read_text()
        self.assertEqual(again.count("'+.tailscale.com'"), 1)

    def test_tailscale_fakeip_exception_is_added_even_when_rules_are_complete(self):
        # 实机回归：registry 模板已经带了 v4/v6 自直连规则和 respect-rules:false，
        # 旧早退条件于是跳过了 fake-IP 过滤，tailscaled 依旧 SYN-SENT 到
        # 198.18.0.20:443（注册 10s 超时）。过滤必须独立于规则补齐。
        (self.root/'gateway.yaml').write_text(
            "mixed-port: 7890\ndns:\n  enable: true\n  respect-rules: false\n"
            "  enhanced-mode: fake-ip\n  fake-ip-filter:\n    - 'rule-set:private_domain'\n"
            "proxies: []\nrules:\n  - SRC-IP-CIDR,198.18.0.1/32,DIRECT\n"
            "  - SRC-IP-CIDR,fdfe:dcba:9876::1/128,DIRECT\n  - MATCH,REJECT\n")
        self.run_agent('hive-clash-sync')
        text = (self.root/'etc/mihomo/config.yaml').read_text()
        self.assertEqual(text.count("'+.tailscale.com'"), 1)
        self.assertEqual(text.count("'+.tailscale.io'"), 1)

    def test_direct_fallback_keeps_the_node_reachable(self):
        # 实测：本机 mihomo 匹配不到 PROCESS-NAME（连 find-process-mode=always 也不行），
        # 只按进程名白名单时，节点自己到 registry 的 TLS 会落到终端 REJECT 被掐掉。
        # 必须按 TUN 源地址放行本机流量（该规则在直连兜底配置里继续保留）。
        self.set_gateway_enabled('on')
        self.seed_gateway_firewall()
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        self.expire('gateway')
        # registry 下发的配置带 dns.respect-rules: true，解析请求因此也走规则引擎。
        config=self.root/'etc/mihomo/config.yaml'
        text=config.read_text().replace('dns:\n', 'dns:\n  respect-rules: true\n', 1)
        config.write_text(text)
        self.run_agent('hive-gateway-prepare')
        text=config.read_text()
        rules=[line.strip() for line in text.splitlines() if line.strip().startswith('- ')]
        self.assertIn('- SRC-IP-CIDR,198.18.0.1/32,DIRECT',rules)
        self.assertIn('- SRC-IP-CIDR,fdfe:dcba:9876::1/128,DIRECT',rules)
        self.assertLess(rules.index('- SRC-IP-CIDR,198.18.0.1/32,DIRECT'),rules.index('- MATCH,直连'))
        # 实测日志 "[TCP] mihomo --> 223.5.5.5:443 match Match using REJECT"：fail-closed
        # 下 DNS 若仍受规则约束，解析全灭、租约永远拉不到，节点永久离线。
        dns_part=text.split('\nrules:\n')[0]
        self.assertIn('respect-rules: false',dns_part)
        self.assertNotIn('respect-rules: true',text)

    def test_direct_fallback_switches_to_tproxy_and_keeps_hotspot_direct(self):
        self.set_gateway_enabled('on')
        self.seed_gateway_firewall()
        access=self.root/'run/hive-subscriptions';access.mkdir(exist_ok=True)
        self.expire('gateway')
        config=self.root/'etc/mihomo/config.yaml'
        config.write_text(config.read_text()+'\ntun:\n  enable: true\n  auto-route: true\n')
        self.run_agent('hive-gateway-prepare')
        text=config.read_text()
        self.assertIn('tproxy-port: 7893',text)
        self.assertNotIn('\ntun:\n',text)
        self.assertIn('- SRC-IP-CIDR,10.42.1.0/24,DIRECT',text)
        self.assertIn('- MATCH,直连',text)

    def test_gateway_missing_lease_uses_direct_fallback(self):
        (self.root/'headers').write_text('HTTP/1.1 200 OK\r\n\r\n')
        self.run_agent('hive-clash-sync',expected=1)
        self.assertFalse(self.state().get('iptables', False))
        self.assertFalse(self.state().get('ip6tables', False))
        text=(self.root/'etc/mihomo/config.yaml').read_text()
        self.assertIn('MATCH,直连',text)
        self.assertNotIn('MATCH,REJECT',text)
        self.run_agent('hive-gateway-prepare')
        self.assertFalse(self.state().get('ip6tables', False))

if __name__=='__main__':unittest.main(verbosity=2)
