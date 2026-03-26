import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalTicketsPage from '@/pages/portal/tickets';
import { mockRouter } from '@/test/setup';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

vi.mock('@/lib/openapi-session', () => ({
  API_PREFIX: '/api',
}));

const mockTickets = [
  { id: 1, subject: 'Cannot connect', status: 'open', created_at: '2025-06-01T10:00:00Z' },
  { id: 2, subject: 'Billing issue', status: 'replied', created_at: '2025-06-02T10:00:00Z' },
  { id: 3, subject: 'Old ticket', status: 'closed', created_at: '2025-05-01T10:00:00Z' },
];

describe('PortalTicketsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.replace.mockClear();
    mockRouter.push.mockClear();
  });

  it('shows loading state while auth is loading', () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: true });
    render(<PortalTicketsPage />);

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: false });
    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login');
    });
  });

  it('renders tickets table after loading', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockTickets }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('Cannot connect')).toBeInTheDocument();
    });
    expect(screen.getByText('Billing issue')).toBeInTheDocument();
    expect(screen.getByText('Old ticket')).toBeInTheDocument();
  });

  it('displays status badges', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockTickets }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.statusOpen')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.statusReplied')).toBeInTheDocument();
    expect(screen.getByText('portal.statusClosed')).toBeInTheDocument();
  });

  it('navigates to ticket detail on row click', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: mockTickets }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('Cannot connect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cannot connect'));

    expect(mockRouter.push).toHaveBeenCalledWith('/portal/tickets/1');
  });

  it('shows empty state when no tickets', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noTickets')).toBeInTheDocument();
    });
  });

  it('shows error on fetch failure', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('opens new ticket dialog', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noTickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('portal.newTicket'));

    // Dialog should be open
    expect(screen.getByPlaceholderText('portal.subjectPlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('portal.contentPlaceholder')).toBeInTheDocument();
  });

  it('submits new ticket and reloads list', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: [] }) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 10 }) }) // submit
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: [{ id: 10, subject: 'New Issue', status: 'open', created_at: '2025-06-10T00:00:00Z' }] }) }); // reload

    const user = userEvent.setup();
    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noTickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('portal.newTicket'));

    await user.type(screen.getByPlaceholderText('portal.subjectPlaceholder'), 'New Issue');
    await user.type(screen.getByPlaceholderText('portal.contentPlaceholder'), 'Description of the issue');

    fireEvent.click(screen.getByText('portal.submit'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/tickets', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subject: 'New Issue', content: 'Description of the issue' }),
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('New Issue')).toBeInTheDocument();
    });
  });

  it('shows error when ticket submission fails', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    const emptyResponse = { ok: true, json: () => Promise.resolve({ items: [] }) };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: 'Subject too short' }) })
      .mockResolvedValue(emptyResponse);

    const user = userEvent.setup();
    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noTickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('portal.newTicket'));

    await user.type(screen.getByPlaceholderText('portal.subjectPlaceholder'), 'X');
    await user.type(screen.getByPlaceholderText('portal.contentPlaceholder'), 'Y');

    fireEvent.click(screen.getByText('portal.submit'));

    await waitFor(() => {
      expect(screen.getByText('Subject too short')).toBeInTheDocument();
    });
  });

  it('submit button is disabled when fields are empty', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noTickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('portal.newTicket'));

    const submitBtn = screen.getByText('portal.submit');
    expect(submitBtn).toBeDisabled();
  });

  it('renders table headers', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<PortalTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.colId')).toBeInTheDocument();
    });
    expect(screen.getByText('portal.colSubject')).toBeInTheDocument();
    expect(screen.getByText('portal.colStatus')).toBeInTheDocument();
    expect(screen.getByText('portal.colCreatedAt')).toBeInTheDocument();
  });
});
