// src/app/(private)/leads/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceIdClient } from '@/lib/workspace/activeWorkspace';

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

type LeadRow = {
  id: string;
  workspace_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

function normalizeStatus(value: string): LeadStatus {
  const v = value as LeadStatus;
  if (v === 'new' || v === 'contacted' || v === 'qualified' || v === 'won' || v === 'lost') return v;
  return 'new';
}

export default function LeadsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const id = getActiveWorkspaceIdClient();
    setWorkspaceId(id);
  }, []);

  async function loadLeads(currentWorkspaceId: string) {
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from('leads')
      .select('id, workspace_id, full_name, email, phone, status, created_at')
      .eq('workspace_id', currentWorkspaceId)
      .order('created_at', { ascending: false });

    if (qErr) {
      setError(qErr.message);
      setLeads([]);
      setLoading(false);
      return;
    }

    // Tipado defensivo sin any: validamos forma mínima
    const rows: LeadRow[] = Array.isArray(data)
      ? data
          .map((row) => {
            if (typeof row !== 'object' || row === null) return null;
            const r = row as Record<string, unknown>;

            const id = typeof r.id === 'string' ? r.id : null;
            const ws = typeof r.workspace_id === 'string' ? r.workspace_id : null;
            const created = typeof r.created_at === 'string' ? r.created_at : null;
            const status = typeof r.status === 'string' ? r.status : 'new';

            if (!id || !ws || !created) return null;

            return {
              id,
              workspace_id: ws,
              created_at: created,
              status,
              full_name: typeof r.full_name === 'string' ? r.full_name : null,
              email: typeof r.email === 'string' ? r.email : null,
              phone: typeof r.phone === 'string' ? r.phone : null,
            } satisfies LeadRow;
          })
          .filter((x): x is LeadRow => x !== null)
      : [];

    setLeads(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    void loadLeads(workspaceId);
  }, [workspaceId]);

  const canCreate = useMemo(() => {
    const hasName = fullName.trim().length > 0;
    const hasEmail = email.trim().length > 0;
    return workspaceId !== null && hasName && hasEmail && !saving;
  }, [workspaceId, fullName, email, saving]);

  async function createLead() {
    if (!workspaceId) {
      setError('No workspace activo.');
      return;
    }

    const name = fullName.trim();
    const mail = email.trim();

    if (!name || !mail) return;

    setSaving(true);
    setError(null);

    const { error: insErr } = await supabase.from('leads').insert({
      workspace_id: workspaceId,
      full_name: name,
      email: mail,
      status: 'new',
    });

    if (insErr) {
      setError(insErr.message);
      setSaving(false);
      return;
    }

    setFullName('');
    setEmail('');
    setSaving(false);

    await loadLeads(workspaceId);
  }

  return (
    <div className="min-w-0">
      <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Leads</h1>
            <p className="mt-1 text-sm text-white/70">
              Listado mínimo por workspace (multi-tenant). Crear lead rápido.
            </p>
          </div>

          <div className="text-xs text-white/60">
            Workspace:{' '}
            <span className="text-white/85 font-medium">
              {workspaceId ? workspaceId.slice(0, 8) + '…' : '—'}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="block text-xs text-white/70">Nombre</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Ana López"
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-indigo-400/30"
            />
          </div>

          <div>
            <label className="block text-xs text-white/70">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ana@empresa.com"
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-indigo-400/30"
            />
          </div>

          <div className="sm:self-end">
            <button
              type="button"
              onClick={() => void createLead()}
              disabled={!canCreate}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/85 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
            >
              {saving ? 'Guardando…' : 'Añadir lead'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/75">
              {loading ? 'Cargando…' : `${leads.length} lead(s)`}
            </p>

            <button
              type="button"
              onClick={() => (workspaceId ? void loadLeads(workspaceId) : undefined)}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
              disabled={!workspaceId || loading}
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading ? (
                  <tr>
                    <td className="px-4 py-4 text-white/60" colSpan={4}>
                      Cargando…
                    </td>
                  </tr>
                ) : leads.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-white/60" colSpan={4}>
                      No hay leads todavía.
                    </td>
                  </tr>
                ) : (
                  leads.map((l) => {
                    const status = normalizeStatus(l.status);
                    return (
                      <tr key={l.id} className="hover:bg-white/5">
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">
                            {l.full_name ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/80">{l.email ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80">
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/70">
                          {new Date(l.created_at).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!workspaceId ? (
            <p className="mt-3 text-xs text-white/60">
              No hay workspace activo aún. Entra a <span className="text-white/80">Onboarding</span>{' '}
              y crea uno.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
