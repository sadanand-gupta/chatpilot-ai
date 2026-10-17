import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

export function MarketingNavbar({ dark = true }: { dark?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname, location.hash]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const solid = scrolled || open || !dark;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-colors duration-200',
        solid ? (dark ? 'border-b border-white/10 bg-ink-950/85 backdrop-blur-lg' : 'border-b border-slate-200 bg-white/85 backdrop-blur-lg') : 'bg-transparent',
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6" aria-label="Primary">
        <Logo dark={dark} />
        <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                dark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {user ? (
            <Button asChild>
              <Link to="/app">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className={dark ? 'text-slate-200 hover:bg-white/10 hover:text-white' : ''}>
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild className="bg-gradient-to-r from-brand-500 to-accent-500 hover:from-brand-600 hover:to-accent-600">
                <Link to="/register">Create your chatbot</Link>
              </Button>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={cn('ml-auto md:hidden', dark && 'text-white hover:bg-white/10 hover:text-white')}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="!size-5" /> : <Menu className="!size-5" />}
        </Button>
      </nav>
      {open && (
        <div className={cn('border-t px-4 pb-5 pt-2 md:hidden', dark ? 'border-white/10' : 'border-slate-200')}>
          <div className="flex flex-col">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn('rounded-md px-2 py-3 text-base font-medium', dark ? 'text-slate-200 hover:bg-white/5' : 'text-slate-700 hover:bg-slate-50')}
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="mt-3 grid gap-2">
            {user ? (
              <Button asChild size="lg">
                <Link to="/app">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/register">Create your chatbot</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className={dark ? 'border-white/20 bg-transparent text-white hover:bg-white/10' : ''}>
                  <Link to="/login">Log in</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/10 bg-ink-950 text-slate-400">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo dark />
          <p className="mt-3 text-sm">An AI assistant trained on your own website, installed with one line of code.</p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-semibold text-white">Product</p>
            <ul className="mt-3 space-y-2">
              <li><a href="/#features" className="hover:text-white">Features</a></li>
              <li><a href="/#pricing" className="hover:text-white">Pricing</a></li>
              <li><Link to="/demo" className="hover:text-white">Live demo</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-white">Company</p>
            <ul className="mt-3 space-y-2">
              <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
              <li><a href="/#faq" className="hover:text-white">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-white">Legal</p>
            <ul className="mt-3 space-y-2">
              <li><Link to="/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link to="/terms" className="hover:text-white">Terms</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs sm:px-6">
          © {year} {appConfig.productName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/** Light page layout for static pages (legal, contact, 404). */
export function SimplePageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <MarketingNavbar dark={false} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
