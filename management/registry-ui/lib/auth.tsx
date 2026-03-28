import React, { createContext, useContext, useState, useEffect } from 'react';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from './openapi-session';
import type { AdminUser } from './domain-types';

export type CurrentUser = AdminUser & {
  can: (perm: string) => boolean;
};

type CurrentUserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
};

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(undefined);

/** Fetches admin /me once and shares the result via context. */
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionApi(AdminService.adminMe())
      .then((me) => {
        const u = me as AdminUser;
        const permSet = new Set(u.permissions ?? []);
        const can = (perm: string) => permSet.has(perm);
        setUser({ ...u, can });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <CurrentUserContext.Provider value={{ user, loading }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

/**
 * Returns the current admin user.
 * Inside <CurrentUserProvider> (normal app), reads from context — single fetch.
 * Outside the provider (unit tests), falls back to a standalone fetch.
 */
export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const skip = ctx !== undefined;

  useEffect(() => {
    if (skip) return;
    sessionApi(AdminService.adminMe())
      .then((me) => {
        const u = me as AdminUser;
        const permSet = new Set(u.permissions ?? []);
        const can = (perm: string) => permSet.has(perm);
        setUser({ ...u, can });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [skip]);

  if (ctx !== undefined) return ctx;
  return { user, loading };
}
