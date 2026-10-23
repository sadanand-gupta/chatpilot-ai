import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Ban,
  CreditCard,
  FlaskConical,
  LogIn,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityEventType, Paginated } from '@chatpilot/shared';
import { api, qs } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';

export const ADMIN_PAGE_SIZE = 25;

type Params = Record<string, string | undefined>;

/** Cursor-paginated admin list (`GET /api/admin/<resource>`). */
export function useAdminList<T>(resource: string, params: Params = {}) {
  const list = useInfiniteQuery({
    queryKey: qk.admin(resource, params),
    initialPageParam: '' as string,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<T>>(`/admin/${resource}${qs({ ...params, limit: ADMIN_PAGE_SIZE, cursor: pageParam || undefined })}`, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return { ...list, items: list.data?.pages.flatMap((p) => p.items) ?? [] };
}

export function LoadMore({ list }: { list: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!list.hasNextPage) return null;
  return (
    <div className="border-t border-slate-100 p-3 text-center">
      <Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
        {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}

export const EVENT_META: Record<ActivityEventType, { label: string; icon: LucideIcon; tone: string }> = {
  sign_up: { label: 'Signed up', icon: UserPlus, tone: 'bg-emerald-50 text-emerald-700' },
  sign_in: { label: 'Signed in', icon: LogIn, tone: 'bg-brand-50 text-brand-700' },
  demo_started: { label: 'Tried the live demo', icon: FlaskConical, tone: 'bg-amber-50 text-amber-700' },
  chatbot_created: { label: 'Created a chatbot', icon: Sparkles, tone: 'bg-brand-50 text-brand-700' },
  chatbot_published: { label: 'Published a chatbot', icon: Rocket, tone: 'bg-emerald-50 text-emerald-700' },
  chatbot_deleted: { label: 'Deleted a chatbot', icon: Trash2, tone: 'bg-slate-100 text-slate-600' },
  account_deleted: { label: 'Deleted their account', icon: UserX, tone: 'bg-red-50 text-red-700' },
  admin_plan_changed: { label: 'Plan changed by admin', icon: CreditCard, tone: 'bg-violet-50 text-violet-700' },
  admin_user_suspended: { label: 'Suspended by admin', icon: Ban, tone: 'bg-red-50 text-red-700' },
  admin_user_restored: { label: 'Restored by admin', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700' },
  admin_user_deleted: { label: 'Account deleted by admin', icon: UserX, tone: 'bg-red-50 text-red-700' },
  admin_chatbot_deleted: { label: 'Chatbot deleted by admin', icon: Trash2, tone: 'bg-red-50 text-red-700' },
};

/** "Chrome on Windows" from a User-Agent string (good enough for an audit log). */
export function describeUserAgent(ua: string | undefined): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.slice(0, 40);
}
