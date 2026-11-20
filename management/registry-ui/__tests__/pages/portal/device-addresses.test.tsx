import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import DeviceAddressesPage from '@/pages/portal/devices/addresses';
import { mockRouter } from '@/test/setup';
import en from '@/messages/en.json';
import zh from '@/messages/zh.json';

const mockUseCustomer = vi.fn();
vi.mock('@/lib/portal-auth', () => ({ useCustomer: () => mockUseCustomer() }));
vi.mock('@/lib/openapi-session', () => ({ apiPath: (path: string) => `/api${path}` }));

const customer = { id: 1, email: 'owner@example.com' };
const mockFetch = vi.fn();
const writeText = vi.fn();
const now = Date.parse('2026-11-20T12:00:00Z');
const fullAddresses = {
  hostname: 'hive-cdeeff', mac: 'aabbccddeeff', last_seen: '2026-11-20T11:59:45Z',
  sampled_at: '2026-11-20T11:59:30Z',
  lan: [
    { interface: 'eth0', address: '192.168.5.228', prefix_length: 24 },
    { interface: 'eth0', address: '2001:db8:1::228', prefix_length: 64 },
    { interface: 'wlan0', address: '10.42.0.1', prefix_length: 24 },
  ],
  egress: { ipv4: '203.0.113.9', ipv6: '2001:db8:3::9', sampled_at: '2026-11-20T11:00:00Z' },
};

interface AddressResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function response(data: unknown = fullAddresses, status = 200): AddressResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

