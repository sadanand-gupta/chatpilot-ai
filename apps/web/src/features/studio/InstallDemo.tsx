import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Loader2, MessageCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Short animated walkthroughs (~20–30s) for the "Installation guides" tabs: a mock
 * admin screen per step, a moving cursor, the user's real embed code being pasted,
 * and the chat bubble appearing on a mock site. Pure DOM/CSS, no video files.
 */

type Scene =
  | { kind: 'copy'; caption: string }
  | { kind: 'menu'; caption: string; app: string; items: string[]; pick: string; title: string; button?: string }
  | { kind: 'code'; caption: string; app: string; file: string; before?: string[]; after?: string[]; snippet?: 'embed' | 'next'; chips?: string[] }
  | { kind: 'action'; caption: string; app: string; label: string; done: string; snippet?: 'embed' | 'next' }
  | { kind: 'site'; caption: string };

interface Demo {
  name: string;
  scenes: Scene[];
}

const COPY: Scene = { kind: 'copy', caption: 'Copy your embed code from this page.' };
const SITE: Scene = { kind: 'site', caption: 'Open your live site — the chat bubble appears on every page.' };

export const INSTALL_DEMOS: Record<string, Demo[]> = {
  html: [
    {
      name: 'HTML',
      scenes: [
        COPY,
        {
          kind: 'code',
          caption: 'Open the HTML file used by every page and paste the code just before </body>.',
          app: 'Code editor',
          file: 'index.html',
          before: ['  <main>…</main>', '  <footer>…</footer>'],
          after: ['</body>', '</html>'],
        },
        { kind: 'action', caption: 'Save the file and upload / deploy your site.', app: 'Code editor', label: 'Save & deploy', done: 'Deployed' },
        SITE,
      ],
    },
  ],
  wordpress: [
    {
      name: 'WordPress',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'In WordPress admin go to Plugins → Add New and install & activate “WPCode”.',
          app: 'WordPress admin',
          items: ['Dashboard', 'Posts', 'Pages', 'Appearance', 'Plugins', 'Settings'],
          pick: 'Plugins',
          title: 'Add Plugins — “WPCode”',
          button: 'Install & Activate',
        },
        {
          kind: 'menu',
          caption: 'Open Code Snippets → Header & Footer.',
          app: 'WordPress admin',
          items: ['Dashboard', 'Posts', 'Pages', 'Code Snippets', 'Plugins', 'Settings'],
          pick: 'Code Snippets',
          title: 'Code Snippets',
          button: 'Header & Footer',
        },
        { kind: 'code', caption: 'Paste the embed code in the Footer box.', app: 'WordPress admin', file: 'Footer' },
        { kind: 'action', caption: 'Click Save. Using a caching plugin? Purge its cache too.', app: 'WordPress admin', label: 'Save Changes', done: 'Snippets saved' },
        SITE,
      ],
    },
  ],
  shopify: [
    {
      name: 'Shopify',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'In Shopify admin open Online Store → Themes → ⋯ → Edit code.',
          app: 'Shopify admin',
          items: ['Home', 'Orders', 'Products', 'Customers', 'Online Store'],
          pick: 'Online Store',
          title: 'Themes',
          button: '⋯  Edit code',
        },
        {
          kind: 'code',
          caption: 'Open layout/theme.liquid and paste the code just before </body>.',
          app: 'Theme code editor',
          file: 'layout/theme.liquid',
          before: ['  {{ content_for_layout }}', '  {% sections "footer-group" %}'],
          after: ['</body>', '</html>'],
        },
        { kind: 'action', caption: 'Click Save.', app: 'Theme code editor', label: 'Save', done: 'Asset saved' },
        { ...SITE, caption: 'Open your live storefront (not the theme editor preview) — the bubble is there.' },
      ],
    },
  ],
  wix: [
    {
      name: 'Wix',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'In your Wix dashboard open Settings → Custom Code.',
          app: 'Wix dashboard',
          items: ['Home', 'Site & App', 'Marketing', 'Analytics', 'Settings'],
          pick: 'Settings',
          title: 'Custom Code',
          button: '+ Add Custom Code',
        },
        {
          kind: 'code',
          caption: 'Paste the code, apply it to “All pages” and place it in “Body – end”.',
          app: 'Wix dashboard',
          file: 'Paste the code snippet here',
          chips: ['All pages', 'Body – end'],
        },
        { kind: 'action', caption: 'Click Apply, then publish your site.', app: 'Wix dashboard', label: 'Apply', done: 'Custom code added' },
        SITE,
      ],
    },
    {
      name: 'Squarespace',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'In Squarespace open Settings → Advanced → Code Injection.',
          app: 'Squarespace',
          items: ['Pages', 'Website', 'Commerce', 'Marketing', 'Settings'],
          pick: 'Settings',
          title: 'Advanced',
          button: 'Code Injection',
        },
        { kind: 'code', caption: 'Paste the embed code in the Footer box.', app: 'Squarespace', file: 'Footer' },
        { kind: 'action', caption: 'Click Save.', app: 'Squarespace', label: 'Save', done: 'Changes saved' },
        SITE,
      ],
    },
  ],
  webflow: [
    {
      name: 'Webflow',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'Open Site settings → Custom code.',
          app: 'Webflow · Site settings',
          items: ['General', 'Publishing', 'Forms', 'SEO', 'Custom code'],
          pick: 'Custom code',
          title: 'Custom code',
        },
        { kind: 'code', caption: 'Paste the embed code into “Footer code” and save.', app: 'Webflow · Site settings', file: 'Footer code — before </body> tag' },
        { kind: 'action', caption: 'Publish the site — custom code only runs on the live domain, not in the Designer.', app: 'Webflow', label: 'Publish', done: 'Published' },
        SITE,
      ],
    },
  ],
  gtm: [
    {
      name: 'Google Tag Manager',
      scenes: [
        COPY,
        {
          kind: 'menu',
          caption: 'In your container click Tags → New, and choose Custom HTML.',
          app: 'Tag Manager',
          items: ['Overview', 'Tags', 'Triggers', 'Variables', 'Folders'],
          pick: 'Tags',
          title: 'Tags',
          button: 'New → Custom HTML',
        },
        {
          kind: 'code',
          caption: 'Paste the embed code and set Triggering to “All Pages”.',
          app: 'Tag Manager',
          file: 'Custom HTML',
          chips: ['Triggering: All Pages'],
        },
        { kind: 'action', caption: 'Save, then Submit → Publish the container.', app: 'Tag Manager', label: 'Submit → Publish', done: 'Version published' },
        SITE,
      ],
    },
  ],
  react: [
    {
      name: 'Next.js',
      scenes: [
        COPY,
        {
          kind: 'code',
          caption: 'In app/layout.tsx import Script from "next/script" and add it inside <body>.',
          app: 'Code editor',
          file: 'app/layout.tsx',
          before: ['<html lang="en">', '  <body>', '    {children}'],
          after: ['  </body>', '</html>'],
          snippet: 'next',
        },
        {
          kind: 'action',
          caption: 'Save and deploy. (Pages Router: add the same <Script> in pages/_app.tsx.)',
          app: 'Code editor',
          label: 'Save & deploy',
          done: 'Deployed',
          snippet: 'next',
        },
        SITE,
      ],
    },
    {
      name: 'Vite / CRA / Vue',
      scenes: [
        COPY,
        {
          kind: 'code',
          caption: 'Open index.html in your project root and paste the code just before </body>.',
          app: 'Code editor',
          file: 'index.html',
          before: ['  <div id="root"></div>', '  <script type="module" src="/src/main.tsx"></script>'],
          after: ['</body>', '</html>'],
        },
        { kind: 'action', caption: 'Save, rebuild and deploy. Load it once here — not inside a component.', app: 'Code editor', label: 'Save & deploy', done: 'Deployed' },
        SITE,
      ],
    },
  ],
};

