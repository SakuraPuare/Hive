import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import PortalDevicesPage from '@/pages/portal/devices';
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
  tailscale_ip: '100.64.0.9',
  easytier_ip: '172.20.1.7',
  gateway_enabled: true,
  exit_enabled: true,
  owner_exit_enabled: true,
  last_seen: '2026-11-14T10:00:00Z',
};

const plainNode = {
  mac: '112233445566',
  hostname: 'hive-33445566',
  probe_status: 'offline',
  gateway_enabled: false,
};

const mockFetch = vi.fn();

describe('PortalDevicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.replace.mockClear();
    mockListDevices.mockReset();
    mockCommands.mockReset();
    mockBindSubscription.mockReset();
    mockUnbindSubscription.mockReset();
    mockSetDeviceExit.mockReset();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (String(url).endsWith('/dashboard')
        ? { urls: ['http://172.20.1.7:9090/ui'], secret: 'deadbeefsecret' }
        : { uploadTotal: 1024, downloadTotal: 4096, connections: [{}, {}] }),
    }));
    // jsdom 没有全局 fetch；这里只替换实现，不改变调用契约。
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('shows the mesh address and online state from the heartbeat probe', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);

    render(<PortalDevicesPage />);

    await waitFor(() => {
      expect(screen.getByText('172.20.1.7')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('hive-cdeeff')).toBeInTheDocument();
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

  it('opens the mihomo panel dialog with the per-node secret and dashboard url', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockListDevices.mockResolvedValue([gatewayNode]);

    render(<PortalDevicesPage />);
    await waitFor(() => screen.getByText('portal.mihomoPanel'));

    fireEvent.click(screen.getByText('portal.mihomoPanel'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('deadbeefsecret')).toBeInTheDocument();
    });
    expect(screen.getByText('http://172.20.1.7:9090/ui')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/aabbccddeeff/dashboard', { credentials: 'include' });
    // 实时流量：同一入口还轮询 /mihomo/connections（累计值换算成瞬时速率）。
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/portal/devices/aabbccddeeff/mihomo/connections', { credentials: 'include' });
    });
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
});
