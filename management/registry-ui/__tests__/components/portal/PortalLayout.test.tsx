import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { mockRouter } from '@/test/setup';

// Mock portal-auth
const mockCustomer = { id: 1, email: 'test@example.com', nickname: 'TestUser', status: 'active', created_at: '' };
const mockUseCustomer = vi.fn();
const mockPortalLogout = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  CustomerProvider: ({ children }: any) => children,
  useCustomer: () => mockUseCustomer(),
  portalLogout: (...args: any[]) => mockPortalLogout(...args),
}));

describe('PortalLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.pathname = '/portal/dashboard';
    mockUseCustomer.mockReturnValue({ customer: mockCustomer, subscriptions: [], loading: false });
    mockPortalLogout.mockResolvedValue(undefined);
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  it('renders brand name and nav links', () => {
    render(<PortalLayout><div>child</div></PortalLayout>);

    expect(screen.getByText('portal.brand')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();

    // Nav links present (desktop nav)
    const dashboardLinks = screen.getAllByText('portal.navDashboard');
    expect(dashboardLinks.length).toBeGreaterThanOrEqual(1);
    const plansLinks = screen.getAllByText('portal.navPlans');
    expect(plansLinks.length).toBeGreaterThanOrEqual(1);
    const ordersLinks = screen.getAllByText('portal.navOrders');
    expect(ordersLinks.length).toBeGreaterThanOrEqual(1);
    const ticketsLinks = screen.getAllByText('portal.navTickets');
    expect(ticketsLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('shows customer nickname in user dropdown', () => {
    render(<PortalLayout><div /></PortalLayout>);

    expect(screen.getByText('TestUser')).toBeInTheDocument();
  });

  it('falls back to email when nickname is empty', () => {
    mockUseCustomer.mockReturnValue({
      customer: { ...mockCustomer, nickname: '' },
      subscriptions: [],
      loading: false,
    });

    render(<PortalLayout><div /></PortalLayout>);

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('does not show user dropdown when customer is null', () => {
    mockUseCustomer.mockReturnValue({ customer: null, subscriptions: [], loading: false });

    render(<PortalLayout><div /></PortalLayout>);

    expect(screen.queryByText('TestUser')).not.toBeInTheDocument();
  });

  it('renders the desktop account menu trigger', () => {
    render(<PortalLayout><div /></PortalLayout>);

    // Radix dropdown trigger is labelled and present; its menu contents are
    // portalled on open (exercised via the mobile logout path below, since
    // jsdom cannot render Radix `asChild` menu items).
    expect(screen.getByRole('button', { name: 'portal.userMenu' })).toBeInTheDocument();
  });

  it('confirms before logging out and redirects on success', async () => {
    const user = userEvent.setup();
    render(<PortalLayout><div /></PortalLayout>);

    // Open the mobile menu (plain markup) and click its logout button
    await user.click(screen.getByLabelText('portal.openMenu'));
    const mobileLogout = screen.getAllByText('portal.logout').find(
      (el) => el.closest('button') !== null
    );
    await user.click(mobileLogout!.closest('button')!);

    // Logout is gated behind a confirmation alertdialog — not fired yet
    expect(mockPortalLogout).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');

    // Confirm
    const confirmBtn = within(dialog).getByRole('button', { name: 'portal.logout' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockPortalLogout).toHaveBeenCalledTimes(1);
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/portal/login');
  });

  it('toggles mobile menu', () => {
    render(<PortalLayout><div /></PortalLayout>);

    const toggleBtn = screen.getByLabelText('portal.openMenu');
    fireEvent.click(toggleBtn);

    // Mobile nav should now be visible — desktop + mobile nav items
    const allDashboardLinks = screen.getAllByText('portal.navDashboard');
    expect(allDashboardLinks.length).toBeGreaterThanOrEqual(2);

    // Hamburger now reflects expanded state
    expect(screen.getByLabelText('portal.closeMenu')).toBeInTheDocument();

    // Close mobile menu
    fireEvent.click(screen.getByLabelText('portal.closeMenu'));
  });

  it('renders theme toggle', () => {
    render(<PortalLayout><div /></PortalLayout>);

    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('renders locale switcher buttons', () => {
    render(<PortalLayout><div /></PortalLayout>);

    const zhButtons = screen.getAllByText('中文');
    expect(zhButtons.length).toBeGreaterThanOrEqual(1);
    const enButtons = screen.getAllByText('EN');
    expect(enButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('highlights active nav item based on pathname', () => {
    mockRouter.pathname = '/portal/tickets';
    render(<PortalLayout><div /></PortalLayout>);

    // The tickets link should have the active class
    const ticketsLinks = screen.getAllByText('portal.navTickets');
    const desktopLink = ticketsLinks[0].closest('a');
    expect(desktopLink?.className).toContain('bg-md-secondary-container');
  });

  it('highlights active nav for nested paths', () => {
    mockRouter.pathname = '/portal/tickets/123';
    render(<PortalLayout><div /></PortalLayout>);

    const ticketsLinks = screen.getAllByText('portal.navTickets');
    const desktopLink = ticketsLinks[0].closest('a');
    expect(desktopLink?.className).toContain('bg-md-secondary-container');
  });

  it('renders children in main area', () => {
    render(<PortalLayout><div data-testid="page-content">Hello</div></PortalLayout>);

    const content = screen.getByTestId('page-content');
    expect(content.closest('main')).toBeInTheDocument();
  });
});
