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
  form_answers?: FormAnswers | null;
};

type LeadGetResponse = { ok: true; lead: Lead } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFormAnswers(v: unknown): v is FormAnswers {
  if (!isRecord(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val === 'string') continue;
    if (Array.isArray(val) && val.every((x) => typeof x === 'string')) continue;
    return false;
  }
  return true;
}

async function getAccessToken(): Promise<string | null> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function asText(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v;
}

function normKey(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s;
}

function prettifyLabel(rawKey: string): string {
  const s = rawKey
    .trim()
    .replace(/[¿?¡!]/g, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return 'Campo';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type DerivedLeadFields = { profession: string | null; biggest_pain: string | null };

function deriveFieldsFromAnswers(lead: Lead): DerivedLeadFields {
  const fromCols: DerivedLeadFields = {
    profession: (lead.profession ?? '').trim() ? (lead.profession ?? '').trim() : null,
    biggest_pain: (lead.biggest_pain ?? '').trim() ? (lead.biggest_pain ?? '').trim() : null,
  };

  if (fromCols.profession && fromCols.biggest_pain) return fromCols;

  const answers = isFormAnswers(lead.form_answers) ? lead.form_answers : null;
  if (!answers) return fromCols;

  const entries = Object.entries(answers);

  function pickValueByKeys(keys: string[]): string | null {
    const keySet = new Set(keys.map(normKey));
    for (const [k, v] of entries) {
      if (keySet.has(normKey(k))) {
        const txt = asText(v).trim();
        if (txt) return txt;
      }
    }
    return null;
  }

  const inferredProfession =
    fromCols.profession ??
    pickValueByKeys(['profession', 'profesion', 'ocupacion', 'ocupación', 'a_que_te_dedicas', '¿a_qué_te_dedicas?']);

  const inferredPain =
    fromCols.biggest_pain ??
    pickValueByKeys([
      'biggest_pain',
      'pain',
      'que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta',
      '¿qué_es_lo_que_más_te_cuesta_ahora_mismo_en_tu_consulta?',
    ]);

  return {
    profession: inferredProfession ?? null,
    biggest_pain: inferredPain ?? null,
  };
}

function shouldHideAnswerKey(rawKey: string): boolean {
  const k = normKey(rawKey);
  const hidden = new Set<string>([
    'email',
    'full_name',
    'phone_number',
    'phone',
    'profession',
    'profesion',
    'ocupacion',
    'a_que_te_dedicas',
    'biggest_pain',
    'pain',
    'que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta',
  ]);
  return hidden.has(k);
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

    const workspaceId = (getActiveWorkspaceId() ?? '').trim();
    if (!workspaceId) return;

    await fetch('/api/lead-notifications/mark-read-by-lead', {
      method: 'POST',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-workspace-id': workspaceId,
      },
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

  const derived = deriveFieldsFromAnswers(lead);

  const answersRaw = isFormAnswers(lead.form_answers) ? lead.form_answers : null;
  const answerEntries = answersRaw
    ? Object.entries(answersRaw)
        .filter(([k, v]) => {
          if (shouldHideAnswerKey(k)) return false;
          const txt = asText(v).trim();
          return txt.length > 0;
        })
        .map(([k, v]) => ({ key: k, label: prettifyLabel(k), value: asText(v) }))
    : [];

  const labels = Array.isArray(lead.labels) ? lead.labels : [];

  return (
    <div className="container-default py-8 text-white">
      {/* Header */}
      <div className="card-glass border border-white/10 rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
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

      {/* ✅ UNA sola card: datos + respuestas + notas (sin duplicar) */}
      <div className="mt-6 card-glass border border-white/10 rounded-2xl p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <p className="mt-1 text-sm text-white/85">{derived.profession ?? '—'}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/60">Pain</p>
            <p className="mt-1 text-sm text-white/85">{derived.biggest_pain ?? '—'}</p>
          </div>
        </div>

        {answerEntries.length > 0 ? (
          <div className="mt-6">
            <p className="text-xs text-white/60">Respuestas del formulario</p>

            <div className="mt-3 space-y-3">
              {answerEntries.map((it) => (
                <div key={`${lead.id}-${it.key}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-white/60">{it.label}</p>
                  <p className="mt-1 text-sm text-white/85 whitespace-pre-wrap">{it.value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {lead.notes ? (
          <div className="mt-6">
            <p className="text-xs text-white/60">Notas</p>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-white/85 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          </div>
        ) : null}

        {labels.length > 0 ? (
          <div className="mt-6">
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
  );
}
