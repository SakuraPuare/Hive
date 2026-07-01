import React, { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocale, type Locale } from '@/lib/locale';

const LOCALES: { value: Locale; short: string; label: string }[] = [
  { value: 'zh', short: '中文', label: '中文' },
  { value: 'en', short: 'EN', label: 'English' },
];

export interface LocaleToggleProps {
  /**
   * Accessible name for the radiogroup. Pass a translated string from the
   * caller. Falls back to an English default so the control is never unnamed.
   */
  groupLabel?: string;
  /**
   * `lg` bumps each option to a >=48dp touch target for the mobile menu;
   * `sm` (default) keeps the compact desktop chip size.
   */
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Segmented language switcher exposed as a WAI-ARIA radiogroup.
 * Single source of truth reused by both the desktop navbar and the mobile menu.
 * Roving tabindex + arrow-key navigation follow the radiogroup pattern.
 */
export function LocaleToggle({ groupLabel = 'Language', size = 'sm', className }: LocaleToggleProps) {
  const { locale, setLocale } = useLocale();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (idx: number) => {
    const next = (idx + LOCALES.length) % LOCALES.length;
    const target = LOCALES[next];
    setLocale(target.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusAt(idx + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusAt(idx - 1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={cn('flex items-center gap-0.5 rounded-full bg-md-surface-container-high p-1', className)}
    >
      {LOCALES.map((l, i) => {
        const checked = locale === l.value;
        return (
          <button
            key={l.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={l.label}
            tabIndex={checked ? 0 : -1}
            onClick={() => setLocale(l.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'state-layer flex items-center justify-center rounded-full text-xs font-500 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1 focus-visible:ring-offset-md-surface-container-high',
              size === 'lg' ? 'min-h-12 min-w-12 px-4' : 'px-3 py-1',
              checked
                ? 'bg-md-primary text-md-on-primary'
                : 'text-md-on-surface-variant hover:text-foreground'
            )}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}
