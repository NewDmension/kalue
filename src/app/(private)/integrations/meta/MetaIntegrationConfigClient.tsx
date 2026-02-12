// MetaIntegrationConfigClient.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

type ProviderKey = 'meta';
type IntegrationStatus = 'draft' | 'connected' | 'error';

type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: ProviderKey;
  name: string;
  status: IntegrationStatus;
  created_at: string;
  config?: unknown;
  secrets?: unknown;
};

type MetaPage = { id: string; name: string };

type OAuthResultMessage =
  | {
      type: 'KALUE_META_OAUTH_RESULT';
      ok: true;
      integrationId: string;
      workspaceId: string;
    }
  | {
      type: 'KALUE_META_OAUTH_RESULT';
      ok: false;
      error: string;
      errorDescription?: string;
      detail?: unknown;
    };

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeId(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low === 'undefined' || low === 'null') return '';
  return s;
}

async function getAccessToken(): Promise<string> {
  const supabase = supabaseBrowser();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: true, text };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw;
  if (isRecord(raw)) {
    const base = typeof raw.error === 'string' ? raw.error : fallback;
    const detail = typeof raw.detail === 'string' ? raw.detail : '';
    const hint = typeof raw.hint === 'string' ? raw.hint : '';
    const code = typeof raw.code === 'string' ? raw.code : '';

    const extras = [detail && `detail: ${detail}`, hint && `hint: ${hint}`, code && `code: ${code}`]
      .filter(Boolean)
      .join('\n');

    return extras ? `${base}\n${extras}` : base;
  }
  return fallback;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function postJson(args: {
  url: string;
  token: string;
  workspaceId: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  return fetch(args.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.token}`,
      'x-workspace-id': args.workspaceId,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });
}

function openOauthPopup(url: string): Window | null {
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
    return null;
  }

  try {
    win.focus();
  } catch {
    // no-op
  }

  return win;
}

function statusBadge(status: IntegrationStatus): { text: string; className: string } {
  if (status === 'connected') {
    return { text: 'LIVE', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' };
  }
  if (status === 'error') {
    return { text: 'ERROR', className: 'border-red-400/30 bg-red-500/10 text-red-200' };
  }
  return { text: 'DRAFT', className: 'border-white/15 bg-white/5 text-white/70' };
}

async function fetchPages(args: { integrationId: string; workspaceId: string; token: string }): Promise<MetaPage[]> {
  const res = await fetch(`/api/integrations/meta/pages?integrationId=${encodeURIComponent(args.integrationId)}`, {
    method: 'GET',
    headers: {
      'x-workspace-id': args.workspaceId,
      // no hace daño: algunas rutas lo ignoran, pero si mañana cambias a Bearer, ya está listo
      authorization: `Bearer ${args.token}`,
    },
  });

  const raw = await safeJson(res);
  if (!res.ok) {
    throw new Error(pickErrorMessage(raw, `No se pudieron cargar Pages (${res.status})`));
  }

  const pagesRaw = isRecord(raw) ? raw.pages : null;
  if (!Array.isArray(pagesRaw)) return [];

  const pages: MetaPage[] = [];
  for (const p of pagesRaw) {
    if (isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string') {
      pages.push({ id: p.id, name: p.name });
    }
  }
  return pages;
}

function useWorkspaceIdReady(): { workspaceId: string; ready: boolean } {
  const [workspaceId, setWorkspaceId] = useState<string>('');

  useEffect(() => {
    const fromLib = (getActiveWorkspaceId() ?? '').trim();
    if (fromLib) {
      setWorkspaceId(fromLib);
      return;
    }

    // fallback a localStorage
    try {
      const fromLs = (window.localStorage.getItem('kalue.activeWorkspaceId') ?? '').trim();
      if (fromLs) setWorkspaceId(fromLs);
    } catch {
      // ignore
    }
  }, []);

  return { workspaceId, ready: workspaceId.length > 0 };
}

export default function MetaIntegrationConfigClient({ integrationId }: { integrationId: string }) {
  const searchParams = useSearchParams();
  const { workspaceId, ready } = useWorkspaceIdReady();

  const originRef = useRef<string>('');
  const pollTimerRef = useRef<number | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
  const [oauthBusy, setOauthBusy] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [pagesLoading, setPagesLoading] = useState<boolean>(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[]>([]);

  const normalizedId = useMemo(() => normalizeId(integrationId), [integrationId]);

  const stopPolling = useCallback((): void => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollDeadlineRef.current = 0;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') originRef.current = window.location.origin;
  }, []);

  const loadIntegration = useCallback(async (): Promise<IntegrationRow | null> => {
    setLoading(true);
    setError(null);

    if (!ready) {
      setLoading(false);
      setError('No hay workspace activo (aún). Abre el selector de workspace y vuelve a entrar.');
      return null;
    }

    if (!normalizedId) {
      setLoading(false);
      setError('No se recibió un Integration ID válido en la ruta. Vuelve a Integraciones y reintenta.');
      return null;
    }

    if (!isUuid(normalizedId)) {
      setLoading(false);
      setError(`Integration ID inválido. Valor recibido: ${normalizedId}`);
      return null;
    }

    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError('Para configurar integraciones necesitas iniciar sesión.');
      return null;
    }

    try {
      const url = `/api/integrations/get?integrationId=${encodeURIComponent(normalizedId)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'x-workspace-id': workspaceId,
        },
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        setLoading(false);
        setError(pickErrorMessage(raw, `No se pudo cargar (${res.status})`));
        return null;
      }

      const row = isRecord(raw) ? raw.integration : null;
      if (!isRecord(row)) {
        setLoading(false);
        setError('Respuesta inválida del servidor.');
        return null;
      }

      const id = typeof row.id === 'string' ? row.id : String(row.id);
      const workspace_id = typeof row.workspace_id === 'string' ? row.workspace_id : String(row.workspace_id);

      const statusRaw = row.status;
      const status: IntegrationStatus =
        statusRaw === 'connected' || statusRaw === 'error' || statusRaw === 'draft' ? statusRaw : 'draft';

      const parsed: IntegrationRow = {
        id,
        workspace_id,
        provider: 'meta',
        name: typeof row.name === 'string' ? row.name : '',
        status,
        created_at: typeof row.created_at === 'string' ? row.created_at : '',
        config: row.config,
        secrets: row.secrets,
      };

      setIntegration(parsed);
      setLoading(false);
      return parsed;
    } catch (e: unknown) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Error cargando integración');
      return null;
    }
  }, [normalizedId, ready, workspaceId]);

  const loadPages = useCallback(async (): Promise<void> => {
    setPagesError(null);
    setPages([]);

    if (!ready) return;
    if (!normalizedId || !isUuid(normalizedId)) return;

    const token = await getAccessToken();
    if (!token) {
      setPagesError('Sin sesión. Vuelve a iniciar sesión.');
      return;
    }

    setPagesLoading(true);
    try {
      const data = await fetchPages({ integrationId: normalizedId, workspaceId, token });
      setPages(data);
      setPagesLoading(false);
    } catch (e: unknown) {
      setPagesLoading(false);
      setPagesError(e instanceof Error ? e.message : 'Error cargando Pages');
    }
  }, [normalizedId, ready, workspaceId]);

  // Carga inicial
  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  // Cuando cambia a connected, intenta páginas
  useEffect(() => {
    if (integration?.status === 'connected') {
      void loadPages();
    } else {
      setPages([]);
      setPagesError(null);
      setPagesLoading(false);
    }
  }, [integration?.status, loadPages]);

  // Compat: query params (por si aún se usan)
  useEffect(() => {
    const oauth = searchParams.get('oauth');

    if (oauth === 'success') {
      setInfo('Conexión completada. Actualizando estado…');
      void loadIntegration().then((row) => {
        if (row?.status === 'connected') setInfo('Meta conectada ✅');
        window.setTimeout(() => setInfo(null), 2500);
      });
      return;
    }

    if (oauth === 'error') {
      const msg = searchParams.get('message') ?? 'No se pudo completar la conexión con Meta.';
      setError(msg);
      return;
    }

    if (oauth === 'cancelled') {
      setInfo('Conexión cancelada.');
      window.setTimeout(() => setInfo(null), 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ✅ postMessage del popup + fallback polling
  useEffect(() => {
    function onMessage(ev: MessageEvent<unknown>): void {
      if (!originRef.current) return;
      if (ev.origin !== originRef.current) return;

      const data = ev.data;
      if (!isRecord(data)) return;
      if (data.type !== 'KALUE_META_OAUTH_RESULT') return;

      const msg = data as OAuthResultMessage;

      if (msg.ok) {
        stopPolling();
        setError(null);
        setInfo('Conexión completada. Actualizando estado…');

        void (async () => {
          const row = await loadIntegration();
          if (row?.status === 'connected') {
            await loadPages();
            setInfo('Meta conectada ✅');
            window.setTimeout(() => setInfo(null), 2500);
          } else {
            // si por lo que sea el status aún no refleja, deja info y el usuario puede refrescar
            setInfo('OAuth OK. Esperando que el servidor refleje el estado…');
            window.setTimeout(() => setInfo(null), 4000);
          }
        })();

        return;
      }

      // msg.ok === false
      stopPolling();

      const desc = msg.errorDescription ?? '';
      const detail = msg.detail;
      const composed = desc
        ? `${msg.error}\n\n${desc}`
        : detail
          ? `${msg.error}\n\n${safeStringify(detail)}`
          : msg.error;

      setInfo(null);
      setError(composed);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadIntegration, loadPages, stopPolling]);

  const startPollingUntilConnected = useCallback(() => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + 45_000; // 45s

    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        // timeout
        if (pollDeadlineRef.current && Date.now() > pollDeadlineRef.current) {
          stopPolling();
          return;
        }

        const row = await loadIntegration();
        if (row?.status === 'connected') {
          stopPolling();
          await loadPages();
          setInfo('Meta conectada ✅');
          window.setTimeout(() => setInfo(null), 2500);
        }
      })();
    }, 1200);
  }, [loadIntegration, loadPages, stopPolling]);

  const handleConnectMeta = useCallback(async () => {
    if (oauthBusy) return;

    setError(null);
    setInfo(null);

    if (!ready) {
      setError('No hay workspace activo. Selecciona uno primero.');
      return;
    }

    if (!normalizedId || !isUuid(normalizedId)) {
      setError('No hay Integration ID válido para iniciar OAuth.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setError('Para conectar con Meta necesitas iniciar sesión.');
      return;
    }

    setOauthBusy(true);

    try {
      const res = await postJson({
        url: '/api/integrations/meta/oauth/start',
        token,
        workspaceId,
        body: { integrationId: normalizedId },
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        setOauthBusy(false);
        setError(pickErrorMessage(raw, `No se pudo iniciar OAuth (${res.status})`));
        return;
      }

      const url = isRecord(raw) && typeof raw.url === 'string' ? raw.url : '';
      if (!url) {
        setOauthBusy(false);
        setError('Respuesta inválida: falta url.');
        return;
      }

      // abre popup
      setOauthBusy(false);
      openOauthPopup(url);

      // feedback + fallback (por si postMessage no llega por cualquier motivo)
      setInfo('Abriendo ventana de conexión…');
      window.setTimeout(() => setInfo('Esperando confirmación de Meta…'), 900);
      startPollingUntilConnected();
    } catch (e: unknown) {
      setOauthBusy(false);
      setError(e instanceof Error ? e.message : 'Error iniciando OAuth');
    }
  }, [normalizedId, oauthBusy, ready, startPollingUntilConnected, workspaceId]);

  // Seguridad: si desmonta la página, para polling
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const status: IntegrationStatus = integration?.status ?? 'draft';
  const b = statusBadge(status);
  const isConnected = status === 'connected';

  return (
    <div className="p-6 text-white">
      <div className="card-glass rounded-2xl border border-white/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">Meta Lead Ads</h1>
            <p className="mt-1 text-sm text-white/70">
              Conecta tu cuenta de Meta para que este workspace pueda recibir leads de formularios (Lead Ads).
            </p>
            <p className="mt-2 text-xs text-white/45">
              Workspace: <span className="font-mono text-white/70">{ready ? workspaceId : '(cargando...)'}</span>
            </p>
            <p className="mt-1 text-xs text-white/45">
              Integration ID: <span className="font-mono text-white/70">{normalizedId || '(vacío)'}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', b.className)}>{b.text}</span>

            <button
              type="button"
              onClick={() => void handleConnectMeta()}
              disabled={oauthBusy || !ready}
              className={cx(
                'rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15 transition',
                oauthBusy || !ready ? 'opacity-60 cursor-not-allowed' : ''
              )}
              title={isConnected ? 'Reautoriza Meta (si cambias permisos o el token expira)' : 'Conecta con Meta (OAuth)'}
            >
              {oauthBusy ? 'Conectando…' : isConnected ? 'Re-conectar' : 'Conectar'}
            </button>

            <button
              type="button"
              onClick={() => void loadIntegration()}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Refrescar
            </button>

            <Link
              href="/integrations"
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
            >
              Volver
            </Link>
          </div>
        </div>

        {loading ? <p className="mt-4 text-sm text-white/60">Cargando…</p> : null}

        {info ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {info}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200 whitespace-pre-line">
            {error}
          </div>
        ) : null}

        {integration ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold text-white/90">Estado de la conexión</p>

              <div className="mt-3 grid gap-2 text-xs text-white/65">
                <div>
                  <span className="text-white/50">Nombre:</span>{' '}
                  <span className="text-white/80">{integration.name || 'Integración Meta'}</span>
                </div>
                <div>
                  <span className="text-white/50">Provider:</span>{' '}
                  <span className="font-mono text-white/75">{integration.provider}</span>
                </div>
                <div>
                  <span className="text-white/50">Status:</span>{' '}
                  <span className="font-mono text-white/75">{integration.status}</span>
                </div>
                <div>
                  <span className="text-white/50">Workspace:</span>{' '}
                  <span className="font-mono text-white/75">{integration.workspace_id}</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/65">
                <p className="text-white/80 font-semibold">¿Qué hace esta conexión?</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>Autoriza a Kalue a acceder a tus assets de Lead Ads (según permisos).</li>
                  <li>Guarda el token cifrado por workspace (no en texto plano).</li>
                  <li>Permite listar Pages y (cuando toque) Lead Forms y leads.</li>
                </ul>
              </div>

              {isConnected ? (
                <div className="mt-4 text-sm text-emerald-200">
                  ✅ Conectado. Si cambias permisos en Meta o tienes problemas, usa{' '}
                  <span className="font-semibold">Re-conectar</span>.
                </div>
              ) : (
                <div className="mt-4 text-sm text-white/70">
                  Aún no está conectado. Pulsa <span className="font-semibold text-white/85">Conectar</span> para completar OAuth.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white/90">Pages detectadas</p>
                  <p className="mt-1 text-xs text-white/60">Si no aparecen Pages, no podremos listar Lead Forms.</p>
                </div>

                <button
                  type="button"
                  onClick={() => void loadPages()}
                  disabled={!isConnected || pagesLoading}
                  className={cx(
                    'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10',
                    !isConnected || pagesLoading ? 'opacity-60 cursor-not-allowed' : ''
                  )}
                >
                  {pagesLoading ? 'Buscando…' : 'Revisar Pages'}
                </button>
              </div>

              {pagesError ? (
                <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-xs text-red-200 whitespace-pre-line">
                  {pagesError}
                </div>
              ) : null}

              {isConnected && !pagesLoading && !pagesError && pages.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-200">
                  <p className="font-semibold">⚠️ No se encontraron Pages para esta cuenta.</p>
                  <p className="mt-2 text-xs text-amber-100/80 leading-relaxed">
                    Si tu usuario SÍ tiene Pages, esto normalmente es: permisos en la integración comercial, o el usuario conectado no es
                    el que administra esas Pages en el Business Manager.
                  </p>
                </div>
              ) : null}

              {pages.length > 0 ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">
                  <p className="text-white/90 font-semibold">Pages disponibles ({pages.length})</p>
                  <ul className="mt-2 space-y-2">
                    {pages.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-white/90">{p.name}</div>
                          <div className="font-mono text-[11px] text-white/45">{p.id}</div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70">
                          detectada
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                <p className="text-white/90 font-semibold">Siguiente (cuando haya Pages)</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>Elegir Page</li>
                  <li>Listar y elegir Lead Form</li>
                  <li>Guardar mapping (Page + Form)</li>
                  <li>Suscribir Webhook (leadgen)</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
