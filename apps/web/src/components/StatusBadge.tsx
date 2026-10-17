import type { Chatbot, ConversationChannel } from '@chatpilot/shared';
import { Badge } from '@/components/ui/badge';

export function ChatbotStatusBadge({ chatbot }: { chatbot: Pick<Chatbot, 'status' | 'hasUnpublishedChanges'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {chatbot.status === 'published' ? (
        <Badge variant="success">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Published
        </Badge>
      ) : chatbot.status === 'unpublished' ? (
        <Badge variant="secondary">Unpublished</Badge>
      ) : (
        <Badge variant="outline">Draft</Badge>
      )}
      {chatbot.status === 'published' && chatbot.hasUnpublishedChanges && <Badge variant="warning">Unpublished changes</Badge>}
    </span>
  );
}

const CHANNEL_LABEL: Record<ConversationChannel, string> = { widget: 'Website widget', hosted: 'Hosted page', demo: 'Demo' };

export function ChannelBadge({ channel }: { channel: ConversationChannel }) {
  return <Badge variant={channel === 'widget' ? 'default' : 'secondary'}>{CHANNEL_LABEL[channel] ?? channel}</Badge>;
}
