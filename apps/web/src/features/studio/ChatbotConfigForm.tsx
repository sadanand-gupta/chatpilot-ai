import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  Bot,
  Check,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import {
  chatbotConfigSchema,
  LANGUAGES,
  LAUNCHER_ICONS,
  TONES,
  type Chatbot,
  type ChatbotConfig,
  type PreviewChatReply,
} from '@chatpilot/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/widget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField, Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LANGUAGE_LABELS, suggestQuestionsFromSite, TONE_LABELS, useMe } from './lib';
import { WidgetStage } from './WidgetStage';

export interface ChatbotConfigFormProps {
  chatbot: Chatbot;
  onSaved?: (chatbot: Chatbot) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Wizard: show a "Continue" button (saves first if dirty). */
  onContinue?: () => void;
}

export const COLOR_PRESETS = ['#4F46E5', '#2563EB', '#0891B2', '#059669', '#16A34A', '#CA8A04', '#EA580C', '#DC2626', '#DB2777', '#7C3AED', '#0F172A'];

export const LAUNCHER_ICON_COMPONENTS: Record<(typeof LAUNCHER_ICONS)[number], typeof MessageCircle> = {
  chat: MessageCircle,
  sparkle: Sparkles,
  help: HelpCircle,
  message: MessageSquare,
  bot: Bot,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isHttpsUrl(u: string | undefined): u is string {
  if (!u) return false;
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

export function ChatbotConfigForm({ chatbot, onSaved, onDirtyChange, onContinue }: ChatbotConfigFormProps) {
  const qc = useQueryClient();
  const me = useMe();
  const canRemoveBranding = me.data?.plan.features.removeBranding ?? false;
  const leadFeature = me.data?.plan.features.leadCapture ?? true;

  const form = useForm<ChatbotConfig>({
    resolver: zodResolver(chatbotConfigSchema),
    defaultValues: chatbot.config,
    mode: 'onChange',
  });
  const { register, control, handleSubmit, formState, reset, setValue } = form;
  const { errors, isDirty } = formState;
  const primaryColor = useWatch({ control, name: 'primaryColor' });
  const swatch = HEX_RE.test(primaryColor ?? '') ? primaryColor : '#4F46E5';

  // Re-sync with server data when the chatbot changes elsewhere and the form is pristine.
  const configJson = JSON.stringify(chatbot.config);
  useEffect(() => {
    if (!form.formState.isDirty) reset(chatbot.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configJson]);

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  // Unsaved-changes guard for reloads / tab closes.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const save = useMutation({
    mutationFn: (values: ChatbotConfig) => api.put<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}/config`, values),
    onSuccess: (c) => {
      qc.setQueryData(qk.chatbot(chatbot.id), c);
      void qc.invalidateQueries({ queryKey: qk.chatbots() });
      reset(c.config);
      toast.success('Configuration saved');
      onSaved?.(c);
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save configuration.')),
  });

  const submit = handleSubmit((v) => save.mutate(v), () => toast.error('Please fix the highlighted fields.'));

  const continueFlow = () => {
    if (!isDirty) return onContinue?.();
    void handleSubmit(
      (v) => save.mutate(v, { onSuccess: () => onContinue?.() }),
      () => toast.error('Please fix the highlighted fields.'),
    )();
  };

  const siteMeta = chatbot.siteMeta;
  const brandColor = siteMeta?.themeColor && HEX_RE.test(siteMeta.themeColor) ? siteMeta.themeColor.toUpperCase() : null;
  const avatarOptions = [
    { label: 'Logo', url: siteMeta?.logo },
    { label: 'Favicon', url: siteMeta?.favicon },
  ].filter((o): o is { label: string; url: string } => isHttpsUrl(o.url));

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]" noValidate>
      <div className="min-w-0 space-y-6">
        {/* Identity */}
        <Section title="Identity" description="How your assistant introduces itself.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="cfg-botName" label="Bot name" error={errors.botName?.message}>
              <Input id="cfg-botName" {...register('botName')} />
            </FormField>
            <FormField id="cfg-headerTitle" label="Header title" error={errors.headerTitle?.message}>
              <Input id="cfg-headerTitle" {...register('headerTitle')} />
            </FormField>
          </div>
          <FormField
            id="cfg-avatarUrl"
            label="Avatar image URL"
            error={errors.avatarUrl?.message}
            hint="An https:// image URL, shown in the chat header."
          >
            <Input id="cfg-avatarUrl" placeholder="https://…" inputMode="url" {...register('avatarUrl')} />
          </FormField>
          {avatarOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">From your site:</span>
              {avatarOptions.map((o) => (
                <button
                  key={o.url}
                  type="button"
                  onClick={() => setValue('avatarUrl', o.url, { shouldDirty: true, shouldValidate: true })}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-xs font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <img src={o.url} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full bg-white object-contain ring-1 ring-slate-200" />
                  Use {o.label.toLowerCase()}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setValue('avatarUrl', '', { shouldDirty: true, shouldValidate: true })}
                className="rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                No avatar
              </button>
            </div>
          )}
        </Section>

        {/* Messages */}
        <Section title="Messages" description="What visitors see first, and what the bot says when it doesn't know.">
          <FormField id="cfg-welcome" label="Welcome message" error={errors.welcomeMessage?.message}>
            <Textarea id="cfg-welcome" rows={3} {...register('welcomeMessage')} />
          </FormField>
          <SuggestedQuestions control={control} chatbot={chatbot} setQuestions={(q) => setValue('suggestedQuestions', q, { shouldDirty: true, shouldValidate: true })} />
          <FormField
            id="cfg-fallback"
            label="Fallback message"
            error={errors.fallbackMessage?.message}
            hint="Used when the answer isn't in your website content."
          >
            <Textarea id="cfg-fallback" rows={3} {...register('fallbackMessage')} />
          </FormField>
        </Section>

        {/* Appearance */}
        <Section title="Appearance" description="Match the widget to your brand.">
          <Controller
            control={control}
            name="primaryColor"
            render={({ field }) => (
              <ColorField value={field.value} onChange={field.onChange} brandColor={brandColor} error={errors.primaryColor?.message} />
            )}
          />
          <Controller
            control={control}
            name="launcherIcon"
            render={({ field }) => (
              <div className="space-y-2">
                <Label id="cfg-launcher-label">Launcher icon</Label>
                <div role="radiogroup" aria-labelledby="cfg-launcher-label" className="flex flex-wrap gap-2">
                  {LAUNCHER_ICONS.map((icon) => {
                    const Icon = LAUNCHER_ICON_COMPONENTS[icon];
                    const selected = field.value === icon;
                    return (
                      <button
                        key={icon}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={icon}
                        onClick={() => field.onChange(icon)}
                        className={cn(
                          'flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                          selected ? 'scale-110 ring-2 ring-slate-900 ring-offset-2' : 'opacity-70 hover:opacity-100',
                        )}
                        style={{ background: swatch }}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          />
          <Controller
            control={control}
            name="position"
            render={({ field }) => (
              <div className="space-y-2">
                <Label id="cfg-pos-label">Position</Label>
                <div className="inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-labelledby="cfg-pos-label">
                  {(['left', 'right'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={field.value === p}
                      onClick={() => field.onChange(p)}
                      className={cn(
                        'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                        field.value === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                      )}
                    >
                      Bottom {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />
          <Controller
            control={control}
            name="showBranding"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <div>
                  <Label htmlFor="cfg-branding">Show “Powered by” branding</Label>
                  {!canRemoveBranding && (
                    <p className="mt-1 text-xs text-slate-500">
                      Removing branding is available on Pro and Business.{' '}
                      <Link to="/app/billing" className="font-medium text-brand-600 hover:underline">
                        Upgrade
                      </Link>
                    </p>
                  )}
                </div>
                <Switch
                  id="cfg-branding"
                  checked={canRemoveBranding ? field.value : true}
                  disabled={!canRemoveBranding}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
        </Section>

        {/* Behaviour */}
        <Section title="Behaviour" description="Tone of voice and reply language.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="tone"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-tone">Tone</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="cfg-tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TONE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
            <Controller
              control={control}
              name="language"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-language">Reply language</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="cfg-language">
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
                </div>
              )}
            />
          </div>
        </Section>

        {/* Lead capture */}
        <LeadCaptureSection control={control} register={register} errors={errors} leadFeature={leadFeature} />

        {/* Contact */}
        <Section title="Contact details" description="Shared by the bot when visitors want to reach a human.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="cfg-c-email" label="Email" error={errors.contact?.email?.message}>
              <Input id="cfg-c-email" type="email" autoComplete="email" {...register('contact.email')} />
            </FormField>
            <FormField id="cfg-c-phone" label="Phone" error={errors.contact?.phone?.message}>
              <Input id="cfg-c-phone" type="tel" autoComplete="tel" {...register('contact.phone')} />
            </FormField>
            <FormField id="cfg-c-wa" label="WhatsApp" error={errors.contact?.whatsapp?.message}>
              <Input id="cfg-c-wa" type="tel" placeholder="+91…" {...register('contact.whatsapp')} />
            </FormField>
            <FormField id="cfg-c-hours" label="Opening hours" error={errors.contact?.hours?.message}>
              <Input id="cfg-c-hours" placeholder="Mon–Sat, 9am–7pm" {...register('contact.hours')} />
            </FormField>
          </div>
          <FormField id="cfg-c-address" label="Address" error={errors.contact?.address?.message}>
            <Textarea id="cfg-c-address" rows={2} {...register('contact.address')} />
          </FormField>
        </Section>

        {/* Save bar */}
        <div className="sticky bottom-4 z-30 flex flex-col gap-3 rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-slate-200 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            {isDirty ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> You have unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" aria-hidden /> All changes saved
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {isDirty && (
              <Button variant="ghost" onClick={() => reset(chatbot.config)}>
                <RotateCcw aria-hidden /> Discard
              </Button>
            )}
            <Button type="submit" variant={onContinue ? 'outline' : 'default'} disabled={!isDirty || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save
            </Button>
            {onContinue && (
              <Button onClick={continueFlow} disabled={save.isPending}>
                {isDirty ? 'Save & preview' : 'Preview & test'} <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="min-w-0">
        <div className="lg:sticky lg:top-6">
          <LivePreview control={control} chatbot={chatbot} />
        </div>
      </aside>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function ColorField({
  value,
  onChange,
  brandColor,
  error,
  id = 'cfg-color',
}: {
  value: string;
  onChange: (v: string) => void;
  brandColor?: string | null;
  error?: string;
  id?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = HEX_RE.test(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Primary colour</Label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="color"
          aria-label="Pick a colour"
          value={valid ? value : '#4F46E5'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
        />
        <Input
          id={id}
          value={text}
          maxLength={7}
          className="w-28 font-mono uppercase"
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setText(v);
            if (HEX_RE.test(v)) onChange(v.toUpperCase());
          }}
          onBlur={() => !HEX_RE.test(text) && setText(value)}
        />
        {brandColor && brandColor !== value.toUpperCase() && (
          <Button size="sm" variant="outline" onClick={() => onChange(brandColor)}>
            <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: brandColor }} aria-hidden /> Use brand colour
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Colour presets">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Use ${c}`}
            aria-pressed={value.toUpperCase() === c}
            className={cn(
              'h-7 w-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              value.toUpperCase() === c && 'ring-2 ring-slate-900 ring-offset-2',
            )}
            style={{ background: c }}
          />
        ))}
      </div>
      {error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SuggestedQuestions({
  control,
  chatbot,
  setQuestions,
}: {
  control: Control<ChatbotConfig>;
  chatbot: Chatbot;
  setQuestions: (q: string[]) => void;
}) {
  const questions = useWatch({ control, name: 'suggestedQuestions' }) ?? [];
  const [draft, setDraft] = useState('');
  const [proposals, setProposals] = useState<string[]>([]);
  const full = questions.length >= 6;

  const add = (q: string) => {
    const v = q.trim().slice(0, 120);
    if (!v || full || questions.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setQuestions([...questions, v]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="cfg-sq-input">Suggested questions</Label>
        <span className="text-xs text-slate-500">{questions.length}/6</span>
      </div>
      {questions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {questions.map((q, i) => (
            <li key={`${q}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-700 ring-1 ring-brand-100">
              <span className="truncate">{q}</span>
              <button
                type="button"
                aria-label={`Remove “${q}”`}
                onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                className="rounded-full p-1 hover:bg-brand-100"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id="cfg-sq-input"
          value={draft}
          maxLength={120}
          disabled={full}
          placeholder={full ? 'Maximum of 6 questions' : 'e.g. Do you offer home delivery?'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
              setDraft('');
            }
          }}
        />
        <Button
          variant="outline"
          disabled={full || !draft.trim()}
          onClick={() => {
            add(draft);
            setDraft('');
          }}
        >
          <Plus aria-hidden /> Add
        </Button>
      </div>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        onClick={() => setProposals(suggestQuestionsFromSite(chatbot.siteMeta, chatbot.businessName, questions))}
        disabled={full}
      >
        <Lightbulb aria-hidden /> Suggest from my site
      </Button>
      {proposals.length > 0 && !full && (
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <p className="mb-2 text-xs text-slate-500">Based on your site's menu — click to add:</p>
          <div className="flex flex-wrap gap-2">
            {proposals
              .filter((p) => !questions.some((q) => q.toLowerCase() === p.toLowerCase()))
              .map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => add(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:border-brand-400 hover:text-brand-700"
                >
                  <Plus className="h-3 w-3" aria-hidden /> {p}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeadCaptureSection({
  control,
  register,
  errors,
  leadFeature,
}: {
  control: Control<ChatbotConfig>;
  register: UseFormRegister<ChatbotConfig>;
  errors: FieldErrors<ChatbotConfig>;
  leadFeature: boolean;
}) {
  const enabled = useWatch({ control, name: 'leadCapture.enabled' });
  const trigger = useWatch({ control, name: 'leadCapture.trigger' });
  const fields = useWatch({ control, name: 'leadCapture.fields' });
  const noContactField = fields && !fields.email && !fields.phone;
  return (
    <Section title="Lead capture" description="Collect visitor contact details inside the chat.">
      <Controller
        control={control}
        name="leadCapture.enabled"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="cfg-lead-enabled">Enable lead capture</Label>
              {!leadFeature && <p className="mt-1 text-xs text-slate-500">Not included in your plan.</p>}
            </div>
            <Switch id="cfg-lead-enabled" checked={field.value} disabled={!leadFeature} onCheckedChange={field.onChange} />
          </div>
        )}
      />
      {enabled && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <FormField id="cfg-lead-title" label="Form title" error={errors.leadCapture?.title?.message}>
            <Input id="cfg-lead-title" {...register('leadCapture.title')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="leadCapture.trigger"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-lead-trigger">When to show</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="cfg-lead-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="start">At the start of the chat</SelectItem>
                      <SelectItem value="after_messages">After a few messages</SelectItem>
                      <SelectItem value="manual">Only via “Contact us” button</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
            {trigger === 'after_messages' && (
              <FormField id="cfg-lead-after" label="After visitor messages" error={errors.leadCapture?.afterMessages?.message}>
                <Input id="cfg-lead-after" type="number" min={1} max={20} {...register('leadCapture.afterMessages', { valueAsNumber: true })} />
              </FormField>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">Fields</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['name', 'email', 'phone', 'message'] as const).map((f) => (
                <Controller
                  key={f}
                  control={control}
                  name={`leadCapture.fields.${f}`}
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm capitalize ring-1 ring-slate-100">
                      {f}
                      <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`Ask for ${f}`} />
                    </label>
                  )}
                />
              ))}
            </div>
            {noContactField && <p className="text-xs text-amber-700">Tip: ask for email or phone so you can follow up.</p>}
          </fieldset>
          <FormField id="cfg-lead-consent" label="Consent text" error={errors.leadCapture?.consentText?.message}>
            <Textarea id="cfg-lead-consent" rows={2} {...register('leadCapture.consentText')} />
          </FormField>
        </div>
      )}
    </Section>
  );
}

/** Sticky live preview: the real widget in preview mode, updated (not remounted) as the form changes. */
function LivePreview({ control, chatbot }: { control: Control<ChatbotConfig>; chatbot: Chatbot }) {
  const values = useWatch({ control }) as ChatbotConfig;
  const lastValid = useRef<ChatbotConfig>(chatbot.config);
  const parsed = useMemo(() => {
    const r = chatbotConfigSchema.safeParse(values);
    if (r.success) lastValid.current = r.data;
    else {
      // Keep the preview alive while a field is mid-edit: merge only the fields that are valid.
      const merged = { ...lastValid.current };
      for (const k of Object.keys(chatbotConfigSchema.shape) as (keyof ChatbotConfig)[]) {
        const one = chatbotConfigSchema.shape[k].safeParse((values as Record<string, unknown>)[k]);
        if (one.success) (merged as Record<string, unknown>)[k] = one.data;
      }
      lastValid.current = merged;
    }
    return lastValid.current;
  }, [values]);
  const config = useDebouncedValue(parsed, 150);

  const configRef = useRef(config);
  configRef.current = config;
  const sendPreview = useCallback(
    async (message: string, history: { role: 'user' | 'assistant'; content: string }[]) => {
      const reply = await api.post<PreviewChatReply>(`/chatbots/${encodeURIComponent(chatbot.id)}/preview/messages`, {
        message,
        history: history.slice(-20),
        config: configRef.current,
      });
      return { content: reply.message.content, sources: reply.message.sources, fallback: reply.message.fallback };
    },
    [chatbot.id],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Live preview</p>
        <Badge variant="success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Live
        </Badge>
      </div>
      <div
        className="relative h-[600px] overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 via-white to-brand-50 shadow-inner ring-1 ring-slate-200"
        data-testid="config-live-preview"
      >
        {/* faint page skeleton behind the widget */}
        <div className="pointer-events-none space-y-3 p-6 opacity-60" aria-hidden>
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-3 w-2/3 rounded bg-slate-200/70" />
          <div className="h-3 w-1/2 rounded bg-slate-200/70" />
          <div className="mt-6 h-28 rounded-xl bg-slate-200/60" />
        </div>
        <WidgetStage
          options={{ mode: 'preview', config, sendPreview, open: true, businessName: chatbot.businessName }}
          mountKey={[chatbot.id]}
        />
      </div>
      <p className="text-xs text-slate-500">Messages here use your real knowledge base and count towards usage. Unsaved changes are previewed too.</p>
    </div>
  );
}
