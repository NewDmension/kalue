// File: src/app/privacy/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Kalue',
  description: 'Privacy Policy for Kalue.',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  const lastUpdated = new Date().toLocaleDateString('en-GB');

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-700">Last updated: {lastUpdated}</p>
        </header>

        <section className="prose prose-slate max-w-none">
          <p className="text-slate-900">
            This Privacy Policy explains how Kalue (“we”, “us”, “our”) collects, uses, and protects information when you use
            our website and services.
          </p>

          <h2 className="text-slate-900">1. Who we are</h2>
          <p className="text-slate-900">
            Kalue is a SaaS CRM/LeadHub platform used to capture, manage, and automate leads and communications.
            If you have questions, contact us at <a href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
          </p>

          <h2 className="text-slate-900">2. Roles (Customers and Kalue)</h2>
          <p className="text-slate-900">
            Kalue is designed as a multi-tenant SaaS. Each customer uses Kalue through an isolated workspace.
            In many cases, the customer (business using Kalue) acts as the <strong>data controller</strong> for lead data,
            and Kalue acts as a <strong>data processor</strong> (or “service provider”) processing data only to provide the service.
          </p>

          <h2 className="text-slate-900">3. Information we collect</h2>
          <ul className="text-slate-900">
            <li>
              <strong>Account data:</strong> email, name (if provided), workspace membership/roles, and authentication identifiers.
            </li>
            <li>
              <strong>Lead data (provided by you or connected platforms):</strong> lead name, email, phone, source, status/labels,
              notes, and any data you choose to store in Kalue.
            </li>
            <li>
              <strong>Integration data:</strong> identifiers such as Page IDs, Form IDs, webhook subscription status, and related metadata.
            </li>
            <li>
              <strong>Usage and technical data:</strong> logs and basic analytics used for security, troubleshooting, and service improvement.
            </li>
          </ul>

          <h2 className="text-slate-900">4. How we use information</h2>
          <ul className="text-slate-900">
            <li>Provide, maintain, and secure the service.</li>
            <li>Operate integrations you connect (e.g., Meta Lead Ads).</li>
            <li>Store and organize leads inside your workspace (pipeline, labels, notes, tasks/automation).</li>
            <li>Send service-related communications (e.g., account and security notices).</li>
            <li>Comply with legal obligations.</li>
          </ul>

          <h2 className="text-slate-900">5. Meta Platforms (Facebook/Instagram) integrations</h2>
          <p className="text-slate-900">
            If you connect Meta (Facebook/Instagram) Lead Ads, Kalue will access data you authorize (such as lead form submissions)
            to import and manage leads inside Kalue. We only process the data for the purpose of providing the integration and related
            CRM features for the customer workspace.
          </p>

          <h3 className="text-slate-900">OAuth tokens</h3>
          <p className="text-slate-900">
            We store access tokens securely. Tokens are stored <strong>encrypted at rest</strong> and are used only to operate the
            integration features you enable.
          </p>

          <h2 className="text-slate-900">6. Legal basis (EEA/UK)</h2>
          <p className="text-slate-900">
            When applicable, we process personal data based on contract necessity (to provide the service), legitimate interests
            (security, fraud prevention, and service improvement), consent (where required), and legal obligations.
          </p>

          <h2 className="text-slate-900">7. Data retention</h2>
          <p className="text-slate-900">
            We retain personal data only as long as necessary to provide the service, comply with legal requirements, and resolve disputes.
            Customers can delete leads and data from within the product. Account deletion requests are handled as described in our{' '}
            <Link href="/data-deletion">Data Deletion</Link> page. Unless legally required otherwise, we aim to complete deletion within
            a reasonable time (typically up to 30 days).
          </p>

          <h2 className="text-slate-900">8. Sharing</h2>
          <p className="text-slate-900">
            We do not sell personal data. We may share data with vendors required to operate Kalue (e.g., hosting, databases, email),
            under appropriate safeguards and contracts, and only to provide the service.
          </p>

          <h2 className="text-slate-900">9. Security</h2>
          <p className="text-slate-900">
            We implement reasonable technical and organizational measures to protect data, including authentication, access control,
            workspace isolation, and encrypted storage for sensitive integration credentials. No system is 100% secure, but we work to
            minimize risk.
          </p>

          <h2 className="text-slate-900">10. Your rights</h2>
          <p className="text-slate-900">
            Depending on your location, you may have rights to access, correct, delete, or export your data, and to object or restrict
            certain processing. Contact us at <a href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
          </p>

          <h2 className="text-slate-900">11. Children</h2>
          <p className="text-slate-900">
            Kalue is not intended for children and we do not knowingly collect data from children.
          </p>

          <h2 className="text-slate-900">12. Changes</h2>
          <p className="text-slate-900">
            We may update this policy from time to time. We will post updates on this page with an updated “Last updated” date.
          </p>

          <hr />

          <p className="text-sm text-slate-900">
            Back to <Link href="/">Home</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
