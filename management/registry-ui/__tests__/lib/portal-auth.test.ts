import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCustomer, portalLogin, portalLogout, portalRegister } from '@/lib/portal-auth';

// Mock the openapi-session module to control API_PREFIX
vi.mock('@/lib/openapi-session', () => ({
  API_PREFIX: '/api',
}));

const mockCustomer = {
  id: 1,
  email: 'test@example.com',
  nickname: 'Test User',
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
};

const mockSubscriptions = [
  {
    id: 1,
    plan_name: 'Pro',
    token: 'abc123',
    traffic_used: 1073741824,
    traffic_limit: 10737418240,
    device_limit: 3,
    expires_at: '2026-12-31T00:00:00Z',
    status: 'active',
  },
];

describe('portal-auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('useCustomer', () => {
    it('returns customer and subscriptions on success', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ customer: mockCustomer, subscriptions: mockSubscriptions }),
      });

      const { result } = renderHook(() => useCustomer());

      // Initially loading
      expect(result.current.loading).toBe(true);
      expect(result.current.customer).toBeNull();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toEqual(mockCustomer);
      expect(result.current.subscriptions).toEqual(mockSubscriptions);
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/me', { credentials: 'include' });
    });

    it('sets customer to null on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
      expect(result.current.subscriptions).toEqual([]);
    });

    it('sets customer to null on network error', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
    });

    it('handles missing subscriptions in response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ customer: mockCustomer }),
      });

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toEqual(mockCustomer);
      expect(result.current.subscriptions).toEqual([]);
    });

    it('handles missing customer in response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
    });
  });

  describe('portalLogin', () => {
    it('sends POST with email and password, returns data on success', async () => {
      const responseData = { token: 'session123' };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(responseData),
      });

      const result = await portalLogin('test@example.com', 'password123');

      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      });
    });

    it('throws error with server message on failure', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      await expect(portalLogin('bad@example.com', 'wrong')).rejects.toEqual({
        error: 'Invalid credentials',
        status: 401,
      });
    });

    it('throws fallback error when response body is not JSON', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(portalLogin('a@b.com', 'x')).rejects.toEqual({
        error: 'Login failed',
        status: 500,
      });
    });
  });

  describe('portalLogout', () => {
    it('sends POST to logout endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      await portalLogout();

      expect(global.fetch).toHaveBeenCalledWith('/api/portal/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
  });

  describe('portalRegister', () => {
    it('sends POST with email, password, nickname', async () => {
      const responseData = { id: 1 };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(responseData),
      });

      const result = await portalRegister('new@example.com', 'pass123', 'NewUser');

      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'pass123', nickname: 'NewUser' }),
      });
    });

    it('throws error with server message on failure', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Email already exists' }),
      });

      await expect(portalRegister('dup@example.com', 'pass', 'Dup')).rejects.toEqual({
        error: 'Email already exists',
        status: 409,
      });
    });

    it('throws fallback error when response body is not JSON', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(portalRegister('a@b.com', 'x', 'n')).rejects.toEqual({
        error: 'Registration failed',
        status: 500,
      });
    });
  });
});
