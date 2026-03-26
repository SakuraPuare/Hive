import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PortalOrdersPage from '@/pages/portal/orders';
import { mockRouter } from '@/test/setup';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

vi.mock('@/lib/openapi-session', () => ({
  API_PREFIX: '/api',
}));

const mockOrders = [
  { id: 1, order_no: 'ORD-001', plan_name: 'Pro', amount_cents: 2999, status: 'paid', created_at: '2025-06-01T10:00:00Z' },
  { id: 2, order_no: 'ORD-002', plan_name: 'Basic', amount_cents: 999, status: 'pending', created_at: '2025-06-02T10:00:00Z' },
  { id: 3, order_no: 'ORD-003', plan_name: 'Pro', amount_cents: 2999, status: 'cancelled', created_at: '2025-06-03T10:00:00Z' },
];

describe('PortalOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.replace.mockClear();
  });

  it('shows loading state while auth is loading', () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: true });
    render(<PortalOrdersPage />);

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: false });
    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login');
    });
  });

  it('renders orders table after loading', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockOrders }),
    });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('ORD-001')).toBeInTheDocument();
    });
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('displays formatted amounts', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockOrders }),
    });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText('¥29.99').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('¥9.99')).toBeInTheDocument();
  });

  it('displays status badges', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockOrders }),
    });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.statusPaid')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.statusPending')).toBeInTheDocument();
    expect(screen.getByText('portal.statusCancelled')).toBeInTheDocument();
  });

  it('shows empty state when no orders', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noOrders')).toBeInTheDocument();
    });
  });

  it('shows error on fetch failure', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('refresh button reloads orders', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: mockOrders }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: [] }) });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('ORD-001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('common.refresh'));

    await waitFor(() => {
      expect(screen.getByText('portal.noOrders')).toBeInTheDocument();
    });
  });

  it('renders table headers', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.colOrderNo')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.colPlan')).toBeInTheDocument();
    expect(screen.getByText('portal.colAmount')).toBeInTheDocument();
    expect(screen.getByText('portal.colStatus')).toBeInTheDocument();
    expect(screen.getByText('portal.colCreatedAt')).toBeInTheDocument();
  });
});
