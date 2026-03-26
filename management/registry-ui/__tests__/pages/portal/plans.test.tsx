import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PortalPlansPage from '@/pages/portal/plans';
import { mockRouter } from '@/test/setup';

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

    expect(screen.getByText('common.loading')).toBeInTheDocument();
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
    // 10737418240 bytes = 10.0 GB
    expect(screen.getByText('10.0 portal.gb')).toBeInTheDocument();
  });

  it('displays unlimited for zero traffic', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.unlimited')).toBeInTheDocument();
  });

  it('displays price formatted from cents', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('9.99 portal.yuan')).toBeInTheDocument();
    });
    expect(screen.getByText('29.99 portal.yuan')).toBeInTheDocument();
  });

  it('displays duration in days', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    const durationTexts = screen.getAllByText('portal.durationDays');
    expect(durationTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows error on fetch failure', async () => {
    mockPortalPlans.mockRejectedValueOnce(new Error('fail'));

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('calls buy API and redirects to orders on success', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockResolvedValueOnce({ order_no: 'ORD-001' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    await waitFor(() => {
      expect(mockPortalCreateOrder).toHaveBeenCalledWith({ requestBody: { plan_id: 1 } });
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/portal/orders');
  });

  it('shows alert on 401 when buying', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockRejectedValueOnce({ error: 'Unauthorized' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith('Unauthorized');
    });
  });

  it('shows alert on buy failure', async () => {
    mockPortalPlans.mockResolvedValueOnce(mockPlans);
    mockPortalCreateOrder.mockRejectedValueOnce({ error: 'Server error' });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith('Server error');
    });
  });
});
