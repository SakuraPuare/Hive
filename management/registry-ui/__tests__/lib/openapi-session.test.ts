import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiPath, sessionApi, getHealth } from '@/lib/openapi-session';
import { ApiError } from '@/src/generated/client/core/ApiError';

describe('apiPath', () => {
  it('prepends API_PREFIX to path', () => {
    expect(apiPath('/nodes')).toBe('/api/nodes');
  });

  it('normalizes path without leading slash', () => {
    expect(apiPath('nodes')).toBe('/api/nodes');
  });
});

describe('sessionApi', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { writable: true, value: { href: '' } });
  });

  it('returns resolved value on success', async () => {
    const result = await sessionApi(Promise.resolve({ data: 'ok' }));
    expect(result).toEqual({ data: 'ok' });
  });

  it('redirects to /login on 401 ApiError', async () => {
    const err = new ApiError(
      { method: 'GET', url: '/test' } as any,
      { url: '/test', ok: false, status: 401, statusText: 'Unauthorized', body: { error: 'unauthorized' } } as any,
      'Unauthorized'
    );
    await expect(sessionApi(Promise.reject(err))).rejects.toEqual({
      error: 'unauthorized',
      status: 401,
    });
    expect(window.location.href).toBe('/login');
  });

  it('redirects to /login on 403 ApiError', async () => {
    const err = new ApiError(
      { method: 'GET', url: '/test' } as any,
      { url: '/test', ok: false, status: 403, statusText: 'Forbidden', body: { error: 'forbidden' } } as any,
      'Forbidden'
    );
    await expect(sessionApi(Promise.reject(err))).rejects.toEqual({
      error: 'forbidden',
      status: 403,
    });
    expect(window.location.href).toBe('/login');
  });

  it('does not redirect on 500 ApiError', async () => {
    const err = new ApiError(
      { method: 'GET', url: '/test' } as any,
      { url: '/test', ok: false, status: 500, statusText: 'Server Error', body: { error: 'internal' } } as any,
      'Server Error'
    );
    await expect(sessionApi(Promise.reject(err))).rejects.toEqual({
      error: 'internal',
      status: 500,
    });
    expect(window.location.href).toBe('');
  });

  it('uses message fallback when body has no error field', async () => {
    const err = new ApiError(
      { method: 'GET', url: '/test' } as any,
      { url: '/test', ok: false, status: 400, statusText: 'Bad Request', body: 'not json' } as any,
      'Bad Request'
    );
    await expect(sessionApi(Promise.reject(err))).rejects.toEqual({
      error: 'Bad Request',
      status: 400,
    });
  });

  it('rethrows non-ApiError errors', async () => {
    const err = new Error('network failure');
    await expect(sessionApi(Promise.reject(err))).rejects.toBe(err);
  });
});

describe('getHealth', () => {
  it('returns null on failure', async () => {
    // getHealth uses HealthService internally which we can't easily mock here,
    // but we can verify the function exists and handles errors
    const result = await getHealth();
    // Will likely fail since no server, should return null
    expect(result).toBeNull();
  });
});
