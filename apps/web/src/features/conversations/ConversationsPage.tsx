import { PageHeader } from '@/components/ui/page-header';
import { ConversationsInbox } from './ConversationsInbox';

export function ConversationsPage() {
  return (
    <div>
      <PageHeader title="Conversations" description="Every chat visitors have had with your chatbots." />
      <ConversationsInbox />
    </div>
  );
}
