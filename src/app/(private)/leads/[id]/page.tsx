'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

type FormAnswers = Record<string, string | string[]>;

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
  // 👇 IMPORTANTE: puede venir con shapes distintos
  form_answers?: unknown;
};

type LeadGetResponse = { ok: true; lead: Lead } | { ok: false; error: string };

/* =======================
FormAnswers normalizer (robusto, sin any)
======================= */

type MetaFieldDataItem = {
  name: string;
  values: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isMetaFieldDataArray(v: unknown): v is MetaFieldDataItem[] {
  return (
    Array.isArray(v) &&
    v.every(
      (it) =>
        isRecord(it) &&
        typeof it.name === 'string' &&
        Array.isArray(it.values) &&
        it.values.every((x) => typeof x === 'string')
    )
  );
}

function normalizeFormAnswers(raw: unknown): FormAnswers | null {
  // 1) string JSON
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try {
      const parsed: unknown = JSON.parse(s);
      return normalizeFormAnswers(parsed);
    } catch {
      return null;
    }
  }

  // 2) Meta field_data array
  if (isMetaFieldDataArray(raw)) {
    const out: FormAnswers = {};
    for (const it of raw) {
      out[it.name] = it.values.length <= 1 ? (it.values[0] ?? '') : it.values;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  // 3) record plain
  if (isRecord(raw)) {
    const out: FormAnswers = {};

    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        out[k] = v;
        continue;
      }

      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        out[k] = v;
        continue;
      }

      // 4) record with { values: string[] }
      if (isRecord(v) && Array.isArray(v.values) && v.values.every((x) => typeof x === 'string')) {
        const vals = v.values as string[];
        out[k] = vals.length <= 1 ? (vals[0] ?? '') : vals;
        continue;
      }
    }

    return Object.keys(out).length > 0 ? out : null;
  }

  return null;
}

async function getAccessToken(): Promise<string | null> {
  const supabase = supabaseBrowser();
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
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
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

      const workspaceId = (getActiveWorkspaceId() ?? '').trim();
      if (!workspaceId) {
        if (!alive) return;
        setError('No hay workspace activo.');
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/marketing/leads/${encodeURIComponent(leadId)}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          'x-workspace-id': workspaceId,
        },
      });

      const json = (await res.json()) as LeadGetResponse;

      if (!alive) return;

      if (!res.ok || !json || !('ok' in json) || json.ok !== true) {
        const msg =
          isRecord(json) && typeof (json as { error?: unknown }).error === 'string'
            ? (json as { error: string }).error
            : `HTTP ${res.status}`;
        setError(msg);
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
    return <div className="container-default py-8 text-white/70">Cargando lead…</div>;
  }

  if (error || !lead) {
    return (
      <div className="container-default py-8">
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
      </div>
    );
  }

  const labels = Array.isArray(lead.labels) ? lead.labels : [];
  const answers = normalizeFormAnswers(lead.form_answers);
  const answerEntries = answers ? Object.entries(answers) : [];

  return (
    <div className="container-default py-8 text-white">
      {/* Header */}
      <div className="card-glass border border-white/10 rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold truncate">{lead.full_name ?? 'Sin nombre'}</h1>
              <span className="shrink-0 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">
                {lead.source}
              </span>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                Status: {lead.status}
              </span>
            </div>

            <p className="mt-1 text-sm text-white/60">{new Date(lead.created_at).toLocaleString()}</p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={backHref}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              ← Volver
            </Link>

            <button
              type="button"
              onClick={() => router.refresh()}
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
            >
              Refrescar
            </button>
          </div>
        </div>
      </div>

      {/* Body layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card-glass border border-white/10 rounded-2xl p-6">
            <p className="text-xs text-white/60">Contacto</p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">Teléfono</p>
                <p className="mt-1 text-sm text-white/85">{lead.phone ?? '—'}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">Email</p>
                <p className="mt-1 text-sm text-white/85 break-words">{lead.email ?? '—'}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">Profesión</p>
                <p className="mt-1 text-sm text-white/85">{lead.profession ?? '—'}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">Pain</p>
                <p className="mt-1 text-sm text-white/85">{lead.biggest_pain ?? '—'}</p>
              </div>
            </div>
          </div>

          {/* Respuestas */}
          {answerEntries.length > 0 ? (
            <div className="card-glass border border-white/10 rounded-2xl p-6">
              <p className="text-xs text-white/60">Respuestas del formulario</p>
              <div className="mt-3 space-y-3">
                {answerEntries.map(([k, v]) => (
                  <div key={`${lead.id}-${k}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs text-white/60">{k}</p>
                    <p className="mt-1 text-sm text-white/85 whitespace-pre-wrap">
                      {Array.isArray(v) ? v.join(', ') : v}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Notas */}
          {lead.notes ? (
            <div className="card-glass border border-white/10 rounded-2xl p-6">
              <p className="text-xs text-white/60">Notas</p>
              <p className="mt-3 text-sm text-white/85 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          ) : null}
        </div>

        {/* Right */}
        <div className="space-y-6">
          <div className="card-glass border border-white/10 rounded-2xl p-6">
            <p className="text-xs text-white/60">Acciones</p>
            <p className="mt-2 text-sm text-white/70">
              Aquí añadiremos más funciones (p.ej. cambiar status, asignar owner, tareas, WhatsApp, email, pipeline, etc.).
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/40 cursor-not-allowed"
                title="Próximamente"
              >
                Crear tarea (próximamente)
              </button>

              <button
                type="button"
                disabled
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/40 cursor-not-allowed"
                title="Próximamente"
              >
                Enviar WhatsApp (próximamente)
              </button>

              <button
                type="button"
                disabled
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/40 cursor-not-allowed"
                title="Próximamente"
              >
                Cambiar status (próximamente)
              </button>
            </div>
          </div>

          {/* Etiquetas */}
          {labels.length > 0 ? (
            <div className="card-glass border border-white/10 rounded-2xl p-6">
              <p className="text-xs text-white/60">Etiquetas</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {labels.map((lab) => (
                  <span
                    key={`${lead.id}-${lab}`}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75"
                  >
                    {lab}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
