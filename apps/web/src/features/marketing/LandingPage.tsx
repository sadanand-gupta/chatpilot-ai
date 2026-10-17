import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Code2,
  Globe,
  Inbox,
  Languages,
  MonitorSmartphone,
  Palette,
  PlayCircle,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Wand2,
} from 'lucide-react';
import { buildEmbedCode, type WidgetInstance } from '@chatpilot/shared';
import { useAuth } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { normalizeUrl } from '@/lib/utils';
import { loadWidget } from '@/lib/widget';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';
import { LiveDemo } from '@/routes/lazy';
import { MarketingFooter, MarketingNavbar } from './MarketingLayout';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';

/* ---------------- URL form (hero + final CTA) ---------------- */

export function useStartFromUrl() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (url: string) => {
    const target = `/app/chatbots/new?url=${encodeURIComponent(url)}`;
    navigate(user ? target : `/register?next=${encodeURIComponent(target)}`);
  };
}

function UrlForm({ id, size = 'lg' }: { id: string; size?: 'lg' | 'md' }) {
  const start = useStartFromUrl();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(value);
    if (!url) {
      setError('Enter a valid website address, like example.com');
      return;
    }
    setError(null);
    start(url);
  };
  return (
    <form onSubmit={onSubmit} noValidate className="w-full max-w-xl" aria-label="Create a chatbot from your website">
      <div className="flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/[0.06] p-2 shadow-2xl shadow-brand-950/40 backdrop-blur transition-shadow focus-within:border-brand-300/60 focus-within:ring-2 focus-within:ring-brand-400 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          Enter your website URL
        </label>
        <div className="flex flex-1 items-center gap-2 px-3">
          <Globe className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            id={id}
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="Enter your website URL"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`h-12 w-full min-w-0 bg-transparent text-white placeholder:text-slate-400 focus:outline-none ${size === 'lg' ? 'text-base' : 'text-sm'}`}
          />
        </div>
        <Button type="submit" size="lg" className="bg-gradient-to-r from-brand-500 to-accent-500 hover:from-brand-600 hover:to-accent-600">
          Create your chatbot <ArrowRight />
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 pl-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

