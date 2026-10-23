import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Eye, MessageSquare, MessagesSquare, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminChatbot, AdminConversation, AdminLead, AdminUser, ChatMessage } from '@chatpilot/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useDebounced } from '@/lib/useDebounced';
import { formatDate, formatDateTime, formatNumber, hostnameOf } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChannelBadge, ChatbotStatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';
import { SafeExternalLink } from '@/components/SafeExternalLink';
import { MessageBubble } from '@/features/conversations/ConversationsInbox';
import { LoadMore, useAdminList } from './lib';

const dash = <span className="text-slate-400">—</span>;

function SearchBox({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Label htmlFor={id} className="sr-only">
        {placeholder}
      </Label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input id={id} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" />
    </div>
  );
}

/** Loading / error / empty states around a table card. */
function ListFrame({
  list,
  columns,
  empty,
  head,
  children,
}: {
  list: ReturnType<typeof useAdminList<unknown>>;
  columns: number;
  empty: ReactNode;
  head: ReactNode;
  children: ReactNode;
}) {
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.isLoading && list.items.length === 0) return <>{empty}</>;
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">{head}</TableRow>
        </TableHeader>
        <TableBody>
          {list.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: columns }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : children}
        </TableBody>
      </Table>
      <LoadMore list={list} />
    </Card>
  );
}

export function UserBadges({ user }: { user: Pick<AdminUser, 'isAdmin' | 'suspended'> }) {
  return (
    <>
      {user.isAdmin && <Badge>Admin</Badge>}
      {user.suspended && <Badge variant="destructive">Suspended</Badge>}
    </>
  );
}

/* ---------------- users ---------------- */

export function AdminUsersTable() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const list = useAdminList<AdminUser>('users', { q: q || undefined });
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      <SearchBox id="admin-user-search" value={search} onChange={setSearch} placeholder="Search email, name or business…" />
      <ListFrame
        list={list}
        columns={7}
        empty={<EmptyState icon={q ? Search : Users} title={q ? 'No users match your search' : 'No users yet'} />}
        head={
          <>
            <TableHead>User</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Chatbots</TableHead>
            <TableHead className="text-right">Messages (month)</TableHead>
            <TableHead className="text-right">Sign-ins</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead>Joined</TableHead>
          </>
        }
      >
        {list.items.map((u) => (
          <TableRow key={u.uid} className="cursor-pointer" onClick={() => navigate(`/app/admin/users/${encodeURIComponent(u.uid)}`)}>
            <TableCell>
              <Link
                to={`/app/admin/users/${encodeURIComponent(u.uid)}`}
                className="font-medium text-slate-900 hover:text-brand-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {u.email || u.uid}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {u.displayName && <span>{u.displayName}</span>}
                {u.businessName && <span>· {u.businessName}</span>}
                <UserBadges user={u} />
              </div>
            </TableCell>
            <TableCell className="capitalize">{u.planId}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(u.chatbotCount)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(u.messagesThisMonth)}</TableCell>
            <TableCell className="text-right tabular-nums">{u.signInCount ? formatNumber(u.signInCount) : dash}</TableCell>
            <TableCell className="whitespace-nowrap text-xs text-slate-500">{u.lastActiveAt ? formatDateTime(u.lastActiveAt) : dash}</TableCell>
            <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDate(u.createdAt)}</TableCell>
          </TableRow>
        ))}
      </ListFrame>
    </div>
  );
}

/* ---------------- chatbots ---------------- */

export function useDeleteAdminChatbot(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/chatbots/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success('Chatbot deleted');
      queryClient.invalidateQueries({ queryKey: qk.admin() });
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the chatbot')),
  });
}

