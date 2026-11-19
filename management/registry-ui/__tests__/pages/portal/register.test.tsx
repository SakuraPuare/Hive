import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalRegisterPage from '@/pages/portal/register';
import { mockRouter } from '@/test/setup';

const mockPortalRegister = vi.fn();
const mockPortalLogin = vi.fn();
const mockRefresh = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  portalRegister: (...args: unknown[]) => mockPortalRegister(...args),
  portalLogin: (...args: unknown[]) => mockPortalLogin(...args),
  useCustomer: () => ({ refresh: mockRefresh }),
}));

describe('PortalRegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPortalRegister.mockReset();
    mockPortalLogin.mockReset().mockResolvedValue({ id: 1 });
    mockRefresh.mockReset().mockResolvedValue(undefined);
    mockRouter.replace.mockClear();
  });

  it('renders register form with email, nickname, and password fields', () => {
    render(<PortalRegisterPage />);

    expect(screen.getAllByText('portal.brand').length).toBeGreaterThanOrEqual(1);
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

  it('registers, logs in, and refreshes the customer before redirecting', async () => {
    mockPortalRegister.mockResolvedValueOnce({ id: 1 });
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'new@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'NewUser');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      // 4th arg is the optional referral code, empty when not supplied via ?ref=
      expect(mockPortalRegister).toHaveBeenCalledWith('new@example.com', 'password123', 'NewUser', '');
    });
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/portal/dashboard');
    });
    expect(mockPortalLogin).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockPortalRegister.mock.invocationCallOrder[0]).toBeLessThan(mockPortalLogin.mock.invocationCallOrder[0]);
    expect(mockPortalLogin.mock.invocationCallOrder[0]).toBeLessThan(mockRefresh.mock.invocationCallOrder[0]);
    expect(mockRefresh.mock.invocationCallOrder[0]).toBeLessThan(mockRouter.replace.mock.invocationCallOrder[0]);
  });

  it('keeps registration pending until login and customer refresh finish', async () => {
    mockPortalRegister.mockResolvedValueOnce({ id: 1 });
    const login = Promise.withResolvers<void>();
    const refresh = Promise.withResolvers<void>();
    mockPortalLogin.mockReturnValueOnce(login.promise);
    mockRefresh.mockReturnValueOnce(refresh.promise);
    const user = userEvent.setup();

    render(<PortalRegisterPage />);
    await user.type(screen.getByLabelText('portal.email'), 'new@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'NewUser');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => expect(mockPortalLogin).toHaveBeenCalledOnce());
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'portal.registering' })).toBeDisabled();

    await act(async () => { login.resolve(); });
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'portal.registering' })).toBeDisabled();

    await act(async () => { refresh.resolve(); });
    expect(mockRouter.replace).toHaveBeenCalledWith('/portal/dashboard');
  });

  it('shows a login failure without navigating to the dashboard', async () => {
    mockPortalRegister.mockResolvedValueOnce({ id: 1 });
    mockPortalLogin.mockRejectedValueOnce({ error: 'Login failed' });
    const user = userEvent.setup();

    render(<PortalRegisterPage />);
    await user.type(screen.getByLabelText('portal.email'), 'new@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'NewUser');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    expect(await screen.findByText('Login failed')).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'portal.register' })).toBeEnabled();
  });

  it('shows error message on registration failure', async () => {
    mockPortalRegister.mockRejectedValueOnce({ error: 'Email already exists' });
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'dup@example.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'Dup');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      expect(screen.getByText('Email already exists')).toBeInTheDocument();
    });
    expect(mockPortalLogin).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('shows fallback error when error object has no message', async () => {
    mockPortalRegister.mockRejectedValueOnce({});
    const user = userEvent.setup();

    render(<PortalRegisterPage />);

    await user.type(screen.getByLabelText('portal.email'), 'a@b.com');
    await user.type(screen.getByLabelText('portal.nickname'), 'nick');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
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
    await user.type(screen.getByLabelText('portal.nickname'), 'nick');
    await user.type(screen.getByLabelText('portal.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'portal.register' }));

    await waitFor(() => {
      // While loading the button keeps its label visible (now the
      // "registering" i18n string) and is implicitly disabled.
      expect(screen.getByRole('button', { name: 'portal.registering' })).toBeDisabled();
    });

    await act(async () => { resolveRegister!({ id: 1 }); });
  });
});