/* ---------------- Sections ---------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink-950 pb-24 pt-10 text-white sm:pt-16 lg:pb-32">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" aria-hidden="true" />
      <div className="absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-600/25 blur-[120px]" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col items-start">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-200">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" /> AI chatbot trained on your own website
          </span>
          <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Turn your website into an <span className="text-gradient">AI assistant</span> in minutes
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-300">
            Enter your URL. {appConfig.productName} reads your pages, builds a chatbot that answers visitor questions from your content, and gives
            you one line of code to install it.
          </p>
          <div className="mt-8 w-full">
            <UrlForm id="hero-url" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-slate-400">
            <a href="#demo" className="inline-flex items-center gap-1.5 font-medium text-white hover:text-brand-200">
              <PlayCircle className="h-4 w-4" /> Try the live demo
            </a>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Free plan · no credit card
            </span>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-tr from-brand-600/30 via-accent-500/20 to-fuchsia-500/20 blur-3xl" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#F5F7FF] to-white p-2 shadow-2xl shadow-brand-950/50 ring-1 ring-white/10 sm:p-3">
            <img
              src="/marketing/hero-devices.svg"
              width={1200}
              height={860}
              alt="ChatPilot AI chat widget answering a visitor's question on a business website, shown on desktop and mobile"
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { img: '/marketing/step-1-url.svg', alt: 'Entering a website URL to generate a chatbot', icon: Globe, title: 'Enter your URL', text: 'Paste your website address. That’s the only thing we need to get started.' },
  { img: '/marketing/step-2-crawl.svg', alt: 'ChatPilot AI crawling website pages and indexing them', icon: ScanSearch, title: 'We crawl & learn', text: 'We read your public pages, extract the useful text and organise it into searchable knowledge.' },
  { img: '/marketing/step-3-customize.svg', alt: "Customizing the chatbot's brand color, name, lead capture and sources with a live preview", icon: Palette, title: 'Customize', text: 'Review what was learned, add FAQs, set the tone, colours and welcome message. Preview on desktop and mobile.' },
  { img: '/marketing/step-4-install.svg', alt: 'Installing the chatbot with one script tag', icon: Code2, title: 'Paste one line of code', text: 'Publish and add a single script tag to your site — or share a hosted chat link.' },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">How it works</p>
          <h2 id="how-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From URL to live chatbot in four steps
          </h2>
        </div>
        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <img src={s.img} width={480} height={320} alt={s.alt} loading="lazy" decoding="async" className="h-auto w-full rounded-xl" />
              <div className="mt-5 flex items-center gap-3 px-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-lg shadow-brand-500/25">
                  <s.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-display text-sm font-bold text-slate-400">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 px-2 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 px-2 pb-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" aria-labelledby="demo-heading" className="scroll-mt-20 bg-gradient-to-b from-slate-50 to-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Live demo</p>
          <h2 id="demo-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Try it on your own website
          </h2>
          <p className="mt-4 text-slate-600">
            Enter a URL and we’ll build a temporary demo chatbot from a few of its pages. No sign-up needed.
          </p>
        </div>
        <div className="mt-12">
          <Suspense fallback={<Skeleton className="mx-auto h-[420px] max-w-5xl rounded-2xl" />}>
            <LiveDemo compact />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: ScanSearch, img: '/marketing/feature-crawl.svg', title: 'Website crawling', text: 'Automatically discovers and reads your public pages, skipping duplicates and boilerplate.' },
  { icon: BookOpenCheck, img: '/marketing/feature-sources.svg', title: 'Grounded answers with sources', text: 'Replies come from your saved content and link to the pages they used. No answer? It says so.' },
  { icon: UserPlus, img: '/marketing/feature-leads.svg', title: 'Lead capture', text: 'Collect name, email, phone or a message with consent — at the start, after a few messages, or on request.' },
  { icon: Palette, img: '/marketing/feature-branding.svg', title: 'Brand customization', text: 'Your colours, name, avatar, launcher icon, tone of voice and welcome message.' },
  { icon: MonitorSmartphone, img: '/marketing/feature-devices.svg', title: 'Desktop & mobile preview', text: 'See exactly how the widget looks on your site before you publish.' },
  { icon: Inbox, img: '/marketing/feature-inbox.svg', title: 'Conversations inbox', text: 'Read every conversation, see which pages were cited and spot gaps in your content.' },
  { icon: Code2, img: '/marketing/step-4-install.svg', title: 'One-line install', text: 'A single async script tag. Works with any site builder or framework.' },
  { icon: BarChart3, img: '/marketing/feature-quotas.svg', title: 'Usage controls', text: 'Clear monthly limits, usage meters and per-chatbot domain restrictions.' },
  { icon: Languages, img: '/marketing/feature-multilingual.svg', title: 'Multilingual', text: 'Replies in the visitor’s language or a language you choose.' },
];

function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Features</p>
          <h2 id="features-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Everything you need to answer visitors 24/7
          </h2>
          <p className="mt-4 text-slate-600">Built for small businesses that want a helpful assistant without a support team or a developer.</p>
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group bg-white p-6 transition-colors hover:bg-slate-50/70">
              <img src={f.img} width={240} height={160} alt="" loading="lazy" decoding="async" className="h-auto w-full max-w-[240px] rounded-2xl transition-transform duration-300 group-hover:-translate-y-0.5" />
              <h3 className="mt-5 flex items-center gap-2 font-semibold text-slate-900">
                <f.icon className="h-4 w-4 text-brand-600" aria-hidden="true" />
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  const snippet = buildEmbedCode({ widgetUrl: appConfig.widgetUrl, publicId: 'YOUR_CHATBOT_ID' });
  return (
    <section aria-labelledby="install-heading" className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Install in one line</p>
          <h2 id="install-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Paste it once. Update it from the dashboard forever.
          </h2>
          <p className="mt-4 text-slate-600">
            Add the snippet before the closing <code className="rounded bg-slate-200 px-1 py-0.5 text-sm">&lt;/body&gt;</code> tag. When you change
            colours, knowledge or settings and republish, your site picks up the new version automatically — no code changes.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-700">
            <li className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-brand-600" /> Loads asynchronously — doesn’t slow your page down
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand-600" /> Optionally restrict it to your own domains
            </li>
          </ul>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-ink-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="text-xs font-medium text-slate-400">index.html</span>
            <CopyButton value={snippet} variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" />
          </div>
          <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
            <code className="font-mono text-slate-300">
              <span className="text-slate-500">{'<!-- ... your page ... -->'}</span>
              {'\n'}
              <span className="text-pink-300">{'<script'}</span>
              {`\n  `}
              <span className="text-sky-300">src</span>=<span className="text-emerald-300">"{appConfig.widgetUrl}"</span>
              {`\n  `}
              <span className="text-sky-300">data-chatbot-id</span>=<span className="text-emerald-300">"YOUR_CHATBOT_ID"</span>
              {`\n  `}
              <span className="text-sky-300">async</span>
              {'\n'}
              <span className="text-pink-300">{'></script>'}</span>
              {'\n'}
              <span className="text-pink-300">{'</body>'}</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-accent-600 py-20 text-white">
      <div className="bg-grid absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 text-center sm:px-6">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Give your visitors answers, even when you’re offline</h2>
        <p className="mt-4 text-brand-100">Create your chatbot for free. It takes a few minutes and one line of code.</p>
        <div className="mt-8 flex w-full justify-center">
          <UrlForm id="cta-url" size="md" />
        </div>
        <Link to="/demo" className="mt-4 text-sm font-medium text-white/90 underline-offset-4 hover:underline">
          Or open the full demo
        </Link>
      </div>
    </section>
  );
}

/** Loads the real ChatPilot widget on the landing page when VITE_LANDING_CHATBOT_ID is set (dogfooding). */
function useLandingWidget() {
  useEffect(() => {
    const publicId = appConfig.landingChatbotId;
    if (!publicId) return;
    let instance: WidgetInstance | null = null;
    let cancelled = false;
    loadWidget()
      .then((cp) => {
        if (cancelled) return;
        instance = cp.mount({ apiUrl: appConfig.apiUrl, publicId, mode: 'floating', channel: 'widget' });
      })
      .catch(() => {
        /* dogfooding is best-effort; the landing page works without it */
      });
    // Destroy on unmount so the launcher doesn't follow the user into /app or other pages.
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, []);
}

export function LandingPage() {
  useLandingWidget();
  useDocumentTitle('Turn your website into an AI chatbot');
  return (
    <div className="min-h-dvh bg-ink-950">
      <div className="absolute inset-x-0 top-0 z-40">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
          Skip to content
        </a>
      </div>
      <MarketingNavbar />
      <main id="main">
        <Hero />
        <HowItWorks />
        <DemoSection />
        <Features />
        <InstallSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
