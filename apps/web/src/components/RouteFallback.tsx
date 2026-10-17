import { Skeleton } from '@/components/ui/skeleton';

/** Suspense fallback for in-app routes (renders inside the shell). */
export function AppRouteFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

/** Suspense fallback for full public pages. */
export function PageFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
    </div>
  );
}

/** Suspense fallback for embedded panels (tabs). */
export function PanelFallback() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
