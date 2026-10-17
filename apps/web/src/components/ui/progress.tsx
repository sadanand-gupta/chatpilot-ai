import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100 */
  value?: number;
  indicatorClassName?: string;
}

export function Progress({ value = 0, className, indicatorClassName, ...props }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600',
          indicatorClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
