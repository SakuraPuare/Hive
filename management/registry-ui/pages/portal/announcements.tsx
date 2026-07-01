import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { PortalPublicService } from '@/src/generated/client';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { getErrorMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Megaphone, Pin, AlertTriangle, Info, AlertCircle, RefreshCw } from 'lucide-react';

/* ── M3 level styling ────────────────────────────────────────────────────── */
type LevelKey = 'critical' | 'warning' | 'info';

const LEVEL_CONFIG: Record<
  LevelKey,
  {
    card: string;
    bar: string;
    icon: React.ElementType;
    iconClass: string;
    badgeVariant: 'destructive' | 'warning' | 'info';
  }
> = {
  critical: {
    card: 'bg-md-error-container/30 border border-md-error-container',
    bar: 'bg-md-error',
    icon: AlertCircle,
    iconClass: 'text-destructive',
    badgeVariant: 'destructive',
  },
  warning: {
    card: 'bg-[hsl(43_96%_50%/0.08)] border border-[hsl(43_96%_50%/0.3)]',
    bar: 'bg-[hsl(43_96%_50%)]',
    icon: AlertTriangle,
    iconClass: 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]',
    badgeVariant: 'warning',
  },
  info: {
    card: 'bg-md-primary-container/20 border border-md-primary-container/50',
    bar: 'bg-md-primary',
    icon: Info,
    iconClass: 'text-md-primary',
    badgeVariant: 'info',
  },
};

