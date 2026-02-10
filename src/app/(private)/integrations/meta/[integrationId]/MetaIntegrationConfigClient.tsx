'use client';

import { useEffect, useMemo, useState } from 'react';
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
    return detail ? `${base}\ndetail: ${detail}` : base;
  }
  return fallback;
}

export default function MetaIntegrationConfigClient({ integrationId }: { integrationId: string }) {
  const workspaceId = useMemo(() => getActiveWorkspaceId(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setIntegration(null);

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

      const res = await fetch(`/api/integrations/get?integrationId=${encodeURIComponent(integrationId)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
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

      const parsed: IntegrationRow = {
        id: String(row.id),
        workspace_id: String(row.workspace_id),
        provider: row.provider === 'meta' ? 'meta' : 'meta',
        name: typeof row.name === 'string' ? row.name : '',
        status: row.status === 'connected' || row.status === 'error' || row.status === 'draft' ? row.status : 'draft',
        created_at: typeof row.created_at === 'string' ? row.created_at : '',
        config: row.config,
        secrets: row.secrets,
      };

      if (!cancelled) {
        setIntegration(parsed);
        setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [integrationId, workspaceId]);

  return (
    <div className="p-6 text-white">
      <div className="card-glass rounded-2xl border border-white/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Configurar Meta</h1>
            <p className="mt-1 text-sm text-white/70">
              Integration ID: <span className="font-mono text-white/90">{integrationId}</span>
            </p>
          </div>

          <Link
            href="/integrations"
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
          >
            Volver
          </Link>
        </div>

        {loading ? <p className="mt-4 text-sm text-white/60">Cargando…</p> : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200 whitespace-pre-line">
            {error}
          </div>
        ) : null}

        {integration ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white">{integration.name}</p>
            <p className="mt-1 text-xs text-white/60">
              Status: <span className="font-mono">{integration.status}</span> · Provider:{' '}
              <span className="font-mono">{integration.provider}</span>
            </p>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
              <p className="font-semibold text-white/80">Siguiente:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                <li>Conectar con Meta (OAuth)</li>
                <li>Seleccionar Page</li>
                <li>Seleccionar Lead Form</li>
                <li>Mapping de campos</li>
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
