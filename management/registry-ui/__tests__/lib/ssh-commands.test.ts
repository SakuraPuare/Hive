import { describe, expect, it } from 'vitest';
import { buildSshCommands, isSshHost } from '@/lib/ssh-commands';

describe('buildSshCommands', () => {
  it('builds all three paths when every address is present', () => {
    const commands = buildSshCommands(
      {
        hostname: 'hive-a4b2c1',
        tailscale_ip: '100.64.1.2',
        easytier_ip: '172.20.1.7',
        frp_port: 23456,
      },
      'vps.example.com',
    );

    expect(commands).toEqual([
      { kind: 'tailscale', command: 'ssh root@100.64.1.2' },
      { kind: 'easytier', command: 'ssh root@172.20.1.7' },
      { kind: 'frp', command: 'ssh -p 23456 root@vps.example.com' },
    ]);
  });

  it('skips unready Tailscale addresses and an unconfigured FRP host', () => {
    const commands = buildSshCommands(
      { tailscale_ip: 'pending', easytier_ip: '172.20.1.7', frp_port: 23456 },
      '',
    );

    expect(commands).toEqual([{ kind: 'easytier', command: 'ssh root@172.20.1.7' }]);
  });

  it('rejects unsafe FRP hosts and out-of-range ports', () => {
    expect(buildSshCommands({ frp_port: 2222 }, '-oProxyCommand=evil').filter(c => c.kind === 'frp')).toEqual([]);
    expect(buildSshCommands({ frp_port: 0 }, 'vps.example.com').filter(c => c.kind === 'frp')).toEqual([]);
    expect(buildSshCommands({ frp_port: 70000 }, 'vps.example.com').filter(c => c.kind === 'frp')).toEqual([]);
    expect(buildSshCommands({ frp_port: 2222 }, 'vps.example.com').filter(c => c.kind === 'frp')).toHaveLength(1);
  });

  it('returns an empty list when the node has no reachable address', () => {
    expect(buildSshCommands({ hostname: 'hive-a4b2c1' }, 'vps.example.com')).toEqual([]);
  });
});

describe('isSshHost', () => {
  it('accepts hostnames and IPv4, rejects shell metacharacters', () => {
    expect(isSshHost('vps.example.com')).toBe(true);
    expect(isSshHost('203.0.113.10')).toBe(true);
    expect(isSshHost('vps.example.com;reboot')).toBe(false);
    expect(isSshHost('-oProxyCommand=evil')).toBe(false);
    expect(isSshHost('')).toBe(false);
  });
});
