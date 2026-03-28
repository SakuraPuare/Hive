import React, { createContext, useContext, useState, useEffect } from 'react';
import { PortalAuthService, PortalService } from '@/src/generated/client';
import type { handler_PortalMeResponse } from '@/src/generated/client';
import type { model_CustomerSubscription } from '@/src/generated/client/models/model_CustomerSubscription';
import { ApiError } from '@/src/generated/client/core/ApiError';

export type CustomerSubscription = model_CustomerSubscription;

export type Customer = Pick<handler_PortalMeResponse, 'id' | 'email' | 'nickname' | 'status' | 'created_at'>;

type CustomerContextValue = {
  customer: Customer | null;
  subscriptions: CustomerSubscription[];
  loading: boolean;
};

const CustomerContext = createContext<CustomerContextValue | undefined>(undefined);

/** Fetches portal /me once and shares the result via context. */
export function CustomerProvider({ children }: { children: React.ReactNode }) {
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

  return (
    <CustomerContext.Provider value={{ customer, subscriptions, loading }}>
      {children}
    </CustomerContext.Provider>
  );
}

/**
 * Returns the current portal customer.
 * Inside <CustomerProvider> (normal app), reads from context — single fetch.
 * Outside the provider (unit tests), falls back to a standalone fetch.
 */
export function useCustomer(): CustomerContextValue {
  const ctx = useContext(CustomerContext);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const skip = ctx !== undefined;

  useEffect(() => {
    if (skip) return;
    PortalService.portalMe()
      .then((data) => {
        setCustomer(data ?? null);
        setSubscriptions(data.subscriptions ?? []);
      })
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, [skip]);

  if (ctx !== undefined) return ctx;
  return { customer, subscriptions, loading };
}

export async function portalLogin(email: string, password: string) {
  try {
    return await PortalAuthService.portalLogin({ requestBody: { email, password } });
  } catch (e) {
    if (e instanceof ApiError) {
      const body: Record<string, unknown> = e.body && typeof e.body === 'object' ? e.body as Record<string, unknown> : {};
      throw { error: (typeof body.error === 'string' ? body.error : '') || 'Login failed', status: e.status };
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
      const body: Record<string, unknown> = e.body && typeof e.body === 'object' ? e.body as Record<string, unknown> : {};
      throw { error: (typeof body.error === 'string' ? body.error : '') || 'Registration failed', status: e.status };
    }
    throw e;
  }
}
