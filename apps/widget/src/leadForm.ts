import type { LeadCaptureConfig } from '@chatpilot/shared';
import { h, svg } from './dom';

export type LeadField = 'name' | 'email' | 'phone' | 'message';
export interface LeadValues {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  consent: boolean;
}
export type LeadErrors = Partial<Record<LeadField | 'consent', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
const PHONE_RE = /^[+()\-\s0-9]{6,40}$/;

/** Client-side validation mirroring leadInputSchema (+ "email or phone" requirement). */
export function validateLead(v: LeadValues, f: LeadCaptureConfig['fields']): LeadErrors {
  const e: LeadErrors = {};
  if (f.name && v.name && v.name.length > 120) e.name = 'Name is too long.';
  if (f.email && v.email && (v.email.length > 200 || !EMAIL_RE.test(v.email))) e.email = 'Please enter a valid email address.';
  if (f.phone && v.phone && (!PHONE_RE.test(v.phone) || v.phone.replace(/\D/g, '').length < 6))
    e.phone = 'Please enter a valid phone number (digits, spaces, + - ( ) only).';
  if ((f.email || f.phone) && !v.email && !v.phone) {
    if (f.email && f.phone) e.email = 'Please enter your email or phone number.';
    else if (f.email) e.email = 'Please enter your email address.';
    else e.phone = 'Please enter your phone number.';
  }
  if (f.message && v.message && v.message.length > 2000) e.message = 'Message is too long.';
  if (!v.consent) e.consent = 'Please confirm you agree to be contacted.';
  return e;
}

export interface LeadFormOptions {
  config: LeadCaptureConfig;
  /** Unique id prefix (ids must be unique inside the shadow root). */
  uid: string;
  preview: boolean;
  /** Resolve on success; reject with an Error (optionally `details.fieldErrors`) on failure. */
  submit(values: LeadValues): Promise<void>;
  onDone?(): void;
}

const LABELS: Record<LeadField, [string, string, string]> = {
  // label, input type, autocomplete
  name: ['Name', 'text', 'name'],
  email: ['Email', 'email', 'email'],
  phone: ['Phone', 'tel', 'tel'],
  message: ['Message', 'textarea', 'off'],
};
const ORDER: LeadField[] = ['name', 'email', 'phone', 'message'];
const MAX: Record<LeadField, number> = { name: 120, email: 200, phone: 40, message: 2000 };

/** Inline lead-capture card rendered inside the message stream. */
export function createLeadForm(o: LeadFormOptions): HTMLFormElement {
  const f = o.config.fields;
  const inputs: Partial<Record<LeadField, HTMLInputElement | HTMLTextAreaElement>> = {};
  const errEls: Partial<Record<LeadField | 'consent', HTMLElement>> = {};
  const form = h('form', { class: 'lead', novalidate: true, 'aria-label': o.config.title });
  form.append(h('p', { class: 'lead-title', text: o.config.title }));

  for (const key of ORDER) {
    if (!f[key]) continue;
    const [label, type, ac] = LABELS[key];
    const id = `${o.uid}-${key}`;
    const input =
      type === 'textarea'
        ? h('textarea', { id, name: key, rows: 3, maxlength: MAX[key] })
        : h('input', { id, name: key, type, autocomplete: ac, maxlength: MAX[key], inputmode: key === 'phone' ? 'tel' : null });
    const err = h('div', { class: 'ferr', id: `${id}-err`, 'aria-live': 'polite' });
    err.hidden = true;
    input.setAttribute('aria-describedby', err.id);
    input.addEventListener('input', () => setErr(key, ''));
    inputs[key] = input;
    errEls[key] = err;
    form.append(h('div', { class: 'field' }, h('label', { for: id, text: label }), input, err));
  }
  if (f.email && f.phone) form.append(h('p', { class: 'hint', text: 'Email or phone is required.' }));

  const consent = h('input', { type: 'checkbox', id: `${o.uid}-consent`, name: 'consent', required: true });
  const consentErr = h('div', { class: 'ferr', id: `${o.uid}-consent-err`, 'aria-live': 'polite' });
  consentErr.hidden = true;
  consent.setAttribute('aria-describedby', consentErr.id);
  consent.addEventListener('change', () => setErr('consent', ''));
  errEls.consent = consentErr;
  form.append(h('label', { class: 'consent', for: consent.id }, consent, h('span', { text: o.config.consentText })), consentErr);

  const formErr = h('div', { class: 'ferr', role: 'alert' });
  formErr.hidden = true;
  const btn = h('button', { type: 'submit', class: 'btn', text: 'Send details' });
  form.append(formErr, btn);

  function setErr(key: LeadField | 'consent', msg: string) {
    const el = errEls[key];
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
    const input = key === 'consent' ? consent : inputs[key];
    if (input) {
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function values(): LeadValues {
    const v: LeadValues = { consent: consent.checked };
    for (const key of ORDER) {
      const val = inputs[key] && inputs[key]!.value.trim();
      if (val) v[key] = val;
    }
    return v;
  }

  function done() {
    form.dataset.done = '1';
    form.setAttribute('aria-live', 'polite');
    form.replaceChildren(
      h(
        'div',
        { class: 'lead-ok', role: 'status' },
        svg('check'),
        o.preview ? 'Preview: lead not saved' : "Thanks! We'll be in touch.",
      ),
    );
    o.onDone && o.onDone();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (btn.disabled) return;
    formErr.hidden = true;
    const v = values();
    const errors = validateLead(v, f);
    (Object.keys(errEls) as (LeadField | 'consent')[]).forEach((k) => setErr(k, errors[k] || ''));
    const first = (Object.keys(errors) as (LeadField | 'consent')[])[0];
    if (first) {
      const el = first === 'consent' ? consent : inputs[first];
      el && el.focus();
      return;
    }
    if (o.preview) return done();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await o.submit(v);
      done();
    } catch (e) {
      const fe = (e as { details?: { fieldErrors?: Record<string, string[] | string> } })?.details?.fieldErrors;
      let mapped = false;
      if (fe && typeof fe === 'object') {
        for (const k of Object.keys(fe)) {
          if (k in errEls) {
            const m = fe[k];
            setErr(k as LeadField, Array.isArray(m) ? String(m[0] || 'Invalid value') : String(m));
            mapped = true;
          }
        }
      }
      if (!mapped) {
        formErr.textContent = (e as Error)?.message || "Couldn't send your details. Please try again.";
        formErr.hidden = false;
      }
      btn.disabled = false;
      btn.textContent = 'Send details';
    }
  });

  return form;
}
