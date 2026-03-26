import { SystemService, OpenAPI } from '../src/generated/client';
import type { handler_StatusResponse } from '../src/generated/client';
import { ApiError } from '../src/generated/client/core/ApiError';

const rawApiBase = process.env.NEXT_PUBLIC_API_BASE?.trim();
export const API_PREFIX = rawApiBase ? rawApiBase.replace(/\/+$/, '') : '/api';

OpenAPI.BASE = API_PREFIX;
OpenAPI.WITH_CREDENTIALS = true;
OpenAPI.CREDENTIALS = 'include';

export function apiPath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${normalized}`;
}

function isBrowser() {
  return typeof window !== 'undefined';
}

function redirectOnAuthFailure(status: number) {
  if (status === 401 || status === 403) {
    if (isBrowser()) window.location.href = '/login';
  }
}

function rejectFromApiError(e: ApiError): never {
  const msg =
    e.body && typeof e.body === 'object' && 'error' in e.body
      ? String((e.body as { error?: string }).error)
      : e.message;
  throw { error: msg, status: e.status };
}

/** 带会话 cookie：401/403 跳转登录，错误抛 `{ error, status }`（与旧 authFetch 一致） */
export async function sessionApi<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError) {
      redirectOnAuthFailure(e.status);
      rejectFromApiError(e);
    }
    throw e;
  }
}

/** Portal 版 sessionApi：401/403 跳转 /portal/login */
export async function portalSessionApi<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError) {
      if ((e.status === 401 || e.status === 403) && isBrowser()) {
        window.location.href = '/portal/login';
      }
      rejectFromApiError(e);
    }
    throw e;
  }
}

/** 公开健康检查：失败返回 null，不跳转 */
export async function getHealth(): Promise<handler_StatusResponse | null> {
  try {
    return await SystemService.health();
  } catch {
    return null;
  }
}
