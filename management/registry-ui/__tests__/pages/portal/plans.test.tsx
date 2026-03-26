import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PortalPlansPage from '@/pages/portal/plans';
import { mockRouter } from '@/test/setup';

vi.mock('@/lib/openapi-session', () => ({
  API_PREFIX: '/api',
}));

const mockPlans = [
  { id: 1, name: 'Basic', traffic_bytes: 10737418240, speed_limit: 0, device_limit: 2, duration_days: 30, price_cents: 999, enabled: true },
  { id: 2, name: 'Pro', traffic_bytes: 0, speed_limit: 0, device_limit: 5, duration_days: 30, price_cents: 2999, enabled: true },
  { id: 3, name: 'Hidden', traffic_bytes: 0, speed_limit: 0, device_limit: 1, duration_days: 30, price_cents: 100, enabled: false },
];

describe('PortalPlansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.push.mockClear();
    global.alert = vi.fn();
  });

  it('shows loading state initially', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<PortalPlansPage />);

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders plan cards after loading', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // Hidden plan should not be rendered
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('displays traffic in GB for non-zero traffic', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    // 10737418240 bytes = 10.0 GB
    expect(screen.getByText('10.0 portal.gb')).toBeInTheDocument();
  });

  it('displays unlimited for zero traffic', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.unlimited')).toBeInTheDocument();
  });

  it('displays price formatted from cents', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('9.99 portal.yuan')).toBeInTheDocument();
    });
    expect(screen.getByText('29.99 portal.yuan')).toBeInTheDocument();
  });

  it('displays duration in days', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });
    const durationTexts = screen.getAllByText('portal.durationDays');
    expect(durationTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows error on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('calls buy API and redirects to orders on success', async () => {
    const plansResponse = { ok: true, json: () => Promise.resolve(mockPlans) };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(plansResponse) // initial load
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1 }) }) // buy
      .mockResolvedValue(plansResponse); // any subsequent reload

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/orders', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ plan_id: 1 }),
      }));
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/portal/orders');
  });

  it('redirects to login on 401 when buying', async () => {
    const plansResponse = { ok: true, json: () => Promise.resolve(mockPlans) };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(plansResponse)
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
      .mockResolvedValue(plansResponse);

    render(<PortalPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
    });

    const buyButtons = screen.getAllByText('portal.buy');
    fireEvent.click(buyButtons[0]);

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/portal/login');
    });
  });

  it('shows alert on buy failure', async () => {
    const plansResponse = { ok: true, json: () => Promise.resolve(mockPlans) };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(plansResponse)
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Server error' }) })
      .mockResolvedValue(plansResponse);

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
