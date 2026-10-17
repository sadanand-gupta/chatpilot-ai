/**
 * Widget stylesheet (lives inside the Shadow DOM, so it neither leaks out nor gets overridden).
 * build.mjs minifies the template literal below at build time — keep it free of `${}` interpolation.
 * Theme colours come from CSS custom properties set by themeVars().
 */
export const CSS = `
:host{all:initial}
[hidden]{display:none!important}
*,*::before,*::after{box-sizing:border-box}
.root{--cp-bg:#fff;--cp-surface:#f3f4f6;--cp-border:#e5e7eb;--cp-text:#111827;--cp-muted:#6b7280;--cp-shadow:0 12px 40px rgba(17,24,39,.16),0 2px 8px rgba(17,24,39,.08);
font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,"Apple Color Emoji","Segoe UI Emoji";
font-size:14px;line-height:1.5;color:var(--cp-text);text-align:left;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
:where(.root) :where(button,input,textarea){font:inherit;color:inherit;margin:0}
:where(.root) :where(button){cursor:pointer;background:none;border:0;padding:0;-webkit-tap-highlight-color:transparent}
:where(.root) :where(button:disabled){cursor:default}
:where(.root) :where(a){color:var(--cp-link)}
:where(.root) :focus{outline:none}
.root :focus-visible{outline:2px solid var(--cp-ring);outline-offset:2px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:where(.root) :where(svg){display:block;flex-shrink:0}

/* Launcher */
.launcher{pointer-events:auto;position:fixed;z-index:2147483000;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;
background:var(--cp-primary);color:var(--cp-on-primary);display:flex;align-items:center;justify-content:center;
box-shadow:0 6px 20px rgba(17,24,39,.22),0 2px 6px rgba(17,24,39,.12);transition:transform .2s ease,background-color .2s ease,box-shadow .2s ease}
.launcher:hover{transform:scale(1.06);background:var(--cp-primary-hover);box-shadow:0 10px 28px rgba(17,24,39,.26)}
.launcher:active{transform:scale(.96)}
.launcher .li{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform .25s ease,opacity .2s ease}
.launcher svg{width:28px;height:28px}
.li-close{opacity:0;transform:rotate(-90deg) scale(.6)}
.open .li-main{opacity:0;transform:rotate(90deg) scale(.6)}
.open .li-close{opacity:1;transform:none}
.dot{position:absolute;top:1px;right:1px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}
.unread:not(.open) .dot{display:block}
.left .launcher{right:auto;left:20px}

/* Teaser */
.teaser{pointer-events:auto;position:fixed;z-index:2147483000;bottom:92px;right:20px;max-width:270px;background:#fff;border-radius:14px;box-shadow:var(--cp-shadow);
border:1px solid var(--cp-border);animation:kpop .3s cubic-bezier(.2,.8,.2,1) both}
.left .teaser{right:auto;left:20px}
.teaser-txt{display:block;text-align:left;padding:12px 34px 12px 14px;font-size:14px;line-height:1.45;color:var(--cp-text);border-radius:14px}
.teaser-x{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;color:var(--cp-muted);display:flex;align-items:center;justify-content:center}
.teaser-x:hover{background:var(--cp-surface);color:var(--cp-text)}
.teaser-x svg{width:14px;height:14px}
.open .teaser,.mobile .teaser{display:none}

/* Panel */
.panel{position:fixed;z-index:2147483000;bottom:92px;right:20px;width:380px;height:600px;max-height:calc(100vh - 120px);max-width:calc(100vw - 40px);
background:var(--cp-bg);border-radius:16px;box-shadow:var(--cp-shadow);display:flex;flex-direction:column;overflow:hidden;
opacity:0;visibility:hidden;pointer-events:none;transform:translateY(16px) scale(.98);transform-origin:bottom right;
transition:opacity .2s ease,transform .25s cubic-bezier(.2,.8,.2,1),visibility 0s linear .25s}
.left .panel{right:auto;left:20px;transform-origin:bottom left}
.open .panel{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition-delay:0s}
.contained .launcher,.contained .panel,.contained .teaser{position:absolute;z-index:50}
.contained .panel{max-height:calc(100% - 112px);max-width:calc(100% - 40px)}
.fullpage{width:100%;height:100%;pointer-events:auto}
.fullpage .panel{position:relative;inset:auto;width:100%;height:100%;max-width:none;max-height:none;border-radius:0;box-shadow:none;
opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:none}
.fullpage .header,.fullpage .log,.fullpage .composer,.fullpage .badge{--gut:max(16px,calc((100% - 760px) / 2));padding-left:var(--gut);padding-right:var(--gut)}
.fullpage .header{padding-top:16px;padding-bottom:16px}
.fullpage .menu{right:max(10px,calc((100% - 760px) / 2))}
.fullpage .count{right:calc(max(16px,calc((100% - 760px) / 2)) + 54px)}
.fullpage .av-lg{width:44px;height:44px}
.fullpage .title{font-size:17px}

/* Mobile */
.mobile .launcher{width:56px;height:56px;bottom:calc(16px + env(safe-area-inset-bottom,0px));right:calc(16px + env(safe-area-inset-right,0px))}
.mobile.left .launcher{right:auto;left:calc(16px + env(safe-area-inset-left,0px))}
.mobile.open .launcher{display:none}
.mobile.floating .panel{top:0;left:0;right:0;bottom:0;width:100%;height:100%;max-width:none;max-height:none;border-radius:0;transform:translateY(24px)}
.mobile.floating:not(.contained) .panel{height:100vh;height:100dvh}
.mobile.open .panel{transform:none}
.mobile .header{padding-top:calc(12px + env(safe-area-inset-top,0px));padding-left:calc(14px + env(safe-area-inset-left,0px));padding-right:calc(10px + env(safe-area-inset-right,0px))}
.mobile:not(.brand) .composer{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
.mobile .input{font-size:16px}

/* Header */
.header{position:relative;display:flex;align-items:center;gap:12px;padding:14px 10px 14px 16px;background:var(--cp-primary);color:var(--cp-on-primary);flex-shrink:0}
.av{position:relative;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;overflow:hidden;
background:var(--cp-primary-soft);color:var(--cp-link);user-select:none}
.av img{width:100%;height:100%;object-fit:cover;display:block}
.av-lg{width:40px;height:40px;font-size:15px;background:var(--cp-tint);color:inherit}
.av-sm{width:28px;height:28px;font-size:11px}
.avwrap{position:relative;flex-shrink:0}
.avwrap::after{content:"";position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid var(--cp-primary)}
.hinfo{flex:1;min-width:0}
.title{font-weight:650;font-size:15px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
.sub{font-size:12.5px;opacity:.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hbtn{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:inherit;flex-shrink:0;transition:background-color .15s}
.hbtn:hover,.hbtn[aria-expanded="true"]{background:var(--cp-tint)}
.hbtn svg{width:20px;height:20px}
.header :focus-visible{outline-color:currentColor}
.menu{position:absolute;top:calc(100% - 6px);right:10px;z-index:5;min-width:200px;padding:6px;background:#fff;color:var(--cp-text);
border:1px solid var(--cp-border);border-radius:12px;box-shadow:var(--cp-shadow);animation:kpop .15s ease both}
.menu button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:8px;font-size:14px;text-align:left}
.menu button:hover,.menu button:focus-visible{background:var(--cp-surface);outline:none}
.menu svg{width:17px;height:17px;color:var(--cp-muted)}
.badge{flex-shrink:0;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;text-align:center;padding:5px 10px;border-bottom:1px solid #fde68a}

/* Messages */
.log{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px 14px 8px;display:flex;flex-direction:column;gap:12px;background:var(--cp-bg);scrollbar-width:thin}
.msg{display:flex;align-items:flex-end;gap:8px;max-width:100%;animation:kin .25s ease both}
.user{justify-content:flex-end}
.col{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;max-width:82%}
.user .col{align-items:flex-end}
.bubble{max-width:100%;padding:9px 13px;border-radius:16px;overflow-wrap:anywhere;word-break:normal}
.bot .bubble{background:var(--cp-surface);color:var(--cp-text);border-bottom-left-radius:5px}
.user .bubble{background:var(--cp-primary);color:var(--cp-on-primary);border-bottom-right-radius:5px;white-space:pre-wrap}
.user .bubble a{color:inherit}
.bubble p{margin:0}
.bubble p+p,.bubble p+ul,.bubble p+ol,.bubble ul+p,.bubble ol+p,.bubble pre{margin-top:8px}
.bubble ul,.bubble ol{margin:0;padding-left:20px}
.bubble li+li{margin-top:2px}
.bubble strong{font-weight:650}
.bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:rgba(17,24,39,.07);padding:1px 5px;border-radius:5px}
.bubble pre{background:rgba(17,24,39,.07);padding:8px 10px;border-radius:8px;overflow-x:auto;white-space:pre}
.bubble pre code{background:none;padding:0}
.bubble a{text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere;word-break:normal}
.meta{font-size:11px;color:var(--cp-muted);padding:0 4px}
.chips{display:flex;flex-wrap:wrap;gap:6px;max-width:100%}
.src,.act{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:12px;line-height:1.3;padding:5px 10px;border-radius:999px;
border:1px solid var(--cp-border);background:#fff;color:var(--cp-muted);text-decoration:none;transition:border-color .15s,color .15s,background-color .15s}
.src span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src:hover,.act:hover{border-color:var(--cp-primary);color:var(--cp-link)}
.src svg,.act svg{width:13px;height:13px}
.act{color:var(--cp-link);font-weight:500;border-color:var(--cp-primary-soft-border);background:var(--cp-primary-soft)}
.suggest{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding-left:36px}
.chip{font-size:13px;line-height:1.35;padding:7px 12px;border-radius:999px;border:1px solid var(--cp-primary-soft-border);background:#fff;color:var(--cp-link);text-align:left;transition:background-color .15s,border-color .15s}
.chip:hover{background:var(--cp-primary-soft);border-color:var(--cp-primary)}
.typing{display:flex;gap:4px;align-items:center;padding:13px 14px}
.typing i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:kbounce 1.2s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}
.typing i:nth-child(3){animation-delay:.3s}
.err .bubble{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.err svg{width:16px;height:16px}
.retry{font-weight:600;text-decoration:underline;text-underline-offset:2px;color:#991b1b}
.note{align-self:center;max-width:92%;text-align:center;font-size:12.5px;color:var(--cp-muted);background:var(--cp-surface);padding:6px 12px;border-radius:10px}

/* Lead form */
.lead{margin-left:36px;border:1px solid var(--cp-border);border-radius:14px;padding:14px;background:#fff;box-shadow:0 1px 3px rgba(17,24,39,.06);display:flex;flex-direction:column;gap:10px;animation:kin .25s ease both}
.lead-title{font-size:14px;font-weight:650;margin:0}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:12px;font-weight:550;color:var(--cp-muted)}
.field input,.field textarea{width:100%;border:1px solid var(--cp-border);border-radius:9px;padding:8px 10px;font-size:14px;background:#fff;color:var(--cp-text);transition:border-color .15s,box-shadow .15s}
.field textarea{resize:vertical;min-height:64px}
.field input:focus,.field textarea:focus{border-color:var(--cp-primary);box-shadow:0 0 0 3px var(--cp-primary-soft);outline:none}
.root [aria-invalid="true"]{border-color:#ef4444}
.ferr{font-size:12px;color:#dc2626}
.hint{font-size:12px;color:var(--cp-muted);margin:-4px 0 0}
.consent{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.4;color:var(--cp-muted);cursor:pointer}
.consent input{margin:2px 0 0;width:16px;height:16px;flex-shrink:0;accent-color:var(--cp-primary)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--cp-primary);color:var(--cp-on-primary);border-radius:10px;padding:10px 14px;font-weight:600;font-size:14px;transition:background-color .15s,opacity .15s}
.btn:hover:not(:disabled){background:var(--cp-primary-hover)}
.btn:disabled{opacity:.6}
.lead-ok{display:flex;align-items:center;gap:10px;font-weight:550;color:#166534}
.lead-ok svg{width:20px;height:20px;padding:3px;border-radius:50%;background:#dcfce7;box-sizing:content-box}

/* Composer */
.composer{position:relative;display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--cp-border);background:var(--cp-bg);flex-shrink:0}
.iw{flex:1;min-width:0;display:flex;background:var(--cp-surface);border:1px solid transparent;border-radius:12px;transition:border-color .15s,box-shadow .15s,background-color .15s}
.iw:focus-within{border-color:var(--cp-primary);background:#fff;box-shadow:0 0 0 3px var(--cp-primary-soft)}
.input{flex:1;min-width:0;display:block;border:0;background:transparent;resize:none;padding:10px 12px;margin:0;height:42px;min-height:42px;max-height:120px;line-height:20px;font-size:14px;color:var(--cp-text);overflow-y:auto}
.input::placeholder{color:#9ca3af}
.input:focus-visible{outline:none}
.input:disabled{cursor:not-allowed}
.send{width:42px;height:42px;border-radius:12px;background:var(--cp-primary);color:var(--cp-on-primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background-color .15s,opacity .15s,transform .1s}
.send:hover:not(:disabled){background:var(--cp-primary-hover)}
.send:active:not(:disabled){transform:scale(.94)}
.send:disabled{opacity:.45}
.send svg{width:19px;height:19px}
.count{position:absolute;right:66px;top:-20px;font-size:11px;color:var(--cp-muted);background:var(--cp-bg);padding:0 6px;border-radius:6px}
.count.max{color:#dc2626;font-weight:600}
.footer{text-align:center;font-size:11.5px;color:#9ca3af;padding:0 0 8px;background:var(--cp-bg);flex-shrink:0}
.footer a{color:var(--cp-muted);text-decoration:none;font-weight:600}
.footer a:hover{text-decoration:underline}
.mobile .footer{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
.mobile.brand .composer{padding-bottom:10px}

@keyframes kin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes kpop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
@keyframes kbounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.root *,.root *::before,.root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}}
`;

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** WCAG relative luminance. */
export function luminance(c: RGB): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const BLACK: RGB = [0, 0, 0];
const INK = '#111827';

