export type MihomoNetwork =
  | 'wan' | 'lan' | 'physical' | 'hotspot5g' | 'hotspot2g'
  | 'easytier' | 'tailscale' | 'mesh'
  | 'lan-fallback' | 'hotspot5g-fallback' | 'hotspot2g-fallback';

export type DashboardInfo = {
  mac: string;
  secret: string;
  sampled_at: string | null;
  endpoints: { network: MihomoNetwork; interface: string; address: string; url: string }[];
  egress: { ipv4: string; ipv6: string; sampled_at: string | null };
};

/** Connect the node-hosted panel without putting the controller key in HTTP request logs. */
export function mihomoPanelUrl(endpointUrl: string, secret: string): string {
  const url = new URL(endpointUrl);
  const params = new URLSearchParams({
    hostname: url.hostname,
    port: url.port,
    secret,
    http: 'true',
  }).toString();
  url.pathname = '/ui/';
  url.search = '';
  url.hash = `/?${params}`;
  return url.toString();
}
