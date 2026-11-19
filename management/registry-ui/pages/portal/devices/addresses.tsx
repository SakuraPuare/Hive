import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Copy, Check, RefreshCw } from 'lucide-react';
import { useCustomer } from '@/lib/portal-auth';
import { apiPath } from '@/lib/openapi-session';
import { useClipboard } from '@/lib/use-clipboard';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';

interface DeviceAddresses {
  hostname: string;
  mac: string;
  last_seen: string;
  sampled_at: string | null;
  lan: Array<{ interface: string; address: string; prefix_length: number }>;
  tailscale_ip: string;
  easytier_ip: string;
  mesh_ip: string;
  cf_url: string;
  frp: { host: string; port: number };
  egress: { ipv4: string; ipv6: string; sampled_at: string | null };
}

function AddressRow({ label, value, link = false }: { label: string; value: string; link?: boolean }) {
  const t = useTranslations('deviceAddresses');
  const { copy, copied } = useClipboard();
  const [copyFailed, setCopyFailed] = useState(false);
  let safeLink = false;
  if (link && value) {
    try {
      const url = new URL(value);
      safeLink = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { /* Non-URL values remain copyable text, never navigation targets. */ }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        {value ? safeLink ? (
          <a className="break-all font-mono text-sm text-primary underline" href={value} target="_blank" rel="noopener noreferrer">{value}</a>
        ) : <p className="break-all font-mono text-sm">{value}</p> : <p className="text-sm text-muted-foreground">{t('unknown')}</p>}
      </div>
      {value && (
        <div>
          <Button variant="outline" size="sm" aria-label={t('copyAddress', { label, address: value })} onClick={async () => setCopyFailed(!await copy(value))}>
            {copied ? <Check className="mr-2 size-4" aria-hidden="true" /> : <Copy className="mr-2 size-4" aria-hidden="true" />}
            {copied ? t('copied') : t('copy')}
          </Button>
          {copyFailed && <p role="alert" className="text-sm text-destructive">{t('copyFailed')}</p>}
        </div>
      )}
    </div>
  );
}

export default function DeviceAddressesPage() {
  const t = useTranslations('deviceAddresses');
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();
  const fmt = useFormat();
  const mac = typeof router.query.mac === 'string' ? router.query.mac : '';
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ mac: string; data: DeviceAddresses | null; status: 'loading' | 'ready' | 'unavailable' | 'error' } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Only update the displayed age; address refreshes never trigger automatic probes.
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!router.isReady || authLoading) return;
    if (!customer) {
      router.replace('/portal/login');
      return;
    }
    if (!mac) {
      setResult({ mac, data: null, status: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setResult({ mac, data: null, status: 'loading' });
    const load = async () => {
      try {
        const response = await fetch(apiPath(`/portal/devices/${encodeURIComponent(mac)}/addresses`), {
          credentials: 'include', signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          router.replace('/portal/login');
          return;
        }
        if (response.status === 404) {
          setResult({ mac, data: null, status: 'unavailable' });
          return;
        }
        if (!response.ok) throw new Error('Address request failed');
        const data: DeviceAddresses = await response.json();
        if (!active) return;
        setNow(Date.now());
        setResult({ mac, data, status: 'ready' });
      } catch {
        if (active) setResult({ mac, data: null, status: 'error' });
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [router.isReady, router, authLoading, customer, mac, refresh]);

  if (!router.isReady || authLoading || !customer) {
    return <div role="status" aria-busy="true" className="py-24 text-center">{t('loading')}</div>;
  }
  const current = result?.mac === mac ? result : null;
  const loading = !current || current.status === 'loading';
  const data = current?.data;
  const lanStale = !!data?.sampled_at && now - Date.parse(data.sampled_at) > 150000;
  const egressStale = !!data?.egress.sampled_at && now - Date.parse(data.egress.sampled_at) > 7200000;
  const sampleTime = (sample: string | null) => sample ? `${fmt.dateTime(sample, t('unknown'))} · ${fmt.relative(sample, t('unknown'))}` : t('unknown');
  const frpHost = data?.frp.host ?? '';
  const frp = frpHost && data?.frp.port && data.frp.port > 0
    ? `${frpHost.includes(':') && !frpHost.startsWith('[') ? `[${frpHost}]` : frpHost}:${data.frp.port}` : '';

  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('description')} actions={
        <>
          <Button variant="outline" asChild><Link href="/portal/devices"><ArrowLeft className="mr-2 size-4" aria-hidden="true" />{t('back')}</Link></Button>
          <Button variant="outline" disabled={loading || !mac} onClick={() => setRefresh((value) => value + 1)}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />{t('refresh')}
          </Button>
        </>
      } />
      {loading && <p role="status" aria-busy="true">{t('loading')}</p>}
      {current?.status === 'unavailable' && <p role="status">{t('unavailable')}</p>}
      {current?.status === 'error' && <p role="alert" className="text-destructive">{t('loadFailed')}</p>}
      {data && <>
        <Card>
          <CardHeader><CardTitle>{data.hostname || t('unknown')}</CardTitle></CardHeader>
          <CardContent>
            <AddressRow label={t('mac')} value={data.mac} />
            <p className="pt-3 text-sm"><span className="text-muted-foreground">{t('lastSeen')}: </span>{sampleTime(data.last_seen)}</p>
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t('lan')}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('lanSampledAt')}: {sampleTime(data.sampled_at)}</p>
              {lanStale && <p role="status" className="mt-2 text-sm text-md-on-tertiary-container">{t('lanStale')}</p>}
              {!data.sampled_at && <p className="py-3 text-sm text-muted-foreground">{t('lanUnknown')}</p>}
              {data.sampled_at && data.lan.length === 0 && <p className="py-3 text-sm text-muted-foreground">{t('lanEmpty')}</p>}
              {data.lan.map((address) => <AddressRow key={`${address.interface}-${address.address}-${address.prefix_length}`} label={address.interface} value={`${address.address}/${address.prefix_length}`} />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('overlay')}</CardTitle></CardHeader>
            <CardContent>
              <AddressRow label={t('tailscale')} value={data.tailscale_ip} />
              <AddressRow label={t('easytier')} value={data.easytier_ip} />
              <AddressRow label={t('mesh')} value={data.mesh_ip} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('remoteAccess')}</CardTitle></CardHeader>
            <CardContent>
              <AddressRow label={t('frp')} value={frp} />
              <AddressRow label={t('cloudflare')} value={data.cf_url} link />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('egress')}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('egressHint')}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t('egressSampledAt')}: {sampleTime(data.egress.sampled_at)}</p>
              {egressStale && <p role="status" className="mt-2 text-sm text-md-on-tertiary-container">{t('egressStale')}</p>}
              <AddressRow label={t('ipv4')} value={data.egress.ipv4} />
              <AddressRow label={t('ipv6')} value={data.egress.ipv6} />
            </CardContent>
          </Card>
        </div>
      </>}
    </PageContainer>
  );
}
