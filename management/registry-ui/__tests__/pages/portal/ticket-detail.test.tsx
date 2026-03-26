import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalTicketDetailPage from '@/pages/portal/tickets/[id]';
import { mockRouter } from '@/test/setup';

const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'Test', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  useCustomer: () => mockUseCustomer(),
}));

const mockPortalGetTicket = vi.fn();
const mockPortalReplyTicket = vi.fn();

vi.mock('@/src/generated/client', () => ({
  PortalService: {
    portalGetTicket: (...args: any[]) => mockPortalGetTicket(...args),
    portalReplyTicket: (...args: any[]) => mockPortalReplyTicket(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  portalSessionApi: (p: any) => p,
}));

const mockTicketDetail = {
  ticket: { id: 42, subject: 'Connection issue', status: 'open', created_at: '2025-06-01T10:00:00Z' },
  replies: [
    { id: 1, author: 'Admin', is_admin: true, content: 'We are looking into it.', created_at: '2025-06-01T11:00:00Z' },
    { id: 2, author: 'Test', is_admin: false, content: 'Thanks for the update.', created_at: '2025-06-01T12:00:00Z' },
  ],
};

describe('PortalTicketDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPortalGetTicket.mockReset();
    mockPortalReplyTicket.mockReset();
    mockRouter.query = { id: '42' };
    mockRouter.replace.mockClear();
    mockRouter.push.mockClear();
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows loading state', () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: true });
    render(<PortalTicketDetailPage />);

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', async () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: false });
    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login');
    });
  });

  it('renders ticket detail with replies', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Connection issue/)).toBeInTheDocument();
    });
    expect(screen.getByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText('portal.statusOpen')).toBeInTheDocument();
    expect(screen.getByText('We are looking into it.')).toBeInTheDocument();
    expect(screen.getByText('Thanks for the update.')).toBeInTheDocument();
  });

  it('renders admin replies on the left and customer replies on the right', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('We are looking into it.')).toBeInTheDocument();
    });

    // Admin reply should have justify-start (left)
    const adminReply = screen.getByText('We are looking into it.').closest('.flex');
    expect(adminReply?.className).toContain('justify-start');

    // Customer reply should have justify-end (right)
    const customerReply = screen.getByText('Thanks for the update.').closest('.flex');
    expect(customerReply?.className).toContain('justify-end');
  });

  it('shows no replies message when empty', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce({ ticket: mockTicketDetail.ticket, replies: [] });

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.noReplies')).toBeInTheDocument();
    });
  });

  it('shows reply form for open tickets', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('portal.replyPlaceholder')).toBeInTheDocument();
    });
  });

  it('hides reply form for closed tickets', async () => {
    const closedTicket = {
      ...mockTicketDetail,
      ticket: { ...mockTicketDetail.ticket, status: 'closed' },
    };
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(closedTicket);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.statusClosed')).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText('portal.replyPlaceholder')).not.toBeInTheDocument();
  });

  it('sends reply and reloads ticket', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    const updatedTicket = {
      ...mockTicketDetail,
      replies: [
        ...mockTicketDetail.replies,
        { id: 3, author: 'Test', is_admin: false, content: 'My reply', created_at: '2025-06-01T13:00:00Z' },
      ],
    };
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail); // initial load
    mockPortalReplyTicket.mockResolvedValueOnce({ status: 'ok' }); // reply
    mockPortalGetTicket.mockResolvedValueOnce(updatedTicket); // reload

    const user = userEvent.setup();
    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('portal.replyPlaceholder')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('portal.replyPlaceholder'), 'My reply');
    fireEvent.click(screen.getByText('portal.reply'));

    await waitFor(() => {
      expect(mockPortalReplyTicket).toHaveBeenCalledWith({ id: 42, requestBody: { content: 'My reply' } });
    });

    await waitFor(() => {
      expect(screen.getByText('My reply')).toBeInTheDocument();
    });
  });

  it('shows error when reply fails', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);
    mockPortalReplyTicket.mockRejectedValueOnce({ error: 'Server error' });

    const user = userEvent.setup();
    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('portal.replyPlaceholder')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('portal.replyPlaceholder'), 'test');
    fireEvent.click(screen.getByText('portal.reply'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('reply button is disabled when textarea is empty', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.reply')).toBeDisabled();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockRejectedValueOnce(new Error('fail'));

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('portal.loadFailed')).toBeInTheDocument();
    });
  });

  it('has back button that navigates to tickets list', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('common.back')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('common.back'));
    expect(mockRouter.push).toHaveBeenCalledWith('/portal/tickets');
  });

  it('renders author names in replies', async () => {
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalGetTicket.mockResolvedValueOnce(mockTicketDetail);

    render(<PortalTicketDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('Test')).toBeInTheDocument();
  });
});
