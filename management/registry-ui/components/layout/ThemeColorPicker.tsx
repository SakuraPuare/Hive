import React, { useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { THEME_COLORS, useThemeColor, type ThemeColorKey } from '@/lib/theme-color';

/**
 * 主题色选择器 —— 调色板图标按钮,点开是 Material Design 全调色板色板网格。
 * 选中即整站换肤(写 <html data-theme-color>),持久化到 localStorage。
 *
 * a11y：色板是 WAI-ARIA radiogroup,roving tabindex + 方向键漫游,每个色板
 * aria-checked 反映当前主题色,>=44dp 命中区,选中态叠对勾。Popover 由 Radix
 * 提供焦点陷阱/Esc 关闭/焦点复位。
 */
export function ThemeColorPicker() {
  const t = useTranslations('theme');
  const { themeColor, setThemeColor } = useThemeColor();
  const [open, setOpen] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = Math.max(
    0,
    THEME_COLORS.findIndex((c) => c.key === themeColor),
  );

  const focusAt = (idx: number) => {
    const next = (idx + THEME_COLORS.length) % THEME_COLORS.length;
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
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(THEME_COLORS.length - 1);
        break;
    }
  };

  const select = (key: ThemeColorKey) => {
    setThemeColor(key);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('pickerLabel')}
          className="state-layer ripple inline-flex h-10 w-10 items-center justify-center rounded-full text-md-on-surface-variant transition-colors hover:text-md-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Palette className="h-5 w-5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-3 font-display text-sm font-600 text-foreground">{t('pickerTitle')}</p>
        <div role="radiogroup" aria-label={t('pickerLabel')} className="grid grid-cols-5 gap-1.5">
          {THEME_COLORS.map((c, i) => {
            const checked = c.key === themeColor;
            const name = t(c.labelKey);
            return (
              <button
                key={c.key}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={name}
                title={name}
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => select(c.key)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  'group relative flex h-11 w-full items-center justify-center rounded-lg transition-transform',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                  'hover:scale-105',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full elevation-1 ring-1 ring-inset ring-black/10',
                    checked && 'ring-2 ring-md-primary ring-offset-2 ring-offset-popover',
                  )}
                  style={{ backgroundColor: c.swatch }}
                >
                  {/* mix-blend-difference keeps the tick legible on any swatch,
                      incl. light seeds (yellow/lime) where pure white vanishes. */}
                  {checked && (
                    <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden="true" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-md-on-surface-variant">
          {t(THEME_COLORS[activeIndex].labelKey)}
        </p>
      </PopoverContent>
    </Popover>
  );
}
