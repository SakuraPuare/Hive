import { SystemService } from '../src/generated/client/services/SystemService';
import { OpenAPI } from '../src/generated/client/core/OpenAPI';
import type { handler_StatusResponse } from '../src/generated/client/models/handler_StatusResponse';
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

/**
 * Absolute, shareable API URL including the current origin.
 *
 * `apiPath` returns a root-relative path like `/api/s/<token>`, which is what
 * fetch() needs but is useless when copied into an external proxy client — the
 * scheme + host are missing. Subscription links, QR codes, and any URL a user
 * copies out of the app must go through this so they get
 * `https://host.example.com/api/s/<token>`. Falls back to the relative path
 * during SSR where `window` is unavailable.
 */
export function apiUrl(path: string) {
  const rel = apiPath(path);
  if (typeof window === 'undefined') return rel;
  // If API_PREFIX is already absolute (cross-origin API base), apiPath already
  // yields a full URL — return as-is.
  if (/^https?:\/\//i.test(rel)) return rel;
  return `${window.location.origin}${rel}`;
}

/**
 * Absolute URL for a customer subscription.
 *
 * `/c/{token}` is a registry endpoint (not a Next.js page): the static export
 * has no `/c/` route and nginx only forwards `/api/` to the backend. Clients
 * therefore fetch `<panel>/api/c/{token}` (or `/c/{token}/vless`).
 *
 * `direction` selects the split config: `overseas` (default, 出海) or
 * `domestic` (回国, `/c/{token}/domestic`). The two are separate configs
 * because their CN routing rules are opposite.
 */
export type SubscriptionDirection = 'overseas' | 'domestic';

export function customerSubscriptionUrl(
  token: string,
  vless = false,
  direction: SubscriptionDirection = 'overseas',
) {
  const path = direction === 'domestic' ? `/domestic${vless ? '/vless' : ''}` : vless ? '/vless' : '';
  return apiUrl(`/c/${token}${path}`);
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
