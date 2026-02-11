'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

    const nonJson =
      raw._nonJson === true && typeof raw.text === 'string'
        ? `nonJson: ${raw.text.slice(0, 220)}${raw.text.length > 220 ? '…' : ''}`
        : '';

    const extras = [detail && `detail: ${detail}`, hint && `hint: ${hint}`, code && `code: ${code}`, nonJson]
      .filter(Boolean)
      .join('\n');

    return extras ? `${base}\n${extras}` : base;
  }

  return fallback;
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
    // no-op
  }
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

function parsePagesPayload(raw: unknown): { pages: MetaPage[]; rawCount: number } {
  if (!isRecord(raw)) return { pages: [], rawCount: 0 };

  const pagesRaw = raw.pages;
  const rawCount = typeof raw.rawCount === 'number' && Number.isFinite(raw.rawCount) ? raw.rawCount : 0;

  if (!Array.isArray(pagesRaw)) return { pages: [], rawCount };

  const pages: MetaPage[] = pagesRaw
    .map((p: unknown) => {
      if (!isRecord(p)) return null;
      const id = typeof p.id === 'string' ? p.id : '';
      const name = typeof p.name === 'string' ? p.name : '';
      if (!id || !name) return null;
      return { id, name };
    })
    .filter((v): v is MetaPage => v !== null);

  return { pages, rawCount };
}

