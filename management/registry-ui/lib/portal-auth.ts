import { useState, useEffect } from 'react';
import { PortalAuthService, PortalService } from '@/src/generated/client';
import type { handler_PortalMeResponse } from '@/src/generated/client';
import type { model_CustomerSubscription } from '@/src/generated/client/models/model_CustomerSubscription';
import { ApiError } from '@/src/generated/client/core/ApiError';

export type CustomerSubscription = model_CustomerSubscription;

export type Customer = Pick<handler_PortalMeResponse, 'id' | 'email' | 'nickname' | 'status' | 'created_at'>;

export function useCustomer(): {
  customer: Customer | null;
  subscriptions: CustomerSubscription[];
  loading: boolean;
} {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    PortalService.portalMe()
      .then((data) => {
        setCustomer(data ?? null);
        setSubscriptions(data.subscriptions ?? []);
      })
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, []);

  return { customer, subscriptions, loading };
}

export async function portalLogin(email: string, password: string) {
  try {
    return await PortalAuthService.portalLogin({ requestBody: { email, password } });
  } catch (e) {
    if (e instanceof ApiError) {
      const body = e.body && typeof e.body === 'object' ? e.body : {};
      throw { error: (body as any).error || 'Login failed', status: e.status };
    }
    throw e;
  }
}

export async function portalLogout() {
  await PortalAuthService.portalLogout();
}

export async function portalRegister(email: string, password: string, nickname: string) {
  try {
    return await PortalAuthService.portalRegister({ requestBody: { email, password, nickname } });
  } catch (e) {
    if (e instanceof ApiError) {
      const body = e.body && typeof e.body === 'object' ? e.body : {};
      throw { error: (body as any).error || 'Registration failed', status: e.status };
    }
    throw e;
  }
}
