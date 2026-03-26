import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockNodesList = vi.fn();

vi.mock('@/src/generated/client', () => ({
  NodesService: { nodesList: () => mockNodesList() },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
}));

import Dashboard from '@/pages/dashboard';

const now = new Date();
const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString();
const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString();

const mockNodes = [
  { mac: 'aabbccddeeff', hostname: 'node-1', location: '🇨🇳 中国', tailscale_ip: '100.1.1.1', probe_status: 'online', cf_url: 'https://cf.example.com', registered_at: twoDaysAgo },
  { mac: '112233445566', hostname: 'node-2', location: '🇯🇵 日本', tailscale_ip: '100.1.1.2', probe_status: 'offline', cf_url: '', registered_at: twoDaysAgo },
  { mac: 'ffeeddccbbaa', hostname: 'node-3', location: '', tailscale_ip: '', probe_status: 'unknown', cf_url: '', registered_at: tenDaysAgo },
];

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockNodesList.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Dashboard />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders stats cards after loading', async () => {
    mockNodesList.mockResolvedValueOnce(mockNodes);
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    // Stats card titles
    expect(screen.getByText('dashboard.totalNodes')).toBeInTheDocument();
    expect(screen.getByText('dashboard.onlineNodes')).toBeInTheDocument();
    expect(screen.getByText('dashboard.offlineNodes')).toBeInTheDocument();
    expect(screen.getByText('dashboard.newThisWeek')).toBeInTheDocument();
    // Total nodes = 3
    expect(screen.getByText('3')).toBeInTheDocument();
    // Online=1, Offline=1 — multiple "1"s expected
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
  });

  it('shows recent nodes table with only nodes from last 7 days', async () => {
    mockNodesList.mockResolvedValueOnce(mockNodes);
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    // Recent nodes (within 7 days) should show
    expect(screen.getByText('node-1')).toBeInTheDocument();
    expect(screen.getByText('node-2')).toBeInTheDocument();
    // Old node should not appear in recent table
    expect(screen.queryByText('node-3')).not.toBeInTheDocument();
  });

  it('shows no-nodes message when no recent nodes', async () => {
    const oldNode = { ...mockNodes[2] }; // only the old node
    mockNodesList.mockResolvedValueOnce([oldNode]);
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('dashboard.noNodesThisWeek')).toBeInTheDocument();
  });

  it('shows empty dashboard when no nodes at all', async () => {
    mockNodesList.mockResolvedValueOnce([]);
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    // All stats should be 0
    expect(screen.getAllByText('0').length).toBe(4);
    expect(screen.getByText('dashboard.noNodesThisWeek')).toBeInTheDocument();
  });
});
