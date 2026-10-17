import { useQuery } from '@tanstack/react-query';
import { DEFAULT_PLANS, type Chatbot, type MeResponse, type Paginated, type Plan } from '@chatpilot/shared';
import { api, publicApi } from './api';
import { qk } from './queryKeys';
import { useAuth } from './auth';

export function useMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.me(),
    queryFn: ({ signal }) => api.get<MeResponse>('/me', { signal }),
    enabled: Boolean(user),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: qk.plans(),
    queryFn: ({ signal }) => api.get<{ items: Plan[] }>('/plans', { signal }).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function usePublicPlans() {
  return useQuery({
    queryKey: qk.publicPlans(),
    queryFn: ({ signal }) => publicApi.get<{ items: Plan[] }>('/public/plans', { signal }).then((r) => r.items),
    staleTime: 10 * 60_000,
    // The API is the source of truth; the default catalogue only fills the gap while loading / if it's down.
    placeholderData: DEFAULT_PLANS,
  });
}

/** All chatbots of the signed-in user (first page of up to 100 — plans cap chatbots well below that). */
export function useChatbots() {
  return useQuery({
    queryKey: qk.chatbots(),
    queryFn: ({ signal }) => api.get<Paginated<Chatbot>>('/chatbots?limit=100', { signal }),
  });
}

export function useChatbot(id: string | undefined) {
  return useQuery({
    queryKey: qk.chatbot(id ?? ''),
    queryFn: ({ signal }) => api.get<Chatbot>(`/chatbots/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
  });
}
