import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * CircularProgress — shared M3 circular loading indicator.
 *
 * Before this, tickets.tsx and dashboard.tsx each hand-rolled their own SVG
 * spinner with different aria semantics and neither guarded prefers-reduced-motion.
 * This primitive fixes both.
 *
 * Usage:
 *   <CircularProgress className="size-8 text-md-primary" label="読み込み中" />
 */
export interface CircularProgressProps extends React.SVGProps<SVGSVGElement> {
  /** Accessible label read by screen readers (sr-only). Defaults to "Loading". */
  label?: string;
  className?: string;
}

export function CircularProgress({ className, label = 'Loading', ...props }: CircularProgressProps) {
  return (
    <svg
      role="status"
      viewBox="0 0 24 24"
      fill="none"
      aria-label={label}
      className={cn('animate-spin motion-reduce:animate-none', className)}
      {...props}
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  );
}
