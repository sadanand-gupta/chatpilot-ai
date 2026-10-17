import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { appConfig } from '@/lib/config';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { SimplePageLayout } from './MarketingLayout';

const LAST_UPDATED = 'October 2026';

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <SimplePageLayout>
      <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p>
            <strong>Template — have it reviewed by a lawyer before launch.</strong> This document is a starting point and is not legal advice. Adapt
            it to your company, jurisdiction and the sub-processors you actually use.
          </p>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-slate-700 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
          {children}
        </div>
      </article>
    </SimplePageLayout>
  );
}

function ContactLine() {
  return appConfig.contactEmail ? (
    <a className="font-medium text-brand-600 hover:underline" href={`mailto:${appConfig.contactEmail}`}>
      {appConfig.contactEmail}
    </a>
  ) : (
    <Link className="font-medium text-brand-600 hover:underline" to="/contact">
      our contact page
    </Link>
  );
}

export function PrivacyPage() {
  const name = appConfig.productName;
  return (
    <LegalShell title="Privacy Policy">
      <section>
        <p>
          This policy explains what information {name} (“we”, “us”) collects when you use our website and service, how we use it, and the choices
          you have. {name} lets businesses (“customers”) create AI chatbots trained on their website content and embed them on their sites, where
          the chatbot talks to the customer’s website visitors (“visitors”).
        </p>
      </section>
      <section>
        <h2>1. Information we process</h2>
        <ul>
          <li>
            <strong>Account information</strong> — your email address, display name and business name, and authentication data handled by our
            identity provider.
          </li>
          <li>
            <strong>Website content</strong> — the publicly accessible pages of the website you ask us to crawl, plus any FAQs or text you add
            manually. We store this text to power your chatbot’s answers.
          </li>
          <li>
            <strong>Visitor chat messages</strong> — messages visitors send to your chatbot and the replies generated, together with the page URL,
            an anonymous random visitor identifier and timestamps.
          </li>
          <li>
            <strong>Leads</strong> — contact details visitors choose to submit through the lead form (such as name, email, phone and message) and
            their consent.
          </li>
          <li>
            <strong>Usage and technical data</strong> — counts of messages, crawls and other usage for plan limits, and standard server logs (IP
            address, user agent) used for security and rate limiting.
          </li>
        </ul>
      </section>
      <section>
        <h2>2. How we use information</h2>
        <ul>
          <li>To provide the service: crawling your site, building knowledge, generating chatbot answers and showing you conversations and leads.</li>
          <li>To enforce plan limits, prevent abuse and keep the service secure.</li>
          <li>To communicate with you about your account, including service and security notices.</li>
        </ul>
        <p className="mt-3">We do not sell personal information, and we do not use your website content or visitor conversations to train general-purpose AI models.</p>
      </section>
      <section>
        <h2>3. AI processing and sub-processors</h2>
        <p>
          To generate answers, relevant excerpts of your website knowledge and the visitor’s message are sent to our AI model provider. We also use
          cloud hosting and database providers to run the service. [List your actual sub-processors here, e.g. hosting, database, AI provider,
          email delivery.]
        </p>
      </section>
      <section>
        <h2>4. Roles</h2>
        <p>
          For visitor chat messages and leads, the customer who installed the chatbot is the controller and {name} acts as a processor on their
          behalf. Customers are responsible for informing their visitors, for example in their own privacy policy.
        </p>
      </section>
      <section>
        <h2>5. Retention</h2>
        <ul>
          <li>Conversations are kept for the retention period of the customer’s plan, then deleted.</li>
          <li>Website knowledge is kept until the customer deletes it, recrawls (replacing it) or deletes the chatbot.</li>
          <li>Leads are kept until the customer deletes them or their account.</li>
          <li>Account data is kept while your account is active and deleted when you delete your account, except where we must keep records by law.</li>
        </ul>
      </section>
      <section>
        <h2>6. Deletion and your rights</h2>
        <p>
          Customers can delete individual conversations, leads, chatbots, or their entire account (with all associated data) from the dashboard at
          any time. Depending on where you live, you may have rights to access, correct, export or delete your personal data, and to object to
          certain processing. Visitors should contact the business whose website they used; we will assist that business. You can also contact us
          at <ContactLine />.
        </p>
      </section>
      <section>
        <h2>7. Security</h2>
        <p>
          We use encryption in transit, access controls and tenant isolation to protect data. No method of transmission or storage is completely
          secure, but we work to protect your information and will notify affected customers of incidents as required by law.
        </p>
      </section>
      <section>
        <h2>8. Changes</h2>
        <p>We may update this policy. We’ll post the new version here and, for material changes, notify account holders by email.</p>
      </section>
    </LegalShell>
  );
}

