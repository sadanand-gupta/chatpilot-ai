import { useState } from 'react';
import { Globe } from 'lucide-react';
import type { SiteMeta } from '@chatpilot/shared';
import { cn, safeImageSrc } from '@/lib/utils';

/** Site favicon/logo from crawled siteMeta with a graceful fallback (no external services). */
export function SiteIcon({ siteMeta, className }: { siteMeta?: SiteMeta; className?: string }) {
  const src = safeImageSrc(siteMeta?.favicon) || safeImageSrc(siteMeta?.logo);
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      {src && !failed ? (
        <img src={src} alt="" className="h-6 w-6 object-contain" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <Globe className="h-5 w-5 text-slate-400" aria-hidden="true" />
      )}
    </span>
  );
}
