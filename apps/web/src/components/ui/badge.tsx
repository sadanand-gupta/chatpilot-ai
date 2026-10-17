import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-100 text-brand-700',
        secondary: 'border-transparent bg-slate-100 text-slate-700',
        outline: 'border-slate-200 text-slate-700',
        success: 'border-transparent bg-emerald-100 text-emerald-700',
        warning: 'border-transparent bg-amber-100 text-amber-800',
        destructive: 'border-transparent bg-red-100 text-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';
