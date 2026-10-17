import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon | React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

function isComponent(icon: unknown): icon is LucideIcon {
  return typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon && 'render' in icon);
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  let iconNode: React.ReactNode = null;
  if (icon) {
    if (isComponent(icon)) {
      const Icon = icon;
      iconNode = <Icon className="h-6 w-6" aria-hidden="true" />;
    } else {
      iconNode = icon as React.ReactNode;
    }
  }
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center', className)}>
      {iconNode && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">{iconNode}</div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
