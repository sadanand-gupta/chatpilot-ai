import { ICONS, type IconName } from './icons';

type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | ((ev: any) => void);

/**
 * Tiny hyperscript helper. Strings are always inserted as text nodes, never parsed as HTML.
 * Buttons default to type="button". `on<event>` keys attach listeners; `class` sets className; `text` sets textContent.
 * Never pass `style` here (setAttribute('style') is blocked by strict CSPs) — use el.style.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, AttrValue> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (tag === 'button') el.setAttribute('type', 'button'); // never submit forms by accident
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an icon with createElementNS from the trusted constants in icons.ts. */
export function svg(name: IconName): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  const base: Record<string, string> = {
    viewBox: '0 0 24 24',
    width: '24',
    height: '24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  for (const k in base) root.setAttribute(k, base[k]);
  const tagRe = /<(\w+)([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(ICONS[name] || ICONS.chat))) {
    const child = document.createElementNS(SVG_NS, m[1]);
    const attrRe = /([\w-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[2]))) child.setAttribute(a[1], a[2]);
    root.appendChild(child);
  }
  return root;
}

/** Replace the icon inside an element. */
export function setIcon(el: Element, name: IconName): void {
  el.replaceChildren(svg(name));
}
