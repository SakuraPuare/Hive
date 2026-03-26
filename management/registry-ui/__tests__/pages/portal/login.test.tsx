import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalLoginPage from '@/pages/portal/login';

const mockPortalLogin = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  portalLogin: (...args: any[]) => mockPortalLogin(...args),
}));

describe('PortalLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', { writable: true, value: { href: '' } });
  });

  it('renders login form with email and password fields', () => {
    render(<PortalLoginPage />);

    expect(screen.getByText('portal.brand')).toBeInTheDocument();
    expect(screen.getByText('portal.customerLogin')).toBeInTheDocument();
    expect(screen.getByLabelText('portal.email')).toBeInTheDocument();
    expect(screen.getByLabelText('portal.password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'portal.login' })).toBeInTheDocument();
  });

  it('renders link to register page', () => {
    render(<PortalLoginPage />);

    const registerLink = screen.getByText('portal.goRegister');
    expect(registerLink.closest('a')).toHaveAttribute('href', '/portal/register');
  });

  it('calls portalLogin on form submit and redirects on success', async () => {
    mockPortalLogin.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();

    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText('portal.email'), 'test@example.com');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.login' }));

    await waitFor(() => {
      expect(mockPortalLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
    expect(window.location.href).toBe('/portal/dashboard');
  });

  it('shows error message on login failure', async () => {
    mockPortalLogin.mockRejectedValueOnce({ error: 'Invalid credentials' });
    const user = userEvent.setup();

    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText('portal.email'), 'bad@example.com');
    await user.type(screen.getByLabelText('portal.password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'portal.login' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows fallback error when error object has no message', async () => {
    mockPortalLogin.mockRejectedValueOnce({});
    const user = userEvent.setup();

    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText('portal.email'), 'a@b.com');
    await user.type(screen.getByLabelText('portal.password'), 'x');
    await user.click(screen.getByRole('button', { name: 'portal.login' }));

    await waitFor(() => {
      expect(screen.getByText('portal.loginFailed')).toBeInTheDocument();
    });
  });

  it('disables button while loading', async () => {
    let resolveLogin: (v: any) => void;
    mockPortalLogin.mockReturnValueOnce(new Promise((r) => { resolveLogin = r; }));
    const user = userEvent.setup();

    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText('portal.email'), 'a@b.com');
    await user.type(screen.getByLabelText('portal.password'), 'x');
    await user.click(screen.getByRole('button', { name: 'portal.login' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'portal.signingIn' })).toBeDisabled();
    });

    await act(async () => { resolveLogin!({ ok: true }); });
  });
});
