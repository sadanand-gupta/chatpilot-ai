import { z } from 'zod';

/**
 * Zod schemas shared by the API (request validation), the dashboard (forms),
 * and the widget (type inference only — the widget does not bundle zod).
 */

/** http(s)-only URL — blocks javascript:, data: and other schemes from being stored and later rendered as links. */
export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #4F46E5');

export const LAUNCHER_ICONS = ['chat', 'sparkle', 'help', 'message', 'bot'] as const;
export const TONES = ['friendly', 'professional', 'concise', 'enthusiastic'] as const;
export const POSITIONS = ['right', 'left'] as const;
export const LANGUAGES = ['auto', 'en', 'hi', 'es', 'fr', 'de', 'pt', 'ar', 'bn', 'ta', 'te', 'mr', 'gu', 'pa'] as const;

export const leadCaptureSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().trim().max(120).default('Leave your details and we will get back to you'),
  /** When to show the form: at chat start, after N visitor messages, or only via the "Contact us" button. */
  trigger: z.enum(['start', 'after_messages', 'manual']).default('after_messages'),
  afterMessages: z.number().int().min(1).max(20).default(2),
  fields: z
    .object({
      name: z.boolean().default(true),
      email: z.boolean().default(true),
      phone: z.boolean().default(false),
      message: z.boolean().default(false),
    })
    .default({}),
  consentText: z
    .string()
    .trim()
    .max(400)
    .default('I agree that this business may contact me about my enquiry.'),
});

export const contactSchema = z.object({
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  whatsapp: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  hours: z.string().trim().max(200).optional().or(z.literal('')),
});

export const chatbotConfigSchema = z.object({
  botName: z.string().trim().min(1).max(60).default('Assistant'),
  headerTitle: z.string().trim().min(1).max(80).default('Chat with us'),
  welcomeMessage: z.string().trim().min(1).max(500).default('Hi! 👋 How can I help you today?'),
  suggestedQuestions: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  primaryColor: hexColor.default('#4F46E5'),
  launcherIcon: z.enum(LAUNCHER_ICONS).default('chat'),
  /** https URL or empty. Never a data: URL (keeps Firestore docs small). */
  avatarUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'Avatar must be an https URL')
    .optional()
    .or(z.literal('')),
  position: z.enum(POSITIONS).default('right'),
  tone: z.enum(TONES).default('friendly'),
  language: z.enum(LANGUAGES).default('auto'),
  fallbackMessage: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default("I'm not sure about that from the information I have. Please contact the team directly and they'll help you."),
  customInstructions: z.string().trim().max(2000).default(''),
  leadCapture: leadCaptureSchema.default({}),
  contact: contactSchema.default({}),
  showBranding: z.boolean().default(true),
});

export const createChatbotSchema = z.object({
  websiteUrl: z.string().trim().min(3).max(2048),
  businessName: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  language: z.enum(LANGUAGES).default('auto'),
});

export const updateChatbotSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  businessName: z.string().trim().min(1).max(120).optional(),
  websiteUrl: z.string().trim().min(3).max(2048).optional(),
  category: z.string().trim().max(80).optional(),
  /** Origins allowed to embed the widget, e.g. https://example.com. Empty = any (rate limits still apply). */
  allowedOrigins: z.array(z.string().trim().max(300)).max(20).optional(),
});

export const startCrawlSchema = z.object({
  url: z.string().trim().min(3).max(2048).optional(),
  maxPages: z.number().int().min(1).max(200).optional(),
});

export const createSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('faq'),
    question: z.string().trim().min(3).max(500),
    answer: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal('manual'),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50000),
  }),
]);

export const updateSourceSchema = z.object({
  status: z.enum(['active', 'excluded']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(50000).optional(),
});

export const chatMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().max(100).optional(),
  /** HMAC token returned with the first reply; required to append to an existing conversation. */
  conversationToken: z.string().max(200).optional(),
  /** Random, client-generated anonymous visitor id (no PII). */
  visitorId: z.string().min(8).max(100),
  /** Where the conversation happens. */
  channel: z.enum(['widget', 'hosted', 'demo']).default('widget'),
  /** Draft preview token (see ChatbotDoc.previewToken) — uses draft config instead of published. */
  previewToken: z.string().max(100).optional(),
  pageUrl: httpUrl.optional(),
});

export const previewMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .default([]),
  /** Optional unsaved config to test before saving. */
  config: chatbotConfigSchema.partial().optional(),
});

export const leadInputSchema = z.object({
  conversationId: z.string().max(100).optional(),
  conversationToken: z.string().max(200).optional(),
  visitorId: z.string().min(8).max(100),
  name: z.string().trim().max(120).optional().or(z.literal('')),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+()\-\s0-9]*$/, 'Invalid phone number')
    .optional()
    .or(z.literal('')),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  pageUrl: httpUrl.optional(),
});

export const demoInputSchema = z.object({
  url: z.string().trim().min(3).max(2048),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  businessName: z.string().trim().max(120).optional(),
});

export type ChatbotConfigInput = z.input<typeof chatbotConfigSchema>;
export type CreateChatbotInput = z.infer<typeof createChatbotSchema>;
export type UpdateChatbotInput = z.infer<typeof updateChatbotSchema>;
export type StartCrawlInput = z.infer<typeof startCrawlSchema>;
export type CreateSourceInput = z.infer<typeof createSourceSchema>;
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;
export type ChatMessageInput = z.input<typeof chatMessageInputSchema>;
export type PreviewMessageInput = z.input<typeof previewMessageInputSchema>;
export type LeadInput = z.input<typeof leadInputSchema>;
export type DemoInput = z.infer<typeof demoInputSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Full default config — use when creating a chatbot. */
export function defaultChatbotConfig(overrides: Partial<ChatbotConfigInput> = {}) {
  return chatbotConfigSchema.parse(overrides);
}
