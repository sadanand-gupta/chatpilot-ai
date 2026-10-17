import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Chatbot, Paginated } from '@chatpilot/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useDeleteChatbot(opts: { onDeleted?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/chatbots/${encodeURIComponent(id)}`),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<Paginated<Chatbot>>(qk.chatbots(), (prev) =>
        prev ? { ...prev, items: prev.items.filter((c) => c.id !== id) } : prev,
      );
      queryClient.removeQueries({ queryKey: qk.chatbot(id) });
      queryClient.invalidateQueries({ queryKey: qk.chatbots() });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: qk.me() });
      toast.success('Chatbot deleted');
      opts.onDeleted?.();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the chatbot')),
  });
}