/** Whitelist the raw API level string; unknown values fall back to info. */
const normalizeLevel = (level?: string): LevelKey => {
  if (level === 'critical' || level === 'warning' || level === 'info') return level;
  if (level && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[announcements] unknown level "${level}" — falling back to info`);
  }
  return 'info';
};

/** Sanitizer that permits the legal block/inline subset and hardens links. */
const sanitizeContent = (raw: string): string => {
  const html = DOMPurify.sanitize(raw.replace(/\n/g, '<br/>'), {
    ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'h3', 'h4', 'code', 'pre', 'blockquote', 'span'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  });
  // Harden anchors: open in new tab, drop opener, apply M3 link token.
  if (typeof document === 'undefined') return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('a[href]').forEach((el) => {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
    el.classList.add('text-md-primary', 'underline', 'underline-offset-2');
  });
  return tpl.innerHTML;
};

export default function PortalAnnouncementsPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const { locale } = useLocale();

  const [announcements, setAnnouncements] = useState<model_Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const data = await PortalPublicService.portalAnnouncements();
        if (controller.signal.aborted) return;
        setAnnouncements(Array.isArray(data) ? data : []);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(e, t('loadFailed')));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  /** Sort: pinned first, then newest (created_at desc) within each group. */
  const sorted = useMemo(
    () =>
      [...announcements].sort((a, b) => {
        const pin = Number(b.pinned ?? false) - Number(a.pinned ?? false);
        if (pin !== 0) return pin;
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      }),
    [announcements],
  );

  const dateLabel = useCallback(
    (iso?: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    },
    [locale],
  );

  return (
    <section aria-labelledby="announcements-heading" className="space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="animate-slide-up flex items-center gap-3">
        <div
          className="flex size-10 items-center justify-center rounded-2xl bg-md-primary-container text-md-on-primary-container"
          aria-hidden="true"
        >
          <Megaphone className="size-5" />
        </div>
        <h1
          id="announcements-heading"
          className="font-display text-2xl font-600 text-foreground tracking-tight"
        >
          {t('announcementsTitle')}
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="ml-auto"
          onClick={() => load({ silent: true })}
          loading={refreshing}
          disabled={loading}
          aria-label={tCommon('refresh')}
        >
          <RefreshCw className="size-5" aria-hidden="true" />
        </Button>
      </div>

      {/* ── Loading state ────────────────────────────────────────────────── */}
      {loading ? (
        <div
          className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in"
          role="status"
          aria-live="polite"
        >
          <div
            className="size-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">{t('loadingAnnouncements')}</p>
        </div>
      ) : error ? (
        /* ── Full-page error state (list-blocking failure) ──────────────── */
        <div
          role="alert"
          aria-live="assertive"
          className="animate-slide-up flex flex-col items-center justify-center gap-4 py-20 rounded-2xl bg-md-error-container/30 border border-md-error-container text-center px-6"
        >
          <div
            className="flex size-14 items-center justify-center rounded-full bg-md-error-container"
            aria-hidden="true"
          >
            <AlertCircle className="size-7 text-destructive" />
          </div>
          <p className="text-base text-md-on-error-container">{error}</p>
          <Button type="button" variant="default" onClick={() => load()} loading={refreshing}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {tCommon('retry')}
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <div
          className="animate-slide-up flex flex-col items-center justify-center gap-4 py-20 rounded-2xl bg-card border text-center px-6"
          role="status"
          aria-live="polite"
        >
          <div
            className="flex size-14 items-center justify-center rounded-full bg-md-surface-container-high"
            aria-hidden="true"
          >
            <Megaphone className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base text-muted-foreground">{t('noAnnouncements')}</p>
          <p className="text-sm text-muted-foreground/80">{t('emptyAnnouncementsHint')}</p>
        </div>
      ) : (
        /* ── Announcement list ───────────────────────────────────────────── */
        <ul role="list" aria-label={t('announcementsTitle')} className="space-y-4">
          {sorted.map((a, i) => {
            const levelKey = normalizeLevel(a.level);
            const cfg = LEVEL_CONFIG[levelKey];
            const LevelIcon = cfg.icon;
            const titleId = `ann-${a.id}-title`;
            const rawContent = a.content ?? '';
            const isLong = rawContent.length > 280 || rawContent.split('\n').length > 6;
            const isExpanded = a.id != null ? !!expanded[a.id] : true;
            const created = dateLabel(a.created_at);
            const updated =
              a.updated_at && a.updated_at !== a.created_at ? dateLabel(a.updated_at) : '';

            return (
              <li key={a.id}>
                <Card
                  aria-labelledby={titleId}
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
                      <LevelIcon className={`size-4 shrink-0 ${cfg.iconClass}`} aria-hidden="true" />
                      <h2
                        id={titleId}
                        className="font-display text-base font-600 text-foreground"
                      >
                        {a.title}
                      </h2>

                      {a.pinned && (
                        <Badge
                          variant={cfg.badgeVariant}
                          className="gap-1"
                          aria-label={t('pinnedAnnouncement')}
                        >
                          <Pin className="size-3" aria-hidden="true" />
                          {t('pinned')}
                        </Badge>
                      )}

                      {a.level && (
                        <Badge variant={cfg.badgeVariant}>{t(`level.${levelKey}`)}</Badge>
                      )}
                    </CardTitle>

                    {created && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <time dateTime={a.created_at}>{created}</time>
                        {updated && (
                          <span className="ml-2">
                            {t('announcementUpdatedAt', { time: updated })}
                          </span>
                        )}
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="pl-6">
                    {/* content is sanitized with DOMPurify (explicit allow-list) */}
                    <div
                      id={a.id != null ? `ann-${a.id}-body` : undefined}
                      className={`text-sm leading-relaxed text-foreground/80 [&_a]:text-md-primary ${
                        isLong && !isExpanded
                          ? 'max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]'
                          : ''
                      }`}
                      dangerouslySetInnerHTML={{ __html: sanitizeContent(rawContent) }}
                    />
                    {isLong && a.id != null && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2 px-2"
                        aria-expanded={isExpanded}
                        aria-controls={`ann-${a.id}-body`}
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [a.id as number]: !isExpanded }))
                        }
                      >
                        {isExpanded ? t('collapse') : t('expandFull')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
