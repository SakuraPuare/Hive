import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PortalDashboardPage from '@/pages/portal/dashboard';
import { mockRouter } from '@/test/setup';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockSub = {
  id: 1,
  plan_name: 'Pro Plan',
  token: 'abc123',
  traffic_used: 2147483648, // 2 GB
  traffic_limit: 10737418240, // 10 GB
  device_limit: 3,
  expires_at: '2027-12-31T00:00:00Z',
  status: 'active',
};

const mockUseCustomer = vi.fn();
const mockPortalAnnouncements = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

vi.mock('@/src/generated/client', () => ({
  PortalPublicService: {
    portalAnnouncements: (...args: any[]) => mockPortalAnnouncements(...args),
  },
}));

// Helper: render and wait for announcement fetch to settle
async function renderAndSettle(ui: React.ReactElement) {
  render(ui);
  // Wait for the announcement fetch effect to complete
  await act(async () => {});
}

describe('PortalDashboardPage', () => {
  beforeEach(() => {
    mockPortalAnnouncements.mockReset();
    vi.clearAllMocks();
    mockRouter.replace.mockClear();
    mockPortalAnnouncements.mockResolvedValue([]);
    Object.defineProperty(window, 'location', { writable: true, value: { href: '', origin: 'http://localhost' } });
  });

  it('shows loading state', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: true });
    render(<PortalDashboardPage />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await act(async () => {});
  });

  it('redirects to login when not authenticated', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: false });
    render(<PortalDashboardPage />);
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login');
    });
  });

  it('renders dashboard with no subscriptions', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('portal.dashboard')).toBeInTheDocument();
    expect(screen.getByText('portal.currentSubscription')).toBeInTheDocument();
    expect(screen.getByText('portal.noSubscription')).toBeInTheDocument();
  });

  it('renders subscription card with plan details', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('Pro Plan')).toBeInTheDocument();
    expect(screen.getByText('portal.active')).toBeInTheDocument();
    // Device limit: "3 portal.devices"
    expect(screen.getByText(/3\s+portal\.devices/)).toBeInTheDocument();
  });

  it('shows expired badge for expired subscription', async () => {
    const expiredSub = { ...mockSub, expires_at: '2020-01-01T00:00:00Z' };
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [expiredSub], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('portal.expired')).toBeInTheDocument();
  });

  it('renders traffic progress bar', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('portal.trafficUsage')).toBeInTheDocument();
    expect(screen.getByText(/2\.00/)).toBeInTheDocument();
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
  });

  it('shows unlimited for zero traffic limit', async () => {
    const unlimitedSub = { ...mockSub, traffic_limit: 0 };
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [unlimitedSub], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText(/portal\.unlimited/)).toBeInTheDocument();
  });

  it('renders copy Clash and VLESS buttons', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('portal.copyClash')).toBeInTheDocument();
    expect(screen.getByText('portal.copyVless')).toBeInTheDocument();
  });

  it('copies Clash link to clipboard', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub], loading: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await renderAndSettle(<PortalDashboardPage />);

    fireEvent.click(screen.getByText('portal.copyClash'));
    expect(writeText).toHaveBeenCalledWith('http://localhost/c/abc123');
    expect(screen.getByText('portal.copied')).toBeInTheDocument();
  });

  it('copies VLESS link to clipboard', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub], loading: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await renderAndSettle(<PortalDashboardPage />);

    fireEvent.click(screen.getByText('portal.copyVless'));
    expect(writeText).toHaveBeenCalledWith('http://localhost/c/abc123/vless');
  });

  it('renders quick action buttons with correct links', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('portal.quickActions')).toBeInTheDocument();
    const buyLink = screen.getByText('portal.buyPlan').closest('a');
    expect(buyLink).toHaveAttribute('href', '/portal/plans');
    const ticketLink = screen.getByText('portal.submitTicket').closest('a');
    expect(ticketLink).toHaveAttribute('href', '/portal/tickets');
  });

  it('renders multiple subscription cards', async () => {
    const sub2 = { ...mockSub, id: 2, plan_name: 'Basic Plan', token: 'def456' };
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [mockSub, sub2], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(screen.getByText('Pro Plan')).toBeInTheDocument();
    expect(screen.getByText('Basic Plan')).toBeInTheDocument();
  });

  it('fetches announcements on mount', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    await renderAndSettle(<PortalDashboardPage />);

    expect(mockPortalAnnouncements).toHaveBeenCalled();
  });

  it('renders announcement banners', async () => {
    const announcements = [
      { id: 1, title: 'Maintenance Notice', content: 'Server will be down', level: 'warning', pinned: true },
    ];
    mockPortalAnnouncements.mockResolvedValue(announcements);
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });

    render(<PortalDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Maintenance Notice')).toBeInTheDocument();
    });
    expect(screen.getByText('Server will be down')).toBeInTheDocument();
  });
});
