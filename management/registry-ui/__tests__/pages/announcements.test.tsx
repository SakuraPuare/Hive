import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetch = vi.fn();

vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({
    user: {
      id: 1,
      username: 'admin',
      roles: ['superadmin'],
      permissions: ['announcement:write'],
      can: (perm: string) => perm === 'announcement:write',
    },
    loading: false,
  }),
}));

vi.mock('@/lib/openapi-session', () => ({
  apiPath: (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`,
}));

import AnnouncementsPage from '@/pages/announcements';

const mockAnnouncements = [
  { id: 1, title: '系统维护', content: '今晚维护', level: 'info', pinned: false, published: true, created_at: '2024-06-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
  { id: 2, title: '紧急通知', content: '服务中断', level: 'critical', pinned: true, published: true, created_at: '2024-06-02T00:00:00Z', updated_at: '2024-06-02T00:00:00Z' },
];

function okResponse(data: any) {
  return () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

function errResponse(error: string) {
  return () => Promise.resolve({ ok: false, status: 500, statusText: 'Error', json: () => Promise.resolve({ error }) });
}

describe('AnnouncementsPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders announcements table after loading', async () => {
    mockFetch.mockImplementation(okResponse({ total: 2, items: mockAnnouncements }));
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('系统维护')).toBeInTheDocument();
    });
    expect(screen.getByText('紧急通知')).toBeInTheDocument();
  });

  it('shows level badges with translated keys', async () => {
    mockFetch.mockImplementation(okResponse({ total: 2, items: mockAnnouncements }));
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('系统维护')).toBeInTheDocument();
    });

    expect(screen.getByText('announcements.levelInfo')).toBeInTheDocument();
    expect(screen.getByText('announcements.levelCritical')).toBeInTheDocument();
  });

  it('shows error on load failure', async () => {
    mockFetch.mockImplementation(errResponse('DB error'));
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('DB error')).toBeInTheDocument();
    });
  });

  it('opens create dialog', async () => {
    mockFetch.mockImplementation(okResponse({ total: 0, items: [] }));
    const user = userEvent.setup();
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('announcements.noData')).toBeInTheDocument();
    });

    await user.click(screen.getByText('announcements.create'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('announcements.titlePlaceholder')).toBeInTheDocument();
    });
  });

  it('creates announcement via dialog', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ total: 0, items: [] }) });
      if (callCount === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 3 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ total: 1, items: [{ id: 3, title: '新公告', content: '公告内容', level: 'info', pinned: false, published: false, created_at: '2024-06-03T00:00:00Z', updated_at: '2024-06-03T00:00:00Z' }] }) });
    });

    const user = userEvent.setup();
    render(<AnnouncementsPage />);

    // Wait for initial load to complete
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    // Wait for the create button to be clickable (not in loading state)
    const createBtn = await screen.findByText('announcements.create');
    await user.click(createBtn);

    await user.type(screen.getByPlaceholderText('announcements.titlePlaceholder'), '新公告');
    await user.type(screen.getByPlaceholderText('announcements.contentPlaceholder'), '公告内容');

    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  it('shows checkmarks for pinned and published announcements', async () => {
    mockFetch.mockImplementation(okResponse({ total: 2, items: mockAnnouncements }));
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('紧急通知')).toBeInTheDocument();
    });

    // Item 1: published=true (1 ✓), Item 2: pinned+published (2 ✓) = 3 total
    expect(screen.getAllByText('✓').length).toBe(3);
  });
});
