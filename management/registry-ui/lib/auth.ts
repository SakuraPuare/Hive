import { useState, useEffect } from 'react';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from './openapi-session';
import type { AdminUser } from './domain-types';

export type CurrentUser = AdminUser & {
  can: (perm: string) => boolean;
};

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
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

  return { user, loading };
}
