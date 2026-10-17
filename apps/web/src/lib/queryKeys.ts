/** Shared TanStack Query keys — used by both the dashboard and the studio so invalidation works. */
export interface ConversationFilters {
  chatbotId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface LeadFilters {
  chatbotId?: string;
  q?: string;
}

export const qk = {
  me: () => ['me'] as const,
  plans: () => ['plans'] as const,
  publicPlans: () => ['plans', 'public'] as const,
  dashboard: (days: number) => ['dashboard', days] as const,
  chatbots: () => ['chatbots'] as const,
  chatbot: (id: string) => ['chatbot', id] as const,
  installStatus: (id: string) => ['chatbot', id, 'install-status'] as const,
  sources: (chatbotId: string) => ['sources', chatbotId] as const,
  crawlJob: (chatbotId: string, jobId: string) => ['crawlJob', chatbotId, jobId] as const,
  conversations: (filters: ConversationFilters = {}) => ['conversations', filters] as const,
  conversation: (id: string) => ['conversation', id] as const,
  leads: (filters: LeadFilters = {}) => ['leads', filters] as const,
};
