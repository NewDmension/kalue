'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId, setActiveWorkspaceId, clearActiveWorkspaceId } from '@/lib/activeWorkspace';

type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  created_by: string;
  role: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(v: unknown, key: string): string | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  return typeof x === 'string' ? x : null;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function WorkspacesSettingsPage() {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState<string>('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState<string>('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeId = useMemo(() => getActiveWorkspaceId(), []);

  const fetchList = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const token = sessionData.session?.access_token ?? null;
      if (!token) {
        setItems([]);
        throw new Error('Para ver Workspaces necesitas iniciar sesión.');
      }

      const res = await fetch('/api/workspaces/list', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = isRecord(json) && typeof json.error === 'string' ? json.error : 'Failed to load workspaces';
        const detail = isRecord(json) && typeof json.detail === 'string' ? json.detail : null;
        throw new Error(detail ? `${msg} — ${detail}` : msg);
      }

      const arr = isRecord(json) ? json.workspaces : null;
      if (!Array.isArray(arr)) {
        setItems([]);
        return;
      }

      const parsed: WorkspaceItem[] = arr
        .map((w) => {
          if (!isRecord(w)) return null;
          const id = getString(w, 'id');
          const name = getString(w, 'name');
          const slug = getString(w, 'slug');
          const created_at = getString(w, 'created_at');
          const created_by = getString(w, 'created_by');
          const role = getString(w, 'role') ?? 'member';
          if (!id || !name || !slug || !created_at || !created_by) return null;
          return { id, name, slug, created_at, created_by, role };
        })
        .filter((x): x is WorkspaceItem => x !== null);

      setItems(parsed);

      const current = getActiveWorkspaceId();
      if (!current && parsed[0]?.id) setActiveWorkspaceId(parsed[0].id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();

    const supabase = supabaseBrowser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void fetchList();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [fetchList]);

  const createWorkspace = useCallback(async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;

    setBusy(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('Para crear un workspace necesitas iniciar sesión.');

      const res = await fetch('/api/workspaces/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof json.error === 'string' ? json.error : 'Failed to create workspace';
        const detail = isRecord(json) && typeof json.detail === 'string' ? json.detail : null;
        throw new Error(detail ? `${msg} — ${detail}` : msg);
      }

      const wsId = isRecord(json) && isRecord(json.workspace) ? getString(json.workspace, 'id') : null;
      if (wsId) setActiveWorkspaceId(wsId);

      setNewName('');
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }, [fetchList, newName]);

  const renameWorkspace = useCallback(async (): Promise<void> => {
    if (!renameId) return;
    const name = renameName.trim();
    if (!name) return;

    setBusy(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('Para renombrar un workspace necesitas iniciar sesión.');

      const res = await fetch('/api/workspaces/rename', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: renameId, name }),
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof json.error === 'string' ? json.error : 'Failed to rename workspace';
        const detail = isRecord(json) && typeof json.detail === 'string' ? json.detail : null;
        throw new Error(detail ? `${msg} — ${detail}` : msg);
      }

      setRenameId(null);
      setRenameName('');
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }, [fetchList, renameId, renameName]);

  const deleteWorkspace = useCallback(async (): Promise<void> => {
    if (!deleteId) return;

    setBusy(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('Para borrar un workspace necesitas iniciar sesión.');

      const res = await fetch('/api/workspaces/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: deleteId }),
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof json.error === 'string' ? json.error : 'Failed to delete workspace';
        const detail = isRecord(json) && typeof json.detail === 'string' ? json.detail : null;
        throw new Error(detail ? `${msg} — ${detail}` : msg);
      }

      const current = getActiveWorkspaceId();
      if (current === deleteId) clearActiveWorkspaceId();

      setDeleteId(null);
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }, [deleteId, fetchList]);

  const canCreate = newName.trim().length > 0 && !busy && !loading;

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="mt-1 text-sm text-white/70">Crea, renombra y gestiona tus workspaces.</p>
      </div>

      {error ? (
        <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT: create (1/3) */}
        <div className="card-glass rounded-2xl border border-white/10 bg-white/5 p-5 lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-white">Nuevo workspace</p>
              <p className="mt-1 text-sm text-white/70">
                Crea un espacio para tu equipo y tus integraciones.
              </p>
            </div>
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">Setup</span>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs text-white/60">Nombre</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-indigo-400/50"
              placeholder="Ej: Mi agencia"
              autoComplete="organization"
            />
          </div>

          <div className="mt-4 flex items-center justify-end">
            {/* ✅ EXACTO al de "+ Nueva campaña" */}
            <button
              type="button"
              onClick={() => void createWorkspace()}
              disabled={!canCreate}
              className={cx(
                'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
                !canCreate
                  ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                  : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
              )}
            >
              {busy ? 'Creando…' : '+ Crear workspace'}
            </button>
          </div>

          <p className="mt-3 text-xs text-white/45">
            Tip: podrás renombrarlo y cambiar el workspace activo cuando quieras.
          </p>
        </div>

        {/* RIGHT: list (2/3) */}
        <div className="card-glass rounded-2xl border border-white/10 bg-white/5 p-6 lg:col-span-2">
          <div className="mb-3 text-sm text-white/60">Tus workspaces</div>

          {loading ? (
            <div className="text-sm text-white/60">Cargando…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-white/60">Aún no tienes workspaces.</div>
          ) : (
            <div className="space-y-3">
              {items.map((w) => (
                <div
                  key={w.id}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="text-white font-semibold flex items-center gap-2">
                      {w.name}
                      <span className="text-xs px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/70">
                        {w.role}
                      </span>
                      {activeId === w.id ? (
                        <span className="text-xs px-2 py-1 rounded-full border border-emerald-300/20 bg-emerald-500/10 text-emerald-200">
                          activo
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-white/50 mt-1">{w.slug}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveWorkspaceId(w.id)}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs border border-white/10"
                      disabled={busy}
                    >
                      Usar
                    </button>

                    <button
                      onClick={() => {
                        setRenameId(w.id);
                        setRenameName(w.name);
                      }}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs border border-white/10"
                      disabled={busy}
                    >
                      Renombrar
                    </button>

                    <button
                      onClick={() => setDeleteId(w.id)}
                      className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-red-200 text-xs border border-red-300/20"
                      disabled={busy || w.role !== 'owner'}
                      title={w.role !== 'owner' ? 'Solo owner puede borrar' : 'Borrar workspace'}
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal rename */}
      {renameId ? (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[6px] flex items-center justify-center p-4 z-[99]">
          <div className="w-full max-w-[560px] card-glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-white">Renombrar workspace</p>
                <p className="mt-2 text-sm text-white/70">Cambia el nombre visible del workspace.</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setRenameId(null);
                  setRenameName('');
                }}
                disabled={busy}
                className={cx(
                  'rounded-xl border px-3 py-2 text-sm transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4">
              <input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              />
            </div>

            <div className="mt-5 flex items-center justify-center">
              <button
                type="button"
                onClick={() => void renameWorkspace()}
                disabled={busy}
                className={cx(
                  'rounded-xl border px-4 py-2 text-sm transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                )}
              >
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal delete */}
      {deleteId ? (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[6px] flex items-center justify-center p-4 z-[99]">
          <div className="w-full max-w-[560px] card-glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-white">Borrar workspace</p>
                <p className="mt-2 text-sm text-white/70">
                  Esta acción es irreversible. Se eliminará el workspace y sus memberships.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setDeleteId(null)}
                disabled={busy}
                className={cx(
                  'rounded-xl border px-3 py-2 text-sm transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                disabled={busy}
                className={cx(
                  'rounded-xl border px-4 py-2 text-sm transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                )}
              >
                Volver
              </button>

              <button
                type="button"
                onClick={() => void deleteWorkspace()}
                disabled={busy}
                className={cx(
                  'rounded-xl border px-4 py-2 text-sm transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/15'
                )}
              >
                {busy ? 'Borrando…' : 'Sí, borrar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
