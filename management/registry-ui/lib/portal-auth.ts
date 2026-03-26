import { useState, useEffect } from 'react';
import { API_PREFIX } from './openapi-session';

export type CustomerSubscription = {
  id: number;
  plan_name: string;
  token: string;
  traffic_used: number;
  traffic_limit: number;
  device_limit: number;
  expires_at: string;
  status: string;
};

export type Customer = {
  id: number;
  email: string;
  nickname: string;
  status: string;
  created_at: string;
};

export function useCustomer(): {
  customer: Customer | null;
  subscriptions: CustomerSubscription[];
  loading: boolean;
} {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_PREFIX}/portal/me`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) { setCustomer(null); return; }
        const data = await res.json();
        setCustomer(data.customer ?? null);
        setSubscriptions(data.subscriptions ?? []);
      })
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, []);

  return { customer, subscriptions, loading };
}

export async function portalLogin(email: string, password: string) {
  const res = await fetch(`${API_PREFIX}/portal/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { error: body.error || 'Login failed', status: res.status };
  }
  return res.json();
}

export async function portalLogout() {
  await fetch(`${API_PREFIX}/portal/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function portalRegister(email: string, password: string, nickname: string) {
  const res = await fetch(`${API_PREFIX}/portal/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, nickname }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { error: body.error || 'Registration failed', status: res.status };
  }
  return res.json();
}