/** The embed code rewritten as a Next.js <Script> element (same attributes, minus `async`). */
export function nextScriptSnippet(embedCode: string): string {
  const attrs = [...embedCode.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => `      ${k}="${v}"`);
  return ['    <Script', ...attrs, '      strategy="afterInteractive"', '    />'].join('\n');
}

// ------------------------------------------------------------------ timing

const TICK = 50;
const TYPE_FROM = 1200;
const TYPE_MS = 2400;

function duration(s: Scene): number {
  switch (s.kind) {
    case 'copy':
      return 2800;
    case 'menu':
      return s.button ? 3800 : 2600;
    case 'code':
      return 4600 + (s.chips ? 600 * s.chips.length : 0);
    case 'action':
      return 3000;
    case 'site':
      return 5200;
  }
}

interface Move {
  at: number;
  target: string;
  click: number;
}

function moves(s: Scene): Move[] {
  switch (s.kind) {
    case 'copy':
      return [{ at: 300, target: 'copy', click: 1100 }];
    case 'menu':
      return [{ at: 300, target: 'pick', click: 1100 }, ...(s.button ? [{ at: 1800, target: 'button', click: 2600 }] : [])];
    case 'code':
      return [{ at: 300, target: 'editor', click: 1000 }];
    case 'action':
      return [{ at: 300, target: 'action', click: 1200 }];
    case 'site':
      return [{ at: 1400, target: 'bubble', click: 2300 }];
  }
}

