import { PageHeader } from '@/components/ui/page-header';
import { LeadsTable } from './LeadsTable';

export function LeadsPage() {
  return (
    <div>
      <PageHeader title="Leads" description="Contact details visitors shared through your chatbots." />
      <LeadsTable />
    </div>
  );
}
