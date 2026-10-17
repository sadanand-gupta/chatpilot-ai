import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Never retry client errors (4xx) — they won't fix themselves. Retry network/5xx up to twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
