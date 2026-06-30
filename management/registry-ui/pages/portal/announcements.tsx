import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { PortalPublicService } from '@/src/generated/client';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { getErrorMessage } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Pin } from 'lucide-react';

const BANNER_STYLES: Record<string, string> = {
  critical: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-200',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200',
};

export default function PortalAnnouncementsPage() {
  const t = useTranslations('portal');

  const [announcements, setAnnouncements] = useState<model_Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await PortalPublicService.portalAnnouncements();
        if (active) setAnnouncements(Array.isArray(data) ? data : []);
      } catch (e) {
        if (active) setError(getErrorMessage(e, t('loadFailed')));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const sorted = useMemo(
    () => [...announcements].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)),
    [announcements],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          {t('announcementsTitle')}
        </h1>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">{t('noAnnouncements')}</div>
      ) : (
        <div className="space-y-4">
          {sorted.map((a) => {
            const levelClass = BANNER_STYLES[a.level ?? 'info'] ?? BANNER_STYLES.info;
            return (
              <Card key={a.id} className={`border-l-4 ${levelClass}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span>{a.title}</span>
                    {a.pinned && (
                      <Badge variant="outline" className="gap-1">
                        <Pin className="h-3 w-3" />
                        {t('pinned')}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* react-doctor-disable-next-line react-doctor/no-danger -- content is sanitized with DOMPurify before injection */}
                  <p
                    className="text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize((a.content ?? '').replace(/\n/g, '<br/>')),
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
