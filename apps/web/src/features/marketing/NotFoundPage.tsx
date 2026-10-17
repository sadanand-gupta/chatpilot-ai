import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { SimplePageLayout } from './MarketingLayout';

function NotFoundContent({ inApp }: { inApp?: boolean }) {
  useDocumentTitle('Page not found');
  return (
    <div className="flex flex-col items-center px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <Compass className="h-7 w-7" />
      </span>
      <p className="mt-6 font-display text-sm font-bold uppercase tracking-wider text-brand-600">404</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-md text-slate-500">The page you’re looking for doesn’t exist or has moved.</p>
      <div className="mt-8 flex gap-2">
        <Button asChild>
          <Link to={inApp ? '/app' : '/'}>{inApp ? 'Back to dashboard' : 'Go home'}</Link>
        </Button>
        {!inApp && (
          <Button asChild variant="outline">
            <Link to="/contact">Contact us</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  if (inApp) return <NotFoundContent inApp />;
  return (
    <SimplePageLayout>
      <NotFoundContent />
    </SimplePageLayout>
  );
}
