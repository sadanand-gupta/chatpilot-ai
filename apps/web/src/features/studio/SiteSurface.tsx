import { useState } from 'react';
import { Info, Menu, Search, ShoppingBag } from 'lucide-react';
import { cn, hostnameOf } from '@/lib/utils';
import { safeHref, type DeviceKind, type SiteMetaWithShot } from './lib';

export const APPROXIMATION_NOTICE =
  "Your site blocks embedding (X-Frame-Options/CSP), so this is an approximation built from your site's content. The real widget will look the same on your site.";

export interface SiteSurfaceProps {
  url: string;
  siteMeta?: SiteMetaWithShot;
  device: DeviceKind;
  /** Result of the frame check. `undefined` = still checking. */
  frameable: boolean | undefined;
  /** Bumping this reloads the iframe. */
  reloadKey?: number;
  /** Hide the in-frame banner (e.g. for static example frames). */
  hideBanner?: boolean;
  className?: string;
}

/**
 * The "website layer" of a preview: the real site in a sandboxed iframe when the site
 * allows framing, otherwise an honest approximation built from crawled SiteMeta.
 * Never tries to bypass X-Frame-Options / CSP frame-ancestors.
 */
export function SiteSurface({ url, siteMeta, device, frameable, reloadKey = 0, hideBanner, className }: SiteSurfaceProps) {
  if (frameable === undefined) {
    return (
      <div className={cn('absolute inset-0 animate-pulse bg-neutral-50', className)} data-testid="site-surface-loading" aria-busy="true">
        <div className="h-16 border-b border-neutral-100 bg-white" />
        <div className="mx-auto mt-16 h-8 w-1/2 rounded-lg bg-neutral-200" />
        <div className="mx-auto mt-4 h-4 w-1/3 rounded bg-neutral-200" />
        <div className="mx-auto mt-10 h-64 w-3/4 rounded-2xl bg-neutral-200" />
      </div>
    );
  }

  const frameSrc = safeHref(url);
  const screenshot = safeHref(siteMeta?.screenshotUrl);
  if (frameable && frameSrc) {
    return (
      <iframe
        key={`${frameSrc}-${reloadKey}`}
        src={frameSrc}
        title={`${hostnameOf(url) || 'Website'} preview`}
        className={cn('absolute inset-0 h-full w-full border-0 bg-white', className)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
        data-testid="site-iframe"
      />
    );
  }

  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-white', className)} data-testid="site-approximation">
      {screenshot ? (
        <img
          src={screenshot}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <SiteMockup url={url} siteMeta={siteMeta} device={device} />
      )}
      {!hideBanner && (
        <div
          role="note"
          className={cn(
            'absolute inset-x-0 z-10 flex items-start gap-3 bg-amber-50/95 text-amber-900 shadow-sm ring-1 ring-amber-200 backdrop-blur',
            device === 'mobile' ? 'top-[50px] px-4 py-2.5 text-[13px] leading-snug' : 'top-0 px-6 py-3 text-[17px] leading-snug',
          )}
          data-testid="approximation-banner"
        >
          <Info className={cn('mt-0.5 shrink-0', device === 'mobile' ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
          <span>{APPROXIMATION_NOTICE}</span>
        </div>
      )}
    </div>
  );
}

function SafeImg({ src, className, alt = '' }: { src?: string; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const safe = safeHref(src);
  if (!safe || failed) return null;
  return <img src={safe} alt={alt} referrerPolicy="no-referrer" className={className} onError={() => setFailed(true)} loading="lazy" />;
}

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0f172a' : '#ffffff';
}

/** Plausible homepage laid out from SiteMeta; adapts to the device viewport. */
export function SiteMockup({ url, siteMeta, device }: { url: string; siteMeta?: SiteMetaWithShot; device: DeviceKind }) {
  const brand = /^#[0-9a-f]{6}$/i.test(siteMeta?.themeColor ?? '') ? siteMeta!.themeColor! : '#1e293b';
  const onBrand = readableOn(brand);
  const name = siteMeta?.siteName || siteMeta?.title || hostnameOf(url) || 'Your website';
  const heading = siteMeta?.heroHeading || siteMeta?.title || name;
  const text = siteMeta?.heroText || siteMeta?.description || '';
  const nav = (siteMeta?.navLinks ?? []).slice(0, device === 'desktop' ? 6 : 4);
  const images = [siteMeta?.ogImage, ...(siteMeta?.images ?? [])].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
  const hero = images[0];
  const gallery = images.slice(1, device === 'desktop' ? 4 : 3);
  const logo = siteMeta?.logo || siteMeta?.favicon;
  const mobile = device === 'mobile';
  const tablet = device === 'tablet';

  return (
    <div className="absolute inset-0 overflow-hidden bg-white font-sans text-neutral-900" aria-hidden>
      {/* header */}
      <header
        className={cn('flex items-center justify-between border-b border-neutral-100 bg-white', mobile ? 'mt-[50px] h-16 px-5' : 'h-[76px] px-12')}
      >
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            <SafeImg src={logo} className={cn('w-auto object-contain', mobile ? 'h-8 max-w-[120px]' : 'h-10 max-w-[180px]')} />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold" style={{ background: brand, color: onBrand }}>
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={cn('truncate font-semibold', mobile ? 'text-[17px]' : 'text-[20px]')}>{name}</span>
        </div>
        {mobile ? (
          <Menu className="h-7 w-7 text-neutral-700" />
        ) : (
          <nav className={cn('flex items-center', tablet ? 'gap-5 text-[15px]' : 'gap-8 text-[16px]')}>
            {nav.map((l) => (
              <span key={l} className="text-neutral-600">
                {l}
              </span>
            ))}
            {!tablet && <Search className="h-5 w-5 text-neutral-500" />}
            <span className="rounded-full px-5 py-2.5 text-[15px] font-medium" style={{ background: brand, color: onBrand }}>
              {nav.some((l) => /shop|store|product/i.test(l)) ? (
                <span className="inline-flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4" /> Shop
                </span>
              ) : (
                'Contact us'
              )}
            </span>
          </nav>
        )}
      </header>

      {/* hero */}
      <section
        className={cn('relative', mobile ? 'px-5 pb-8 pt-16' : tablet ? 'px-12 pb-12 pt-24' : 'grid grid-cols-2 items-center gap-16 px-24 pb-16 pt-28')}
        style={{ background: `linear-gradient(180deg, ${brand}12 0%, #ffffff 100%)` }}
      >
        <div>
          <div
            className={cn(
              'font-bold tracking-tight text-neutral-900',
              mobile ? 'text-[30px] leading-[1.15]' : tablet ? 'text-[44px] leading-[1.1]' : 'text-[56px] leading-[1.05]',
            )}
          >
            {heading}
          </div>
          {text && (
            <p className={cn('mt-5 line-clamp-4 text-neutral-600', mobile ? 'text-[16px]' : 'text-[19px] leading-relaxed')}>{text}</p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full px-6 py-3 text-[16px] font-medium shadow-sm" style={{ background: brand, color: onBrand }}>
              Get started
            </span>
            <span className="rounded-full border border-neutral-300 px-6 py-3 text-[16px] font-medium text-neutral-700">Learn more</span>
          </div>
        </div>
        {hero && (
          <div className={cn('overflow-hidden rounded-3xl bg-neutral-100 shadow-xl', mobile ? 'mt-10 h-[220px]' : tablet ? 'mt-12 h-[360px]' : 'h-[440px]')}>
            <SafeImg src={hero} className="h-full w-full object-cover" />
          </div>
        )}
      </section>

      {/* gallery / features */}
      <section className={cn(mobile ? 'px-5 py-8' : 'px-12 py-14', !mobile && !tablet && 'px-24')}>
        <div className={cn('grid gap-5', mobile ? 'grid-cols-1' : tablet ? 'grid-cols-2' : 'grid-cols-3')}>
          {(gallery.length ? gallery : [undefined, undefined, undefined].slice(0, mobile ? 2 : 3)).map((src, i) => (
            <div key={src ?? i} className="overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-50 shadow-sm">
              <div className={cn('bg-neutral-100', mobile ? 'h-40' : 'h-48')} style={src ? undefined : { background: `${brand}14` }}>
                <SafeImg src={src} className="h-full w-full object-cover" />
              </div>
              <div className="space-y-2 p-5">
                <div className="h-3 w-2/3 rounded bg-neutral-200" />
                <div className="h-3 w-1/2 rounded bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
