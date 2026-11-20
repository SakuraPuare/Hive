import { describe, expect, it } from 'vitest';
import { mihomoPanelUrl } from '@/lib/mihomo-panel';

describe('mihomoPanelUrl', () => {
  it('uses the node controller origin and keeps authentication solely in the hash router', () => {
    const url = new URL(mihomoPanelUrl('http://192.168.1.8:9090/ui?old=value#old', 'a +&?#/=中文'));
    expect(url.origin).toBe('http://192.168.1.8:9090');
    expect(url.pathname).toBe('/ui/');
    expect(url.search).toBe('');
    expect(url.hash.startsWith('#/?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(3)))).toEqual({
      hostname: '192.168.1.8', port: '9090', secret: 'a +&?#/=中文', http: 'true',
    });
  });

  it('retains bracketed IPv6 controller hostnames and an empty key', () => {
    const url = new URL(mihomoPanelUrl('http://[2001:db8::42]:9090/ui', ''));
    expect(url.origin).toBe('http://[2001:db8::42]:9090');
    expect(url.pathname).toBe('/ui/');
    expect(url.search).toBe('');
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(3)))).toEqual({
      hostname: '[2001:db8::42]', port: '9090', secret: '', http: 'true',
    });
  });
});
