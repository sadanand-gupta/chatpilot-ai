import { Link } from 'react-router-dom';
import { DEFAULT_PLANS } from '@chatpilot/shared';
import { usePublicPlans } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { PlanCard } from '@/components/PlanCard';

export function PricingSection() {
  const plans = usePublicPlans();
  const { user } = useAuth();
  const ctaHref = user ? '/app/billing' : '/register';

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-20 bg-ink-950 py-20 text-white sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">Pricing</p>
          <h2 id="pricing-heading" className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Start free. Upgrade when it's working for you.
          </h2>
          <p className="mt-4 text-slate-400">Simple monthly plans with clear limits. No credit card needed to try it.</p>
        </div>
        <div className="mt-14">
          {plans.isError && (
            <p role="status" className="mb-6 text-center text-sm text-slate-400">
              Showing our standard plans — live pricing couldn't be loaded right now.{' '}
              <button type="button" className="cursor-pointer font-medium text-brand-300 underline-offset-4 hover:underline" onClick={() => plans.refetch()}>
                Retry
              </button>
            </p>
          )}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {(plans.data ?? DEFAULT_PLANS).map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  dark
                  action={
                    p.priceMonthly === null ? (
                      <Button asChild variant="outline" className="w-full border-white/20 bg-transparent text-white hover:bg-white/10">
                        <Link to="/contact">Contact us</Link>
                      </Button>
                    ) : (
                      <Button
                        asChild
                        className={
                          p.highlighted
                            ? 'w-full bg-gradient-to-r from-brand-500 to-accent-500 hover:from-brand-600 hover:to-accent-600'
                            : 'w-full bg-white text-slate-900 hover:bg-slate-100'
                        }
                      >
                        <Link to={ctaHref}>{p.priceMonthly === 0 ? 'Start free' : `Choose ${p.name}`}</Link>
                      </Button>
                    )
                  }
                />
              ))}
            </div>
        </div>
      </div>
    </section>
  );
}
