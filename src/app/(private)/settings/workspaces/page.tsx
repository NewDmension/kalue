'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('Para ver Workspaces necesitas iniciar sesión.');

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

      // Si no hay active workspace, setear el primero
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
  }, [fetchList]);

  const createWorkspace = useCallback(async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('No session');

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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('No session');

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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('No session');

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

  return (
    <div className="p-6">
      <div className="card-glass rounded-2xl p-6 border border-white/10 bg-white/5">
        <div className="text-2xl font-semibold text-white">Workspaces</div>
        <div className="mt-1 text-sm text-white/70">Crea, renombra y gestiona tus workspaces.</div>

        {error ? (
          <div className="mt-4 text-sm text-red-200 bg-red-500/10 border border-red-300/20 rounded-xl p-3">{error}</div>
        ) : null}

        <div className="mt-6 flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-sm text-white/70 mb-2">Nuevo workspace</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-black/30 text-white border border-white/10 outline-none"
              placeholder="Ej: Mi agencia"
            />
          </div>

          <button
            onClick={() => void createWorkspace()}
            disabled={busy || loading}
            className="px-5 py-3 rounded-2xl bg-indigo-600/90 hover:bg-indigo-600 text-white text-sm border border-white/10 disabled:opacity-50"
          >
            Crear
          </button>
        </div>

        <div className="mt-8">
          <div className="text-sm text-white/60 mb-2">Tus workspaces</div>

          {loading ? (
            <div className="text-white/60 text-sm">Cargando…</div>
          ) : items.length === 0 ? (
            <div className="text-white/60 text-sm">Aún no tienes workspaces.</div>
          ) : (
            <div className="space-y-3">
              {items.map((w) => (
                <div key={w.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 flex items-center justify-between">
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
                      className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs border border-white/10"
                      disabled={busy}
                    >
                      Usar
                    </button>

                    <button
                      onClick={() => {
                        setRenameId(w.id);
                        setRenameName(w.name);
                      }}
                      className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs border border-white/10"
                      disabled={busy}
                    >
                      Renombrar
                    </button>

                    <button
                      onClick={() => setDeleteId(w.id)}
                      className="px-4 py-2 rounded-2xl bg-red-500/10 hover:bg-red-500/15 text-red-200 text-xs border border-red-300/20"
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

        {/* Modal rename (simple inline) */}
        {renameId ? (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
            <div className="card-glass rounded-2xl p-6 border border-white/10 bg-white/5 w-full max-w-lg">
              <div className="text-white font-semibold text-lg">Renombrar workspace</div>
              <div className="mt-4">
                <input
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-black/30 text-white border border-white/10 outline-none"
                />
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  className="px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
                  onClick={() => {
                    setRenameId(null);
                    setRenameName('');
                  }}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  className="px-5 py-3 rounded-2xl bg-indigo-600/90 hover:bg-indigo-600 text-white text-sm border border-white/10"
                  onClick={() => void renameWorkspace()}
                  disabled={busy}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal delete */}
        {deleteId ? (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
            <div className="card-glass rounded-2xl p-6 border border-white/10 bg-white/5 w-full max-w-lg">
              <div className="text-white font-semibold text-lg">Borrar workspace</div>
              <div className="mt-2 text-sm text-white/70">
                Esta acción es irreversible. Se eliminará el workspace y sus memberships.
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  className="px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
                  onClick={() => setDeleteId(null)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  className="px-5 py-3 rounded-2xl bg-red-500/15 hover:bg-red-500/20 text-red-200 text-sm border border-red-300/20"
                  onClick={() => void deleteWorkspace()}
                  disabled={busy}
                >
                  Sí, borrar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
