import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Send } from 'lucide-react';
import { appConfig } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SimplePageLayout } from './MarketingLayout';

const schema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  subject: z.string().trim().min(1, 'Please add a subject').max(150),
  message: z.string().trim().min(10, 'Please write at least 10 characters').max(4000),
});
type Values = z.infer<typeof schema>;

export function ContactPage() {
  const { user } = useAuth();
  const to = appConfig.contactEmail;
  const [opened, setOpened] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.displayName ?? '', email: user?.email ?? '', subject: '', message: '' },
  });
  const { errors } = form.formState;

  useDocumentTitle('Contact');

  const onSubmit = form.handleSubmit((v) => {
    const body = `${v.message}\n\n— ${v.name} <${v.email}>`;
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(v.subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  });

  return (
    <SimplePageLayout>
      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-14 sm:px-6 sm:py-20 md:grid-cols-[1fr_1.3fr]">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Contact us</h1>
          <p className="mt-3 text-slate-600">Questions about {appConfig.productName}, upgrading your plan, or a problem with your chatbot? Send us a message.</p>
          {to && (
            <p className="mt-6 flex items-center gap-2 text-sm text-slate-700">
              <Mail className="h-4 w-4 text-brand-600" />
              <a href={`mailto:${to}`} className="font-medium text-brand-600 hover:underline">
                {to}
              </a>
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {!to ? (
            <Alert variant="warning">
              <AlertDescription>
                The contact email isn’t configured yet. Set <code className="font-mono">VITE_CONTACT_EMAIL</code> to enable this form.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {opened && (
                <Alert>
                  <AlertDescription>
                    Your email app should have opened with the message ready to send. If it didn’t, email us directly at {to}.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="c-name" label="Name" error={errors.name?.message}>
                  <Input id="c-name" autoComplete="name" aria-invalid={!!errors.name} {...form.register('name')} />
                </FormField>
                <FormField id="c-email" label="Email" error={errors.email?.message}>
                  <Input id="c-email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register('email')} />
                </FormField>
              </div>
              <FormField id="c-subject" label="Subject" error={errors.subject?.message}>
                <Input id="c-subject" aria-invalid={!!errors.subject} {...form.register('subject')} />
              </FormField>
              <FormField id="c-message" label="Message" error={errors.message?.message}>
                <Textarea id="c-message" rows={6} aria-invalid={!!errors.message} {...form.register('message')} />
              </FormField>
              <Button type="submit" size="lg" className="w-full sm:w-auto">
                <Send /> Open in email app
              </Button>
              <p className="text-xs text-slate-500">This form opens your email app — nothing is sent until you press send there.</p>
            </form>
          )}
        </div>
      </div>
    </SimplePageLayout>
  );
}
