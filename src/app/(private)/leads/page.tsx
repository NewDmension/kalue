'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

import { LEAD_LABELS, type LeadLabel, isLeadLabel, normalizeLabel, type LeadStatus } from '@/lib/leadhub/leadConstants';

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

type LeadsListResponse = { ok: true; leads: Lead[] } | { ok: false; error: string };

type LeadNotificationItem = {
  id: string;
  created_at: string;
  lead_id: string;
  kind: string;
  title: string | null;
  message: string | null;
};

type LeadNotificationsResponse =
  | { ok: true; unreadCount: number; items: LeadNotificationItem[] }
  | { ok: false; error: string };

type FilterMode = 'all' | 'unread' | 'read';
type SortMode = 'recent' | 'oldest' | 'az' | 'za';
type StatusFilter = 'all' | LeadStatus;

type MetaImportResponse = { ok: true; imported: number; skipped?: number } | { ok: false; error: string };

/** ✅ mismo shape que usa tu ficha */
type LeadGetResponse = { ok: true; lead: Lead } | { ok: false; error: string };

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function getAccessToken(): Promise<string | null> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

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

function safeAnswers(lead: Lead): FormAnswers | null {
  const v = lead.form_answers;
  return isFormAnswers(v) ? v : null;
}

/** Normaliza claves (quita acentos/puntuación) para poder mapear preguntas tipo "¿a_qué_te_dedicas?" */
function normKey(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacríticos
    .replace(/[¿?¡!]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s;
}

function asText(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v;
}

function prettifyLabel(rawKey: string): string {
  const s = rawKey
    .trim()
    .replace(/[¿?¡!]/g, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return 'Campo';

  // Capitaliza primera letra, respeta el resto
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type DerivedLeadFields = { profession: string | null; biggest_pain: string | null };

/**
 * 1) Si columnas profession/biggest_pain vienen, se usan.
 * 2) Si no, se intentan inferir desde form_answers con varias keys posibles.
 */
function deriveFieldsFromAnswers(lead: Lead): DerivedLeadFields {
  const fromCols: DerivedLeadFields = {
    profession: (lead.profession ?? '').trim() ? (lead.profession ?? '').trim() : null,
    biggest_pain: (lead.biggest_pain ?? '').trim() ? (lead.biggest_pain ?? '').trim() : null,
  };

  if (fromCols.profession && fromCols.biggest_pain) return fromCols;

  const answers = safeAnswers(lead);
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
    pickValueByKeys([
      'profession',
      'profesion',
      'ocupacion',
      'ocupación',
      'a_que_te_dedicas',
      '¿a_qué_te_dedicas?',
      'a_qué_te_dedicas',
    ]);

  const inferredPain =
    fromCols.biggest_pain ??
    pickValueByKeys([
      'biggest_pain',
      'pain',
      'dolor',
      'problema',
      'que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta',
      '¿que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta?',
      'qué_es_lo_que_más_te_cuesta_ahora_mismo_en_tu_consulta?',
    ]);

  return {
    profession: inferredProfession ?? null,
    biggest_pain: inferredPain ?? null,
  };
}

/** Para el mini-resumen: quitamos claves que ya “mapeamos” a columnas */
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

/* =======================
Modal: Confirm
======================= */

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function ConfirmModal(props: ConfirmModalProps) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[520px] card-glass rounded-2xl border border-white/10 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-white">{props.title}</p>
            {props.description ? <p className="mt-1 text-sm text-white/60">{props.description}</p> : null}
          </div>

          <button
            type="button"
            onClick={props.onClose}
            disabled={props.loading}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.loading}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            {props.cancelText ?? 'Cancelar'}
          </button>

          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.loading}
            className={[
              'rounded-xl border px-4 py-2 text-sm transition disabled:opacity-60',
              props.danger
                ? 'border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/15'
                : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15',
            ].join(' ')}
          >
            {props.loading ? 'Procesando…' : props.confirmText ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
Modal: Edit lead (basic)
======================= */

type LeadEditDraft = {
  full_name: string;
  phone: string;
  email: string;
  profession: string;
  biggest_pain: string;
};

type EditLeadModalProps = {
  open: boolean;
  initial: LeadEditDraft;
  loading?: boolean;
  onClose: () => void;
  onSave: (next: LeadEditDraft) => void;
};

function EditLeadModal(props: EditLeadModalProps) {
  const [draft, setDraft] = useState<LeadEditDraft>(props.initial);

  useEffect(() => {
    if (props.open) setDraft(props.initial);
  }, [props.open, props.initial]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-[6px] p-4">
      <div className="w-full max-w-[720px] rounded-2xl border border-white/15 bg-black/70 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-white">Editar lead</p>
            <p className="mt-1 text-sm text-white/60">Actualiza datos básicos.</p>
          </div>

          <button
            type="button"
            onClick={props.onClose}
            disabled={props.loading}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-white/60">Nombre</p>
            <input
              value={draft.full_name}
              onChange={(e) => setDraft((p) => ({ ...p, full_name: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Teléfono</p>
            <input
              value={draft.phone}
              onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Email</p>
            <input
              value={draft.email}
              onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Profesión</p>
            <input
              value={draft.profession}
              onChange={(e) => setDraft((p) => ({ ...p, profession: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div className="sm:col-span-2">
            <p className="mb-1 text-xs text-white/60">Pain</p>
            <input
              value={draft.biggest_pain}
              onChange={(e) => setDraft((p) => ({ ...p, biggest_pain: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.loading}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => props.onSave(draft)}
            disabled={props.loading}
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {props.loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
Round selector (Sybana UIX)
======================= */

function RoundSelectButton(props: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-pressed={props.selected}
      className={cx(
        'relative inline-flex h-7 w-7 items-center justify-center rounded-full border transition',
        props.selected ? 'border-indigo-400/50 bg-indigo-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10',
        props.disabled ? 'cursor-not-allowed opacity-60' : ''
      )}
    >
      <span className={cx('h-3.5 w-3.5 rounded-full transition', props.selected ? 'bg-indigo-300' : 'bg-white/20')} />
    </button>
  );
}

/* =======================
Labels helpers
======================= */

function leadMatchesSelectedLabelsAny(lead: Lead, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  const arr = Array.isArray(lead.labels) ? lead.labels : [];
  if (arr.length === 0) return false;
  for (const raw of arr) {
    const k = normalizeLabel(raw);
    if (!k) continue;
    if (selected.has(k)) return true;
  }
  return false;
}

function leadHasEmail(lead: Lead): boolean {
  const e = (lead.email ?? '').trim();
  return e.length > 0;
}

function mergeLabels(existing: string[] | null | undefined, addLabel: LeadLabel): string[] {
  const curr = Array.isArray(existing) ? existing : [];
  const addNorm = normalizeLabel(addLabel) ?? addLabel;

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of curr) {
    const n = normalizeLabel(raw);
    const key = n ?? raw.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }

  if (!seen.has(addNorm)) out.push(addLabel);
  return out;
}

/* =======================
Page
======================= */

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const [unreadLeadIds, setUnreadLeadIds] = useState<Set<string>>(new Set());
  const [unreadNotificationByLead, setUnreadNotificationByLead] = useState<Map<string, string>>(new Map());

  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());

  const [onlyWithEmail, setOnlyWithEmail] = useState(false);

  const PAGE_SIZE = 15;

  const PAGE_STORAGE_KEY = 'kalue:leads:page';
  const [page, setPage] = useState(1);
  const didMountRef = useRef(false);
  const [pageHydrated, setPageHydrated] = useState(false);

  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const [bulkLabel, setBulkLabel] = useState<LeadLabel | ''>('');
  const [bulkLabelOpen, setBulkLabelOpen] = useState(false);
  const [bulkLabelConfirmOpen, setBulkLabelConfirmOpen] = useState(false);

  const [markAllBellOpen, setMarkAllBellOpen] = useState(false);
  const [markAllBellLoading, setMarkAllBellLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<LeadEditDraft>({
    full_name: '',
    phone: '',
    email: '',
    profession: '',
    biggest_pain: '',
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteLeadId, setDeleteLeadId] = useState<string | null>(null);
  const [deleteLeadName, setDeleteLeadName] = useState<string>('este lead');

  const [metaImportOpen, setMetaImportOpen] = useState(false);
  const [metaImportLoading, setMetaImportLoading] = useState(false);
  const [metaImportMsg, setMetaImportMsg] = useState<string>('');

  /** ✅ cache local: campos derivados traídos desde el endpoint de detalle */
  const [derivedByLeadId, setDerivedByLeadId] = useState<Record<string, DerivedLeadFields>>({});
  const [detailsLoadingIds, setDetailsLoadingIds] = useState<Set<string>>(new Set());

  const unreadCount = unreadLeadIds.size;

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) {
        setItems([]);
        setUnreadLeadIds(new Set());
        setUnreadNotificationByLead(new Map());
        return;
      }

      const workspaceId = (getActiveWorkspaceId() ?? '').trim();
      if (!workspaceId) {
        setItems([]);
        setUnreadLeadIds(new Set());
        setUnreadNotificationByLead(new Map());
        return;
      }

      const headers: HeadersInit = {
        authorization: `Bearer ${token}`,
        'x-workspace-id': workspaceId,
      };

      const [leadsRes, unreadRes] = await Promise.all([
        fetch('/api/marketing/leads/list', { method: 'GET', cache: 'no-store', headers }),
        fetch('/api/admin/leadhub/lead-notifications?unread=1&limit=500', { method: 'GET', cache: 'no-store', headers }),
      ]);

      if (leadsRes.ok) {
        const leadsJson = (await leadsRes.json()) as LeadsListResponse;
        if (leadsJson.ok && Array.isArray(leadsJson.leads)) setItems(leadsJson.leads);
        else setItems([]);
      } else {
        setItems([]);
      }

      if (unreadRes.ok) {
        const json = (await unreadRes.json()) as LeadNotificationsResponse;
        if (json.ok && Array.isArray(json.items)) {
          const byLead = new Map<string, string>();
          for (const it of json.items) {
            if (it.lead_id && !byLead.has(it.lead_id)) byLead.set(it.lead_id, it.id);
          }
          setUnreadNotificationByLead(byLead);
          setUnreadLeadIds(new Set(byLead.keys()));
        } else {
          setUnreadNotificationByLead(new Map());
          setUnreadLeadIds(new Set());
        }
      } else {
        setUnreadNotificationByLead(new Map());
        setUnreadLeadIds(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ Initial load
  useEffect(() => {
    void load();
  }, [load]);

  // ✅ Refresh on tab focus (SOLO UNA VEZ)
  useEffect(() => {
    function onFocus() {
      void load();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // ✅ Polling suave (25s). Solo si está visible.
  useEffect(() => {
    const EVERY_MS = 25_000;

    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load();
    }, EVERY_MS);

    return () => window.clearInterval(id);
  }, [load]);

  const labelOptions = useMemo(() => {
    const counts = new Map<LeadLabel, number>();
    for (const k of LEAD_LABELS) counts.set(k, 0);

    for (const l of items) {
      const arr = Array.isArray(l.labels) ? l.labels : [];
      for (const raw of arr) {
        const k0 = normalizeLabel(raw);
        if (!k0) continue;
        if (isLeadLabel(k0)) counts.set(k0, (counts.get(k0) ?? 0) + 1);
      }
    }

    return LEAD_LABELS.map((label) => ({ label, count: counts.get(label) ?? 0 }));
  }, [items]);

  function toggleLabel(label: LeadLabel) {
    const k = normalizeLabel(label);
    if (!k) return;
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  function clearLabels() {
    setSelectedLabels(new Set());
  }

  const filtered = useMemo(() => {
    let list = items;

    if (filterMode === 'unread') list = list.filter((l) => unreadLeadIds.has(l.id));
    if (filterMode === 'read') list = list.filter((l) => !unreadLeadIds.has(l.id));

    if (statusFilter !== 'all') list = list.filter((l) => l.status === statusFilter);

    list = list.filter((l) => leadMatchesSelectedLabelsAny(l, selectedLabels));
    if (onlyWithEmail) list = list.filter((l) => leadHasEmail(l));

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => {
        const full = (l.full_name ?? '').toLowerCase();
        const phone = (l.phone ?? '').toLowerCase();
        const email = (l.email ?? '').toLowerCase();
        return full.includes(q) || phone.includes(q) || email.includes(q);
      });
    }

    const sorted = [...list].sort((a, b) => {
      if (sortMode === 'recent') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortMode === 'az') return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es', { sensitivity: 'base' });
      return (b.full_name ?? '').localeCompare(a.full_name ?? '', 'es', { sensitivity: 'base' });
    });

    return sorted;
  }, [items, query, filterMode, sortMode, unreadLeadIds, selectedLabels, statusFilter, onlyWithEmail]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), [filtered.length]);

  const setPagePersisted = useCallback(
    (nextPage: number) => {
      const safe = Math.min(Math.max(1, nextPage), totalPages);
      setPage(safe);
    },
    [totalPages]
  );

  useEffect(() => {
    const rawFromUrl = searchParams.get('page');
    const parsedFromUrl = rawFromUrl ? Number.parseInt(rawFromUrl, 10) : Number.NaN;

    if (Number.isFinite(parsedFromUrl) && parsedFromUrl > 0) {
      setPage(parsedFromUrl);
      setPageHydrated(true);
      return;
    }

    try {
      const raw = sessionStorage.getItem(PAGE_STORAGE_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) setPage(parsed);
    } catch {
      // ignore
    }

    setPageHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pageHydrated) return;
    if (loading) return;

    const safe = Math.min(Math.max(1, page), totalPages);
    if (safe !== page) {
      setPage(safe);
      return;
    }

    try {
      sessionStorage.setItem(PAGE_STORAGE_KEY, String(safe));
    } catch {
      // ignore
    }

    const current = searchParams.get('page');
    const next = String(safe);
    if (current === next) return;

    const sp = new URLSearchParams(searchParams.toString());
    sp.set('page', next);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [pageHydrated, loading, page, totalPages, router, searchParams]);

  useEffect(() => {
    if (!pageHydrated) return;

    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    setPage(1);
    setSelectedLeadIds(new Set());
  }, [pageHydrated, query, filterMode, sortMode, selectedLabels, statusFilter, onlyWithEmail]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  /** ✅ Traer detalle SOLO para los que lo necesitan */
  useEffect(() => {
    let alive = true;

    async function run() {
      if (loading) return;

      const token = await getAccessToken();
      if (!token) return;

      const workspaceId = (getActiveWorkspaceId() ?? '').trim();
      if (!workspaceId) return;

      const toFetch: string[] = [];

      for (const l of pagedItems) {
        const already = derivedByLeadId[l.id];
        if (already?.profession || already?.biggest_pain) continue;

        // si ya se puede derivar con lo que tenemos, cacheamos y NO pedimos detalle
        const derivedLocal = deriveFieldsFromAnswers(l);
        if (derivedLocal.profession || derivedLocal.biggest_pain) {
          setDerivedByLeadId((prev) => ({ ...prev, [l.id]: derivedLocal }));
          continue;
        }

        if (detailsLoadingIds.has(l.id)) continue;
        toFetch.push(l.id);
      }

      if (toFetch.length === 0) return;

      setDetailsLoadingIds((prev) => {
        const next = new Set(prev);
        for (const id of toFetch) next.add(id);
        return next;
      });

      try {
        const results = await Promise.all(
          toFetch.map(async (leadId) => {
            const res = await fetch(`/api/marketing/leads/${encodeURIComponent(leadId)}`, {
              method: 'GET',
              cache: 'no-store',
              headers: {
                authorization: `Bearer ${token}`,
                'x-workspace-id': workspaceId,
              },
            });

            const json = (await res.json()) as LeadGetResponse;
            if (!res.ok || !json.ok) return { id: leadId, derived: null };

            const derived = deriveFieldsFromAnswers(json.lead);
            return { id: leadId, derived };
          })
        );

        if (!alive) return;

        setDerivedByLeadId((prev) => {
          const next: Record<string, DerivedLeadFields> = { ...prev };
          for (const r of results) {
            if (r.derived) next[r.id] = r.derived;
          }
          return next;
        });
      } finally {
        if (!alive) return;
        setDetailsLoadingIds((prev) => {
          const next = new Set(prev);
          for (const id of toFetch) next.delete(id);
          return next;
        });
      }
    }

    void run();
    return () => {
      alive = false;
    };
  }, [pagedItems, loading, derivedByLeadId, detailsLoadingIds]);

  const pageNumbers = useMemo(() => {
    const last = totalPages;
    const cur = page;

    const set = new Set<number>();
    set.add(1);
    set.add(last);
    set.add(cur);
    if (cur - 1 >= 1) set.add(cur - 1);
    if (cur + 1 <= last) set.add(cur + 1);

    const arr = Array.from(set).sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (i > 0) {
        const prev = arr[i - 1];
        if (n - prev > 1) out.push(0);
      }
      out.push(n);
    }
    return out;
  }, [page, totalPages]);

  function toggleSelectOne(leadId: string) {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      next.has(leadId) ? next.delete(leadId) : next.add(leadId);
      return next;
    });
  }

  const allIdsOnPage = useMemo(() => pagedItems.map((l) => l.id), [pagedItems]);

  const allSelectedOnPage = useMemo(() => {
    if (allIdsOnPage.length === 0) return false;
    return allIdsOnPage.every((id) => selectedLeadIds.has(id));
  }, [allIdsOnPage, selectedLeadIds]);

  function toggleSelectAllOnPage() {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        for (const id of allIdsOnPage) next.delete(id);
        return next;
      }
      for (const id of allIdsOnPage) next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedLeadIds(new Set());
  }

  const markLeadRead = useCallback(
    async (leadId: string) => {
      setUnreadLeadIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });

      const notificationId = unreadNotificationByLead.get(leadId);
      setUnreadNotificationByLead((prev) => {
        const next = new Map(prev);
        next.delete(leadId);
        return next;
      });

      if (!notificationId) return;

      const token = await getAccessToken();
      if (!token) return;

      await fetch('/api/admin/leadhub/lead-notifications/mark-read', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: notificationId }),
      });
    },
    [unreadNotificationByLead]
  );

  async function markLeadUnreadByLeadId(leadId: string, token: string) {
    await fetch('/api/admin/leadhub/lead-notifications/mark-unread', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ lead_id: leadId }),
    });

    setUnreadLeadIds((prev) => {
      const next = new Set(prev);
      next.add(leadId);
      return next;
    });
  }

  async function markLeadReadByLeadId(leadId: string, token: string) {
    await fetch('/api/admin/leadhub/lead-notifications/mark-read-by-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ lead_id: leadId }),
    });

    setUnreadLeadIds((prev) => {
      const next = new Set(prev);
      next.delete(leadId);
      return next;
    });

    setUnreadNotificationByLead((prev) => {
      const next = new Map(prev);
      next.delete(leadId);
      return next;
    });
  }

  async function bulkMarkSelectedRead() {
    if (selectedLeadIds.size === 0) return;

    setBulkLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      for (const leadId of selectedLeadIds) {
        if (unreadLeadIds.has(leadId)) await markLeadReadByLeadId(leadId, token);
      }

      clearSelection();
      await load();
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkMarkSelectedUnread() {
    if (selectedLeadIds.size === 0) return;

    setBulkLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      for (const leadId of selectedLeadIds) {
        if (!unreadLeadIds.has(leadId)) await markLeadUnreadByLeadId(leadId, token);
      }

      clearSelection();
      await load();
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkMarkAllFilteredRead() {
    if (filtered.length === 0) return;

    setBulkLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      for (const l of filtered) {
        if (unreadLeadIds.has(l.id)) await markLeadReadByLeadId(l.id, token);
      }

      clearSelection();
      await load();
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkMarkAllFilteredUnread() {
    if (filtered.length === 0) return;

    setBulkLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      for (const l of filtered) {
        if (!unreadLeadIds.has(l.id)) await markLeadUnreadByLeadId(l.id, token);
      }

      clearSelection();
      await load();
    } finally {
      setBulkLoading(false);
    }
  }

  async function markAllBellRead() {
    if (markAllBellLoading) return;

    setMarkAllBellLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch('/api/admin/leadhub/lead-notifications/mark-all-read', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });

      const data = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!res.ok || !data.ok) return;

      setMarkAllBellOpen(false);
      await load();
    } finally {
      setMarkAllBellLoading(false);
    }
  }

  async function openEditModal(lead: Lead) {
    setEditLeadId(lead.id);

    const cached = derivedByLeadId[lead.id] ?? null;
    const derived = cached ?? deriveFieldsFromAnswers(lead);

    setEditInitial({
      full_name: lead.full_name ?? '',
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      profession: derived.profession ?? '',
      biggest_pain: derived.biggest_pain ?? '',
    });
    setEditOpen(true);
  }

  async function saveEdit(next: LeadEditDraft) {
    if (!editLeadId) return;

    setEditSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`/api/admin/leadhub/leads/${editLeadId}/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          full_name: next.full_name.trim() || null,
          phone: next.phone.trim() || null,
          email: next.email.trim() || null,
          profession: next.profession.trim() || null,
          biggest_pain: next.biggest_pain.trim() || null,
        }),
      });

      const data = (await res.json()) as { ok: true; lead: Lead } | { ok: false; error: string };
      if (!res.ok || !data.ok) return;

      setDerivedByLeadId((prev) => ({
        ...prev,
        [editLeadId]: { profession: next.profession.trim() || null, biggest_pain: next.biggest_pain.trim() || null },
      }));

      await load();
      setEditOpen(false);
      setEditLeadId(null);
    } finally {
      setEditSaving(false);
    }
  }

  function openDeleteModal(lead: Lead) {
    setDeleteLeadId(lead.id);
    setDeleteLeadName(lead.full_name ?? 'este lead');
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteLeadId) return;

    setDeleteLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`/api/admin/leadhub/leads/${deleteLeadId}/delete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });

      const data = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!res.ok || !data.ok) return;

      await load();
      setDeleteOpen(false);
      clearSelection();

      setDerivedByLeadId((prev) => {
        const next = { ...prev };
        delete next[deleteLeadId];
        return next;
      });

      setDeleteLeadId(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  async function bulkAssignLabelToSelected() {
    if (!bulkLabel || selectedLeadIds.size === 0) return;

    setBulkLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const selectedIds = Array.from(selectedLeadIds);
      for (const leadId of selectedIds) {
        const lead = items.find((x) => x.id === leadId);
        if (!lead) continue;
        if (onlyWithEmail && !leadHasEmail(lead)) continue;

        const nextLabels = mergeLabels(lead.labels, bulkLabel);

        const res = await fetch(`/api/admin/leadhub/leads/${leadId}/update`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ labels: nextLabels }),
        });

        const data = (await res.json()) as { ok: true; lead: Lead } | { ok: false; error: string };
        if (!res.ok || !data.ok) continue;
      }

      setBulkLabelConfirmOpen(false);
      setBulkLabelOpen(false);
      setBulkLabel('');
      clearSelection();
      await load();
    } finally {
      setBulkLoading(false);
    }
  }

  async function importFromMeta() {
    if (metaImportLoading) return;

    setMetaImportLoading(true);
    setMetaImportMsg('');
    try {
      const token = await getAccessToken();
      if (!token) {
        setMetaImportMsg('No hay sesión activa.');
        return;
      }

      const res = await fetch('/api/integrations/meta/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });

      const data = (await res.json()) as MetaImportResponse;

      if (!res.ok || !data.ok) {
        setMetaImportMsg(data.ok ? 'Error al importar.' : data.error);
        return;
      }

      setMetaImportOpen(false);
      setMetaImportMsg(
        `Importados: ${data.imported}${typeof data.skipped === 'number' ? ` · Saltados: ${data.skipped}` : ''}`
      );
      await load();
    } catch {
      setMetaImportMsg('Error inesperado al importar.');
    } finally {
      setMetaImportLoading(false);
    }
  }

  function Paginator(props: { compact?: boolean }) {
    return (
      <div className={cx('flex items-center gap-2', props.compact ? 'justify-end' : '')}>
        <button
          type="button"
          onClick={() => setPagePersisted(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={cx(
            'rounded-xl border px-3 py-2 text-xs transition',
            page > 1
              ? 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              : 'cursor-not-allowed border-white/5 bg-white/5 text-white/30'
          )}
        >
          ← Anterior
        </button>

        <div className="flex items-center gap-1">
          {pageNumbers.map((n, idx) =>
            n === 0 ? (
              <span key={`gap-${idx}`} className="px-2 text-white/40">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => setPagePersisted(n)}
                className={cx(
                  'min-w-[36px] rounded-xl border px-3 py-2 text-xs transition',
                  n === page
                    ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                {n}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => setPagePersisted(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className={cx(
            'rounded-xl border px-3 py-2 text-xs transition',
            page < totalPages
              ? 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              : 'cursor-not-allowed border-white/5 bg-white/5 text-white/30'
          )}
        >
          Siguiente →
        </button>
      </div>
    );
  }

  return (
    <div className="container-default py-8 text-white">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Leads</h1>

        <p className="max-w-2xl text-sm text-white/70">
          Bandeja de leads recibidos desde integraciones (Meta, etc.). <span className="text-white/60">Pendientes:</span>{' '}
          <span className="font-medium text-white/85">{unreadCount}</span>
        </p>

        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/integrations"
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white/80 hover:bg-white/10"
              >
                Ver integraciones
              </Link>

              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-indigo-200 hover:bg-indigo-500/15"
              >
                Refrescar
              </button>

              <button
                type="button"
                onClick={() => setMarkAllBellOpen(true)}
                className="inline-flex items-center rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-indigo-200 hover:bg-indigo-500/15"
                title="Pone read_at a todas las notificaciones pendientes"
              >
                Marcar TODO (campana) leído
              </button>
            </div>

            <div className="w-full sm:w-[360px]">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, teléfono o email…"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-indigo-400/50"
              />
            </div>
          </div>
        </div>

        {metaImportMsg ? (
          <div className="mt-3 text-xs text-white/70">
            <span className="inline-block rounded-xl border border-white/10 bg-white/5 px-3 py-2">{metaImportMsg}</span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="text-white/60">Cargando leads…</p>
      ) : filtered.length === 0 ? (
        <div className="card-glass p-5 text-sm text-white/70">No hay leads en esta vista.</div>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <RoundSelectButton
                selected={allSelectedOnPage}
                disabled={bulkLoading}
                title={allSelectedOnPage ? 'Deseleccionar página' : 'Seleccionar página'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelectAllOnPage();
                }}
              />
              <span className="select-none text-xs text-white/70">Seleccionar todos (esta página)</span>
            </div>

            <div className="flex items-center justify-end gap-3">
              {bulkLoading ? <span className="text-xs text-white/50">Aplicando cambios…</span> : null}
              <Paginator compact />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {pagedItems.map((l) => {
              const isUnread = unreadLeadIds.has(l.id);
              const selected = selectedLeadIds.has(l.id);
              const labels = Array.isArray(l.labels) ? l.labels : [];

              const derivedLocal = deriveFieldsFromAnswers(l);
              const derivedCached = derivedByLeadId[l.id] ?? null;

              const professionValue = derivedLocal.profession ?? derivedCached?.profession ?? null;
              const painValue = derivedLocal.biggest_pain ?? derivedCached?.biggest_pain ?? null;

              const isFetchingDetails = detailsLoadingIds.has(l.id);

              const answers = safeAnswers(l);
              const answerEntries = answers
                ? Object.entries(answers)
                    .filter(([k, v]) => {
                      if (shouldHideAnswerKey(k)) return false;
                      const txt = asText(v).trim();
                      return txt.length > 0;
                    })
                    .slice(0, 2)
                : [];

              return (
                <div
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  onClick={async () => {
                    if (isUnread) await markLeadRead(l.id);

                    try {
                      sessionStorage.setItem(PAGE_STORAGE_KEY, String(page));
                    } catch {
                      // ignore
                    }

                    router.push(`/leads/${l.id}?page=${page}`);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();

                    if (isUnread) await markLeadRead(l.id);

                    try {
                      sessionStorage.setItem(PAGE_STORAGE_KEY, String(page));
                    } catch {
                      // ignore
                    }

                    router.push(`/leads/${l.id}?page=${page}`);
                  }}
                  className={cx('group h-full cursor-pointer rounded-2xl text-left', selected ? 'ring-2 ring-indigo-400/35' : '')}
                >
                  <div className="card-glass flex h-full flex-col gap-2 p-5 transition-transform duration-150 hover:-translate-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cx('h-2 w-2 shrink-0 rounded-full', isUnread ? 'bg-sky-400' : 'bg-white/25')}
                            title={isUnread ? 'Pendiente de leer' : 'Leído'}
                          />
                          <h2 className="truncate text-base font-semibold text-white">{l.full_name ?? 'Sin nombre'}</h2>
                        </div>
                        <p className="text-xs text-white/60">{new Date(l.created_at).toLocaleString()}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEditModal(l);
                          }}
                          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteModal(l);
                          }}
                          className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs text-red-200 hover:bg-red-500/15"
                        >
                          Borrar
                        </button>

                        <span className="shrink-0 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">
                          {l.source}
                        </span>

                        <RoundSelectButton
                          selected={selected}
                          disabled={bulkLoading}
                          title={selected ? 'Quitar de selección' : 'Seleccionar'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectOne(l.id);
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1 text-sm text-white/80">
                      <p>
                        <span className="text-white/60">Tel:</span> {l.phone ?? '—'}
                      </p>
                      <p>
                        <span className="text-white/60">Email:</span> {l.email ?? '—'}
                      </p>

                      <p>
                        <span className="text-white/60">Profesión:</span>{' '}
                        {professionValue ? (
                          professionValue
                        ) : isFetchingDetails ? (
                          <span className="text-white/45 italic">(cargando…)</span>
                        ) : (
                          <span className="text-white/45 italic">(ver respuestas)</span>
                        )}
                      </p>

                      <p>
                        <span className="text-white/60">Pain:</span>{' '}
                        {painValue ? (
                          painValue
                        ) : isFetchingDetails ? (
                          <span className="text-white/45 italic">(cargando…)</span>
                        ) : (
                          <span className="text-white/45 italic">(ver respuestas)</span>
                        )}
                      </p>
                    </div>

                    {answerEntries.length > 0 ? (
                      <div className="mt-2 space-y-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/80">
                        {answerEntries.map(([k, v]) => (
                          <div key={`${l.id}-${k}`} className="flex gap-2">
                            <span className="shrink-0 text-white/50">{prettifyLabel(k)}:</span>
                            <span className="truncate">{asText(v)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {labels.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {labels.slice(0, 4).map((lab) => (
                          <span
                            key={`${l.id}-${lab}`}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75"
                          >
                            {lab}
                          </span>
                        ))}
                        {labels.length > 4 ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60">
                            +{labels.length - 4}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-auto flex items-center justify-between pt-4 text-xs text-white/60">
                      <span>Status: {l.status}</span>
                      <span className="text-indigo-300 transition-transform group-hover:translate-x-1">Ver detalle →</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-white/60">
              Mostrando <span className="font-medium text-white/80">{(page - 1) * PAGE_SIZE + 1}</span> -{' '}
              <span className="font-medium text-white/80">{Math.min(page * PAGE_SIZE, filtered.length)}</span> de{' '}
              <span className="font-medium text-white/80">{filtered.length}</span>
            </div>

            <Paginator />
          </div>

          <EditLeadModal
            open={editOpen}
            loading={editSaving}
            onClose={() => setEditOpen(false)}
            initial={editInitial}
            onSave={(next) => void saveEdit(next)}
          />

          <ConfirmModal
            open={deleteOpen}
            title="Borrar lead"
            description={`Esta acción eliminará ${deleteLeadName}. ¿Seguro que quieres continuar?`}
            confirmText="Sí, borrar"
            cancelText="Cancelar"
            danger
            loading={deleteLoading}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => void confirmDelete()}
          />

          <ConfirmModal
            open={markAllBellOpen}
            title="Marcar TODO como leído (campana)"
            description="Esto marcará como leídas (read_at) todas las notificaciones pendientes para que la campanita quede a cero."
            confirmText={markAllBellLoading ? 'Procesando…' : 'Sí, marcar todo'}
            cancelText="Cancelar"
            loading={markAllBellLoading}
            onClose={() => setMarkAllBellOpen(false)}
            onConfirm={() => void markAllBellRead()}
          />

          <ConfirmModal
            open={bulkLabelConfirmOpen}
            title="Asignar etiqueta"
            description={
              bulkLabel
                ? `Se añadirá la etiqueta "${bulkLabel}" a ${selectedLeadIds.size} lead(s)${onlyWithEmail ? ` (solo aplicará a los que tengan email)` : ''}. ¿Continuar?`
                : 'Elige una etiqueta primero.'
            }
            confirmText="Sí, aplicar"
            cancelText="Cancelar"
            loading={bulkLoading}
            onClose={() => setBulkLabelConfirmOpen(false)}
            onConfirm={() => void bulkAssignLabelToSelected()}
          />

          <ConfirmModal
            open={metaImportOpen}
            title="Importar leads desde Meta"
            description="Esto pedirá a tu backend importar leads desde Meta Lead Ads. Requiere que exista /api/integrations/meta/leads/import y permisos leads_retrieval."
            confirmText={metaImportLoading ? 'Procesando…' : 'Sí, importar'}
            cancelText="Cancelar"
            loading={metaImportLoading}
            onClose={() => setMetaImportOpen(false)}
            onConfirm={() => void importFromMeta()}
          />
        </>
      )}
    </div>
  );
}
