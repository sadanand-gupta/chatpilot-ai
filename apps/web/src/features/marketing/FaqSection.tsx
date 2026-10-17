import { ChevronDown } from 'lucide-react';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Where do the chatbot’s answers come from?',
    a: 'From the knowledge saved for your chatbot: the pages we crawl from your website plus any FAQs or notes you add yourself. The assistant is instructed to answer only from that knowledge and to show the pages it used. When it can’t find an answer it replies with your fallback message instead of guessing.',
  },
  {
    q: 'What happens when I update my website?',
    a: 'The chatbot doesn’t watch your site live. When your content changes, start a recrawl from the Knowledge tab (or edit the knowledge directly). The new content is used as soon as the crawl finishes.',
  },
  {
    q: 'Will it work with my website?',
    a: 'It works with most public websites. Sites that render their content entirely with JavaScript, sit behind a login, or block automated access may return little or no text. In that case the crawl report tells you what was skipped, and you can paste content or add FAQs manually.',
  },
  {
    q: 'How do I install it?',
    a: 'Publish your chatbot and paste one script tag before the closing </body> tag of your site — it works with WordPress, Shopify, Webflow, Wix and hand-written HTML. You can also share a hosted chat page link without installing anything.',
  },
  {
    q: 'Can it capture leads?',
    a: 'Yes. You can turn on a lead form that asks for name, email, phone and/or a message, with a consent checkbox. Leads appear in your dashboard and can be exported to CSV on plans that include it.',
  },
  {
    q: 'What data do you store, and can I delete it?',
    a: 'We store your account email, the website content we crawl for your chatbot, visitor chat messages and any leads visitors submit. Conversations are kept for your plan’s retention period. You can delete individual conversations, leads, chatbots, or your entire account at any time from the dashboard.',
  },
  {
    q: 'Which languages are supported?',
    a: 'The assistant can reply in the visitor’s language automatically or in a fixed language you choose, including English, Hindi, Spanish, French, German, Portuguese, Arabic and several Indian languages. Answer quality depends on the language of your website content.',
  },
  {
    q: 'Is there a free plan?',
    a: 'Yes — the free trial plan lets you build, preview and publish a chatbot for one website with monthly limits shown in the pricing table above. No credit card is required.',
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">FAQ</p>
          <h2 id="faq-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Questions, answered honestly
          </h2>
        </div>
        <div className="mt-12 divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 sm:px-6 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-md">
                {f.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="-mt-1 pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
