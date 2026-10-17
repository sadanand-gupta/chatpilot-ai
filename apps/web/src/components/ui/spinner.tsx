import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <Loader2 className={cn('h-4 w-4 animate-spin text-current', className)} aria-hidden="true" />
      {label ? <span className="text-sm text-slate-500">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-8 text-brand-600">
      <Spinner className="h-6 w-6" label={label} />
    </div>
  );
}
