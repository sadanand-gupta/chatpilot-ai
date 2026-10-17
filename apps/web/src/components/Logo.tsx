import { Link } from 'react-router-dom';
import { PRODUCT_NAME_DEFAULT } from '@chatpilot/shared';
import { appConfig } from '@/lib/config';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return <img src="/marketing/logo-mark.svg" width={64} height={64} alt="" aria-hidden="true" className={cn('h-8 w-8', className)} />;
}

/**
 * Brand lockup. Uses the full SVG lockup when the product name is the default; with a custom
 * VITE_PRODUCT_NAME it falls back to the mark plus live text so the name stays correct.
 */
export function Logo({
  to = '/',
  className,
  dark = false,
  hideTextOnSmall = false,
}: {
  to?: string;
  className?: string;
  dark?: boolean;
  /** Show only the mark below 400px wide (tight mobile headers). */
  hideTextOnSmall?: boolean;
}) {
  const name = appConfig.productName;
  const useLockup = name === PRODUCT_NAME_DEFAULT;
  return (
    <Link
      to={to}
      aria-label={`${name} home`}
      className={cn('inline-flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', className)}
    >
      {useLockup ? (
        <>
          <img
            src={dark ? '/marketing/logo-full-light.svg' : '/marketing/logo-full.svg'}
            width={240}
            height={64}
            alt={name}
            className={cn('h-9 w-auto', hideTextOnSmall && 'hidden min-[400px]:block')}
          />
          {hideTextOnSmall && <LogoMark className="min-[400px]:hidden" />}
        </>
      ) : (
        <>
          <LogoMark />
          <span
            className={cn(
              'font-display text-lg font-bold tracking-tight',
              dark ? 'text-white' : 'text-slate-900',
              hideTextOnSmall && 'hidden min-[400px]:inline',
            )}
          >
            {name}
          </span>
        </>
      )}
    </Link>
  );
}
