'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

import { Plus, Workflow, PauseCircle, PlayCircle, FileText, Trash2 } from 'lucide-react';

type WorkflowStatus = 'draft' | 'active' | 'paused' | string;

type WorkflowItem = {
  id: string;
  name: string;
  status: WorkflowStatus;
  updated_at: string;
};

type ListResponse =
  | { ok: true; workflows: WorkflowItem[] }
  | { ok: false; error: string; detail?: string };

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function statusBadge(status: WorkflowStatus): { label: string; icon: ReactNode; cls: string } {
  if (status === 'active') {
    return {
      label: 'Activo',
      icon: <PlayCircle className="h-4 w-4" />,
      cls: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100',
    };
  }
  if (status === 'paused') {
    return {
      label: 'Pausado',
      icon: <PauseCircle className="h-4 w-4" />,
      cls: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
    };
  }
  return {
    label: 'Borrador',
    icon: <FileText className="h-4 w-4" />,
    cls: 'border-white/10 bg-white/5 text-white/80',
  };
}

export default function AutomationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(true);
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const ws = await getActiveWorkspaceId();
    if (!ws) {
      setLoading(false);
      setError('missing_workspace');
      return;
    }

    const { data: sess, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      setLoading(false);
      setError(sessErr.message);
      return;
    }

    const token = sess.session?.access_token;
    if (!token) {
      setLoading(false);
      setError('login_required');
      return;
    }

    const res = await fetch('/api/automations/workflows/list', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws,
      },
      cache: 'no-store',
    });

    const json = (await res.json()) as ListResponse;
    if (!json.ok) {
      setError(json.detail ?? json.error);
      setItems([]);
      setLoading(false);
      return;
    }

    setItems(json.workflows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createNew = useCallback(async (): Promise<void> => {
    setError(null);

    const ws = await getActiveWorkspaceId();
    if (!ws) {
      setError('missing_workspace');
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      setError('login_required');
      return;
    }

    const res = await fetch('/api/automations/workflows/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Nuevo workflow' }),
    });

    const j = (await res.json()) as
      | { ok: true; workflowId: string }
      | { ok: false; error: string; detail?: string };

    if (!j.ok) {
      setError(j.detail ?? j.error);
      return;
    }

    router.push(`/automations/${j.workflowId}`);
  }, [router]);

  const deleteWorkflow = useCallback(
    async (id: string): Promise<void> => {
      setError(null);

      const ws = await getActiveWorkspaceId();
      if (!ws) {
        setError('missing_workspace');
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError('login_required');
        return;
      }

      const res = await fetch('/api/automations/workflows/delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-workspace-id': ws,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });

      const j = (await res.json()) as { ok: true } | { ok: false; error: string; detail?: string };
      if (!j.ok) {
        setError(j.detail ?? j.error);
        return;
      }

      await load();
    },
    [load]
  );

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">
          Cargando automatizaciones…
        </div>
      );
    }

    if (error) {
      return (
        <div className="card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-6 backdrop-blur">
          Error: {error}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">
          <div className="flex items-center gap-2 text-white/90">
            <Workflow className="h-5 w-5" />
            <span>No hay workflows todavía.</span>
          </div>
          <button
            onClick={() => void createNew()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-indigo-500/20 px-4 py-2 text-white hover:bg-indigo-500/30"
          >
            <Plus className="h-4 w-4" />
            Crear primer workflow
          </button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((w) => {
          const badge = statusBadge(w.status);
          return (
            <div key={w.id} className="card-glass rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-white/95 font-medium">{w.name}</div>
                  <div className="mt-2">
                    <span className={cx('inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-sm', badge.cls)}>
                      {badge.icon}
                      {badge.label}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => void deleteWorkflow(w.id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/80 hover:bg-white/10"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-white/50">Última edición: {new Date(w.updated_at).toLocaleString()}</div>
                <Link
                  href={`/automations/${w.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-emerald-500/15 px-4 py-2 text-white hover:bg-emerald-500/25"
                >
                  Editar
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [loading, error, items, createNew, deleteWorkflow]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white/95">Automatizaciones</h1>
          <p className="text-sm text-white/60">Crea workflows tipo GHL: triggers → condiciones → acciones.</p>
        </div>
        <button
          onClick={() => void createNew()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-indigo-500/20 px-4 py-2 text-white hover:bg-indigo-500/30"
        >
          <Plus className="h-4 w-4" />
          Nuevo workflow
        </button>
      </div>

      {content}
    </div>
  );
}
