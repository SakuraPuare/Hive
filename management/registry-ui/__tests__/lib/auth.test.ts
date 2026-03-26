import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockAdminMe = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: { adminMe: () => mockAdminMe() },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
}));

import { useCurrentUser } from '@/lib/auth';

describe('useCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user with can() after successful fetch', async () => {
    mockAdminMe.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      roles: ['superadmin'],
      permissions: ['node:read', 'node:write'],
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    const { result } = renderHook(() => useCurrentUser());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user!.username).toBe('admin');
    expect(result.current.user!.can('node:read')).toBe(true);
    expect(result.current.user!.can('node:write')).toBe(true);
    expect(result.current.user!.can('customer:read')).toBe(false);
  });

  it('returns null user on fetch failure', async () => {
    mockAdminMe.mockRejectedValueOnce(new Error('unauthorized'));

    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it('handles empty permissions array', async () => {
    mockAdminMe.mockResolvedValueOnce({
      id: 2,
      username: 'viewer',
      roles: ['viewer'],
      permissions: [],
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user!.can('anything')).toBe(false);
  });

  it('handles undefined permissions', async () => {
    mockAdminMe.mockResolvedValueOnce({
      id: 3,
      username: 'noperms',
      roles: [],
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user!.can('node:read')).toBe(false);
  });
});
