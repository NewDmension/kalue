'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

export default function MetaIntegrationConfigClient({ integrationId }: { integrationId: string }) {
  const workspaceId = useMemo(() => getActiveWorkspaceId(), []);
  const [loading, setLoading] = useState<boolean>(true);
  const [oauthBusy, setOauthBusy] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);

  const normalizedId = useMemo(() => normalizeId(integrationId), [integrationId]);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIntegration(null);

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
      const provider: ProviderKey = row.provider === 'meta' ? 'meta' : 'meta';

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

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled) return;
      await loadIntegration();
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadIntegration]);

  const handleConnectMeta = useCallback(async () => {
    if (oauthBusy) return;

    setError(null);

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

      // Redirect a Meta OAuth
      window.location.href = url;
    } catch (e: unknown) {
      setOauthBusy(false);
      setError(e instanceof Error ? e.message : 'Error iniciando OAuth');
    }
  }, [normalizedId, oauthBusy, workspaceId]);

  return (
    <div className="p-6 text-white">
      <div className="card-glass rounded-2xl border border-white/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Configurar Meta</h1>
            <p className="mt-1 text-sm text-white/70">
              Integration ID:{' '}
              <span className="font-mono text-white/90">{normalizedId || '(vacío)'}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
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

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200 whitespace-pre-line">
            {error}
          </div>
        ) : null}

        {integration ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{integration.name || 'Integración Meta'}</p>
                <p className="mt-1 text-xs text-white/60 break-all">
                  Status: <span className="font-mono">{integration.status}</span> · Provider:{' '}
                  <span className="font-mono">{integration.provider}</span>
                </p>
              </div>

              <span
                className={cx(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  integration.status === 'connected'
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                    : integration.status === 'error'
                      ? 'border-red-400/30 bg-red-500/10 text-red-200'
                      : 'border-white/15 bg-white/5 text-white/70'
                )}
              >
                {integration.status.toUpperCase()}
              </span>
            </div>

            {/* Paso 1: OAuth */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white/90">Conexión</p>
              <p className="mt-1 text-xs text-white/60">Paso 1 de 4 · Conectar con Meta mediante OAuth.</p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleConnectMeta()}
                  disabled={oauthBusy}
                  className={cx(
                    'rounded-xl border px-4 py-2 text-sm transition',
                    oauthBusy
                      ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                      : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                  )}
                >
                  {oauthBusy ? 'Conectando…' : 'Conectar con Meta'}
                </button>

                <div className="text-xs text-white/45">
                  Se guardará la conexión para este workspace.
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                <p className="font-semibold text-white/80">Siguiente:</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>Seleccionar Page</li>
                  <li>Seleccionar Lead Form</li>
                  <li>Mapping de campos</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
