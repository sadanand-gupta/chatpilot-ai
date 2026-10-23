import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Activity, Bot, LayoutDashboard, MessagesSquare, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useMe } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityLog } from './ActivityLog';
import { AdminOverview } from './AdminOverview';
import { AdminChatbotsTable, AdminConversationsTable, AdminLeadsTable, AdminUsersTable } from './AdminTables';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'activity', label: 'Activity log', icon: Activity },
  { id: 'chatbots', label: 'Chatbots', icon: Bot },
  { id: 'conversations', label: 'Conversations', icon: MessagesSquare },
  { id: 'leads', label: 'Leads', icon: UserPlus },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Renders children for platform admins only; everyone else is sent back to their dashboard. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export function AdminPage() {
  useDocumentTitle('Admin console');
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'overview';
  const chatbotId = params.get('chatbotId') ?? undefined;

  const setTab = (next: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('tab', next);
        n.delete('chatbotId');
        return n;
      },
      { replace: true },
    );

  return (
    <RequireAdmin>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Admin only
          </span>
        }
        title="Admin console"
        description="Everyone who signed in, tried the demo or built a chatbot, and everything they did."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id}>
                <Icon aria-hidden="true" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <AdminOverview />
        </TabsContent>
        <TabsContent value="users">
          <AdminUsersTable />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityLog />
        </TabsContent>
        <TabsContent value="chatbots">
          <AdminChatbotsTable />
        </TabsContent>
        <TabsContent value="conversations">
          <AdminConversationsTable chatbotId={chatbotId} onClearFilter={() => setTab('conversations')} />
        </TabsContent>
        <TabsContent value="leads">
          <AdminLeadsTable />
        </TabsContent>
      </Tabs>
    </RequireAdmin>
  );
}
