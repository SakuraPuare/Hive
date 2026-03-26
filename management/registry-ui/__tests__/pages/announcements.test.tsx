import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAdminListAnnouncements = vi.fn();
const mockAdminCreateAnnouncement = vi.fn();
const mockAdminUpdateAnnouncement = vi.fn();
const mockAdminDeleteAnnouncement = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: {
    adminListAnnouncements: (...args: any[]) => mockAdminListAnnouncements(...args),
    adminCreateAnnouncement: (...args: any[]) => mockAdminCreateAnnouncement(...args),
    adminUpdateAnnouncement: (...args: any[]) => mockAdminUpdateAnnouncement(...args),
    adminDeleteAnnouncement: (...args: any[]) => mockAdminDeleteAnnouncement(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: <T,>(p: Promise<T>) => p,
}));

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

import AnnouncementsPage from '@/pages/announcements';

const mockAnnouncements = [
  { id: 1, title: '系统维护', content: '今晚维护', level: 'info', pinned: false, published: true, created_at: '2024-06-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
  { id: 2, title: '紧急通知', content: '服务中断', level: 'critical', pinned: true, published: true, created_at: '2024-06-02T00:00:00Z', updated_at: '2024-06-02T00:00:00Z' },
];

describe('AnnouncementsPage', () => {
  beforeEach(() => {
    mockAdminListAnnouncements.mockReset();
    mockAdminCreateAnnouncement.mockReset();
    mockAdminUpdateAnnouncement.mockReset();
    mockAdminDeleteAnnouncement.mockReset();
  });

  it('renders announcements table after loading', async () => {
    mockAdminListAnnouncements.mockResolvedValueOnce({ total: 2, items: mockAnnouncements });
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('系统维护')).toBeInTheDocument();
    });
    expect(screen.getByText('紧急通知')).toBeInTheDocument();
  });

  it('shows level badges with translated keys', async () => {
    mockAdminListAnnouncements.mockResolvedValueOnce({ total: 2, items: mockAnnouncements });
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('系统维护')).toBeInTheDocument();
    });

    expect(screen.getByText('announcements.levelInfo')).toBeInTheDocument();
    expect(screen.getByText('announcements.levelCritical')).toBeInTheDocument();
  });

  it('shows error on load failure', async () => {
    mockAdminListAnnouncements.mockRejectedValueOnce(new Error('DB error'));
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('announcements.loadFailed')).toBeInTheDocument();
    });
  });

  it('opens create dialog', async () => {
    mockAdminListAnnouncements.mockResolvedValueOnce({ total: 0, items: [] });
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
    mockAdminListAnnouncements.mockResolvedValueOnce({ total: 0, items: [] });
    mockAdminCreateAnnouncement.mockResolvedValueOnce({ id: 3 });
    mockAdminListAnnouncements.mockResolvedValueOnce({
      total: 1,
      items: [{ id: 3, title: '新公告', content: '公告内容', level: 'info', pinned: false, published: false, created_at: '2024-06-03T00:00:00Z', updated_at: '2024-06-03T00:00:00Z' }],
    });

    const user = userEvent.setup();
    render(<AnnouncementsPage />);

    const createBtn = await screen.findByText('announcements.create');
    await user.click(createBtn);

    await user.type(screen.getByPlaceholderText('announcements.titlePlaceholder'), '新公告');
    await user.type(screen.getByPlaceholderText('announcements.contentPlaceholder'), '公告内容');

    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      expect(mockAdminCreateAnnouncement).toHaveBeenCalled();
    });
  });

  it('shows checkmarks for pinned and published announcements', async () => {
    mockAdminListAnnouncements.mockResolvedValueOnce({ total: 2, items: mockAnnouncements });
    render(<AnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('紧急通知')).toBeInTheDocument();
    });

    // Item 1: published=true (1 ✓), Item 2: pinned+published (2 ✓) = 3 total
    expect(screen.getAllByText('✓').length).toBe(3);
  });
});
