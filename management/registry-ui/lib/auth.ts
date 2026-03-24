import { useState, useEffect, useCallback } from 'react';
import { getMe, type AdminUser } from './api';

export type CurrentUser = AdminUser & {
  can: (perm: string) => boolean;
};

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((me) => {
        const permSet = new Set(me.permissions);
        const can = (perm: string) => permSet.has(perm);
        setUser({ ...me, can });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
