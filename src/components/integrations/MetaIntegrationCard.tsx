'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useSearchParams } from 'next/navigation';

type MetaStatusResp =
  | {
      exists: false;
      status: 'disconnected';
      config: { step: null; page_id: null; page_name: null };
    }
  | {
      exists: true;
      id: string;
      status: string;
      connected_at: string | null;
      updated_at: string | null;
      config: { step: string | null; page_id: string | null; page_name: string | null };
    };

type MetaPage = { id: string; name: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function getPagesFromJson(v: unknown): MetaPage[] {
  if (!isRecord(v)) return [];
  const pages = v.pages;
  if (!Array.isArray(pages)) return [];
  const out: MetaPage[] = [];
  for (const p of pages) {
    if (!isRecord(p)) continue;
    const id = getString(p.id);
    const name = getString(p.name);
    if (id && name) out.push({ id, name });
  }
  return out;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Abre OAuth en popup centrado. Si el navegador bloquea popups, fallback a redirect normal.
 */
function openOauthPopup(url: string) {
  const width = 540;
  const height = 720;

  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  const win = window.open(url, 'kalue_meta_oauth', features);

  if (!win) {
    window.location.href = url;
    return;
  }

  try {
    win.focus();
  } catch {
    // ignore
  }
}

export default function MetaIntegrationCard(props: { workspaceId: string }) {
  const { workspaceId } = props;

  const searchParams = useSearchParams();

  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<MetaStatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pages, setPages] = useState<MetaPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('');

  // 1) Cargar sesión + escuchar cambios
  useEffect(() => {
    let mounted = true;

    const load = async (): Promise<void> => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token ?? null;
      if (mounted) setAccessToken(t);
    };

    void load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const fetchStatus = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      setError('Missing workspaceId');
      setLoading(false);
      return;
    }
    if (!accessToken) {
      setError(null);
      setLoading(false);
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/meta/status', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': workspaceId,
        },
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof json.error === 'string' ? json.error : 'Failed to load status';
        throw new Error(msg);
      }

      setStatus(json as MetaStatusResp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  // 2) Refrescar estado cuando haya sesión
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // ✅ Al volver del OAuth, refrescar solo (si tu callback redirige con oauth=success/error/cancelled)
  useEffect(() => {
    const oauth = (searchParams.get('oauth') ?? '').trim().toLowerCase();
    if (oauth === 'success' || oauth === 'error' || oauth === 'cancelled') {
      void fetchStatus();
    }
  }, [searchParams, fetchStatus]);

  const handleConnect = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (!accessToken) throw new Error('Login required');
      if (!workspaceId) throw new Error('Missing workspaceId');

      const res = await fetch('/api/integrations/meta/start', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': workspaceId,
        },
      });

      const json: unknown = await res.json().catch(() => null);
      const url = isRecord(json) ? getString((json as Record<string, unknown>).url) : null;
      if (!res.ok || !url) throw new Error('Failed to start Meta OAuth');

      // ✅ Popup centrado (fallback a redirect si bloquean popup)
      openOauthPopup(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [accessToken, workspaceId]);

  const handleLoadPages = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (!accessToken) throw new Error('Login required');
      if (!workspaceId) throw new Error('Missing workspaceId');

      const res = await fetch('/api/integrations/meta/pages', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': workspaceId,
        },
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof (json as Record<string, unknown>).error === 'string'
          ? String((json as Record<string, unknown>).error)
          : 'Failed to list pages';
        throw new Error(msg);
      }

      const p = getPagesFromJson(json);
      setPages(p);
      if (p.length > 0) setSelectedPageId(p[0]!.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setPages([]);
    }
  }, [accessToken, workspaceId]);

  const handleSavePage = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (!accessToken) throw new Error('Login required');
      if (!workspaceId) throw new Error('Missing workspaceId');

      const page = pages.find((p) => p.id === selectedPageId) ?? null;
      if (!page) throw new Error('Select a page');

      const res = await fetch('/api/integrations/meta/connect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_id: page.id, page_name: page.name }),
      });

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRecord(json) && typeof (json as Record<string, unknown>).error === 'string'
          ? String((json as Record<string, unknown>).error)
          : 'Failed to connect page';
        throw new Error(msg);
      }

      await fetchStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [accessToken, workspaceId, pages, selectedPageId, fetchStatus]);

  const view = useMemo(() => {
    if (!accessToken) return { state: 'login_required' as const };
    if (!status) return { state: 'unknown' as const };
    if (!status.exists) return { state: 'disconnected' as const };
    const step = status.config.step;
    const isConnected = status.status === 'connected' && !!status.config.page_id;
    if (isConnected) return { state: 'connected' as const };
    if (step === 'page_select') return { state: 'needs_page' as const };
    return { state: 'pending' as const };
  }, [accessToken, status]);

  const badge = useMemo(() => {
    if (loading) return { label: 'Cargando…', cls: 'border-white/10 bg-white/5 text-white/80' };

    if (view.state === 'connected') {
      return { label: 'LIVE', cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' };
    }

    if (view.state === 'disconnected') {
      return { label: 'DISCONNECTED', cls: 'border-white/10 bg-white/5 text-white/70' };
    }

    if (view.state === 'needs_page') {
      return { label: 'NEEDS PAGE', cls: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200' };
    }

    if (view.state === 'pending') {
      return { label: 'PENDING', cls: 'border-white/10 bg-white/5 text-white/70' };
    }

    if (view.state === 'login_required') {
      return { label: 'LOGIN', cls: 'border-white/10 bg-white/5 text-white/70' };
    }

    return { label: '—', cls: 'border-white/10 bg-white/5 text-white/70' };
  }, [loading, view.state]);

  const connectBtnLabel = view.state === 'connected' ? 'Re-conectar Meta' : 'Conectar Meta';

  return (
    <div className="card-glass rounded-2xl p-5 border border-white/10 bg-white/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-white">Meta Lead Ads</div>
          <div className="text-sm text-white/70 mt-1">Conecta una Facebook Page y recibe leads en tiempo real.</div>
        </div>

        <div className={cx('text-xs px-2 py-1 rounded-full border', badge.cls)}>
          {badge.label}
        </div>
      </div>

      {error ? (
        <div className="mt-4 text-sm text-red-200 bg-red-500/10 border border-red-300/20 rounded-xl p-3">
          {error}
        </div>
      ) : null}

      {view.state === 'login_required' ? (
        <div className="mt-5 text-sm text-white/80">
          Para conectar Meta necesitas iniciar sesión en Kalue.
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* ✅ Botón SIEMPRE visible (si hay sesión). Connected => Re-conectar */}
        {view.state !== 'login_required' ? (
          <button
            onClick={() => void handleConnect()}
            className={cx(
              'px-4 py-2 rounded-xl text-white text-sm font-medium border border-white/10',
              view.state === 'connected'
                ? 'bg-emerald-600/20 hover:bg-emerald-600/30'
                : 'bg-indigo-600/90 hover:bg-indigo-600'
            )}
          >
            {connectBtnLabel}
          </button>
        ) : null}

        {view.state === 'needs_page' || view.state === 'pending' ? (
          <>
            <button
              onClick={() => void handleLoadPages()}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium border border-white/10"
            >
              Cargar Pages
            </button>

            {pages.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-black/30 text-white text-sm border border-white/10"
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => void handleSavePage()}
                  className="px-4 py-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-600 text-white text-sm font-medium border border-white/10"
                >
                  Guardar Page
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {view.state === 'connected' && status && status.exists ? (
          <div className="text-sm text-white/80">
            ✅ Conectado: <span className="text-white">{status.config.page_name ?? 'Page'}</span>
          </div>
        ) : null}

        <button
          onClick={() => void fetchStatus()}
          className="ml-auto px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
        >
          Refrescar
        </button>
      </div>

      <div className="mt-4 text-xs text-white/50">
        Nota: si la UI de Meta no muestra “leadgen”, no pasa nada. La suscripción real se activa al “Guardar Page”.
      </div>
    </div>
  );
}
