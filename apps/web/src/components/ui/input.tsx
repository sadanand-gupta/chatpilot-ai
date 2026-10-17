import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus-visible:ring-red-500/20 file:border-0 file:bg-transparent file:text-sm file:font-medium',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';
