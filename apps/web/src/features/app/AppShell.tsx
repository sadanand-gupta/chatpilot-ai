import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Bot,
  ChevronDown,
  CreditCard,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plus,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/hooks';
import { cn, formatNumber, initials } from '@/lib/utils';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { SimpleTooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EmailVerificationBanner } from './EmailVerificationBanner';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/chatbots', label: 'Chatbots', icon: Bot, end: false },
  { to: '/app/conversations', label: 'Conversations', icon: MessagesSquare, end: false },
  { to: '/app/leads', label: 'Leads', icon: Users, end: false },
  { to: '/app/billing', label: 'Usage & Plan', icon: CreditCard, end: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, end: false },
] as const;

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('h-[18px] w-[18px]', isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function PlanWidget() {
  const { data } = useMe();
  if (!data) return null;
  const limit = data.plan.limits.messagesPerMonth;
  const used = data.usage.messages;
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <Link
      to="/app/billing"
      className="block rounded-xl border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-800">{data.plan.name} plan</span>
        <span className="text-slate-500">Messages</span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <p className="mt-1.5 text-xs text-slate-500">
        {formatNumber(used)} / {formatNumber(limit)} this month
      </p>
    </Link>
  );
}

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-1 pt-1">
        <Logo to="/app" />
      </div>
      <Button asChild className="w-full justify-start">
        <Link to="/app/chatbots/new" onClick={onNavigate}>
          <Plus /> New chatbot
        </Link>
      </Button>
      <SidebarNav onNavigate={onNavigate} />
      <div className="mt-auto">
        <PlanWidget />
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { data } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const name = data?.user.displayName || user?.displayName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Account menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-xs font-semibold text-white">
            {initials(name || user?.email)}
          </span>
          <span className="hidden max-w-[180px] truncate text-sm font-medium text-slate-700 md:inline">{name || user?.email}</span>
          <ChevronDown className="hidden h-4 w-4 text-slate-400 md:inline" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-slate-900">{name || 'Your account'}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
          <UserRound /> Profile & settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/app/billing')}>
          <CreditCard /> Usage & plan
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await signOut();
            queryClient.clear();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DevModeBadge() {
  const { mode } = useAuth();
  if (mode !== 'dev') return null;
  return (
    <SimpleTooltip content="Dev auth mode: sign-in uses POST /api/dev/login without a password. Never enable in production.">
      <Badge variant="warning" className="cursor-help" data-testid="dev-mode-badge" tabIndex={0}>
        <FlaskConical /> Dev mode
      </Badge>
    </SimpleTooltip>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <SidebarContents />
      </aside>

      {/* Mobile drawer */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/40 data-[state=open]:animate-fade-in lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-xl data-[state=open]:animate-slide-in-left focus:outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation menu</DialogPrimitive.Description>
            <DialogPrimitive.Close className="absolute right-3 top-4 cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
            <SidebarContents onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu className="!size-5" />
          </Button>
          <div className="lg:hidden">
            <Logo to="/app" hideTextOnSmall />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <DevModeBadge />
            <UserMenu />
          </div>
        </header>
        <EmailVerificationBanner />
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
