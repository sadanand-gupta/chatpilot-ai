import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { DevModeBadge } from '@/features/app/AppShell';
import { appConfig } from '@/lib/config';
import { useApiWaking } from '@/lib/keepWarm';
import { Spinner } from '@/components/ui/spinner';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const POINTS = [
  'Learns from the pages on your own website',
  'Answers with links to the pages it used',
  'Captures leads when visitors want to be contacted',
  'Install anywhere with one line of code',
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  documentTitle,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Browser tab title; defaults to the page heading. */
  documentTitle?: string;
}) {
  useDocumentTitle(documentTitle ?? title);
  const waking = useApiWaking();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
      >
        Skip to content
      </a>
      <aside className="relative hidden overflow-hidden bg-ink-950 p-10 text-white lg:flex lg:flex-col">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-accent-500/30 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <Logo dark />
        </div>
        <div className="relative my-auto max-w-md">
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
            Your website already has the answers. <span className="text-gradient">Let visitors ask.</span>
          </h2>
          <ul className="mt-8 space-y-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-slate-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">
          © {new Date().getFullYear()} {appConfig.productName} ·{' '}
          <Link className="hover:text-slate-300" to="/privacy">
            Privacy
          </Link>{' '}
          ·{' '}
          <Link className="hover:text-slate-300" to="/terms">
            Terms
          </Link>
        </p>
      </aside>
      <main id="main" className="flex flex-col bg-white px-4 py-8 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="lg:hidden">
            <Logo />
          </div>
          <DevModeBadge />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
          {waking && (
            <div className="mt-6 flex justify-center text-slate-400">
              <Spinner className="h-3.5 w-3.5" label="Waking up the server… the first visit can take up to a minute." />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
