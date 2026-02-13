// File: src/app/data-deletion/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Deletion | Kalue',
  description: 'How to delete your data and account in Kalue.',
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  const lastUpdated = new Date().toLocaleDateString('en-GB');

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Data Deletion Instructions</h1>
          <p className="mt-2 text-sm text-slate-700">Last updated: {lastUpdated}</p>
        </header>

        <section className="prose prose-slate max-w-none">
          <p className="text-slate-900">
            This page explains how to request deletion of your Kalue account and related data, including data processed through
            connected integrations (e.g., Meta Lead Ads).
          </p>

          <h2 className="text-slate-900">1. Delete your account from within Kalue</h2>
          <p className="text-slate-900">
            If you have access to your account, you can delete it from inside the product:
          </p>
          <ol className="text-slate-900">
            <li>Sign in to Kalue.</li>
            <li>Go to <strong>Settings</strong> → <strong>Account</strong>.</li>
            <li>Click <strong>Delete account</strong> and confirm.</li>
          </ol>

          <h2 className="text-slate-900">2. Request deletion by email</h2>
          <p className="text-slate-900">
            If you cannot access your account, email us at <a href="mailto:privacy@kalue.app">privacy@kalue.app</a> with:
          </p>
          <ul className="text-slate-900">
            <li>Your account email address</li>
            <li>The workspace name (if known)</li>
            <li>A clear request: “Please delete my Kalue account and associated data.”</li>
          </ul>

          <h2 className="text-slate-900">3. What gets deleted</h2>
          <p className="text-slate-900">
            Depending on the request and your role, deletion may include:
          </p>
          <ul className="text-slate-900">
            <li>User account data (authentication identifiers and profile basics)</li>
            <li>Workspace membership records</li>
            <li>Stored leads and CRM data inside the workspace (subject to customer instructions and legal requirements)</li>
            <li>Integration configuration (Page/Form mappings)</li>
            <li>Stored OAuth tokens (encrypted) and webhook subscription records</li>
          </ul>

          <h2 className="text-slate-900">4. Timeframe</h2>
          <p className="text-slate-900">
            Unless a longer retention period is legally required, we aim to complete deletion within a reasonable timeframe
            (typically up to <strong>30 days</strong>).
          </p>

          <h2 className="text-slate-900">5. Customer-controlled data</h2>
          <p className="text-slate-900">
            Kalue is a multi-tenant SaaS. In many cases, the business customer that owns a workspace acts as the data controller
            for lead data. If you submitted your information to a business via a Meta Lead Ad, you may also contact that business
            directly to exercise your rights regarding your lead data.
          </p>

          <hr />

          <p className="text-sm text-slate-900">
            Read our <Link href="/privacy">Privacy Policy</Link> or go back to <Link href="/">Home</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
