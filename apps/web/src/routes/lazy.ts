import { lazy, type ComponentType } from 'react';

/** React.lazy for named exports. */
function lazyNamed<M extends Record<string, unknown>, K extends keyof M & string>(loader: () => Promise<M>, name: K) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[name] as unknown as ComponentType<any> };
  }) as unknown as M[K];
}

/* ---------- Marketing / public ---------- */
export const LandingPage = lazyNamed(() => import('@/features/marketing/LandingPage'), 'LandingPage');
export const PrivacyPage = lazyNamed(() => import('@/features/marketing/LegalPages'), 'PrivacyPage');
export const TermsPage = lazyNamed(() => import('@/features/marketing/LegalPages'), 'TermsPage');
export const ContactPage = lazyNamed(() => import('@/features/marketing/ContactPage'), 'ContactPage');
export const NotFoundPage = lazyNamed(() => import('@/features/marketing/NotFoundPage'), 'NotFoundPage');

/* ---------- Auth ---------- */
export const LoginPage = lazyNamed(() => import('@/features/auth/LoginPage'), 'LoginPage');
export const RegisterPage = lazyNamed(() => import('@/features/auth/RegisterPage'), 'RegisterPage');

/* ---------- App ---------- */
export const DashboardPage = lazyNamed(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
export const ChatbotsListPage = lazyNamed(() => import('@/features/chatbots/ChatbotsListPage'), 'ChatbotsListPage');
export const ChatbotDetailPage = lazyNamed(() => import('@/features/chatbots/ChatbotDetailPage'), 'ChatbotDetailPage');
export const ConversationsPage = lazyNamed(() => import('@/features/conversations/ConversationsPage'), 'ConversationsPage');
export const LeadsPage = lazyNamed(() => import('@/features/leads/LeadsPage'), 'LeadsPage');
export const BillingPage = lazyNamed(() => import('@/features/billing/BillingPage'), 'BillingPage');
export const SettingsPage = lazyNamed(() => import('@/features/settings/SettingsPage'), 'SettingsPage');

/* ---------- Studio (owned by the Studio engineer) ---------- */
export const CreateChatbotWizard = lazyNamed(() => import('@/features/studio/CreateChatbotWizard'), 'CreateChatbotWizard');
export const CrawlPanel = lazyNamed(() => import('@/features/studio/CrawlPanel'), 'CrawlPanel');
export const KnowledgeReview = lazyNamed(() => import('@/features/studio/KnowledgeReview'), 'KnowledgeReview');
export const ChatbotConfigForm = lazyNamed(() => import('@/features/studio/ChatbotConfigForm'), 'ChatbotConfigForm');
export const PreviewStudio = lazyNamed(() => import('@/features/studio/PreviewStudio'), 'PreviewStudio');
export const PublishPanel = lazyNamed(() => import('@/features/studio/PublishPanel'), 'PublishPanel');
export const LiveDemo = lazyNamed(() => import('@/features/demo/LiveDemo'), 'LiveDemo');
export const DemoPage = lazyNamed(() => import('@/features/demo/DemoPage'), 'DemoPage');
export const HostedChatPage = lazyNamed(() => import('@/features/hosted/HostedChatPage'), 'HostedChatPage');