export function AdminChatbotRows({ items, showOwner, onDelete }: { items: AdminChatbot[]; showOwner: boolean; onDelete: (b: AdminChatbot) => void }) {
  return (
    <>
      {items.map((b) => (
        <TableRow key={b.id}>
          <TableCell>
            <p className="font-medium text-slate-900">{b.name}</p>
            <SafeExternalLink href={b.websiteUrl} className="text-xs text-slate-500 hover:text-brand-600 hover:underline" title={b.websiteUrl}>
              {hostnameOf(b.websiteUrl)}
            </SafeExternalLink>
          </TableCell>
          {showOwner && (
            <TableCell className="whitespace-nowrap text-sm">
              {b.ownerEmail ? (
                <Link to={`/app/admin/users/${encodeURIComponent(b.ownerId)}`} className="text-brand-600 hover:underline">
                  {b.ownerEmail}
                </Link>
              ) : (
                dash
              )}
            </TableCell>
          )}
          <TableCell>
            <ChatbotStatusBadge chatbot={b} />
          </TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(b.stats?.sources ?? 0)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(b.stats?.conversations ?? 0)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(b.stats?.leads ?? 0)}</TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-500">
            {b.install?.lastSeenOrigin ? (
              <SimpleTooltip content={`Widget last loaded ${formatDateTime(b.install.lastSeenAt)}`}>
                <span>{hostnameOf(b.install.lastSeenOrigin)}</span>
              </SimpleTooltip>
            ) : (
              dash
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDate(b.createdAt)}</TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <SimpleTooltip content="View conversations">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                  <Link to={`/app/admin?tab=conversations&chatbotId=${encodeURIComponent(b.id)}`} aria-label="View conversations">
                    <MessageSquare />
                  </Link>
                </Button>
              </SimpleTooltip>
              {b.status === 'published' && (
                <SimpleTooltip content="Open hosted chat page">
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <a href={`/chat/${encodeURIComponent(b.publicId)}`} target="_blank" rel="noopener noreferrer" aria-label="Open hosted chat page">
                      <Eye />
                    </a>
                  </Button>
                </SimpleTooltip>
              )}
              <SimpleTooltip content="Delete chatbot">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-600" onClick={() => onDelete(b)} aria-label="Delete chatbot">
                  <Trash2 />
                </Button>
              </SimpleTooltip>
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function ChatbotTableHead({ showOwner }: { showOwner: boolean }) {
  return (
    <>
      <TableHead>Chatbot / website</TableHead>
      {showOwner && <TableHead>Owner</TableHead>}
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Sources</TableHead>
      <TableHead className="text-right">Conversations</TableHead>
      <TableHead className="text-right">Leads</TableHead>
      <TableHead>Installed on</TableHead>
      <TableHead>Created</TableHead>
      <TableHead className="text-right">
        <span className="sr-only">Actions</span>
      </TableHead>
    </>
  );
}

export function DeleteChatbotDialog({ bot, onClose }: { bot: AdminChatbot | null; onClose: () => void }) {
  const del = useDeleteAdminChatbot(onClose);
  return (
    <ConfirmDialog
      open={Boolean(bot)}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this chatbot?"
      description={`${bot?.name ?? 'This chatbot'}${bot?.ownerEmail ? ` (owned by ${bot.ownerEmail})` : ''} will be removed with its knowledge, conversations and leads. The widget stops working on their site. This can't be undone.`}
      confirmLabel="Delete chatbot"
      loading={del.isPending}
      onConfirm={() => {
        if (bot) del.mutate(bot.id);
      }}
    />
  );
}

export function AdminChatbotsTable() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const list = useAdminList<AdminChatbot>('chatbots', { q: q || undefined });
  const [toDelete, setToDelete] = useState<AdminChatbot | null>(null);

  return (
    <div className="space-y-3">
      <SearchBox id="admin-bot-search" value={search} onChange={setSearch} placeholder="Search name, website or chatbot id…" />
      <ListFrame
        list={list}
        columns={9}
        empty={<EmptyState icon={q ? Search : Bot} title={q ? 'No chatbots match your search' : 'No chatbots yet'} />}
        head={<ChatbotTableHead showOwner />}
      >
        <AdminChatbotRows items={list.items} showOwner onDelete={setToDelete} />
      </ListFrame>
      <DeleteChatbotDialog bot={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}

/* ---------------- conversations ---------------- */

function TranscriptDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: qk.admin('conversation', id),
    queryFn: ({ signal }) => api.get<{ conversation: AdminConversation; messages: ChatMessage[] }>(`/admin/conversations/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
  });
  const c = q.data?.conversation;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c?.chatbotName ?? 'Conversation'}</DialogTitle>
          <DialogDescription>
            {c ? `${c.ownerEmail ?? 'Landing-page demo'} · started ${formatDateTime(c.createdAt)} · ${c.messageCount} messages` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-3/4" />)
          ) : (
            q.data.messages.map((m) => <MessageBubble key={m.id} m={m} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminConversationsTable({ chatbotId, onClearFilter }: { chatbotId?: string; onClearFilter: () => void }) {
  const list = useAdminList<AdminConversation>('conversations', { chatbotId });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {chatbotId && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          Showing one chatbot's conversations.
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onClearFilter}>
            Show all
          </Button>
        </div>
      )}
      <ListFrame
        list={list}
        columns={6}
        empty={<EmptyState icon={MessagesSquare} title="No conversations yet" description="Visitor chats from every chatbot (and the live demo) appear here." />}
        head={
          <>
            <TableHead>Last message</TableHead>
            <TableHead>Chatbot</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="min-w-[220px]">Preview</TableHead>
            <TableHead className="text-right">Messages</TableHead>
          </>
        }
      >
        {list.items.map((c) => (
          <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
            <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(c.lastMessageAt)}</TableCell>
            <TableCell className="whitespace-nowrap font-medium text-slate-900">{c.chatbotName ?? dash}</TableCell>
            <TableCell className="whitespace-nowrap text-sm">{c.ownerEmail ?? <span className="text-slate-400">Demo</span>}</TableCell>
            <TableCell>
              <ChannelBadge channel={c.channel} />
            </TableCell>
            <TableCell>
              <p className="line-clamp-2 max-w-sm text-sm">{c.lastMessagePreview || dash}</p>
              {c.pageUrl && <p className="mt-0.5 max-w-sm truncate text-xs text-slate-500">on {hostnameOf(c.pageUrl)}</p>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(c.messageCount)}</TableCell>
          </TableRow>
        ))}
      </ListFrame>
      <TranscriptDialog id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ---------------- leads ---------------- */

export function AdminLeadsTable() {
  const list = useAdminList<AdminLead>('leads');
  return (
    <ListFrame
      list={list}
      columns={6}
      empty={<EmptyState icon={UserPlus} title="No leads yet" description="Contact details captured by any chatbot appear here." />}
      head={
        <>
          <TableHead>Date</TableHead>
          <TableHead>Lead</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead className="min-w-[200px]">Message</TableHead>
          <TableHead>Chatbot</TableHead>
          <TableHead>Owner</TableHead>
        </>
      }
    >
      {list.items.map((l) => (
        <TableRow key={l.id}>
          <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(l.createdAt)}</TableCell>
          <TableCell>
            <p className="font-medium text-slate-900">{l.name || dash}</p>
            {l.email && <p className="text-xs text-slate-500">{l.email}</p>}
          </TableCell>
          <TableCell className="whitespace-nowrap">{l.phone || dash}</TableCell>
          <TableCell>
            <p className="line-clamp-2 max-w-xs text-sm" title={l.message}>
              {l.message || dash}
            </p>
          </TableCell>
          <TableCell className="whitespace-nowrap">{l.chatbotName ?? dash}</TableCell>
          <TableCell className="whitespace-nowrap text-sm">
            {l.ownerEmail ? (
              <Link to={`/app/admin/users/${encodeURIComponent(l.ownerId)}`} className="text-brand-600 hover:underline">
                {l.ownerEmail}
              </Link>
            ) : (
              dash
            )}
          </TableCell>
        </TableRow>
      ))}
    </ListFrame>
  );
}
