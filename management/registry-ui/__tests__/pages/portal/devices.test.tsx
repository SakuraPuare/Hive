import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PortalDevicesPage from '@/pages/portal/devices';
import { mockRouter } from '@/test/setup';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

const mockListDevices = vi.fn();
const mockEnqueue = vi.fn();
const mockCommands = vi.fn();

vi.mock('@/src/generated/client', () => ({
  PortalService: {
    portalListDevices: (...args: unknown[]) => mockListDevices(...args),
    portalClaimDevice: vi.fn(),
    portalUnbindDevice: vi.fn(),
    portalListDeviceCommands: (...args: unknown[]) => mockCommands(...args),
    portalEnqueueDeviceCommand: (...args: unknown[]) => mockEnqueue(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  portalSessionApi: (p: any) => p,
  apiPath: (path: string) => `/api${path}`,
}));

const gatewayNode = {
  mac: 'aabbccddeeff',
  hostname: 'hive-cdeeff',
  probe_status: 'online',
  tailscale_ip: '100.64.0.9',
  easytier_ip: '172.20.1.7',
  gateway_enabled: true,
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
});
