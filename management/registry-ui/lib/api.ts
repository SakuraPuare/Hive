import { z } from 'zod';

const rawApiBase = process.env.NEXT_PUBLIC_API_BASE?.trim();
export const API_PREFIX = rawApiBase ? rawApiBase.replace(/\/+$/, '') : '/api';

export function apiPath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${normalized}`;
}

// Zod schemas generated from OpenAPI (Swagger -> OpenAPI3 -> openapi-to-zod)
import {
  mainNodeSchema,
  mainStatusResponseSchema,
  mainAdminLoginRequestSchema,
  mainUpdateRequestSchema,
} from '../src/generated/zod/schemas';

// Types generated from OpenAPI
import type {
  main_AdminLoginRequest,
  main_Node,
  main_StatusResponse,
  main_UpdateRequest,
} from '../src/generated/client';

type ApiError = {
  error?: string;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

export function authFetch(path: string, options: RequestInit = {}) {
  const res = fetch(apiPath(path), {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.headers || {}),
    },
  });

  // Keep auth redirect logic identical to the previous api.js behavior.
  // Note: we intentionally don't throw here; callers can still inspect res.ok.
  return res.then((r) => {
    if (r.status === 401 || r.status === 403) {
      if (isBrowser()) window.location.href = '/login';
    }
    return r;
  });
}

async function authJsonParse<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const res = await authFetch(path, options);
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  const data = await res.json();
  return schema.parse(data);
}

async function safeReadApiError(res: Response): Promise<ApiError> {
  try {
    return await res.json();
  } catch {
    return { error: `${res.status}` };
  }
}

export async function getHealth(): Promise<main_StatusResponse | null> {
  const res = await authFetch('/health', { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json();
  return mainStatusResponseSchema.parse(data);
}

export async function adminLogin(username: string, password: string) {
  const body: main_AdminLoginRequest = { username, password } as any;
  // Optional: validate request shape (doesn't affect server, just early fail)
  mainAdminLoginRequestSchema.parse(body);
  return authJsonParse('/admin/login', mainStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function adminLogout() {
  return authJsonParse('/admin/logout', mainStatusResponseSchema, { method: 'POST' });
}

export async function listNodes(): Promise<main_Node[]> {
  const res = await authFetch('/nodes', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  const data = await res.json();
  return z.array(mainNodeSchema).parse(data);
}

export async function getNode(mac: string): Promise<main_Node> {
  const res = await authFetch(`/nodes/${encodeURIComponent(mac)}`, { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  const data = await res.json();
  return mainNodeSchema.parse(data);
}

export async function patchNode(mac: string, patch: Partial<main_UpdateRequest>) {
  // patch can omit fields; schema is loose/optional
  mainUpdateRequestSchema.parse(patch as any);
  const res = await authFetch(`/nodes/${encodeURIComponent(mac)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  const data = await res.json();
  return mainStatusResponseSchema.parse(data);
}

export async function deleteNode(mac: string) {
  const res = await authFetch(`/nodes/${encodeURIComponent(mac)}`, { method: 'DELETE' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  const data = await res.json();
  return mainStatusResponseSchema.parse(data);
}

// Non-JSON endpoints: keep them as plain text.
export async function getSubscriptionVlessText(): Promise<string> {
  const res = await authFetch('/subscription', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.text();
}

export async function getSubscriptionClashText(): Promise<string> {
  const res = await authFetch('/subscription/clash', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.text();
}

export async function getLabelsHtmlText(): Promise<string> {
  const res = await authFetch('/labels', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.text();
}

// ── 用户管理 ──────────────────────────────────────────────────────────────────

export type AdminUser = {
  id: number;
  username: string;
  roles: string[];
  permissions: string[];
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  id: number;
  username: string;
  action: string;
  detail: string;
  ip: string;
  created_at: string;
};

export type Role = {
  id: number;
  name: string;
  description: string;
  permissions: string[];
};

export type PermissionItem = {
  slug: string;
  description: string;
};

export async function getMe(): Promise<AdminUser> {
  const res = await authFetch('/admin/me', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}

export async function listUsers(): Promise<AdminUser[]> {
  const res = await authFetch('/admin/users', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}

export async function createUser(username: string, password: string, role: string) {
  const res = await authFetch('/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role }),
  });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json() as Promise<{ status: string }>;
}

export async function deleteUser(id: number) {
  const res = await authFetch(`/admin/users/${id}`, { method: 'DELETE' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json() as Promise<{ status: string }>;
}

export async function changePassword(id: number, password: string) {
  const res = await authFetch(`/admin/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json() as Promise<{ status: string }>;
}

export async function getUserRoles(id: number): Promise<string[]> {
  const res = await authFetch(`/admin/users/${id}/roles`, { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}

export async function setUserRoles(id: number, roles: string[]) {
  const res = await authFetch(`/admin/users/${id}/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json() as Promise<{ status: string }>;
}

export async function listRoles(): Promise<Role[]> {
  const res = await authFetch('/admin/roles', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}

export async function setRolePermissions(id: number, permissions: string[]) {
  const res = await authFetch(`/admin/roles/${id}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions }),
  });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json() as Promise<{ status: string }>;
}

export async function listPermissions(): Promise<PermissionItem[]> {
  const res = await authFetch('/admin/permissions', { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}

export async function listAuditLogs(limit = 50, offset = 0): Promise<AuditLog[]> {
  const res = await authFetch(`/admin/audit-logs?limit=${limit}&offset=${offset}`, { method: 'GET' });
  if (!res.ok) return Promise.reject(await safeReadApiError(res));
  return res.json();
}
