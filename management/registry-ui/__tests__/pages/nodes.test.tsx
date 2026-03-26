import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNodesList = vi.fn();
const mockNodeDelete = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: {
    nodesList: () => mockNodesList(),
    nodeDelete: (...args: any[]) => mockNodeDelete(...args),
    nodeUpdate: vi.fn(),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
}));

vi.mock('@/components/nodes/NodeEditDialog', () => ({
  NodeEditDialog: () => <div data-testid="node-edit-dialog" />,
}));

import Nodes from '@/pages/nodes';

const mockNodes = [
  {
    mac: 'aabbccddeeff',
    hostname: 'node-alpha',
    location: '🇨🇳 中国',
    tailscale_ip: '100.1.1.1',
    easytier_ip: '',
    frp_port: 7000,
    probe_status: 'online',
    cf_url: '',
    tunnel_id: '',
    note: '',
    enabled: true,
    weight: 1,
    tags: '',
    registered_at: '2024-06-01T00:00:00Z',
    last_seen: '2024-06-15T12:00:00Z',
  },
  {
    mac: '112233445566',
    hostname: 'node-beta',
    location: '🇯🇵 日本',
    tailscale_ip: '100.1.1.2',
    easytier_ip: '',
    frp_port: 7001,
    probe_status: 'offline',
    cf_url: 'https://cf.example.com',
    tunnel_id: 'tid-123',
    note: 'test note',
    enabled: false,
    weight: 2,
    tags: 'tag1,tag2',
    registered_at: '2024-05-01T00:00:00Z',
    last_seen: '2024-06-10T08:00:00Z',
  },
];

describe('Nodes page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodesList.mockResolvedValue(mockNodes);
    const store: Record<string, string> = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, val) => { store[key] = val; });
  });

  it('renders node table after loading', async () => {
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    expect(screen.getByText('node-beta')).toBeInTheDocument();
  });

  it('shows formatted MAC addresses', async () => {
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
    expect(screen.getByText('11:22:33:44:55:66')).toBeInTheDocument();
  });

  it('shows node status with translated labels', async () => {
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    // Status uses t('statusOnline'), t('statusOffline')
    expect(screen.getByText('nodes.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('nodes.statusOffline')).toBeInTheDocument();
  });

  it('filters nodes by search query', async () => {
    const user = userEvent.setup();
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('nodes.searchPlaceholder');
    await user.type(searchInput, 'alpha');

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
      expect(screen.queryByText('node-beta')).not.toBeInTheDocument();
    });
  });

  it('shows no-nodes message when list is empty', async () => {
    mockNodesList.mockResolvedValueOnce([]);
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('nodes.noNodesYet')).toBeInTheDocument();
    });
  });

  it('shows no-matching message when search has no results', async () => {
    const user = userEvent.setup();
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('nodes.searchPlaceholder');
    await user.type(searchInput, 'nonexistent');

    await waitFor(() => {
      expect(screen.getByText('nodes.noMatchingNodes')).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    mockNodesList.mockReturnValue(new Promise(() => {}));
    render(<Nodes />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('shows location info', async () => {
    render(<Nodes />);

    await waitFor(() => {
      expect(screen.getByText('node-alpha')).toBeInTheDocument();
    });

    expect(screen.getByText('🇨🇳 中国')).toBeInTheDocument();
    expect(screen.getByText('🇯🇵 日本')).toBeInTheDocument();
  });
});
