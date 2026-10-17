import { AlertCircle, RotateCw } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-xl border border-red-100 bg-red-50/50 px-6 py-10 text-center', className)}>
      <AlertCircle className="mb-3 h-6 w-6 text-red-500" aria-hidden="true" />
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-600">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}
