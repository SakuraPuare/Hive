import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageContainer — the single source of truth for a page's outer width, gutter
 * and vertical rhythm inside `AppLayout`'s `<main>`.
 *
 * Before this primitive every page hand-rolled its own wrapper: some added a
 * redundant `max-w-5xl mx-auto px-6 py-8`, some added `p-6`, most relied on the
 * layout gutter alone — so container widths visibly diverged page to page.
 * Route all pages through this to keep the shell consistent.
 *
 * `width`:
 *  - `wide` (default) — full comfortable width for data tables / grids.
 *  - `content` — a reading-width column (max-w-5xl) for form/detail-heavy pages.
 *  - `narrow` — a tight column (max-w-2xl) for single-form / focused pages.
 */
const WIDTHS = {
  wide: 'max-w-[100rem]',
  content: 'max-w-5xl',
  narrow: 'max-w-2xl',
} as const;

type PageContainerProps = React.ComponentProps<'div'> & {
  width?: keyof typeof WIDTHS;
};

export function PageContainer({
  className,
  width = 'wide',
  ...props
}: PageContainerProps) {
  return (
    <div
      data-slot="page-container"
      className={cn(
        'mx-auto w-full space-y-6 animate-fade-in',
        WIDTHS[width],
        className,
      )}
      {...props}
    />
  );
}
