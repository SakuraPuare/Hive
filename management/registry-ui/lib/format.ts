import { useCallback, useMemo } from 'react';
import { useLocale } from '@/lib/locale';

/**
 * Shared, locale-aware date/time formatting.
 *
 * Before this, 14 pages each hand-rolled a `formatDate` that hardcoded the
 * `'zh-CN'` locale, so dates never followed the UI language toggle and the
 * logic drifted page to page. This hook centralises it: formatting follows the
 * active `useLocale()` value (zh / en) and the viewer's local timezone.
 */
const LOCALE_TAG: Record<string, string> = { zh: 'zh-CN', en: 'en-US' };

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

const RELATIVE_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

export function useFormat() {
  const { locale } = useLocale();
  const tag = LOCALE_TAG[locale] ?? locale;

  /** Full date + time, e.g. `2026/07/02 14:30`. Returns `fallback` for empty/invalid. */
  const dateTime = useCallback(
    (input: string | number | Date | null | undefined, fallback = '—') => {
      const d = toDate(input);
      if (!d) return fallback;
      return new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' }).format(d);
    },
    [tag],
  );

  /** Date only, e.g. `2026/07/02`. */
  const date = useCallback(
    (input: string | number | Date | null | undefined, fallback = '—') => {
      const d = toDate(input);
      if (!d) return fallback;
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(d);
    },
    [tag],
  );

  /** Compact date, e.g. `Jul 2` / `7月2日` — for dense tables. */
  const dateShort = useCallback(
    (input: string | number | Date | null | undefined, fallback = '—') => {
      const d = toDate(input);
      if (!d) return fallback;
      return new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' }).format(d);
    },
    [tag],
  );

  /** Relative time, e.g. `3 minutes ago` / `3 分钟前`. */
  const relative = useCallback(
    (input: string | number | Date | null | undefined, fallback = '—') => {
      const d = toDate(input);
      if (!d) return fallback;
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
      let duration = (d.getTime() - Date.now()) / 1000;
      for (const { amount, unit } of RELATIVE_DIVISIONS) {
        if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
        duration /= amount;
      }
      return rtf.format(Math.round(duration), 'year');
    },
    [tag],
  );

  return useMemo(() => ({ dateTime, date, dateShort, relative }), [dateTime, date, dateShort, relative]);
}
