import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { safeHref } from '@/lib/utils';

/**
 * External link for URLs that come from API data. Renders a plain <span> (same className) when the
 * URL is not http(s), so `javascript:` URLs from visitors or crawled pages can never execute.
 */
export function SafeExternalLink({
  href,
  children,
  className,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & { href: string | undefined | null; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={className} {...rest}>
      {children}
    </a>
  );
}
