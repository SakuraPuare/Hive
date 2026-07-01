import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PortalPlansPage from '@/pages/portal/plans';
import { mockRouter } from '@/test/setup';
// Toast is globally mocked in test/setup.tsx as a stable singleton; alias the
// import to a non-hook name so we can grab the spy object at module scope
// (replaces the old window.alert assertion path).
import { useToast as getMockToast } from '@/components/ui/toast';
const mockToast = getMockToast();

const mockPortalPlans = vi.fn();
const mockPortalCreateOrder = vi.fn();

vi.mock('@/src/generated/client', () => ({
  PortalPublicService: {
    portalPlans: (...args: any[]) => mockPortalPlans(...args),
  },
  PortalService: {
    portalCreateOrder: (...args: any[]) => mockPortalCreateOrder(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  portalSessionApi: (p: any) => p,
}));

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => ({
    customer: { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' },
    subscriptions: [],
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/src/generated/client/core/ApiError', () => {
  class ApiError extends Error {
    status: number;
    body: any;
    constructor(request: any, response: any, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = response.status;
      this.body = response.body;
    }
  }
  return { ApiError };
});

const mockPlans = [
  { id: 1, name: 'Basic', traffic_limit: 10737418240, speed_limit: 0, device_limit: 2, duration_days: 30, price: 999, enabled: true },
  { id: 2, name: 'Pro', traffic_limit: 0, speed_limit: 0, device_limit: 5, duration_days: 30, price: 2999, enabled: true },
  { id: 3, name: 'Hidden', traffic_limit: 0, speed_limit: 0, device_limit: 1, duration_days: 30, price: 100, enabled: false },
];

describe('PortalPlansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPortalPlans.mockReset();
    mockPortalCreateOrder.mockReset();
    mockRouter.push.mockClear();
    global.alert = vi.fn();
  });

  it('shows loading state initially', () => {
    mockPortalPlans.mockReturnValue(new Promise(() => {}));
    render(<PortalPlansPage />);

    // Loading shows spinner, no plan cards
    expect(screen.queryByText('Basic')).not.toBeInTheDocument();
  });

  it('renders plan cards after loading', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // Hidden plan should not be rendered
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('displays traffic in GB for non-zero traffic', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    // 10737418240 bytes = 10 GB
    expect(screen.getByText(/10 GB/)).toBeInTheDocument();
  });

  it('displays unlimited for zero traffic', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
    expect(screen.getByText(/portal\.unlimited/)).toBeInTheDocument();
  });

  it('displays price formatted from cents', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('¥9.99')).toBeInTheDocument();
    });
    expect(screen.getByText('¥29.99')).toBeInTheDocument();
  });

  it('displays duration in days', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    const durationTexts = screen.getAllByText(/30/);
    expect(durationTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows error on fetch failure', async () => {
    mockPortalPlans.mockRejectedValueOnce(new Error('fail'));

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('opens confirm dialog, calls buy API and redirects to orders on success', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockResolvedValueOnce({ order_no: 'ORD-001' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    // Buy is now a two-step flow: clicking "buy" opens a confirmation
    // AlertDialog; the API is only called after confirming.
    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    const confirmButton = await screen.findByText('portal.confirmPurchaseAction');
    expect(mockPortalCreateOrder).not.toHaveBeenCalled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockPortalCreateOrder).toHaveBeenCalledWith({ requestBody: { plan_id: 1 } });
    });
    // Success now surfaces via toast + redirect (no alert).
    expect(mockToast.success).toHaveBeenCalledWith('portal.purchaseSuccess');
    expect(mockRouter.push).toHaveBeenCalledWith('/portal/orders?highlight=ORD-001');
  });

  it('shows error dialog on 401 when buying', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockRejectedValueOnce({ error: 'Unauthorized' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    const confirmButton = await screen.findByText('portal.confirmPurchaseAction');
    fireEvent.click(confirmButton);

    // Failure now surfaces via an error AlertDialog (not window.alert).
    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
    expect(global.alert).not.toHaveBeenCalled();
  });

  it('shows error dialog on buy failure', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockRejectedValueOnce({ error: 'Server error' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    const confirmButton = await screen.findByText('portal.confirmPurchaseAction');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
    expect(global.alert).not.toHaveBeenCalled();
  });
});
