import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-slate-200 bg-white text-slate-800 [&>svg]:text-brand-600',
        destructive: 'border-red-200 bg-red-50 text-red-800 [&>svg]:text-red-600',
        warning: 'border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />,
);
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('mb-1 font-semibold leading-tight', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
