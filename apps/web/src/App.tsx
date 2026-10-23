import { lazy, Suspense, useState, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, RedirectIfAuthed, RequireAuth } from '@/lib/auth';
import { createQueryClient } from '@/lib/queryClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppRouteFallback, PageFallback } from '@/components/RouteFallback';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as P from '@/routes/lazy';

const AppShell = lazy(() => import('@/features/app/AppShell').then((m) => ({ default: m.AppShell })));

function RootLayout() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
    </ErrorBoundary>
  );
}

function AppLayout() {
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

/** /verify-email?next=… from before Google-only sign-in: keep ?next and go to /login. */
function LegacyAuthRedirect() {
  const next = new URLSearchParams(useLocation().search).get('next');
  return <Navigate to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
}

function InApp({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppRouteFallback />}>{children}</Suspense>;
}

function Guest({ children }: { children: ReactNode }) {
  return <RedirectIfAuthed>{children}</RedirectIfAuthed>;
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <P.LandingPage /> },
      { path: '/demo', element: <P.DemoPage /> },
      { path: '/chat/:publicId', element: <P.HostedChatPage /> },
      { path: '/privacy', element: <P.PrivacyPage /> },
      { path: '/terms', element: <P.TermsPage /> },
      { path: '/contact', element: <P.ContactPage /> },
      { path: '/login', element: <Guest><P.LoginPage /></Guest> },
      { path: '/register', element: <Guest><P.RegisterPage /></Guest> },
      // Retired with email/password sign-in; old email links land on the Google sign-in page.
      { path: '/forgot-password', element: <Navigate to="/login" replace /> },
      { path: '/verify-email', element: <LegacyAuthRedirect /> },
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: <InApp><P.DashboardPage /></InApp> },
          { path: 'chatbots', element: <InApp><P.ChatbotsListPage /></InApp> },
          { path: 'chatbots/new', element: <InApp><P.CreateChatbotWizard /></InApp> },
          { path: 'chatbots/:id', element: <InApp><P.ChatbotDetailPage /></InApp> },
          { path: 'conversations', element: <InApp><P.ConversationsPage /></InApp> },
          { path: 'leads', element: <InApp><P.LeadsPage /></InApp> },
          { path: 'billing', element: <InApp><P.BillingPage /></InApp> },
          { path: 'settings', element: <InApp><P.SettingsPage /></InApp> },
          { path: 'admin', element: <InApp><P.AdminPage /></InApp> },
          { path: 'admin/users/:uid', element: <InApp><P.AdminUserPage /></InApp> },
          { path: '*', element: <InApp><P.NotFoundPage inApp /></InApp> },
        ],
      },
      { path: '*', element: <P.NotFoundPage /> },
    ],
  },
];

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <RouterProvider router={router} />
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