function cursorAt(s: Scene, t: number): { target: string | null; clicking: boolean } {
  const m = moves(s).filter((x) => t >= x.at).pop();
  return m ? { target: m.target, clicking: t >= m.click && t < m.click + 300 } : { target: null, clicking: false };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ------------------------------------------------------------------ component

export interface InstallDemoProps {
  platform: string;
  embedCode: string;
  botName?: string;
  welcomeMessage?: string;
  primaryColor?: string;
}

export function InstallDemo({ platform, ...rest }: InstallDemoProps) {
  const demos = INSTALL_DEMOS[platform];
  const [variant, setVariant] = useState(0);
  if (!demos?.length) return null;
  const demo = demos[Math.min(variant, demos.length - 1)];
  return (
    <div className="space-y-2" data-testid={`install-demo-${platform}`}>
      {demos.length > 1 && (
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Choose a walkthrough">
          {demos.map((d, i) => (
            <button
              key={d.name}
              type="button"
              aria-pressed={i === variant}
              onClick={() => setVariant(i)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                i === variant ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}
      <DemoPlayer key={demo.name} demo={demo} {...rest} />
    </div>
  );
}

function DemoPlayer({ demo, embedCode, botName, welcomeMessage, primaryColor }: Omit<InstallDemoProps, 'platform'> & { demo: Demo }) {
  const reduced = useRef(prefersReducedMotion()).current;
  const scenes = demo.scenes;
  const last = scenes.length - 1;
  const [pos, setPos] = useState(() => ({ step: 0, t: reduced ? duration(scenes[0]) : 0 }));
  const [playing, setPlaying] = useState(!reduced);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const scene = scenes[pos.step];
  const ended = pos.step === last && pos.t >= duration(scene);

  // Only run while the player is on screen, so the walkthrough isn't over before the user scrolls to it.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView) return;
    const id = window.setInterval(() => {
      setPos((p) => {
        const d = duration(scenes[p.step]);
        if (p.t + TICK < d) return { ...p, t: p.t + TICK };
        if (p.step < scenes.length - 1) return { step: p.step + 1, t: 0 };
        return { ...p, t: d };
      });
    }, TICK);
    return () => window.clearInterval(id);
  }, [playing, inView, scenes]);

  useEffect(() => {
    if (ended && playing) setPlaying(false);
  }, [ended, playing]);

  const jump = (step: number) => {
    setPos({ step, t: reduced ? duration(scenes[step]) : 0 });
    if (!reduced) setPlaying(true);
  };
  const toggle = () => {
    if (ended) jump(0);
    else setPlaying((p) => !p);
  };

  // Cursor: glide to the current target element inside the stage.
  const { target, clicking } = cursorAt(scene, pos.t);
  const [cursor, setCursor] = useState({ x: 70, y: 75 });
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !target) return;
    const el = stage.querySelector<HTMLElement>(`[data-demo-target="${target}"]`);
    if (!el) return;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!s.width || !s.height) return;
    setCursor({ x: ((r.left + r.width * 0.6 - s.left) / s.width) * 100, y: ((r.top + r.height * 0.6 - s.top) / s.height) * 100 });
  }, [target, pos.step]);

  const progress = (i: number) => (i < pos.step ? 1 : i > pos.step ? 0 : Math.min(1, pos.t / duration(scene)));

  return (
    <div ref={rootRef} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div ref={stageRef} className="relative h-60 select-none p-3 sm:h-64" aria-hidden="true">
        <SceneView scene={scene} t={pos.t} embedCode={embedCode} botName={botName} welcomeMessage={welcomeMessage} primaryColor={primaryColor} />
        {!reduced && (
          <div
            className="pointer-events-none absolute z-20 transition-[left,top] duration-700 ease-in-out"
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
          >
            {clicking && <span className="absolute -left-2 -top-2 h-5 w-5 animate-ping rounded-full bg-brand-500/50" />}
            <svg width="16" height="20" viewBox="0 0 16 20" className={cn('drop-shadow transition-transform', clicking && 'scale-90')}>
              <path d="M1 1l0 15 4-4 3 7 3-1.4-3-6.6 6 0z" fill="#0f172a" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 bg-white px-3 py-2.5">
        <div className="flex gap-1" role="group" aria-label="Walkthrough steps">
          {scenes.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jump(i)}
              aria-label={`Step ${i + 1}: ${s.caption}`}
              aria-current={i === pos.step ? 'step' : undefined}
              className="group h-3 flex-1 py-1"
            >
              <span className="block h-1 overflow-hidden rounded-full bg-slate-200 group-hover:bg-slate-300">
                <span className="block h-full rounded-full bg-brand-600" style={{ width: `${progress(i) * 100}%` }} />
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={ended ? 'Replay walkthrough' : playing ? 'Pause walkthrough' : 'Play walkthrough'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-white hover:bg-slate-700"
          >
            {ended ? <RotateCcw className="h-3.5 w-3.5" /> : playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <p className="min-w-0 text-xs text-slate-600" data-testid="install-demo-caption">
            <span className="font-medium text-slate-900">
              {pos.step + 1}/{scenes.length}
            </span>{' '}
            {scene.caption}
          </p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ scenes

function Window({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative flex h-6 shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-100 px-2">
        <span className="h-2 w-2 rounded-full bg-red-300" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-300" />
        <span className="absolute inset-x-12 truncate text-center text-[10px] text-slate-500">{title}</span>
      </div>
      <div className={cn('relative min-h-0 flex-1', className)}>{children}</div>
    </div>
  );
}

function Bars({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-2 rounded bg-slate-100" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}

interface SceneProps {
  scene: Scene;
  t: number;
  embedCode: string;
  botName?: string;
  welcomeMessage?: string;
  primaryColor?: string;
}

function SceneView(p: SceneProps) {
  const { scene, t } = p;
  switch (scene.kind) {
    case 'copy':
      return <CopyScene t={t} embedCode={p.embedCode} />;
    case 'menu':
      return <MenuScene scene={scene} t={t} />;
    case 'code':
      return <CodeScene scene={scene} t={t} embedCode={p.embedCode} />;
    case 'action':
      return <ActionScene scene={scene} t={t} embedCode={p.embedCode} />;
    case 'site':
      return <SiteScene t={t} botName={p.botName} welcomeMessage={p.welcomeMessage} primaryColor={p.primaryColor} />;
  }
}

function CopyScene({ t, embedCode }: { t: number; embedCode: string }) {
  const copied = t >= 1200;
  return (
    <Window title="Publish → Embed code" className="flex flex-col justify-center gap-3 p-4">
      <div className="text-[11px] font-semibold text-slate-800">Embed code</div>
      <pre className="line-clamp-4 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-slate-900 p-2.5 font-mono text-[10px] leading-relaxed text-slate-100">
        {embedCode}
      </pre>
      <div className="flex justify-end">
        <span
          data-demo-target="copy"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white transition-colors',
            copied ? 'bg-emerald-600' : 'bg-brand-600',
          )}
        >
          {copied && <Check className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy code'}
        </span>
      </div>
    </Window>
  );
}

function MenuScene({ scene, t }: { scene: Extract<Scene, { kind: 'menu' }>; t: number }) {
  const picked = t >= 1200;
  const pressed = t >= 2700;
  return (
    <Window title={scene.app} className="flex">
      <ul className="w-[36%] shrink-0 space-y-0.5 bg-slate-800 p-1.5">
        {scene.items.map((item) => (
          <li
            key={item}
            data-demo-target={item === scene.pick ? 'pick' : undefined}
            className={cn(
              'truncate rounded px-2 py-1 text-[11px] transition-colors',
              item === scene.pick && picked ? 'bg-brand-600 text-white' : 'text-slate-300',
            )}
          >
            {item}
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1 space-y-3 p-3">
        <div className="truncate text-[12px] font-semibold text-slate-800">{picked ? scene.title : 'Dashboard'}</div>
        <Bars />
        {picked && scene.button && (
          <span
            data-demo-target="button"
            className={cn(
              'inline-block animate-fade-in rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
              pressed ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700',
            )}
          >
            {scene.button}
          </span>
        )}
        {picked && <Bars n={2} />}
      </div>
    </Window>
  );
}

function CodeScene({ scene, t, embedCode }: { scene: Extract<Scene, { kind: 'code' }>; t: number; embedCode: string }) {
  const snippet = scene.snippet === 'next' ? nextScriptSnippet(embedCode) : embedCode;
  const typed = Math.max(0, Math.min(1, (t - TYPE_FROM) / TYPE_MS));
  const shown = snippet.slice(0, Math.round(snippet.length * typed));
  const typing = typed > 0 && typed < 1;
  const focused = t >= 1000;
  const chipsFrom = TYPE_FROM + TYPE_MS + 300;
  const isFile = /[./]/.test(scene.file) && !scene.file.includes(' ');
  return (
    <Window title={scene.app} className="flex flex-col gap-2 p-2.5">
      <div className="text-[10px] font-medium text-slate-600">
        {isFile ? <span className="rounded-t bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{scene.file}</span> : scene.file}
      </div>
      <pre
        data-demo-target="editor"
        className={cn(
          '-mt-2 min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-slate-900 p-2.5 font-mono text-[10px] leading-relaxed ring-2 transition-shadow',
          focused ? 'ring-brand-500/60' : 'ring-transparent',
        )}
      >
        {scene.before?.map((l, i) => (
          <div key={`b${i}`} className="text-slate-500">
            {l}
          </div>
        ))}
        <span className="text-emerald-300">{shown}</span>
        {focused && <span className={cn('inline-block h-3 w-px translate-y-0.5 bg-slate-100', !typing && 'animate-pulse')} />}
        {scene.after?.map((l, i) => (
          <div key={`a${i}`} className="text-slate-500">
            {l}
          </div>
        ))}
      </pre>
      {scene.chips && (
        <div className="flex flex-wrap gap-1.5">
          {scene.chips.map((c, i) => {
            const on = t >= chipsFrom + i * 600;
            return (
              <span
                key={c}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-400',
                )}
              >
                {on && <Check className="h-2.5 w-2.5" />}
                {c}
              </span>
            );
          })}
        </div>
      )}
    </Window>
  );
}

function ActionScene({ scene, t, embedCode }: { scene: Extract<Scene, { kind: 'action' }>; t: number; embedCode: string }) {
  const working = t >= 1300 && t < 1900;
  const done = t >= 1900;
  return (
    <Window title={scene.app} className="flex flex-col justify-between gap-3 p-3">
      <pre className="min-h-0 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-slate-900 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-300/70">
        {scene.snippet === 'next' ? nextScriptSnippet(embedCode) : embedCode}
      </pre>
      {done && (
        <div className="absolute inset-x-0 top-3 mx-auto flex w-max animate-fade-in items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white shadow">
          <Check className="h-3.5 w-3.5" /> {scene.done}
        </div>
      )}
      <div className="flex justify-end">
        <span
          data-demo-target="action"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-white transition-colors',
            done ? 'bg-emerald-600' : 'bg-brand-600',
          )}
        >
          {working && <Loader2 className="h-3 w-3 animate-spin" />}
          {done && <Check className="h-3 w-3" />}
          {scene.label}
        </span>
      </div>
    </Window>
  );
}

function SiteScene({ t, botName, welcomeMessage, primaryColor }: { t: number; botName?: string; welcomeMessage?: string; primaryColor?: string }) {
  const color = primaryColor || '#4F46E5';
  const bubble = t >= 700;
  const open = t >= 2400;
  const replied = t >= 3300;
  return (
    <Window title="https://your-website.com" className="bg-white">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="h-2.5 w-16 rounded bg-slate-300" />
          <div className="flex gap-2">
            <div className="h-2 w-8 rounded bg-slate-200" />
            <div className="h-2 w-8 rounded bg-slate-200" />
            <div className="h-2 w-8 rounded bg-slate-200" />
          </div>
        </div>
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <Bars n={2} />
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="h-10 rounded bg-slate-100" />
          <div className="h-10 rounded bg-slate-100" />
          <div className="h-10 rounded bg-slate-100" />
        </div>
      </div>

      {open && (
        <div className="absolute bottom-12 right-3 flex w-[58%] max-w-56 animate-dialog-in flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="truncate px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ background: color }}>
            {botName || 'Assistant'}
          </div>
          <div className="min-h-14 p-2">
            {replied ? (
              <div className="line-clamp-3 w-max max-w-full animate-fade-in rounded-lg rounded-tl-sm bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
                {welcomeMessage || 'Hi! 👋 How can I help you today?'}
              </div>
            ) : (
              <div className="flex w-max gap-0.5 rounded-lg bg-slate-100 px-2 py-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1 w-1 animate-typing rounded-full bg-slate-400" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {bubble && (
        <span
          data-demo-target="bubble"
          className="absolute bottom-2.5 right-3 grid h-8 w-8 animate-dialog-in place-items-center rounded-full text-white shadow-md"
          style={{ background: color }}
        >
          <MessageCircle className="h-4 w-4" />
        </span>
      )}
    </Window>
  );
}
