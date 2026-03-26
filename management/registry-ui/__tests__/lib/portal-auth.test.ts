import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockPortalMe = vi.fn();
const mockPortalLogin = vi.fn();
const mockPortalLogout = vi.fn();
const mockPortalRegister = vi.fn();

vi.mock('@/src/generated/client', () => ({
  PortalService: { portalMe: (...args: any[]) => mockPortalMe(...args) },
  PortalAuthService: {
    portalLogin: (...args: any[]) => mockPortalLogin(...args),
    portalLogout: (...args: any[]) => mockPortalLogout(...args),
    portalRegister: (...args: any[]) => mockPortalRegister(...args),
  },
}));

vi.mock('@/src/generated/client/core/ApiError', () => {
  class ApiError extends Error {
    status: number;
    body: any;
    constructor(request: any, response: any, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = response.status;
      this.body = response.body;
    }
  }
  return { ApiError };
});

import { useCustomer, portalLogin, portalLogout, portalRegister } from '@/lib/portal-auth';
import { ApiError } from '@/src/generated/client/core/ApiError';

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
    mockPortalMe.mockReset();
    mockPortalLogin.mockReset();
    mockPortalLogout.mockReset();
    mockPortalRegister.mockReset();
  });

  describe('useCustomer', () => {
    it('returns customer and subscriptions on success', async () => {
      mockPortalMe.mockResolvedValueOnce({
        ...mockCustomer,
        subscriptions: mockSubscriptions,
      });

      const { result } = renderHook(() => useCustomer());

      // Initially loading
      expect(result.current.loading).toBe(true);
      expect(result.current.customer).toBeNull();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toEqual(expect.objectContaining(mockCustomer));
      expect(result.current.subscriptions).toEqual(mockSubscriptions);
    });

    it('sets customer to null on non-ok response', async () => {
      mockPortalMe.mockRejectedValueOnce(
        new ApiError({} as any, { status: 401, body: {} } as any, 'Unauthorized'),
      );

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
      expect(result.current.subscriptions).toEqual([]);
    });

    it('sets customer to null on network error', async () => {
      mockPortalMe.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
    });

    it('handles missing subscriptions in response', async () => {
      mockPortalMe.mockResolvedValueOnce({ ...mockCustomer });

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toEqual(expect.objectContaining(mockCustomer));
      expect(result.current.subscriptions).toEqual([]);
    });

    it('handles missing customer in response', async () => {
      mockPortalMe.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useCustomer());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.customer).toBeNull();
    });
  });

  describe('portalLogin', () => {
    it('sends POST with email and password, returns data on success', async () => {
      const responseData = { status: 'ok' };
      mockPortalLogin.mockResolvedValueOnce(responseData);

      const result = await portalLogin('test@example.com', 'password123');

      expect(result).toEqual(responseData);
      expect(mockPortalLogin).toHaveBeenCalledWith({
        requestBody: { email: 'test@example.com', password: 'password123' },
      });
    });

    it('throws error with server message on failure', async () => {
      mockPortalLogin.mockRejectedValueOnce(
        new ApiError({} as any, { status: 401, body: { error: 'Invalid credentials' } } as any, 'Unauthorized'),
      );

      await expect(portalLogin('bad@example.com', 'wrong')).rejects.toEqual({
        error: 'Invalid credentials',
        status: 401,
      });
    });

    it('throws fallback error when response body is not JSON', async () => {
      mockPortalLogin.mockRejectedValueOnce(
        new ApiError({} as any, { status: 500, body: null } as any, 'Server Error'),
      );

      await expect(portalLogin('a@b.com', 'x')).rejects.toEqual({
        error: 'Login failed',
        status: 500,
      });
    });
  });

  describe('portalLogout', () => {
    it('sends POST to logout endpoint', async () => {
      mockPortalLogout.mockResolvedValueOnce({ status: 'ok' });

      await portalLogout();

      expect(mockPortalLogout).toHaveBeenCalled();
    });
  });

  describe('portalRegister', () => {
    it('sends POST with email, password, nickname', async () => {
      const responseData = { status: 'ok' };
      mockPortalRegister.mockResolvedValueOnce(responseData);

      const result = await portalRegister('new@example.com', 'pass123', 'NewUser');

      expect(result).toEqual(responseData);
      expect(mockPortalRegister).toHaveBeenCalledWith({
        requestBody: { email: 'new@example.com', password: 'pass123', nickname: 'NewUser' },
      });
    });

    it('throws error with server message on failure', async () => {
      mockPortalRegister.mockRejectedValueOnce(
        new ApiError({} as any, { status: 409, body: { error: 'Email already exists' } } as any, 'Conflict'),
      );

      await expect(portalRegister('dup@example.com', 'pass', 'Dup')).rejects.toEqual({
        error: 'Email already exists',
        status: 409,
      });
    });

    it('throws fallback error when response body is not JSON', async () => {
      mockPortalRegister.mockRejectedValueOnce(
        new ApiError({} as any, { status: 500, body: null } as any, 'Server Error'),
      );

      await expect(portalRegister('a@b.com', 'x', 'n')).rejects.toEqual({
        error: 'Registration failed',
        status: 500,
      });
    });
  });
});
