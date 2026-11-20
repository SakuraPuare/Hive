import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { handler_AdminClaimCodeResponse, model_Node } from '@/src/generated/client';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useClipboard } from '@/lib/use-clipboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Copy, RefreshCw } from 'lucide-react';

/**
 * Operator-only view of a device claim code. The registry keeps the code as a
 * hash for claiming and as plaintext (migration 40) for this panel; devices
 * enrolled before that migration return an empty string.
 */
export function ClaimCodeCard({ node }: { node: model_Node }) {
  const t = useTranslations('claimCode');
  const { user } = useCurrentUser();
  const canWrite = !!user?.can('node:write');
  const { copied, copy } = useClipboard();
  const [data, setData] = useState<handler_AdminClaimCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!canWrite || !node.mac) return;
    setLoading(true);
    setError('');
    sessionApi(AdminService.adminGetDeviceClaimCode({ mac: node.mac }))
      .then(setData)
      .catch((e: unknown) => setError(getErrorMessage(e, t('loadFailed'))))
      .finally(() => setLoading(false));
  }, [canWrite, node.mac, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canWrite) return null;

  const code = data?.claim_code?.trim() ?? '';
  const claimable = data?.claimable ?? false;

  return (
    <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '20ms' }}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2 pt-5 px-5">
        <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">
          {t('title')}
        </CardTitle>
        <Button variant="ghost" size="xs" onClick={load} disabled={loading} aria-label={t('refresh')}>
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('refresh')}
        </Button>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : loading && !data ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : code ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-md-surface-container-high/60 px-3 py-2">
              <code className="min-w-0 flex-1 font-mono text-lg tracking-wider text-foreground">{code}</code>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0 gap-1"
                onClick={() => void copy(code)}
                aria-label={`${t('copy')} ${code}`}
              >
                {copied ? <Check className="size-3.5 text-md-tertiary" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {claimable ? t('hint') : t('claimed')}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('notStored')}</p>
        )}
      </CardContent>
    </Card>
  );
}