/** CSS custom properties derived from the brand colour. Text on primary always picks the higher-contrast option. */
export function themeVars(primary: string): Record<string, string> {
  const hex = /^#[0-9a-f]{6}$/i.test(primary) ? primary.toLowerCase() : '#4f46e5';
  const rgb = hexToRgb(hex);
  const onPrimary = contrastRatio(hex, '#ffffff') >= contrastRatio(hex, INK) ? '#ffffff' : INK;
  const light = onPrimary === INK;
  // Darken the primary until it is readable as text on white (links, chips).
  let link = hex;
  for (let t = 0.1; contrastRatio(link, '#ffffff') < 4.5 && t <= 0.9; t += 0.1) link = toHex(mix(rgb, BLACK, t));
  const [r, g, b] = rgb;
  return {
    '--cp-primary': hex,
    '--cp-primary-hover': toHex(mix(rgb, BLACK, light ? 0.08 : 0.14)),
    '--cp-primary-soft': `rgba(${r},${g},${b},.1)`,
    '--cp-primary-soft-border': `rgba(${r},${g},${b},.35)`,
    '--cp-on-primary': onPrimary,
    '--cp-link': link,
    '--cp-ring': link,
    '--cp-tint': light ? 'rgba(17,24,39,.08)' : 'rgba(255,255,255,.18)',
  };
}

let sheet: CSSStyleSheet | null | undefined;

/**
 * Attach the stylesheet to a shadow root. Prefers constructable stylesheets (not subject to
 * CSP style-src 'unsafe-inline'); falls back to a <style> element.
 */
export function applyStyles(root: ShadowRoot | HTMLElement): void {
  if (sheet === undefined) {
    sheet = null;
    try {
      if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype && 'adoptedStyleSheets' in Document.prototype) {
        const s = new CSSStyleSheet();
        s.replaceSync(CSS);
        sheet = s;
      }
    } catch {
      sheet = null;
    }
  }
  if (sheet && 'adoptedStyleSheets' in root) {
    try {
      (root as ShadowRoot).adoptedStyleSheets = [...(root as ShadowRoot).adoptedStyleSheets, sheet];
      return;
    } catch {
      /* fall through */
    }
  }
  const style = document.createElement('style');
  style.textContent = CSS;
  root.prepend(style);
}
