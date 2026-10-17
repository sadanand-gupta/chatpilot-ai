import { Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Eye, LayoutGrid, MessageSquare, Palette, Rocket, UserPlus } from 'lucide-react';
import { useChatbot } from '@/lib/hooks';
import { ApiError } from '@/lib/api';
import { hostnameOf } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ErrorState';
import { PanelFallback } from '@/components/RouteFallback';
import { ChatbotStatusBadge } from '@/components/StatusBadge';
import { SiteIcon } from '@/components/SiteIcon';
import { CrawlPanel, KnowledgeReview, ChatbotConfigForm, PreviewStudio, PublishPanel } from '@/routes/lazy';
import { ConversationsInbox } from '@/features/conversations/ConversationsInbox';
import { LeadsTable } from '@/features/leads/LeadsTable';
import { ChatbotOverview } from './ChatbotOverview';
import { SafeExternalLink } from '@/components/SafeExternalLink';

export const CHATBOT_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { value: 'customize', label: 'Customize', icon: Palette },
  { value: 'preview', label: 'Preview', icon: Eye },
  { value: 'publish', label: 'Publish & Install', icon: Rocket },
  { value: 'conversations', label: 'Conversations', icon: MessageSquare },
  { value: 'leads', label: 'Leads', icon: UserPlus },
] as const;
type TabValue = (typeof CHATBOT_TABS)[number]['value'];

export function ChatbotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const q = useChatbot(id);
  const raw = params.get('tab') ?? 'overview';
  const tab: TabValue = CHATBOT_TABS.some((t) => t.value === raw) ? (raw as TabValue) : 'overview';

  const setTab = (t: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        // keep only params meaningful for the target tab
        if (t !== 'overview') next.set('tab', t);
        if (t === 'conversations' && prev.get('conversation')) next.set('conversation', prev.get('conversation')!);
        return next;
      },
      { replace: false },
    );

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-2xl" />
        <PanelFallback />
      </div>
    );
  }
  if (q.isError || !q.data) {
    if (q.error instanceof ApiError && (q.error.code === 'not_found' || q.error.code === 'forbidden')) {
      return (
        <EmptyState
          title="Chatbot not found"
          description="It may have been deleted, or you don't have access to it."
          action={
            <Button asChild>
              <Link to="/app/chatbots">Back to chatbots</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState error={q.error} title="Couldn't load this chatbot" onRetry={() => q.refetch()} />;
  }

  const chatbot = q.data;

  return (
    <div>
      <Link to="/app/chatbots" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All chatbots
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SiteIcon siteMeta={chatbot.siteMeta} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-2xl font-bold tracking-tight text-slate-900">{chatbot.name}</h1>
            <ChatbotStatusBadge chatbot={chatbot} />
          </div>
          <SafeExternalLink href={chatbot.websiteUrl} className="text-sm text-slate-500 hover:text-brand-600">
            {hostnameOf(chatbot.websiteUrl)}
          </SafeExternalLink>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {CHATBOT_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                <t.icon className="hidden sm:block" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <Suspense fallback={<PanelFallback />}>
          <TabsContent value="overview">
            <ChatbotOverview chatbot={chatbot} onTab={setTab} />
          </TabsContent>
          <TabsContent value="knowledge" className="space-y-6">
            <CrawlPanel chatbot={chatbot} />
            <KnowledgeReview chatbotId={chatbot.id} />
          </TabsContent>
          <TabsContent value="customize">
            <ChatbotConfigForm chatbot={chatbot} />
          </TabsContent>
          <TabsContent value="preview">
            <PreviewStudio chatbot={chatbot} />
          </TabsContent>
          <TabsContent value="publish">
            <PublishPanel chatbot={chatbot} />
          </TabsContent>
          <TabsContent value="conversations">
            <ConversationsInbox fixedChatbotId={chatbot.id} />
          </TabsContent>
          <TabsContent value="leads">
            <LeadsTable fixedChatbotId={chatbot.id} />
          </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
