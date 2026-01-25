'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Lead = {
  id: string;
  created_at: string;
  source: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  profession: string | null;
  biggest_pain: string | null;
  status: string;
  labels?: string[] | null;
  notes?: string | null;
};

type LeadGetResponse = { ok: true; lead: Lead } | { ok: false; error: string };

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params?.id ?? '';

  const router = useRouter();
  const searchParams = useSearchParams();

  const page = useMemo(() => {
    const raw = searchParams.get('page');
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [searchParams]);

  const backHref = useMemo(() => `/leads?page=${page}`, [page]);

  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string>('');

  // 1) Load lead
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!leadId) return;

      setLoading(true);
      setError('');

      const token = await getAccessToken();
      if (!token) {
        if (!alive) return;
        setError('No hay sesión activa.');
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/admin/leadhub/leads/${leadId}/get`, {
        method: 'GET',
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` },
      });

      const json = (await res.json()) as LeadGetResponse;

      if (!alive) return;

      if (!res.ok || !json.ok) {
        setError(json.ok ? '' : json.error);
        setLead(null);
        setLoading(false);
        return;
      }

      setLead(json.lead);
      setLoading(false);
    }

    void run();
    return () => {
      alive = false;
    };
  }, [leadId]);

  // 2) Mark read when entering detail (idempotente)
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!leadId) return;

      const token = await getAccessToken();
      if (!token) return;

      // Si tu endpoint mark-read-by-lead es idempotente, perfecto.
      await fetch('/api/admin/leadhub/lead-notifications/mark-read-by-lead', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ lead_id: leadId }),
      });

      if (!alive) return;
    }

    void run();
    return () => {
      alive = false;
    };
  }, [leadId]);

  if (loading) {
    return <div className="text-white/70">Cargando lead…</div>;
  }

  if (error || !lead) {
    return (
      <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Lead</h1>
          <Link
            href={backHref}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            ← Volver
          </Link>
        </div>

        <p className="mt-3 text-sm text-red-200">No se pudo cargar el lead. {error ? `(${error})` : ''}</p>

        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const labels = Array.isArray(lead.labels) ? lead.labels : [];

  return (
    <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">{lead.full_name ?? 'Sin nombre'}</h1>
          <p className="mt-1 text-sm text-white/60">
            {new Date(lead.created_at).toLocaleString()} · <span className="text-white/75">{lead.source}</span>
          </p>
        </div>

        <Link
          href={backHref}
          className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          ← Volver
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/60">Contacto</p>
          <div className="mt-2 space-y-1 text-sm text-white/85">
            <p>
              <span className="text-white/60">Tel:</span> {lead.phone ?? '—'}
            </p>
            <p>
              <span className="text-white/60">Email:</span> {lead.email ?? '—'}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/60">Profesional</p>
          <div className="mt-2 space-y-1 text-sm text-white/85">
            <p>
              <span className="text-white/60">Profesión:</span> {lead.profession ?? '—'}
            </p>
            <p>
              <span className="text-white/60">Status:</span> {lead.status}
            </p>
          </div>
        </div>

        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/60">Pain</p>
          <p className="mt-2 text-sm text-white/85">{lead.biggest_pain ?? '—'}</p>
        </div>

        {labels.length > 0 ? (
          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/60">Etiquetas</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {labels.map((lab) => (
                <span key={lab} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                  {lab}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {lead.notes ? (
          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/60">Notas</p>
            <p className="mt-2 text-sm text-white/85 whitespace-pre-wrap">{lead.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
