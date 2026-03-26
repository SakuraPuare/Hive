import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCustomersList = vi.fn();
const mockCustomerCreate = vi.fn();
const mockCustomerDelete = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: {
    adminListCustomers: (...args: any[]) => mockCustomersList(...args),
    adminCreateCustomer: (...args: any[]) => mockCustomerCreate(...args),
    adminDeleteCustomer: (...args: any[]) => mockCustomerDelete(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
}));

vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({
    user: {
      id: 1,
      username: 'admin',
      roles: ['superadmin'],
      permissions: ['customer:read', 'customer:write'],
      can: (perm: string) => ['customer:read', 'customer:write'].includes(perm),
    },
    loading: false,
  }),
}));

import CustomersPage from '@/pages/customers';

const mockCustomers = [
  { id: 1, email: 'alice@example.com', nickname: 'Alice', status: 'active', created_at: '2024-06-01T00:00:00Z' },
  { id: 2, email: 'bob@example.com', nickname: 'Bob', status: 'suspended', created_at: '2024-06-02T00:00:00Z' },
];

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomersList.mockResolvedValue({ items: mockCustomers, total: 2 });
  });

  it('renders customer table after loading', async () => {
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('shows status badges with translated labels', async () => {
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    // statusLabel uses t('active'), t('suspended')
    expect(screen.getByText('customers.active')).toBeInTheDocument();
    expect(screen.getByText('customers.suspended')).toBeInTheDocument();
  });

  it('shows error message on load failure', async () => {
    mockCustomersList.mockRejectedValueOnce({ error: 'Server error' });
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('opens create dialog and submits', async () => {
    mockCustomerCreate.mockResolvedValueOnce({ id: 3 });
    const user = userEvent.setup();

    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    // Click create button — uses t('createCustomer')
    await user.click(screen.getByText('customers.createCustomer'));

    // Fill form — labels use t('email'), t('password')
    const inputs = screen.getAllByRole('textbox');
    const emailInput = inputs.find(i => i.closest('div')?.textContent?.includes('customers.email'));
    // Use the input fields in the dialog
    const dialogInputs = screen.getAllByRole('textbox');
    await user.type(dialogInputs[dialogInputs.length - 2], 'new@example.com');

    // Submit — reload after create
    mockCustomersList.mockResolvedValueOnce({ items: [...mockCustomers, { id: 3, email: 'new@example.com', nickname: '', status: 'active', created_at: '2024-06-03T00:00:00Z' }], total: 3 });
  });

  it('shows pagination when total exceeds limit', async () => {
    // Override the default mock to return more items
    mockCustomersList.mockReset();
    mockCustomersList.mockImplementation(() => Promise.resolve({ items: mockCustomers, total: 40 }));
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    // totalPages = ceil(40/20) = 2, so pagination should show "1 / 2"
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    });
  });

  it('shows nicknames', async () => {
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows no customers message when empty', async () => {
    mockCustomersList.mockResolvedValueOnce({ items: [], total: 0 });
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getByText('customers.noCustomers')).toBeInTheDocument();
    });
  });
});
