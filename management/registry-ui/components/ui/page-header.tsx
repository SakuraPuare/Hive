import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — the single source of truth for a page title block.
 *
 * Before this primitive, every admin page hand-rolled its own header: title
 * sizes ranged across `text-xl` / `text-2xl` / `text-3xl`, the leading icon
 * container appeared as `rounded-xl` / `rounded-2xl` / `rounded-full` (or was
 * missing entirely on users / promo-codes / audit-logs / subscriptions), and
 * the action slot alignment drifted. This standardises all of it:
 *
 *  - fixed `text-2xl` display title (M3 headline-small rhythm),
 *  - a consistent `size-11 rounded-2xl` tonal icon container,
 *  - optional description line,
 *  - a right-aligned `actions` slot that wraps gracefully on small screens.
 *
 * Every page header is a `<header>` landmark containing the page's single
 * `<h1>`, keeping the heading hierarchy predictable for assistive tech.
 */
type PageHeaderProps = {
  /** Leading icon — pass a lucide icon element; rendered inside the tonal chip. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  /** Right-aligned actions (buttons, refresh, filters). */
  actions?: React.ReactNode;
  /** Tonal accent for the icon chip. Defaults to primary. */
  accent?: 'primary' | 'tertiary' | 'secondary';
  className?: string;
  /** Override the heading id (defaults to a stable value for aria wiring). */
  titleId?: string;
};

const ACCENTS = {
  primary: 'bg-md-primary-container text-md-on-primary-container',
  tertiary: 'bg-md-tertiary-container text-md-on-tertiary-container',
  secondary: 'bg-md-secondary-container text-md-on-secondary-container',
} as const;

export function PageHeader({
  icon,
  title,
  description,
  actions,
  accent = 'primary',
  className,
  titleId,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-3 animate-slide-up',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon != null && (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-2xl [&_svg]:size-5',
              ACCENTS[accent],
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <h1
            id={titleId}
            className="font-display text-2xl font-600 leading-tight tracking-tight text-foreground"
          >
            {title}
          </h1>
          {description != null && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions != null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
