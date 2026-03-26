import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSubscriptionClash = vi.fn();
const mockSubscriptionVless = vi.fn();
const mockListGroups = vi.fn();
const mockNodesList = vi.fn();

vi.mock('@/src/generated/client', () => ({
  SubscriptionService: {
    subscriptionClash: () => mockSubscriptionClash(),
    subscriptionVless: () => mockSubscriptionVless(),
  },
  AdminService: {
    adminListSubscriptionGroups: () => mockListGroups(),
    adminCreateSubscriptionGroup: vi.fn(),
    adminDeleteSubscriptionGroup: vi.fn(),
    adminSetSubscriptionGroupNodes: vi.fn(),
    adminGetSubscriptionGroupNodes: vi.fn(),
    adminResetSubscriptionGroupToken: vi.fn(),
    nodesList: () => mockNodesList(),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
  apiPath: (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`,
  API_PREFIX: '/api',
}));

vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({
    user: {
      id: 1,
      username: 'admin',
      roles: ['superadmin'],
      permissions: ['subscription:write', 'subscription:read'],
      can: (perm: string) => ['subscription:write', 'subscription:read'].includes(perm),
    },
    loading: false,
  }),
}));

import Subscriptions from '@/pages/subscriptions';

const mockGroups = [
  { id: 1, name: '基础组', token: 'tok1', node_macs: ['aabbccddeeff'], created_at: '2024-06-01T00:00:00Z' },
  { id: 2, name: '高级组', token: 'tok2', node_macs: ['112233445566', 'ffeeddccbbaa'], created_at: '2024-06-02T00:00:00Z' },
];

describe('Subscriptions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListGroups.mockResolvedValue(mockGroups);
    mockNodesList.mockResolvedValue([]);
  });

  it('renders subscription groups after loading', async () => {
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('基础组')).toBeInTheDocument();
    });

    expect(screen.getByText('高级组')).toBeInTheDocument();
  });

  it('renders preview buttons for VLESS and Clash', async () => {
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('基础组')).toBeInTheDocument();
    });

    // Two preview buttons (VLESS + Clash)
    const previewButtons = screen.getAllByText('common.preview');
    expect(previewButtons.length).toBe(2);
  });

  it('previews VLESS content', async () => {
    mockSubscriptionVless.mockResolvedValueOnce('vless://uuid@host:443');
    const user = userEvent.setup();

    render(<Subscriptions />);

    // Click first preview button (VLESS card comes first)
    const previewButtons = screen.getAllByText('common.preview');
    await user.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/vless:\/\//)).toBeInTheDocument();
    });
  });

  it('previews Clash YAML content', async () => {
    mockSubscriptionClash.mockResolvedValueOnce('proxies:\n  - name: test');
    const user = userEvent.setup();

    render(<Subscriptions />);

    // Click second preview button (Clash card)
    const previewButtons = screen.getAllByText('common.preview');
    await user.click(previewButtons[1]);

    await waitFor(() => {
      expect(screen.getByText(/proxies/)).toBeInTheDocument();
    });
  });

  it('shows error on preview failure', async () => {
    mockSubscriptionVless.mockRejectedValueOnce({ error: 'No nodes' });
    const user = userEvent.setup();

    render(<Subscriptions />);

    const previewButtons = screen.getAllByText('common.preview');
    await user.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('No nodes')).toBeInTheDocument();
    });
  });

  it('shows groups loading error', async () => {
    mockListGroups.mockRejectedValueOnce({ error: 'DB error' });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('DB error')).toBeInTheDocument();
    });
  });

  it('shows create group button', async () => {
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('subscriptions.createGroup')).toBeInTheDocument();
    });
  });
});
