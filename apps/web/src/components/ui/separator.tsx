import * as React from 'react';
import { cn } from '@/lib/utils';

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical'; decorative?: boolean }) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('shrink-0 bg-slate-200', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}
