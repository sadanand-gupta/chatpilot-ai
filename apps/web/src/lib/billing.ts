import type { PlanId } from '@chatpilot/shared';

/**
 * Billing service interface. Payments are NOT integrated yet — `enabled` is false and the UI shows
 * an honest "contact us to upgrade" dialog. To wire a provider (Stripe / Razorpay), implement this
 * interface (e.g. call POST /api/billing/checkout and redirect to the returned URL) and swap
 * `billing` below.
 */
export interface BillingService {
  readonly enabled: boolean;
  readonly provider: string | null;
  /** Starts an upgrade/checkout flow. Resolves with a URL to redirect to. */
  startCheckout(planId: PlanId): Promise<{ url: string }>;
  /** Opens the customer billing portal (invoices, payment method, cancel). */
  openPortal(): Promise<{ url: string }>;
}

class NotEnabledError extends Error {
  constructor() {
    super('Billing is not enabled yet.');
    this.name = 'BillingNotEnabledError';
  }
}

export const disabledBilling: BillingService = {
  enabled: false,
  provider: null,
  startCheckout: () => Promise.reject(new NotEnabledError()),
  openPortal: () => Promise.reject(new NotEnabledError()),
};

export const billing: BillingService = disabledBilling;