describe('DeviceAddressesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(response());
    mockUseCustomer.mockReturnValue({ customer, loading: false });
    mockRouter.query = { mac: fullAddresses.mac };
    mockRouter.isReady = true;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.stubGlobal('fetch', mockFetch);
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows and individually copies LAN, Cloudflare and egress addresses without management networks', async () => {
    render(<DeviceAddressesPage />);
    await screen.findByText(fullAddresses.hostname);
    expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/aabbccddeeff/addresses', {
      credentials: 'include', signal: expect.any(AbortSignal),
    });
    const values = [
      fullAddresses.mac, '192.168.5.228/24', '2001:db8:1::228/64', '10.42.0.1/24',
      fullAddresses.egress.ipv4, fullAddresses.egress.ipv6,
    ];
    for (const value of values) {
      const row = screen.getByText(value).parentElement!.parentElement!;
      fireEvent.click(within(row).getByRole('button'));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(value));
    }
    expect(screen.getAllByText('eth0')).toHaveLength(2);
    expect(screen.getByText('wlan0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'deviceAddresses.back' })).toHaveAttribute('href', '/portal/devices');
    expect(screen.getByText(/deviceAddresses.lastSeen/)).toBeInTheDocument();
    expect(screen.getByText(/deviceAddresses.lanSampledAt/)).toBeInTheDocument();
    expect(screen.getByText(/deviceAddresses.egressSampledAt/)).toBeInTheDocument();
    expect(screen.queryByText('deviceAddresses.lanStale')).not.toBeInTheDocument();
    expect(screen.queryByText('deviceAddresses.egressStale')).not.toBeInTheDocument();
  });

  it('distinguishes unknown LAN data from a current empty snapshot and blank endpoints', async () => {
    const empty = {
      ...fullAddresses, last_seen: '', sampled_at: null, lan: [],
      egress: { ipv4: '', ipv6: '', sampled_at: null },
    };
    mockFetch.mockResolvedValueOnce(response(empty)).mockResolvedValueOnce(response({ ...empty, sampled_at: fullAddresses.sampled_at }));
    render(<DeviceAddressesPage />);
    await screen.findByText('deviceAddresses.lanUnknown');
    expect(screen.queryByText('deviceAddresses.lanEmpty')).not.toBeInTheDocument();
    expect(screen.getAllByText('deviceAddresses.unknown').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole('button', { name: 'deviceAddresses.copyAddress' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'deviceAddresses.refresh' }));
    await screen.findByText('deviceAddresses.lanEmpty');
    expect(screen.queryByText('deviceAddresses.lanUnknown')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('warns independently about LAN over 150 seconds and egress over two hours without probing repeatedly', async () => {
    mockFetch.mockResolvedValue(response({
      ...fullAddresses, sampled_at: '2026-11-20T11:57:29Z',
      egress: { ...fullAddresses.egress, sampled_at: '2026-11-20T09:59:59Z' },
    }));
    render(<DeviceAddressesPage />);
    await screen.findByText('deviceAddresses.lanStale');
    expect(screen.getByText('deviceAddresses.egressStale')).toBeInTheDocument();
    expect(screen.getByText('deviceAddresses.egressHint')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(en.deviceAddresses.egressHint).toContain('may traverse a proxy');
    expect(en.deviceAddresses.egressHint).toContain('not necessarily the direct WAN IPs');
    expect(zh.deviceAddresses.egressHint).toContain('不一定是 WAN 直连公网 IP');
  });

  it('shows the same friendly unavailable state for missing targets and 404 responses', async () => {
    mockRouter.query = {};
    const view = render(<DeviceAddressesPage />);
    await screen.findByText('deviceAddresses.unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
    mockRouter.query = { mac: 'not-available' };
    mockFetch.mockResolvedValue(response(fullAddresses, 404));
    view.rerender(<DeviceAddressesPage />);
    await screen.findByText('deviceAddresses.unavailable');
    expect(screen.queryByText(fullAddresses.hostname)).not.toBeInTheDocument();
  });

  it('reports request failure and supports a single manual refresh with loading feedback', async () => {
    const retry = Promise.withResolvers<AddressResponse>();
    mockFetch.mockRejectedValueOnce(new Error('network error')).mockReturnValueOnce(retry.promise);
    render(<DeviceAddressesPage />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('deviceAddresses.loadFailed');
    fireEvent.click(screen.getByRole('button', { name: 'deviceAddresses.refresh' }));
    await screen.findByText('deviceAddresses.loading');
    expect(screen.getByRole('button', { name: 'deviceAddresses.refresh' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => retry.resolve(response()));
    await screen.findByText(fullAddresses.hostname);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('redirects HTTP %s to portal login without exposing device data', async (status) => {
    mockFetch.mockResolvedValue(response(fullAddresses, status));
    render(<DeviceAddressesPage />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login'));
    expect(screen.queryByText(fullAddresses.hostname)).not.toBeInTheDocument();
  });

  it('waits for router readiness and auth, then ignores an old request after a target switch', async () => {
    const old = Promise.withResolvers<AddressResponse>();
    mockFetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ ...fullAddresses, mac: '112233445566', hostname: 'hive-new' }));
    mockRouter.isReady = false;
    mockUseCustomer.mockReturnValue({ customer: null, loading: true });
    const view = render(<DeviceAddressesPage />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    mockRouter.isReady = true;
    view.rerender(<DeviceAddressesPage />);
    expect(mockFetch).not.toHaveBeenCalled();
    mockUseCustomer.mockReturnValue({ customer, loading: false });
    view.rerender(<DeviceAddressesPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const oldSignal = mockFetch.mock.calls[0][1].signal as AbortSignal;
    mockRouter.query = { mac: '112233445566' };
    view.rerender(<DeviceAddressesPage />);
    await screen.findByText('hive-new');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(response()));
    expect(screen.getByText('hive-new')).toBeInTheDocument();
    expect(screen.queryByText(fullAddresses.hostname)).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith('/api/portal/devices/112233445566/addresses', expect.objectContaining({ credentials: 'include' }));
  });

  it('aborts on unmount and ignores JSON that resolves after the target changes', async () => {
    const oldJson = Promise.withResolvers<typeof fullAddresses>();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => oldJson.promise })
      .mockResolvedValueOnce(response({ ...fullAddresses, hostname: 'hive-new' }));
    const view = render(<DeviceAddressesPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const oldSignal = mockFetch.mock.calls[0][1].signal as AbortSignal;
    mockRouter.query = { mac: '112233445566' };
    view.rerender(<DeviceAddressesPage />);
    await screen.findByText('hive-new');
    await act(async () => oldJson.resolve(fullAddresses));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByText(fullAddresses.hostname)).not.toBeInTheDocument();
    const signal = mockFetch.mock.calls[1][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('redirects a settled unauthenticated customer without fetching addresses', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, loading: false });
    render(<DeviceAddressesPage />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login'));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
