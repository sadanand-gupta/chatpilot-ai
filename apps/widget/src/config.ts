import type { ChatbotConfig } from '@chatpilot/shared';

/**
 * Mirror of the defaults in packages/shared/src/schemas.ts (chatbotConfigSchema).
 * Duplicated on purpose: the widget must not bundle zod.
 */
export const DEFAULT_CONFIG: ChatbotConfig = {
  botName: 'Assistant',
  headerTitle: 'Chat with us',
  welcomeMessage: 'Hi! \u{1F44B} How can I help you today?',
  suggestedQuestions: [],
  primaryColor: '#4F46E5',
  launcherIcon: 'chat',
  avatarUrl: '',
  position: 'right',
  tone: 'friendly',
  language: 'auto',
  fallbackMessage:
    "I'm not sure about that from the information I have. Please contact the team directly and they'll help you.",
  customInstructions: '',
  leadCapture: {
    enabled: false,
    title: 'Leave your details and we will get back to you',
    trigger: 'after_messages',
    afterMessages: 2,
    fields: { name: true, email: true, phone: false, message: false },
    consentText: 'I agree that this business may contact me about my enquiry.',
  },
  contact: {},
  showBranding: true,
};

const ICONS = ['chat', 'sparkle', 'help', 'message', 'bot'];
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim() : d);

/**
 * Defensive merge of a (possibly partial / mid-edit) config with defaults.
 * Preview Studio calls update() on every keystroke, so empty strings fall back to defaults.
 */
export function normalizeConfig(input?: Partial<ChatbotConfig> | null): ChatbotConfig {
  const c = (input && typeof input === 'object' ? input : {}) as Partial<ChatbotConfig>;
  const d = DEFAULT_CONFIG;
  const lc = (c.leadCapture || {}) as Partial<ChatbotConfig['leadCapture']>;
  const fields = (lc.fields || {}) as Partial<ChatbotConfig['leadCapture']['fields']>;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    ...d,
    botName: str(c.botName, d.botName),
    headerTitle: str(c.headerTitle, d.headerTitle),
    welcomeMessage: str(c.welcomeMessage, d.welcomeMessage),
    fallbackMessage: str(c.fallbackMessage, d.fallbackMessage),
    suggestedQuestions: Array.isArray(c.suggestedQuestions)
      ? c.suggestedQuestions.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 6)
      : [],
    primaryColor:
      typeof c.primaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(c.primaryColor) ? c.primaryColor : d.primaryColor,
    launcherIcon: ICONS.includes(c.launcherIcon as string) ? (c.launcherIcon as ChatbotConfig['launcherIcon']) : 'chat',
    avatarUrl: typeof c.avatarUrl === 'string' ? c.avatarUrl.trim() : '',
    position: c.position === 'left' ? 'left' : 'right',
    tone: c.tone || d.tone,
    language: c.language || d.language,
    customInstructions: '',
    showBranding: bool(c.showBranding, true),
    contact: { ...(c.contact || {}) },
    leadCapture: {
      enabled: bool(lc.enabled, false),
      title: str(lc.title, d.leadCapture.title),
      trigger: lc.trigger === 'start' || lc.trigger === 'manual' ? lc.trigger : 'after_messages',
      afterMessages:
        typeof lc.afterMessages === 'number' && lc.afterMessages >= 1 ? Math.floor(lc.afterMessages) : 2,
      fields: {
        name: bool(fields.name, true),
        email: bool(fields.email, true),
        phone: bool(fields.phone, false),
        message: bool(fields.message, false),
      },
      consentText: str(lc.consentText, d.leadCapture.consentText),
    },
  };
}
