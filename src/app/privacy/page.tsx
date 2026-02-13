// File: src/app/privacy/page.tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Kalue',
  description: 'Privacy Policy for Kalue.',
  robots: { index: true, follow: true },
};

export const dynamic = 'force-dynamic';

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-sm font-semibold text-white/90">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const lastUpdated = new Date().toLocaleDateString('en-GB');

  return (
    <main className="min-h-screen w-full text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#070a14] to-black" />
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-[420px] w-[420px] rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      <header className="mx-auto w-full max-w-6xl px-4 pt-6">
        <div className="card-glass flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <Image src="/logo.png" alt="Kalue" fill className="object-contain p-1.5" priority />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">Kalue</p>
              <p className="text-xs text-white/60">Privacy Policy</p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/data-deletion"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Data Deletion
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10">
        <div className="card-glass rounded-2xl border border-white/10 p-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Privacy Policy</h1>
          <p className="mt-2 text-xs text-white/55">Last updated: {lastUpdated}</p>

          <div className="mt-6 grid gap-4">
            <Item title="1. Who we are">
              Kalue (“we”, “us”, “our”) is a SaaS CRM/LeadHub platform used to capture, manage, and automate leads and communications.
              <br />
              Contact: <a className="text-indigo-200 hover:underline" href="mailto:privacy@kalue.app">privacy@kalue.app</a>
            </Item>

            <Item title="2. Information we collect">
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <span className="font-semibold text-white/85">Account data:</span> email, name (if provided), authentication identifiers.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Workspace & app data:</span> workspace membership, roles, configuration
                  relevant to providing the service.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Lead data:</span> lead name, email, phone, source, status/labels, notes,
                  and any data you choose to store in Kalue.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Usage & technical data:</span> logs and basic diagnostics for security and
                  reliability.
                </li>
              </ul>
            </Item>

            <Item title="3. How we use information">
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Provide, maintain, and secure the service.</li>
                <li>Operate integrations you connect (e.g., Meta Lead Ads).</li>
                <li>Send service-related communications (account/security notices).</li>
                <li>Comply with legal obligations.</li>
              </ul>
            </Item>

            <Item title="4. Integrations (Meta Platforms)">
              If you connect Meta (Facebook/Instagram) Lead Ads, Kalue will access data you authorize (such as lead form submissions) to
              import and manage leads inside Kalue. We process this data solely to provide the integration and related CRM features.
            </Item>

            <Item title="5. Legal basis (EEA/UK)">
              When applicable, we process personal data based on contract necessity, legitimate interests (security and service
              improvement), consent (where required), and legal obligations.
            </Item>

            <Item title="6. Data retention">
              We retain personal data only as long as necessary to provide the service, comply with legal requirements, and resolve
              disputes. You can request deletion of your account data, subject to legal retention obligations.
            </Item>

            <Item title="7. Sharing">
              We do not sell your personal data. We may share data with service providers required to operate Kalue (hosting, databases,
              email) under appropriate safeguards and contracts.
            </Item>

            <Item title="8. Security">
              We implement reasonable technical and organizational measures to protect data, including access controls and secure
              storage. No system is 100% secure, but we work to minimize risk.
            </Item>

            <Item title="9. Your rights">
              Depending on your location, you may have rights to access, correct, delete, or export your data, and to object or restrict
              certain processing. Contact us at{' '}
              <a className="text-indigo-200 hover:underline" href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
            </Item>

            <Item title="10. Children">
              Kalue is not intended for children and we do not knowingly collect data from children.
            </Item>

            <Item title="11. Changes">
              We may update this policy from time to time. We will post updates on this page with an updated “Last updated” date.
            </Item>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/60">
              Back to{' '}
              <Link href="/" className="text-indigo-200 hover:underline">
                Home
              </Link>
            </p>
            <p className="text-xs text-white/45">
              Also see{' '}
              <Link href="/data-deletion" className="text-indigo-200 hover:underline">
                Data Deletion
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
