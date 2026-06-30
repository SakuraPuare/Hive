import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { PortalPublicService } from '@/src/generated/client';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { getErrorMessage } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Pin, AlertTriangle, Info, AlertCircle } from 'lucide-react';

/* ── M3 level styling ────────────────────────────────────────────────────── */
const LEVEL_CONFIG: Record<
  string,
  {
    card: string;
    bar: string;
    icon: React.ElementType;
    iconClass: string;
    badge: string;
  }
> = {
  critical: {
    card: 'bg-md-error-container/30 border border-md-error-container',
    bar: 'bg-md-error',
    icon: AlertCircle,
    iconClass: 'text-destructive',
    badge: 'bg-md-error-container text-md-on-error-container',
  },
  warning: {
    card: 'bg-[hsl(43_96%_50%/0.08)] border border-[hsl(43_96%_50%/0.3)]',
    bar: 'bg-[hsl(43_96%_50%)]',
    icon: AlertTriangle,
    iconClass: 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]',
    badge:
      'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  },
  info: {
    card: 'bg-md-primary-container/20 border border-md-primary-container/50',
    bar: 'bg-md-primary',
    icon: Info,
    iconClass: 'text-md-primary',
    badge: 'bg-md-primary-container text-md-on-primary-container',
  },
};

const getLevelConfig = (level?: string) =>
  LEVEL_CONFIG[level ?? 'info'] ?? LEVEL_CONFIG.info;

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
    () =>
      [...announcements].sort(
        (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false),
      ),
    [announcements],
  );

  return (
    <div className="space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="animate-slide-up flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-md-primary-container text-md-on-primary-container">
          <Megaphone className="size-5" />
        </div>
        <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
          {t('announcementsTitle')}
        </h1>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="animate-slide-up rounded-xl bg-md-error-container/40 border border-md-error-container px-4 py-3 text-sm text-md-on-error-container flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          {error}
        </div>
      )}

      {/* ── Loading state — M3 circular progress ─────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
          <div
            className="size-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
            role="progressbar"
            aria-label={t('announcementsTitle')}
          />
          <p className="text-sm text-muted-foreground">{t('announcementsTitle')}</p>
        </div>
      ) : sorted.length === 0 ? (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <div className="animate-slide-up flex flex-col items-center justify-center gap-4 py-20 rounded-2xl bg-card border">
          <div className="flex size-14 items-center justify-center rounded-full bg-md-surface-container-high">
            <Megaphone className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base text-muted-foreground">{t('noAnnouncements')}</p>
        </div>
      ) : (
        /* ── Announcement list ───────────────────────────────────────────── */
        <div className="space-y-4">
          {sorted.map((a, i) => {
            const cfg = getLevelConfig(a.level);
            const LevelIcon = cfg.icon;
            return (
              <Card
                key={a.id}
                className={`relative overflow-hidden rounded-xl border-0 shadow-none animate-slide-up ${cfg.card}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {/* left tonal accent bar */}
                <span
                  className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${cfg.bar}`}
                  aria-hidden="true"
                />

                <CardHeader className="pl-6 pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <LevelIcon className={`size-4 shrink-0 ${cfg.iconClass}`} />
                    <span className="font-display text-base font-600 text-foreground">
                      {a.title}
                    </span>

                    {a.pinned && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-500 ${cfg.badge}`}
                      >
                        <Pin className="size-3" />
                        {t('pinned')}
                      </span>
                    )}

                    {a.level && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-500 uppercase tracking-wide ${cfg.badge}`}
                      >
                        {a.level}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>

                <CardContent className="pl-6">
                  {/* content is sanitized with DOMPurify before injection */}
                  <p
                    className="text-sm leading-relaxed text-foreground/80"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        (a.content ?? '').replace(/\n/g, '<br/>'),
                      ),
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