export function TermsPage() {
  const name = appConfig.productName;
  return (
    <LegalShell title="Terms of Service">
      <section>
        <p>
          These terms govern your use of {name}. By creating an account or using the service you agree to them. If you use {name} on behalf of a
          business, you confirm you are authorised to accept these terms for it.
        </p>
      </section>
      <section>
        <h2>1. The service</h2>
        <p>
          {name} crawls website content you point it to, builds a knowledge base, and provides an AI chatbot you can embed on your website or share
          via a hosted link. Features and limits depend on your plan.
        </p>
      </section>
      <section>
        <h2>2. Your responsibilities</h2>
        <ul>
          <li>Only crawl websites you own or are authorised to use, and respect their terms and robots rules.</li>
          <li>Make sure your use of the chatbot and lead capture complies with applicable laws, including privacy and consumer-protection laws.</li>
          <li>Tell your visitors that they are chatting with an AI assistant and how their data is handled.</li>
          <li>Keep your account credentials secure; you are responsible for activity under your account.</li>
          <li>Don’t use the service for unlawful, harmful, deceptive or abusive purposes, or to attempt to disrupt or reverse-engineer it.</li>
        </ul>
      </section>
      <section>
        <h2>3. AI-generated answers</h2>
        <p>
          Answers are generated automatically from the knowledge saved for your chatbot and may be incomplete or inaccurate. You are responsible
          for reviewing your chatbot’s knowledge and configuration. Don’t rely on the chatbot for legal, medical, financial or other professional
          advice.
        </p>
      </section>
      <section>
        <h2>4. Your content</h2>
        <p>
          You keep all rights to your content, including crawled website text, knowledge you add, and conversations and leads. You grant us a
          limited licence to process it solely to provide the service. See the <Link className="font-medium text-brand-600 hover:underline" to="/privacy">Privacy Policy</Link>.
        </p>
      </section>
      <section>
        <h2>5. Plans, limits and payment</h2>
        <p>
          Plans include monthly usage limits. When a limit is reached, the related feature pauses until the next period or until you upgrade.
          Prices are shown on our pricing page. [Add your billing, renewal, refund and tax terms here before enabling paid plans.]
        </p>
      </section>
      <section>
        <h2>6. Termination</h2>
        <p>
          You can delete your account at any time from Settings, which permanently deletes your data. We may suspend or terminate accounts that
          violate these terms or create risk for the service or others.
        </p>
      </section>
      <section>
        <h2>7. Disclaimers and liability</h2>
        <p>
          The service is provided “as is” without warranties of any kind to the extent permitted by law. To the maximum extent permitted by law,
          our total liability for any claim relating to the service is limited to the amount you paid us in the 12 months before the claim.
          [Adapt to your jurisdiction.]
        </p>
      </section>
      <section>
        <h2>8. Changes and contact</h2>
        <p>
          We may update these terms; we’ll notify account holders of material changes. Questions? Reach us at <ContactLine />. [Add governing law
          and company details.]
        </p>
      </section>
    </LegalShell>
  );
}
