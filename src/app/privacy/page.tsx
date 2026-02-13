// File: src/app/privacy/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Kalue',
  description: 'Privacy Policy for Kalue.',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Last updated: {new Date().toLocaleDateString('en-GB')}
          </p>
        </header>

        <section className="prose prose-slate max-w-none">
          <p>
            This Privacy Policy explains how Kalue (“we”, “us”, “our”) collects,
            uses, and protects your information when you use our website and
            services.
          </p>

          <h2>1. Who we are</h2>
          <p>
            Kalue is a CRM/LeadHub platform used to capture, manage, and automate
            leads and communications. If you have questions, contact us at:{' '}
            <a href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
          </p>

          <h2>2. Information we collect</h2>
          <ul>
            <li>
              <strong>Account data:</strong> email, name (if provided), and
              authentication identifiers.
            </li>
            <li>
              <strong>Lead data (provided by you or connected platforms):</strong>{' '}
              lead name, email, phone, source, status/labels, notes, and any data
              you choose to store in Kalue.
            </li>
            <li>
              <strong>Usage and technical data:</strong> logs, device
              information, and basic analytics to maintain security and improve
              the service.
            </li>
          </ul>

          <h2>3. How we use information</h2>
          <ul>
            <li>Provide, maintain, and secure the service.</li>
            <li>Operate integrations you connect (e.g., Meta Lead Ads).</li>
            <li>Send service-related communications (e.g., account/security).</li>
            <li>Comply with legal obligations.</li>
          </ul>

          <h2>4. Integrations (Meta Platforms)</h2>
          <p>
            If you connect Meta (Facebook/Instagram) Lead Ads, Kalue will access
            data you authorize (such as lead form submissions) to import and
            manage leads inside Kalue. We only process the data for the purpose
            of providing the integration and related features.
          </p>

          <h2>5. Legal basis (EEA/UK)</h2>
          <p>
            When applicable, we process personal data based on contract
            necessity, legitimate interests (security and service improvement),
            consent (where required), and legal obligations.
          </p>

          <h2>6. Data retention</h2>
          <p>
            We retain personal data only as long as necessary to provide the
            service, comply with legal requirements, and resolve disputes. You
            can request deletion of your account data, subject to legal
            retention obligations.
          </p>

          <h2>7. Sharing</h2>
          <p>
            We do not sell your personal data. We may share data with service
            providers required to operate Kalue (e.g., hosting, databases,
            email), under appropriate safeguards and contracts.
          </p>

          <h2>8. Security</h2>
          <p>
            We implement reasonable technical and organizational measures to
            protect data, including access controls and secure storage. No system
            is 100% secure, but we work to minimize risk.
          </p>

          <h2>9. Your rights</h2>
          <p>
            Depending on your location, you may have rights to access, correct,
            delete, or export your data, and to object or restrict certain
            processing. Contact us at{' '}
            <a href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
          </p>

          <h2>10. Children</h2>
          <p>
            Kalue is not intended for children and we do not knowingly collect
            data from children.
          </p>

          <h2>11. Changes</h2>
          <p>
            We may update this policy from time to time. We will post updates on
            this page with an updated “Last updated” date.
          </p>

          <hr />

          <p className="text-sm">
            Back to <Link href="/">Home</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
