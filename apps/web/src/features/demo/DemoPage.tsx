import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { appConfig } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { LiveDemo } from './LiveDemo';

/** Standalone /demo page wrapping the full-size live demo. */
export function DemoPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = `Live demo · ${appConfig.productName}`;
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-brand-50 via-white to-white">
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to {appConfig.productName}
          </Link>
          <Button size="sm" asChild>
            <Link to="/register">Get started free</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Live demo
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">See your AI chatbot on your own website</h1>
          <p className="mt-3 text-base text-slate-600">
            Enter your URL. We'll read your public pages and put a working assistant on your site in under a minute — on desktop and mobile.
          </p>
        </div>
        <LiveDemo />
      </main>
    </div>
  );
}
