'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

import {
  LEAD_LABELS,
  type LeadLabel,
  isLeadLabel,
  normalizeLabel,
  LEAD_STATUSES,
  type LeadStatus,
} from '@/lib/leadhub/leadConstants';

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

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
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
      <div className="w-full max-w-[720px] rounded-2xl border border-white/15 bg-black/70 shadow-2xl p-5">
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
  onClick: () => void;
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
        props.disabled ? 'opacity-60 cursor-not-allowed' : ''
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

  const PAGE_SIZE = 15;

  // ✅ pagina persistida (URL + sessionStorage)
  const PAGE_STORAGE_KEY = 'kalue:leads:page';
  const [page, setPage] = useState(1);
  const didMountRef = useRef(false);
  const [pageHydrated, setPageHydrated] = useState(false);

  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

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

  const unreadCount = unreadLeadIds.size;

  const load = useCallback(async () => {
    setLoading(true);

    const token = await getAccessToken();
    if (!token) {
      setItems([]);
      setUnreadLeadIds(new Set());
      setUnreadNotificationByLead(new Map());
      setLoading(false);
      return;
    }

    const headers: HeadersInit = { authorization: `Bearer ${token}` };

    try {
      const [leadsRes, unreadRes] = await Promise.all([
        fetch('/api/marketing/leads/list', { method: 'GET', cache: 'no-store', headers }),
        fetch('/api/admin/leadhub/lead-notifications?unread=1&limit=500', { method: 'GET', cache: 'no-store', headers }),
      ]);

      if (leadsRes.ok) {
        const json = (await leadsRes.json()) as LeadsListResponse;
        setItems(json.ok && Array.isArray(json.leads) ? json.leads : []);
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

  useEffect(() => {
    void load();
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
  }, [items, query, filterMode, sortMode, unreadLeadIds, selectedLabels, statusFilter]);

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
    const parsedFromUrl = rawFromUrl ? Number.parseInt(rawFromUrl, 10) : NaN;

    if (Number.isFinite(parsedFromUrl) && parsedFromUrl > 0) {
      setPage(parsedFromUrl);
      setPageHydrated(true);
      return;
    }

    try {
      const raw = sessionStorage.getItem(PAGE_STORAGE_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
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
  }, [pageHydrated, query, filterMode, sortMode, selectedLabels, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

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
      // UX inmediato
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
    setEditInitial({
      full_name: lead.full_name ?? '',
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      profession: lead.profession ?? '',
      biggest_pain: lead.biggest_pain ?? '',
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
      setDeleteLeadId(null);
      clearSelection();
    } finally {
      setDeleteLoading(false);
    }
  }

  function Paginator(props: { compact?: boolean }) {
    return (
      <div className={cx('flex items-center gap-2', props.compact ? 'justify-end' : '')}>
        <button
          type="button"
          onClick={() => setPagePersisted(Math.max(1, page - 1))}
          disabled={!canPrev}
          className={cx(
            'rounded-xl border px-3 py-2 text-xs transition',
            canPrev
              ? 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              : 'border-white/5 bg-white/5 text-white/30 cursor-not-allowed'
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
          disabled={!canNext}
          className={cx(
            'rounded-xl border px-3 py-2 text-xs transition',
            canNext
              ? 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              : 'border-white/5 bg-white/5 text-white/30 cursor-not-allowed'
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

        <p className="text-sm text-white/70 max-w-2xl">
          Bandeja de leads recibidos desde integraciones (Meta, etc.).{' '}
          <span className="text-white/60">Pendientes:</span>{' '}
          <span className="text-white/85 font-medium">{unreadCount}</span>
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

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'unread', 'read'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFilterMode(m)}
                  className={cx(
                    'rounded-xl border px-3 py-2 text-xs transition',
                    filterMode === m
                      ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200'
                      : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                  )}
                >
                  {m === 'all' ? 'Todos' : m === 'unread' ? 'No leídos' : 'Leídos'}
                </button>
              ))}

              <div className="ml-0 sm:ml-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 outline-none focus:border-indigo-400/50"
                  title="Filtrar por estado"
                >
                  <option value="all">Estado: TODOS</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setLabelsOpen((v) => !v)}
                className={cx(
                  'rounded-xl border px-3 py-2 text-xs transition',
                  selectedLabels.size > 0
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                )}
                title="Filtrar por etiquetas"
              >
                Etiquetas{selectedLabels.size > 0 ? ` (${selectedLabels.size})` : ''}
              </button>

              <span className="ml-1 text-xs text-white/50">({filtered.length} en vista)</span>

              <div className="ml-0 sm:ml-2">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 outline-none focus:border-indigo-400/50"
                >
                  <option value="recent">Recientes primero</option>
                  <option value="oldest">Antiguos primero</option>
                  <option value="az">A–Z (nombre)</option>
                  <option value="za">Z–A (nombre)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkLoading || selectedLeadIds.size === 0}
                onClick={() => void bulkMarkSelectedRead()}
                className={cx(
                  'rounded-xl border px-3 py-2 text-xs transition',
                  bulkLoading || selectedLeadIds.size === 0
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                )}
              >
                Marcar seleccionados leídos
              </button>

              <button
                type="button"
                disabled={bulkLoading || selectedLeadIds.size === 0}
                onClick={() => void bulkMarkSelectedUnread()}
                className={cx(
                  'rounded-xl border px-3 py-2 text-xs transition',
                  bulkLoading || selectedLeadIds.size === 0
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                Marcar seleccionados no leídos
              </button>

              <button
                type="button"
                disabled={bulkLoading || filtered.length === 0}
                onClick={() => void bulkMarkAllFilteredRead()}
                className={cx(
                  'rounded-xl border px-3 py-2 text-xs transition',
                  bulkLoading || filtered.length === 0
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                )}
              >
                Marcar TODOS (vista) leídos
              </button>

              <button
                type="button"
                disabled={bulkLoading || filtered.length === 0}
                onClick={() => void bulkMarkAllFilteredUnread()}
                className={cx(
                  'rounded-xl border px-3 py-2 text-xs transition',
                  bulkLoading || filtered.length === 0
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                Marcar TODOS (vista) no leídos
              </button>

              {selectedLeadIds.size > 0 ? (
                <button
                  type="button"
                  disabled={bulkLoading}
                  onClick={() => clearSelection()}
                  className={cx(
                    'rounded-xl border px-3 py-2 text-xs transition',
                    bulkLoading
                      ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                      : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                  )}
                >
                  Limpiar selección ({selectedLeadIds.size})
                </button>
              ) : null}
            </div>
          </div>

          {labelsOpen ? (
            <div className="card-glass rounded-2xl border border-white/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Filtrar por etiquetas</p>

                  {selectedLabels.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => clearLabels()}
                      className="ml-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                      title="Quitar filtro de etiquetas"
                    >
                      Limpiar ({selectedLabels.size})
                    </button>
                  ) : (
                    <span className="ml-2 text-xs text-white/60">
                      Marca una o varias (OR). Si no marcas ninguna, se ven todos.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setLabelsOpen(false)}
                  className="self-start sm:self-auto rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {labelOptions.map((o) => {
                  const active = selectedLabels.has(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => toggleLabel(o.label)}
                      className={cx(
                        'rounded-xl border px-3 py-2 text-xs transition',
                        active
                          ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                          : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                      )}
                      title={active ? 'Quitar etiqueta' : 'Filtrar por etiqueta'}
                    >
                      <span className="mr-2">{o.label}</span>
                      <span className="rounded-full bg-white/10 px-2 py-[2px] text-[11px] text-white/70">
                        {o.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedLabels.size > 0 ? (
                <div className="mt-3 text-xs text-white/60">
                  Seleccionadas: <span className="text-white/80">{Array.from(selectedLabels).join(', ')}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
                onClick={toggleSelectAllOnPage}
              />
              <span className="text-xs text-white/70 select-none">Seleccionar todos (esta página)</span>
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
                          onClick={() => toggleSelectOne(l.id)}
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
                        <span className="text-white/60">Profesión:</span> {l.profession ?? '—'}
                      </p>
                      <p>
                        <span className="text-white/60">Pain:</span> {l.biggest_pain ?? '—'}
                      </p>
                    </div>

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
        </>
      )}
    </div>
  );
}
