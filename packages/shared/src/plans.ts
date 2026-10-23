import type { Plan, PlanId } from './types';

/**
 * Default plan catalogue. Prices are DISPLAY values only and can be overridden
 * at runtime by the API (env PLANS_JSON or the Firestore `plans` collection).
 * Never hardcode prices in UI components — read them from GET /api/plans.
 */
export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free Trial',
    description: 'Try ChatPilot with up to 5 chatbots.',
    priceMonthly: 0,
    currency: 'INR',
    limits: {
      chatbots: 5,
      messagesPerMonth: 100,
      crawlsPerMonth: 5,
      pagesPerCrawl: 15,
      leadsPerMonth: 25,
      knowledgeCharsPerBot: 150_000,
      retentionDays: 30,
    },
    features: { leadCapture: true, removeBranding: false, csvExport: false, allowedOrigins: false },
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'For a single small business website.',
    priceMonthly: 999,
    currency: 'INR',
    limits: {
      chatbots: 1,
      messagesPerMonth: 1_000,
      crawlsPerMonth: 20,
      pagesPerCrawl: 50,
      leadsPerMonth: 500,
      knowledgeCharsPerBot: 500_000,
      retentionDays: 90,
    },
    features: { leadCapture: true, removeBranding: false, csvExport: true, allowedOrigins: true },
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Multiple sites and higher volume.',
    priceMonthly: 2_499,
    currency: 'INR',
    highlighted: true,
    limits: {
      chatbots: 5,
      messagesPerMonth: 5_000,
      crawlsPerMonth: 60,
      pagesPerCrawl: 100,
      leadsPerMonth: 5_000,
      knowledgeCharsPerBot: 1_500_000,
      retentionDays: 180,
    },
    features: { leadCapture: true, removeBranding: true, csvExport: true, allowedOrigins: true },
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Agencies and high-traffic websites.',
    priceMonthly: null,
    currency: 'INR',
    limits: {
      chatbots: 25,
      messagesPerMonth: 25_000,
      crawlsPerMonth: 200,
      pagesPerCrawl: 200,
      leadsPerMonth: 25_000,
      knowledgeCharsPerBot: 3_000_000,
      retentionDays: 365,
    },
    features: { leadCapture: true, removeBranding: true, csvExport: true, allowedOrigins: true },
  },
];

export const DEFAULT_PLAN_ID: PlanId = 'free';

export function findPlan(plans: Plan[], id: string | undefined): Plan {
  return plans.find((p) => p.id === id) ?? plans.find((p) => p.id === DEFAULT_PLAN_ID) ?? plans[0];
}
