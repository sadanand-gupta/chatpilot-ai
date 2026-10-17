import { useEffect, useRef, useState, type DependencyList } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type { WidgetInstance } from '@chatpilot/shared';
import { cn } from '@/lib/utils';
import { useWidgetMount, type UseWidgetMountOptions } from '@/lib/widget';

export interface WidgetStageProps {
  /** Mount options (without container). `null` keeps the widget unmounted. */
  options: UseWidgetMountOptions | null;
  /** Values that require a full remount when they change (device, mode, publicId…). */
  mountKey?: DependencyList;
  /**
   * 'overlay' (default): transparent layer over a page; only the widget's own
   * elements receive pointer events so the page underneath stays scrollable.
   * 'fill': the widget fills the container (hosted full-page chat).
   */
  layout?: 'overlay' | 'fill';
  className?: string;
  onInstance?: (instance: WidgetInstance | null) => void;
}

/** Container + real widget mount (via useWidgetMount), with loading / error states. */
export function WidgetStage({ options, mountKey = [], layout = 'overlay', className, onInstance }: WidgetStageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const state = useWidgetMount(ref, options, [...mountKey, attempt]);

  const onInstanceRef = useRef(onInstance);
  onInstanceRef.current = onInstance;
  useEffect(() => {
    onInstanceRef.current?.(state.instance);
  }, [state.instance]);

  return (
    <div
      className={cn(layout === 'overlay' ? 'pointer-events-none absolute inset-0 z-20' : 'relative h-full w-full', className)}
      data-testid="widget-stage"
      data-status={state.status}
    >
      <div
        ref={ref}
        className={cn(
          'cp-widget-stage',
          layout === 'overlay' ? 'absolute inset-0 [&>*]:pointer-events-auto' : 'relative h-full w-full',
        )}
      />
      {state.status === 'loading' && (
        <div className="pointer-events-none absolute bottom-6 right-6 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm text-neutral-600 shadow-lg ring-1 ring-black/5">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading chat widget…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(92%,420px)] -translate-x-1/2 rounded-2xl bg-white p-4 text-sm shadow-xl ring-1 ring-red-200"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-neutral-900">The chat widget could not load</p>
              <p className="mt-1 break-words text-neutral-600">{state.error?.message}</p>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
