import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepDef {
  label: string;
  description?: string;
  icon?: LucideIcon;
}

export interface StepperProps {
  steps: StepDef[];
  /** 1-based current step. */
  current: number;
  /** Highest 1-based step the user may jump to. */
  maxReachable: number;
  onStepClick?: (step: number) => void;
  className?: string;
}

/** Progress stepper: full horizontal track on md+, compact "Step n of N" bar on phones. */
export function Stepper({ steps, current, maxReachable, onStepClick, className }: StepperProps) {
  const total = steps.length;
  const cur = steps[current - 1];
  const pct = total > 1 ? ((current - 1) / (total - 1)) * 100 : 100;

  return (
    <nav aria-label="Setup progress" className={className}>
      {/* compact (mobile) */}
      <div className="md:hidden">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-900">
            Step {current} of {total} · {cur?.label}
          </span>
          <span className="text-slate-500">{Math.round(pct)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <ol className="mt-3 flex justify-between">
          {steps.map((s, i) => {
            const n = i + 1;
            const reachable = n <= maxReachable && Boolean(onStepClick);
            return (
              <li key={s.label}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => onStepClick?.(n)}
                  aria-current={n === current ? 'step' : undefined}
                  aria-label={`Step ${n}: ${s.label}`}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    n < current && 'bg-brand-600 text-white',
                    n === current && 'bg-brand-600 text-white ring-4 ring-brand-100',
                    n > current && 'bg-slate-100 text-slate-500',
                    !reachable && 'cursor-default',
                  )}
                >
                  {n < current ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* full (md+) */}
      <ol className="hidden items-start md:flex">
        {steps.map((s, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const reachable = n <= maxReachable && Boolean(onStepClick);
          const Icon = s.icon;
          return (
            <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2 transition-colors duration-500',
                    n <= current ? 'bg-brand-500' : 'bg-slate-200',
                  )}
                  style={{ marginRight: 22 }}
                />
              )}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onStepClick?.(n)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'group relative z-10 flex flex-col items-center gap-2 rounded-xl px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  !reachable && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all duration-300',
                    done && 'border-brand-600 bg-brand-600 text-white',
                    active && 'border-brand-600 bg-white text-brand-600 shadow-[0_0_0_6px_rgba(99,102,241,0.15)]',
                    !done && !active && 'border-slate-200 bg-white text-slate-500',
                    reachable && !active && 'group-hover:border-brand-400',
                  )}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : n}
                </span>
                <span className="flex flex-col">
                  <span className={cn('text-sm font-medium', active ? 'text-slate-900' : 'text-slate-500')}>{s.label}</span>
                  {s.description && <span className="hidden text-xs text-slate-500 lg:block">{s.description}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
