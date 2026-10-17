import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Eye,
  Globe,
  LayoutDashboard,
  Loader2,
  Palette,
  Rocket,
} from 'lucide-react';
import { LANGUAGES, type Chatbot, type CreateChatbotInput } from '@chatpilot/shared';
import { api, errorMessage, isQuotaError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { hostnameOf, normalizeUrl } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField, Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotaNotice } from '@/components/QuotaNotice';
import { ChatbotConfigForm } from './ChatbotConfigForm';
import { CrawlPanel } from './CrawlPanel';
import { KnowledgeReview } from './KnowledgeReview';
import { BUSINESS_CATEGORIES, businessNameFromUrl, LANGUAGE_LABELS, useChatbot } from './lib';
import { PreviewStudio } from './PreviewStudio';
import { PublishPanel } from './PublishPanel';
import { Stepper, type StepDef } from './Stepper';

const STEPS: StepDef[] = [
  { label: 'Website', description: 'Your business', icon: Building2 },
  { label: 'Crawl', description: 'Read your site', icon: Globe },
  { label: 'Knowledge', description: 'Review content', icon: BookOpen },
  { label: 'Customize', description: 'Look & behaviour', icon: Palette },
  { label: 'Preview', description: 'Test it live', icon: Eye },
  { label: 'Publish', description: 'Go live', icon: Rocket },
];

const STEP_TITLES: Record<number, { title: string; description: string }> = {
  1: { title: 'Tell us about your business', description: 'We will read your website and train your assistant on it.' },
  2: { title: 'Reading your website', description: 'We crawl your public pages and extract the useful text.' },
  3: { title: 'Review what your bot knows', description: 'Keep what matters, exclude noise, and fill gaps with FAQs.' },
  4: { title: 'Customize your assistant', description: 'Brand it, set its tone, and decide when to capture leads.' },
  5: { title: 'Preview & test', description: 'See the real widget on your site and ask it questions.' },
  6: { title: 'Publish & install', description: 'Go live and add one line of code to your website.' },
};

const OTHER = '__other__';

