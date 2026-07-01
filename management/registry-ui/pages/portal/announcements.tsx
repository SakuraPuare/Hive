import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { PortalPublicService } from '@/src/generated/client';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { getErrorMessage } from '@/lib/i18n';
import { useFormat } from '@/lib/format';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
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

/**
 * Sanitizer that permits the legal block/inline subset and hardens links.
 *
 * Order: sanitize first (XSS-safe), then inject <br/> into text nodes so that
 * raw \n in the original string never enters the sanitise context as HTML.
 */
const sanitizeContent = (raw: string): string => {
  // 1. Sanitize the raw string first — before any \n→<br/> substitution —
  //    so no attacker-controlled newline-adjacent payload can slip into the
  //    HTML context pre-sanitise.
  const sanitized = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'h3', 'h4', 'code', 'pre', 'blockquote', 'span'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  });

  if (typeof document === 'undefined') return sanitized;

  const tpl = document.createElement('template');
  tpl.innerHTML = sanitized;

  // 2. Walk text nodes: replace literal \n with <br/> elements.
  //    This runs after DOMPurify so we are only injecting structural <br>
  //    into already-sanitised markup, not into raw user input.
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    textNodes.push(node as Text);
  }
  for (const textNode of textNodes) {
    if (!textNode.nodeValue?.includes('\n')) continue;
    const parts = textNode.nodeValue.split('\n');
    const frag = document.createDocumentFragment();
    parts.forEach((part, idx) => {
      frag.appendChild(document.createTextNode(part));
      if (idx < parts.length - 1) {
        frag.appendChild(document.createElement('br'));
      }
    });
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  // 3. Harden anchors: open in new tab, drop opener, apply M3 link token.
  tpl.content.querySelectorAll('a[href]').forEach((el) => {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
    el.classList.add('text-md-primary', 'underline', 'underline-offset-2');
  });

  return tpl.innerHTML;
};

/**
 * Extract plain text from sanitised HTML to accurately measure visible length.
 * Used for the "is this long enough to collapse?" heuristic.
 */
const getTextLength = (sanitizedHtml: string): { chars: number; lines: number } => {
  if (typeof document === 'undefined') {
    return { chars: sanitizedHtml.length, lines: 1 };
  }
  const div = document.createElement('div');
  div.innerHTML = sanitizedHtml;
  const text = div.textContent ?? '';
  const lines = div.querySelectorAll('br, p, li').length + 1;
  return { chars: text.length, lines };
};

export default function PortalAnnouncementsPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const fmt = useFormat();

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
        setError(getErrorMessage(e, t('announcementsLoadFailed')));
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

  return (
    <PageContainer width="content">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <PageHeader
        icon={<Megaphone />}
        title={t('announcementsTitle')}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={() => load({ silent: true })}
            loading={refreshing}
            disabled={loading}
            aria-label={tCommon('refresh')}
          >
            <RefreshCw className="size-5" aria-hidden="true" />
          </Button>
        }
      />

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
          <Button type="button" variant="default" onClick={() => load()} loading={loading}>
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
          {sorted.map((a, i) => (
            <AnnouncementCard
              key={a.id ?? i}
              announcement={a}
              index={i}
              t={t}
              fmt={fmt}
              expanded={a.id != null ? !!expanded[a.id] : true}
              onToggleExpand={() =>
                setExpanded((prev) => ({ ...prev, [a.id as number]: !expanded[a.id as number] }))
              }
            />
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

/* ── AnnouncementCard ────────────────────────────────────────────────────── */

type AnnouncementCardProps = {
  announcement: model_Announcement;
  index: number;
  t: ReturnType<typeof useTranslations>;
  fmt: ReturnType<typeof useFormat>;
  expanded: boolean;
  onToggleExpand: () => void;
};

function AnnouncementCard({ announcement: a, index: i, t, fmt, expanded: isExpanded, onToggleExpand }: AnnouncementCardProps) {
  const levelKey = normalizeLevel(a.level);
  const cfg = LEVEL_CONFIG[levelKey];
  const LevelIcon = cfg.icon;
  const titleId = `ann-${a.id}-title`;
  const rawContent = a.content ?? '';

  // Memoize sanitization per content string — avoids redundant DOMPurify
  // parses on every parent re-render.
  const sanitizedHtml = useMemo(() => sanitizeContent(rawContent), [rawContent]);

  // Determine "long content" from visible text length, not raw HTML byte count,
  // to avoid misjudging heavily tagged-but-short content.
  const isLong = useMemo(() => {
    const { chars, lines } = getTextLength(sanitizedHtml);
    return chars > 280 || lines > 6;
  }, [sanitizedHtml]);

  // Relative time as primary label; absolute as tooltip via `title`.
  const createdRelative = fmt.relative(a.created_at);
  const createdAbsolute = fmt.dateTime(a.created_at);
  const updatedAbsolute = fmt.dateTime(a.updated_at);
  const showUpdated = !!a.updated_at && a.updated_at !== a.created_at;

  return (
    <li>
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
              <Badge variant={cfg.badgeVariant} className="gap-1">
                <Pin className="size-3" aria-hidden="true" />
                {t('pinned')}
              </Badge>
            )}

            {a.level && (
              <Badge variant={cfg.badgeVariant}>{t(`level.${levelKey}`)}</Badge>
            )}
          </CardTitle>

          {a.created_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              <time dateTime={a.created_at} title={createdAbsolute}>
                {createdRelative}
              </time>
              {showUpdated && (
                <time dateTime={a.updated_at} className="ml-2">
                  {t('announcementUpdatedAt', { time: updatedAbsolute })}
                </time>
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
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
          {isLong && a.id != null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 px-2"
              aria-expanded={isExpanded}
              aria-controls={`ann-${a.id}-body`}
              onClick={onToggleExpand}
            >
              {isExpanded ? t('collapse') : t('expandFull')}
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
