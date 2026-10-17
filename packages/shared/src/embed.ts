/** Builds the one-line embed snippet customers paste into their site. */
export function buildEmbedCode(opts: { widgetUrl: string; publicId: string; apiUrl?: string }): string {
  const apiAttr = opts.apiUrl ? `\n  data-api-url="${opts.apiUrl}"` : '';
  return `<script\n  src="${opts.widgetUrl}"\n  data-chatbot-id="${opts.publicId}"${apiAttr}\n  async\n></script>`;
}

export function buildHostedUrl(appUrl: string, publicId: string): string {
  return `${appUrl.replace(/\/$/, '')}/chat/${encodeURIComponent(publicId)}`;
}

/**
 * Programmatic widget API exposed on `window.ChatPilot` by widget.js.
 * The dashboard's Preview Studio and the hosted chat page use `mount()` directly.
 */
export interface WidgetMountOptions {
  apiUrl: string;
  /** Published public id (widget/hosted/demo modes). */
  publicId?: string;
  /**
   * 'floating' (default launcher bubble), 'fullpage' (hosted page, fills container),
   * 'preview' (studio: uses `config` + `sendPreview` instead of the public API).
   */
  mode?: 'floating' | 'fullpage' | 'preview';
  channel?: 'widget' | 'hosted' | 'demo';
  /** Mount inside this element instead of document.body. Floating mode then positions relative to it. */
  container?: HTMLElement;
  /** Force the mobile layout (used by device frames in Preview Studio). */
  forceMobile?: boolean;
  /** Start opened. */
  open?: boolean;
  /** Preview mode: config to render (re-render via instance.update(config)). */
  config?: import('./types').ChatbotConfig;
  businessName?: string;
  /** Preview mode: send a message through the authenticated preview endpoint. */
  sendPreview?: (
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ) => Promise<{ content: string; sources?: { url?: string; title?: string }[]; fallback?: boolean; suggestions?: string[] }>;
  previewToken?: string;
}

export interface WidgetInstance {
  open(): void;
  close(): void;
  toggle(): void;
  update(config: import('./types').ChatbotConfig): void;
  reset(): void;
  destroy(): void;
}

export interface ChatPilotGlobal {
  version: string;
  mount(opts: WidgetMountOptions): WidgetInstance;
}
