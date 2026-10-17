import { useChatbots } from '@/lib/hooks';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ALL = '__all__';

/** Chatbot dropdown filter; value '' = all chatbots. */
export function ChatbotFilter({ value, onChange, className, id = 'chatbot-filter' }: { value: string; onChange: (v: string) => void; className?: string; id?: string }) {
  const { data } = useChatbots();
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger id={id} className={cn('w-full sm:w-52', className)} aria-label="Filter by chatbot">
        <SelectValue placeholder="All chatbots" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All chatbots</SelectItem>
        {data?.items.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
