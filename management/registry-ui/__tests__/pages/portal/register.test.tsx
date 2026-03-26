import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalRegisterPage from '@/pages/portal/register';

const mockPortalRegister = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  portalRegister: (...args: any[]) => mockPortalRegister(...args),
}));

describe('PortalRegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', { writable: true, value: { href: '' } });
  });

  it('renders register form with email, nickname, and password fields', () => {
    render(<PortalRegisterPage />);

    expect(screen.getByText('portal.brand')).toBeInTheDocument();
    expect(screen.getByText('portal.customerRegister')).toBeInTheDocument();
    expect(screen.getByLabelText('portal.email')).toBeInTheDocument();
    expect(screen.getByLabelText('portal.nickname')).toBeInTheDocument();
    expect(screen.getByLabelText('portal.password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'portal.register' })).toBeInTheDocument();
  });

  it('renders link to login page', () => {
    render(<PortalRegisterPage />);

    const loginLink = screen.getByText('portal.goLogin');
    expect(loginLink.closest('a')).toHaveAttribute('href', '/portal/login');
  });

  it('calls portalRegister on form submit and redirects on success', async () => {
    mockPortalRegister.mockResolvedValueOnce({ id: 1 });
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'new@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'NewUser');
    await user.type(screen.getByLabelText('portal.password'), 'pass123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      expect(mockPortalRegister).toHaveBeenCalledWith('new@example.com', 'pass123', 'NewUser');
    });
    expect(window.location.href).toBe('/portal/dashboard');
  });

  it('shows error message on registration failure', async () => {
    mockPortalRegister.mockRejectedValueOnce({ error: 'Email already exists' });
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'dup@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'Dup');
    await user.type(screen.getByLabelText('portal.password'), 'pass');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      expect(screen.getByText('Email already exists')).toBeInTheDocument();
    });
  });

  it('shows fallback error when error object has no message', async () => {
    mockPortalRegister.mockRejectedValueOnce({});
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'a@b.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'n');
    await user.type(screen.getByLabelText('portal.password'), 'x');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      expect(screen.getByText('portal.registerFailed')).toBeInTheDocument();
    });
  });

  it('disables button while loading', async () => {
    let resolveRegister: (v: any) => void;
    mockPortalRegister.mockReturnValueOnce(new Promise((r) => { resolveRegister = r; }));
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'a@b.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'n');
    await user.type(screen.getByLabelText('portal.password'), 'x');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'portal.registering' })).toBeDisabled();
    });

    await act(async () => { resolveRegister!({ id: 1 }); });
  });
});
