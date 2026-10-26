import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminService, type model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ServerCredentialCard({ node, onChanged }: {
  node: model_Node;
  onChanged: (enabled: boolean) => void;
}) {
  const t = useTranslations('serverRole');
  const { user } = useCurrentUser();
  const canWrite = !!user?.can('node:write');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(revoke: boolean) {
    if (!node.mac || !canWrite || node.owner_customer_id != null) return;
    setBusy(true);
    setError('');
    setToken('');
    try {
      if (revoke) {
        await sessionApi(AdminService.serverCredentialRevoke({ mac: node.mac }));
        setToken('');
      } else {
        const result = await sessionApi(AdminService.serverCredentialIssue({ mac: node.mac }));
        setToken(result.token ?? '');
      }
      onChanged(!revoke);
    } catch (e) {
      setError(getErrorMessage(e, t('failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="font-medium">{node.server_enabled ? t('server') : t('device')}</p>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        {node.owner_customer_id != null ? <p>{t('customerOwned')}</p> : canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void change(false)}>
              {node.server_enabled ? t('rotate') : t('enable')}
            </Button>
            {node.server_enabled && <Button variant="outline" disabled={busy} onClick={() => void change(true)}>{t('revoke')}</Button>}
          </div>
        )}
        {canWrite && token && (
          <div className="space-y-2">
            <label htmlFor="server-token" className="text-sm">{t('tokenHelp')}</label>
            <textarea id="server-token" className="w-full rounded border bg-background p-2 font-mono text-sm" readOnly value={token} onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={() => setToken('')}>{t('hide')}</Button>
          </div>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