export default function MetaIntegrationConfigClient({ integrationId }: { integrationId: string }) {
  const searchParams = useSearchParams();
  const workspaceId = useMemo(() => getActiveWorkspaceId(), []);

  const [loading, setLoading] = useState<boolean>(true);
  const [oauthBusy, setOauthBusy] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);

  const [info, setInfo] = useState<string | null>(null);

  // Pages detectadas
  const [pagesBusy, setPagesBusy] = useState<boolean>(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [rawCount, setRawCount] = useState<number>(0);
  const [pagesCheckedAt, setPagesCheckedAt] = useState<string | null>(null);

  const normalizedId = useMemo(() => normalizeId(integrationId), [integrationId]);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!normalizedId) {
      setLoading(false);
      setError('No se recibió un Integration ID válido en la ruta. Vuelve a Integraciones y reintenta.');
      return;
    }

    if (!isUuid(normalizedId)) {
      setLoading(false);
      setError(`Integration ID inválido. Valor recibido: ${normalizedId}`);
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError('Para configurar integraciones necesitas iniciar sesión.');
      return;
    }

    if (!workspaceId) {
      setLoading(false);
      setError('No hay workspace activo. Selecciona uno primero.');
      return;
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
        return;
      }

      const row = isRecord(raw) ? raw.integration : null;
      if (!isRecord(row)) {
        setLoading(false);
        setError('Respuesta inválida del servidor.');
        return;
      }

      const id = typeof row.id === 'string' ? row.id : String(row.id);
      const workspace_id = typeof row.workspace_id === 'string' ? row.workspace_id : String(row.workspace_id);
      const provider: ProviderKey = 'meta';

      const statusRaw = row.status;
      const status: IntegrationStatus =
        statusRaw === 'connected' || statusRaw === 'error' || statusRaw === 'draft' ? statusRaw : 'draft';

      const parsed: IntegrationRow = {
        id,
        workspace_id,
        provider,
        name: typeof row.name === 'string' ? row.name : '',
        status,
        created_at: typeof row.created_at === 'string' ? row.created_at : '',
        config: row.config,
        secrets: row.secrets,
      };

      setIntegration(parsed);
      setLoading(false);
    } catch (e: unknown) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Error cargando integración');
    }
  }, [normalizedId, workspaceId]);

  const loadPages = useCallback(async () => {
    setPagesBusy(true);
    setPagesError(null);

    if (!normalizedId || !isUuid(normalizedId)) {
      setPagesBusy(false);
      setPagesError('No hay Integration ID válido para listar Pages.');
      return;
    }

    if (!workspaceId) {
      setPagesBusy(false);
      setPagesError('No hay workspace activo. Selecciona uno primero.');
      return;
    }

    try {
      const token = await getAccessToken();

      const url = `/api/integrations/meta/pages?integrationId=${encodeURIComponent(normalizedId)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-workspace-id': workspaceId,
        },
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        setPagesBusy(false);
        setPagesError(pickErrorMessage(raw, `No se pudo listar Pages (${res.status})`));
        return;
      }

      const parsed = parsePagesPayload(raw);
      setPages(parsed.pages);
      setRawCount(parsed.rawCount);
      setPagesCheckedAt(new Date().toISOString());
      setPagesBusy(false);
    } catch (e: unknown) {
      setPagesBusy(false);
      setPagesError(e instanceof Error ? e.message : 'Error listando Pages');
    }
  }, [normalizedId, workspaceId]);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  useEffect(() => {
    const oauth = searchParams.get('oauth');

    if (oauth === 'success') {
      setInfo('Conexión completada. Actualizando estado…');
      void loadIntegration().then(() => {
        setInfo('Meta conectada ✅');
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

  // Auto-load pages una vez cuando está conectado
  useEffect(() => {
    if (!integration) return;
    if (integration.status !== 'connected') return;
    if (pagesCheckedAt) return;
    void loadPages();
  }, [integration, loadPages, pagesCheckedAt]);

  const handleConnectMeta = useCallback(async () => {
    if (oauthBusy) return;

    setError(null);
    setInfo(null);

    if (!normalizedId || !isUuid(normalizedId)) {
      setError('No hay Integration ID válido para iniciar OAuth.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setError('Para conectar con Meta necesitas iniciar sesión.');
      return;
    }

    if (!workspaceId) {
      setError('No hay workspace activo. Selecciona uno primero.');
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

      // reset pages para forzar re-check tras reconectar
      setPages([]);
      setRawCount(0);
      setPagesCheckedAt(null);

      setOauthBusy(false);
      openOauthPopup(url);
    } catch (e: unknown) {
      setOauthBusy(false);
      setError(e instanceof Error ? e.message : 'Error iniciando OAuth');
    }
  }, [normalizedId, oauthBusy, workspaceId]);

  const b = statusBadge(integration?.status ?? 'draft');
  const isConnected = integration?.status === 'connected';
  const hasNoPages = isConnected && !pagesBusy && pages.length === 0;

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
              Integration ID: <span className="font-mono text-white/70">{normalizedId || '(vacío)'}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', b.className)}>{b.text}</span>

            <button
              type="button"
              onClick={() => void handleConnectMeta()}
              disabled={oauthBusy}
              className={cx(
                'rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15 transition',
                oauthBusy ? 'opacity-60 cursor-not-allowed' : '',
              )}
              title="Reautoriza Meta (útil si cambias permisos o si el token expira)"
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
                  <li>Permite que este workspace reciba leads y los procese en tu inbox/pipeline.</li>
                </ul>
              </div>

              {isConnected ? (
                <div className="mt-4 text-sm text-emerald-200">
                  ✅ Conectado. Si cambias permisos en Meta o tienes problemas, usa <span className="font-semibold">Re-conectar</span>.
                </div>
              ) : (
                <div className="mt-4 text-sm text-white/70">
                  Aún no está conectado. Pulsa <span className="font-semibold text-white/85">Conectar</span> para completar OAuth.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white/90">Pages detectadas</p>
                  <p className="mt-1 text-xs text-white/60">
                    Si no aparecen Pages, este workspace no podrá listar Lead Forms ni recibir leads.
                  </p>
                  <p className="mt-2 text-[11px] text-white/45">
                    rawCount: <span className="font-mono text-white/70">{rawCount}</span>
                    {pagesCheckedAt ? (
                      <span className="ml-2">
                        · revisado <span className="font-mono">{new Date(pagesCheckedAt).toLocaleString()}</span>
                      </span>
                    ) : null}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void loadPages()}
                  disabled={!isConnected || pagesBusy}
                  className={cx(
                    'rounded-xl border px-3 py-2 text-xs transition',
                    !isConnected
                      ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                      : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10',
                    pagesBusy ? 'opacity-60 cursor-not-allowed' : '',
                  )}
                  title={!isConnected ? 'Primero conecta Meta' : 'Vuelve a consultar /me/accounts'}
                >
                  {pagesBusy ? 'Revisando…' : 'Revisar Pages'}
                </button>
              </div>

              {pagesError ? (
                <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-xs text-red-200 whitespace-pre-line">
                  {pagesError}
                </div>
              ) : null}

              {isConnected && hasNoPages ? (
                <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <p className="font-semibold">⚠️ Meta no devolvió ninguna Page en /me/accounts.</p>
                  <p className="mt-2 text-xs text-amber-100/90">
                    Esto pasa cuando el usuario que autorizó <span className="font-semibold">no tiene rol</span> en ninguna Page
                    (o no tiene control suficiente). Solución rápida:
                  </p>
                  <ul className="mt-3 list-disc pl-5 space-y-1 text-xs text-amber-100/90">
                    <li>Crea una Page de prueba en Facebook (o usa una existente).</li>
                    <li>Asegúrate de que ese usuario es Admin/Editor de la Page (no “viewer”).</li>
                    <li>Vuelve aquí, pulsa <span className="font-semibold">Re-conectar</span> y luego <span className="font-semibold">Revisar Pages</span>.</li>
                  </ul>
                </div>
              ) : null}

              {isConnected && pages.length > 0 ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs font-semibold text-white/80">Pages ({pages.length})</p>
                  <ul className="mt-2 space-y-1 text-xs text-white/70">
                    {pages.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{p.name}</span>
                        <span className="font-mono text-white/50">{p.id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-6">
                <p className="text-sm font-semibold text-white/90">Siguiente</p>
                <p className="mt-1 text-xs text-white/60">Esto lo activaremos cuando añadamos el flujo de selección de Page + Form.</p>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Seleccionar Page</li>
                    <li>Seleccionar Lead Form</li>
                    <li>Mapping de campos</li>
                    <li>Suscribir Webhook (leadgen)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