export function CreateChatbotWizard() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id') ?? undefined;
  const rawStep = Number(params.get('step') ?? '1');
  const step = id ? Math.min(6, Math.max(1, Number.isFinite(rawStep) ? Math.round(rawStep) : 1)) : 1;
  const addParam = params.get('add');
  const initialDialog = addParam === 'manual' || addParam === 'faq' ? addParam : null;

  const chatbotQ = useChatbot(id);
  const chatbot = chatbotQ.data;
  const [configDirty, setConfigDirty] = useState(false);

  const goTo = useCallback(
    (n: number, extra: Record<string, string> = {}) => {
      if (step === 4 && configDirty && n !== 4 && !window.confirm('You have unsaved changes in the configuration. Leave this step anyway?')) {
        return;
      }
      if (step === 4 && n !== 4) setConfigDirty(false);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('step', String(n));
          next.delete('add');
          for (const [k, v] of Object.entries(extra)) next.set(k, v);
          return next;
        },
        { replace: false },
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [configDirty, setParams, step],
  );

  const clearAddParam = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const heading = STEP_TITLES[step];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 sm:space-y-8">
      <div className="space-y-4">
        <Link to="/app/chatbots" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Chatbots
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">{heading.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {chatbot ? (
                <>
                  <span className="font-medium text-slate-700">{chatbot.businessName}</span> · {hostnameOf(chatbot.websiteUrl)} ·{' '}
                </>
              ) : null}
              {heading.description}
            </p>
          </div>
          {chatbot && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/app/chatbots/${encodeURIComponent(chatbot.id)}`}>
                <LayoutDashboard aria-hidden /> Open chatbot
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <Stepper steps={STEPS} current={step} maxReachable={id ? 6 : 1} onStepClick={(n) => goTo(n)} />
      </div>

      {id && chatbotQ.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      ) : id && chatbotQ.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load this chatbot</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(chatbotQ.error)}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => chatbotQ.refetch()}>
                Retry
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/app/chatbots/new">Start over</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div key={step}>
          {step === 1 && (
            <BusinessStep
              chatbot={chatbot}
              prefillUrl={params.get('url') ?? ''}
              onDone={(c) => {
                setParams({ id: c.id, step: '2' });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
          {step === 2 && chatbot && (
            <CrawlPanel
              chatbot={chatbot}
              autoStart
              onContinue={() => goTo(3)}
              onAddManual={() => goTo(3, { add: 'manual' })}
            />
          )}
          {step === 3 && chatbot && (
            <KnowledgeReview chatbotId={chatbot.id} initialDialog={initialDialog} onDialogConsumed={clearAddParam} onContinue={() => goTo(4)} />
          )}
          {step === 4 && chatbot && <ChatbotConfigForm chatbot={chatbot} onDirtyChange={setConfigDirty} onContinue={() => goTo(5)} />}
          {step === 5 && chatbot && <PreviewStudio chatbot={chatbot} onContinue={() => goTo(6)} />}
          {step === 6 && chatbot && <PublishPanel chatbot={chatbot} hasUnsavedConfig={false} />}

          {step > 1 && (
            <div className="mt-8 flex">
              <Button variant="ghost" onClick={() => goTo(step - 1)}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step 1 */

const businessSchema = z.object({
  websiteUrl: z
    .string()
    .trim()
    .min(3, 'Enter your website address')
    .max(2048)
    .refine((v) => normalizeUrl(v) !== null, 'Enter a valid website address, e.g. example.com'),
  businessName: z.string().trim().min(1, 'Enter your business name').max(120),
  categoryChoice: z.string().optional(),
  categoryOther: z.string().trim().max(80).optional(),
  language: z.enum(LANGUAGES),
});
type BusinessValues = z.infer<typeof businessSchema>;

function BusinessStep({
  chatbot,
  prefillUrl,
  onDone,
}: {
  chatbot?: Chatbot;
  prefillUrl: string;
  onDone: (c: Chatbot) => void;
}) {
  const qc = useQueryClient();
  const knownCategory = chatbot?.category && (BUSINESS_CATEGORIES as readonly string[]).includes(chatbot.category);
  const initialUrl = chatbot?.websiteUrl ?? (prefillUrl ? normalizeUrl(prefillUrl) ?? prefillUrl : '');
  const form = useForm<BusinessValues>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      websiteUrl: initialUrl,
      businessName: chatbot?.businessName ?? (initialUrl ? businessNameFromUrl(normalizeUrl(initialUrl) ?? '') : ''),
      categoryChoice: chatbot?.category ? (knownCategory ? chatbot.category : OTHER) : undefined,
      categoryOther: chatbot?.category && !knownCategory ? chatbot.category : '',
      language: ((chatbot?.config.language ?? chatbot?.language ?? 'auto') as BusinessValues['language']) || 'auto',
    },
  });
  const { register, control, handleSubmit, formState, setValue, getValues, watch } = form;
  const [autoName, setAutoName] = useState(!chatbot);
  const categoryChoice = watch('categoryChoice');

  const prefillName = () => {
    const n = normalizeUrl(getValues('websiteUrl'));
    if (!n) return;
    setValue('websiteUrl', n, { shouldValidate: true });
    if (autoName || !getValues('businessName').trim()) {
      const guess = businessNameFromUrl(n);
      if (guess) setValue('businessName', guess, { shouldValidate: true });
    }
  };

  const save = useMutation({
    mutationFn: async (v: BusinessValues) => {
      const websiteUrl = normalizeUrl(v.websiteUrl)!;
      const category = v.categoryChoice === OTHER ? v.categoryOther?.trim() ?? '' : v.categoryChoice ?? '';
      if (!chatbot) {
        const body: CreateChatbotInput = { websiteUrl, businessName: v.businessName.trim(), category, language: v.language };
        return api.post<Chatbot>('/chatbots', body);
      }
      let updated = await api.patch<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}`, {
        websiteUrl,
        businessName: v.businessName.trim(),
        category,
      });
      if (v.language !== updated.config.language) {
        updated = await api.put<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}/config`, { ...updated.config, language: v.language });
      }
      return updated;
    },
    onSuccess: (c) => {
      qc.setQueryData(qk.chatbot(c.id), c);
      void qc.invalidateQueries({ queryKey: qk.chatbots() });
      void qc.invalidateQueries({ queryKey: qk.me() });
      if (!chatbot) toast.success('Chatbot created — reading your website now');
      onDone(c);
    },
  });

  // Prefill from ?url= once on mount.
  useEffect(() => {
    if (prefillUrl && !chatbot) prefillName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="mx-auto max-w-2xl rounded-2xl">
      <CardContent className="p-6 sm:p-8">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
          <FormField
            id="wiz-url"
            label="Website URL"
            error={formState.errors.websiteUrl?.message}
            hint="Your public homepage — we'll follow links from there."
          >
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                id="wiz-url"
                className="h-11 pl-9 text-base"
                placeholder="yourbusiness.com"
                inputMode="url"
                autoComplete="url"
                autoFocus={!chatbot}
                aria-invalid={Boolean(formState.errors.websiteUrl)}
                {...register('websiteUrl', { onBlur: prefillName })}
              />
            </div>
          </FormField>

          <FormField id="wiz-name" label="Business name" error={formState.errors.businessName?.message}>
            <Input
              id="wiz-name"
              className="h-11"
              autoComplete="organization"
              aria-invalid={Boolean(formState.errors.businessName)}
              {...register('businessName', { onChange: () => setAutoName(false) })}
            />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wiz-category">
                Category <span className="font-normal text-slate-400">(optional)</span>
              </Label>
              <Controller
                control={control}
                name="categoryChoice"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="wiz-category" className="h-11">
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER}>Other…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {categoryChoice === OTHER && (
                <Input aria-label="Describe your category" placeholder="e.g. Pet grooming" maxLength={80} {...register('categoryOther')} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiz-language">Chat language</Label>
              <Controller
                control={control}
                name="language"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="wiz-language" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LANGUAGE_LABELS[l] ?? l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {save.isError &&
            (isQuotaError(save.error) ? (
              <QuotaNotice error={save.error} />
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Could not save</AlertTitle>
                <AlertDescription>{errorMessage(save.error)}</AlertDescription>
              </Alert>
            ))}

          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {chatbot ? 'Save & continue' : 'Create chatbot & read my site'}
            {!save.isPending && <ArrowRight aria-hidden />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
