import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import PortalDevicesPage from '@/pages/portal/devices';
import type { DashboardInfo } from '@/lib/mihomo-panel';
import { mockRouter } from '@/test/setup';
import { useToast } from '@/components/ui/toast';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

const mockListDevices = vi.fn();
const mockEnqueue = vi.fn();
const mockCommands = vi.fn();
const mockBindSubscription = vi.fn();
const mockUnbindSubscription = vi.fn();
const mockSetDeviceExit = vi.fn();

vi.mock('@/src/generated/client', () => ({
  PortalService: {
    portalListDevices: (...args: unknown[]) => mockListDevices(...args),
    portalClaimDevice: vi.fn(),
    portalUnbindDevice: vi.fn(),
    portalListDeviceCommands: (...args: unknown[]) => mockCommands(...args),
    portalEnqueueDeviceCommand: (...args: unknown[]) => mockEnqueue(...args),
    portalBindDeviceSubscription: (...args: unknown[]) => mockBindSubscription(...args),
    portalUnbindDeviceSubscription: (...args: unknown[]) => mockUnbindSubscription(...args),
    portalSetDeviceExit: (...args: unknown[]) => mockSetDeviceExit(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  portalSessionApi: (p: any) => p,
  apiPath: (path: string) => `/api${path}`,
  apiUrl: (path: string) => `${window.location.origin}/api${path}`,
}));

const gatewayNode = {
  mac: 'aabbccddeeff',
  hostname: 'hive-cdeeff',
  probe_status: 'online',
  gateway_enabled: true,
  exit_enabled: true,
  owner_exit_enabled: true,
  last_seen: '2026-11-14 10:00:00',
};

const plainNode = {
  mac: '112233445566',
  hostname: 'hive-33445566',
  probe_status: 'offline',
  gateway_enabled: false,
};

const mockFetch = vi.fn();
const dashboardInfo: DashboardInfo = {
  mac: gatewayNode.mac,
  secret: 'deadbeefsecret',
  sampled_at: '2026-11-14T10:00:00Z',
  endpoints: [{ network: 'wan', interface: 'end0', address: '192.168.5.226', url: 'http://192.168.5.226:9090/ui' }],
  egress: { ipv4: '203.0.113.7', ipv6: '2001:db8::7', sampled_at: '2026-11-14T10:00:00Z' },
};

describe('PortalDevicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.replace.mockClear();
    mockListDevices.mockReset();
    mockCommands.mockReset();
    mockEnqueue.mockReset();
    mockBindSubscription.mockReset();
    mockUnbindSubscription.mockReset();
    mockSetDeviceExit.mockReset();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (String(url).endsWith('/dashboard')
        ? dashboardInfo
        : String(url).endsWith('/services') ? { sampled_at: null, services: [] }
        : { uploadTotal: 1024, downloadTotal: 4096, connections: [{}, {}] }),
    }));
    // jsdom 没有全局 fetch；这里只替换实现，不改变调用契约。
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('shows online state without exposing overlay or management addresses', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([{ ...gatewayNode, tailscale_ip: '100.64.0.9', easytier_ip: '172.20.1.7' }]);

    render(<PortalDevicesPage />);

    await waitFor(() => {
      expect(screen.getByText('hive-cdeeff')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.statusOnline')).toBeInTheDocument();
    expect(screen.queryByText('100.64.0.9')).not.toBeInTheDocument();
    expect(screen.queryByText('172.20.1.7')).not.toBeInTheDocument();
  });

  it('lets the owner turn the device exit switch off', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockSetDeviceExit.mockResolvedValue({ status: 'ok' });

    render(<PortalDevicesPage />);
    await waitFor(() => screen.getByText('hive-cdeeff'));

    fireEvent.click(screen.getByRole('switch', { name: 'portal.colExit' }));

    await waitFor(() => {
      expect(mockSetDeviceExit).toHaveBeenCalledWith({
        mac: 'aabbccddeeff',
        requestBody: { enabled: false },
      });
    });
  });

  it('opens the Mihomo dialog with a masked per-node key and an authenticated same-origin panel link', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.mihomoPanel' }));

    const secret = await screen.findByLabelText('portal.mihomoSecret');
    expect(secret).toHaveValue('deadbeefsecret');
    expect(secret).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'portal.mihomoCopy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deadbeefsecret'));
    expect(screen.getByText('portal.mihomoNetwork_wan')).toBeInTheDocument();
    expect(screen.getByText('192.168.5.226:9090')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'portal.mihomoOneClick' });
    const url = new URL(link.getAttribute('href')!);
    expect(url.origin).toBe('http://192.168.5.226:9090');
    expect(url.pathname).toBe('/ui/');
    expect(url.search).toBe('');
    expect(new URLSearchParams(url.hash.slice(3)).get('secret')).toBe('deadbeefsecret');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(link).not.toHaveTextContent('deadbeefsecret');
    expect(screen.getByText('portal.mihomoSecretWarning')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/aabbccddeeff/dashboard', {
      credentials: 'include', signal: expect.any(AbortSignal),
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/aabbccddeeff/mihomo/connections', { credentials: 'include' });
    });
  });

  it('labels every network separately, retains IPv6 and special key parameters, and never links public egress', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const networks: DashboardInfo['endpoints'][number]['network'][] = [
      'wan', 'lan', 'physical', 'hotspot',
    ];
    const secret = 'key + &?#/=中文';
    const endpoints = networks.map((network, index) => ({
      network, interface: index < 3 ? `eth${index}` : '', address: `2001:db8::${index + 10}`,
      url: `http://[2001:db8::${index + 10}]:9090/ui`,
    }));
    mockFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => (
      url.endsWith('/dashboard') ? { ...dashboardInfo, secret, endpoints } : {}
    ) }));
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.mihomoPanel' }));
    await screen.findByLabelText('portal.mihomoSecret');
    const dialog = screen.getByRole('dialog');
    networks.forEach((network, index) => {
      const row = within(dialog).getByText(`portal.mihomoNetwork_${network}`).closest('li')!;
      expect(within(row).getByText(`portal.mihomoReach_${network}`)).toBeInTheDocument();
      if (index < 3) expect(within(row).getByText(`eth${index}`)).toBeInTheDocument();
      expect(within(row).getByText(`[2001:db8::${index + 10}]:9090`)).toBeInTheDocument();
      const url = new URL(within(row).getByRole('link').getAttribute('href')!);
      const params = new URLSearchParams(url.hash.slice(3));
      expect(params.get('hostname')).toBe(`[2001:db8::${index + 10}]`);
      expect(params.get('port')).toBe('9090');
      expect(params.get('secret')).toBe(secret);
      expect(params.get('http')).toBe('true');
      expect(url.search).toBe('');
    });
    expect(within(dialog).getAllByRole('link')).toHaveLength(networks.length);
    expect(within(dialog).getByText('203.0.113.7').closest('a')).toBeNull();
    expect(within(dialog).getByText('2001:db8::7').closest('a')).toBeNull();
    expect(within(dialog).getByText('portal.mihomoEgressHint')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/portal.mihomoSampleStale/)).toHaveLength(2);
  });

  it('treats a 30-minute-old egress observation as fresh while the address snapshot is stale', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    mockFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => (
      url.endsWith('/dashboard') ? {
        ...dashboardInfo,
        sampled_at: thirtyMinutesAgo,
        egress: { ...dashboardInfo.egress, sampled_at: thirtyMinutesAgo },
      } : {}
    ) }));
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.mihomoPanel' }));
    await screen.findByLabelText('portal.mihomoSecret');
    expect(screen.getAllByText(/portal.mihomoSampleStale/)).toHaveLength(1);
  });

  it('marks absent egress and address samples unknown without inventing fallback addresses', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => (
      url.endsWith('/dashboard') ? {
        ...dashboardInfo, sampled_at: null, endpoints: [],
        egress: { ipv4: '', ipv6: '', sampled_at: null },
      } : {}
    ) }));
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.mihomoPanel' }));
    await screen.findByLabelText('portal.mihomoSecret');
    expect(screen.getAllByText('portal.mihomoNotObserved')).toHaveLength(2);
    expect(screen.getAllByText('portal.mihomoSampleUnknown')).toHaveLength(2);
    expect(screen.getByText('portal.mihomoNoAddresses')).toBeInTheDocument();
    expect(screen.queryByText(/10\.42\./)).not.toBeInTheDocument();
  });

  it('aborts a closed dashboard request and ignores its late key after switching devices', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    const other = { ...gatewayNode, mac: '112233445566', hostname: 'other gateway' };
    mockListDevices.mockResolvedValue([gatewayNode, other]);
    const late = Promise.withResolvers<Response>();
    mockFetch.mockImplementation((url: string) => {
      if (url === `/api/portal/devices/${gatewayNode.mac}/dashboard`) return late.promise;
      return Promise.resolve({ ok: true, json: async () => url.endsWith('/dashboard')
        ? { ...dashboardInfo, mac: other.mac, secret: 'current-device-key' } : {} });
    });
    render(<PortalDevicesPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'portal.mihomoPanel' }))[0]);
    const signal = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/dashboard'))![1].signal as AbortSignal;
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'portal.mihomoPanel' })[1]);
    await screen.findByDisplayValue('current-device-key');
    await act(async () => late.resolve({ ok: true, json: async () => dashboardInfo } as Response));
    expect(screen.queryByDisplayValue('deadbeefsecret')).not.toBeInTheDocument();
    expect(screen.getByLabelText('portal.mihomoSecret')).toHaveValue('current-device-key');
    const link = new URL(screen.getByRole('link', { name: 'portal.mihomoOneClick' }).getAttribute('href')!);
    expect(new URLSearchParams(link.hash.slice(3)).get('secret')).toBe('current-device-key');
  });

  it('hides the panel action for nodes without the gateway role', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([plainNode]);

    render(<PortalDevicesPage />);
    await waitFor(() => screen.getByText('hive-33445566'));

    expect(screen.queryByText('portal.mihomoPanel')).not.toBeInTheDocument();
    expect(screen.getByText('portal.statusOffline')).toBeInTheDocument();
  });

  it('delivers an active subscription to a gateway device', async () => {
    mockUseCustomer.mockReturnValue({
      customer: mockCustomer,
      subscriptions: [{
        id: 7,
        plan_id: 2,
        status: 'active',
        expires_at: '2099-01-01T00:00:00Z',
        traffic_used: 0,
        traffic_limit: 100,
      }],
      loading: false,
    });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockBindSubscription.mockResolvedValue({ status: 'ok' });

    render(<PortalDevicesPage />);
    await waitFor(() => screen.getByText('portal.subscriptionConfig'));
    fireEvent.click(screen.getByText('portal.subscriptionConfig'));

    await waitFor(() => screen.getByLabelText('portal.subscriptionSelect'));
    fireEvent.change(screen.getByLabelText('portal.subscriptionSelect'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('portal.subscriptionBind'));

    await waitFor(() => {
      expect(mockBindSubscription).toHaveBeenCalledWith({
        mac: 'aabbccddeeff',
        requestBody: { subscription_id: 7 },
      });
    });
  });

  it('unbinds the subscription from a gateway device', async () => {
    const boundNode = { ...gatewayNode, bound_subscription_id: 7 };
    mockUseCustomer.mockReturnValue({
      customer: mockCustomer,
      subscriptions: [{ id: 7, plan_id: 2, status: 'active', expires_at: '2099-01-01T00:00:00Z' }],
      loading: false,
    });
    mockListDevices.mockResolvedValue([boundNode]);
    mockUnbindSubscription.mockResolvedValue({ status: 'ok' });

    render(<PortalDevicesPage />);
    await waitFor(() => screen.getByText('portal.subscriptionConfig'));
    fireEvent.click(screen.getByText('portal.subscriptionConfig'));

    await waitFor(() => screen.getByText('portal.subscriptionUnbind'));
    fireEvent.click(screen.getByText('portal.subscriptionUnbind'));

    await waitFor(() => {
      expect(mockUnbindSubscription).toHaveBeenCalledWith({ mac: 'aabbccddeeff' });
    });
  });

  it('offers free links for each owned device without a paid subscription, even when its exit is off', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode, { ...plainNode, exit_enabled: false, owner_exit_enabled: false }]);
    const token = 'device-token';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ token }) });

    render(<PortalDevicesPage />);
    await screen.findByText('hive-33445566');
    expect(screen.getAllByRole('button', { name: 'portal.freeSubscription' })).toHaveLength(2);
    const row = screen.getByText('hive-33445566').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'portal.freeSubscription' }));

    const clashUrl = `${window.location.origin}/api/d/${token}`;
    await screen.findByDisplayValue(clashUrl);
    expect(screen.getByLabelText('portal.freeSubscriptionClash')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('portal.freeSubscriptionVless')).toHaveValue(`${clashUrl}/vless`);
    expect(screen.getByText('portal.freeSubscriptionHint')).toBeInTheDocument();
    expect(screen.getByText('portal.freeSubscriptionImportHint')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/112233445566/subscription-access', { credentials: 'include' });
  });

  it('copies both absolute free subscription URLs for import into a proxy client', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'owner-token' }) });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.freeSubscription' }));
    fireEvent.click(await screen.findByRole('button', { name: 'portal.copyClash' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/d/owner-token`));
    fireEvent.click(screen.getByRole('button', { name: 'portal.copyVless' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/d/owner-token/vless`));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'common.copied' })).toHaveLength(2));
  });

  it('shows a busy action while fetching free access and lets the owner retry a failed request', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const { promise, resolve: finishRequest } = Promise.withResolvers<unknown>();
    mockFetch.mockReturnValueOnce(promise);

    render(<PortalDevicesPage />);
    const button = await screen.findByRole('button', { name: 'portal.freeSubscription' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      finishRequest({ ok: false, json: async () => ({ error: 'Device no longer belongs to you' }) });
    });
    await waitFor(() => expect(useToast().error).toHaveBeenCalledWith('Device no longer belongs to you'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'retry-token' }) });
    fireEvent.click(button);
    await screen.findByDisplayValue(`${window.location.origin}/api/d/retry-token`);
  });

  it('reports network failures without displaying invalid free subscription links', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockFetch.mockRejectedValueOnce(new Error('Network offline'));

    render(<PortalDevicesPage />);
    const button = await screen.findByRole('button', { name: 'portal.freeSubscription' });
    fireEvent.click(button);
    await waitFor(() => expect(useToast().error).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
  it('refreshes a queued command to its actual output and stops polling when closed', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const command = { id: 6, action: 'service-control', params: '{"service":"xray","operation":"status"}', status: 'pending' };
    mockCommands.mockResolvedValueOnce([command]).mockResolvedValue([{ ...command, status: 'done', result: 'xray.service\nActiveState=active\nSubState=running' }]);
    const view = render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.cmdManage' }));
    await screen.findByText('portal.cmdStatus_pending');
    await waitFor(() => expect(screen.getByText(/ActiveState=active/)).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByText('portal.cmdStatus_done')).toBeInTheDocument();
    expect(screen.queryByText('portal.cmdStatus_pending')).not.toBeInTheDocument();
    view.unmount();
    const calls = mockCommands.mock.calls.length;
    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 2100);
    await delay.promise;
    expect(mockCommands).toHaveBeenCalledTimes(calls);
  }, 7000);

  it('skips polling ticks during slow requests and cannot restart after unmount', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    const history = Promise.withResolvers<unknown[]>();
    const service = Promise.withResolvers<Response>();
    mockCommands.mockReturnValue(history.promise);
    mockFetch.mockReturnValue(service.promise);
    const view = render(<PortalDevicesPage />);
    const manage = await screen.findByRole('button', { name: 'portal.cmdManage' });
    vi.useFakeTimers();
    try {
      fireEvent.click(manage);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(mockCommands).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const signal = mockFetch.mock.calls[0][1].signal as AbortSignal;
      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        history.resolve([]);
        service.resolve({ ok: true, json: async () => ({ sampled_at: null, services: [] }) } as Response);
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mockCommands).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('updates service state without queueing commands and marks old samples unknown', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockCommands.mockResolvedValue([]);
    const services = [{ name: 'hive-mihomo', load_state: 'loaded', active_state: 'active', sub_state: 'running' }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sampled_at: new Date().toISOString(), services }) })
      .mockResolvedValue({ ok: true, json: async () => ({ sampled_at: new Date(Date.now() - 180_000).toISOString(), services }) });
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.cmdManage' }));
    await screen.findByText('active / running');
    await waitFor(() => expect(screen.getByText(/portal.serviceStatusStale/)).toBeInTheDocument(), { timeout: 7000 });
    expect(screen.queryByText('active / running')).not.toBeInTheDocument();
    expect(mockEnqueue).not.toHaveBeenCalled();
  }, 9000);

  it('limits customer commands to reboot and gateway/hotspot services', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockCommands.mockResolvedValue([]);
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.cmdManage' }));

    expect(await screen.findByRole('button', { name: 'portal.cmdAction_reboot' })).toBeInTheDocument();
    for (const action of ['restart-xray', 'restart-mihomo', 'resync']) {
      expect(screen.queryByRole('button', { name: `portal.cmdAction_${action}` })).not.toBeInTheDocument();
    }
    expect(screen.getByText('portal.serviceGroup_network')).toBeInTheDocument();
    for (const group of ['proxy', 'security', 'system', 'automation']) {
      expect(screen.queryByText(`portal.serviceGroup_${group}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText('portal.service_hive-gateway')).toBeInTheDocument();
    expect(screen.queryByText('portal.service_hive-firewall')).not.toBeInTheDocument();
  });

  it('hides hotspot configuration without AP capability', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);
    mockCommands.mockResolvedValue([]);
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.cmdManage' }));

    expect(await screen.findByText('portal.service_hive-gateway')).toBeInTheDocument();
    expect(screen.queryByText('portal.hotspotConfig')).not.toBeInTheDocument();
    expect(screen.queryByText('portal.service_hive-hotspot')).not.toBeInTheDocument();
  });

  it('shows hotspot configuration when the device reports AP capability', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([{ ...gatewayNode, hotspot_capable: true }]);
    mockCommands.mockResolvedValue([]);
    render(<PortalDevicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'portal.cmdManage' }));

    expect(await screen.findByText('portal.hotspotConfig')).toBeInTheDocument();
    expect(screen.getByText('portal.service_hive-hotspot')).toBeInTheDocument();
  });

  it('does not put a late response from another device into the current dialog', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode, plainNode]);
    const late = Promise.withResolvers<unknown[]>();
    mockCommands.mockReturnValueOnce(late.promise).mockResolvedValue([{ id: 2, action: 'resync', status: 'done', result: 'current device output' }]);
    render(<PortalDevicesPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'portal.cmdManage' }))[0]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'portal.cmdManage' })[1]);
    await screen.findByText('current device output');
    await act(async () => late.resolve([{ id: 1, action: 'resync', status: 'done', result: 'wrong device output' }]));
    expect(screen.queryByText('wrong device output')).not.toBeInTheDocument();
    expect(screen.getByText('current device output')).toBeInTheDocument();
  });

});
