'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

type ProviderKey = 'meta';

type IntegrationItem = {
  id: string;
  provider: ProviderKey;
  name: string;
  status: 'draft' | 'connected' | 'error';
  created_at: string;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(v: unknown, key: string): string | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  return typeof x === 'string' ? x : null;
}

function getProvider(v: unknown): ProviderKey | null {
  if (!isRecord(v)) return null;
  const p = v['provider'];
  return p === 'meta' ? 'meta' : null;
}

function getStatus(v: unknown): IntegrationItem['status'] {
  if (!isRecord(v)) return 'draft';
  const s = v['status'];
  return s === 'connected' || s === 'error' || s === 'draft' ? s : 'draft';
}

async function getAccessToken(): Promise<string> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.auth.getSession();
  if (error) return '';
  const token = data.session?.access_token ?? '';
  return typeof token === 'string' ? token : '';
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

type InfoModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
};

function InfoModal(props: InfoModalProps) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[98] flex items-center justify-center bg-black/60 backdrop-blur-[6px] p-4">
      <div className="w-full max-w-[560px] card-glass rounded-2xl border border-white/10 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-white">{props.title}</p>
            {props.description ? (
              <p className="mt-2 text-sm text-white/70 whitespace-pre-line">{props.description}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntegracionesPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [provider, setProvider] = useState<ProviderKey>('meta');
  const [name, setName] = useState<string>('');

  const [infoOpen, setInfoOpen] = useState<boolean>(false);
  const [infoTitle, setInfoTitle] = useState<string>('Listo');
  const [infoDesc, setInfoDesc] = useState<string>('');

  const workspaceId = useMemo(() => getActiveWorkspaceId(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError('Para ver integraciones necesitas iniciar sesión.');
      setItems([]);
      return;
    }

    if (!workspaceId) {
      setLoading(false);
      setError('No hay workspace activo. Ve a Workspaces y selecciona uno.');
      setItems([]);
      return;
    }

    try {
      const res = await fetch('/api/integrations/list', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'x-workspace-id': workspaceId,
        },
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        const msg =
          isRecord(raw) && typeof raw['error'] === 'string'
            ? String(raw['error'])
            : `Respuesta inválida (${res.status})`;
        setError(msg);
        setItems([]);
        setLoading(false);
        return;
      }

      const arr = isRecord(raw) ? raw['integrations'] : null;
      if (!Array.isArray(arr)) {
        setItems([]);
        setLoading(false);
        return;
      }

      const parsed: IntegrationItem[] = arr
        .map((it) => {
          if (!isRecord(it)) return null;
          const id = getString(it, 'id');
          const p = getProvider(it);
          const nm = getString(it, 'name');
          const createdAt = getString(it, 'created_at') ?? '';
          if (!id || !p || !nm) return null;
          return { id, provider: p, name: nm, status: getStatus(it), created_at: createdAt };
        })
        .filter((x): x is IntegrationItem => x !== null);

      setItems(parsed);
      setLoading(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando integraciones');
      setItems([]);
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createIntegration = useCallback(async () => {
    if (busy) return;
    const nm = name.trim();
    if (!nm) return;

    const token = await getAccessToken();
    if (!token) {
      setInfoTitle('No hay sesión');
      setInfoDesc('Inicia sesión para crear integraciones.');
      setInfoOpen(true);
      return;
    }

    if (!workspaceId) {
      setInfoTitle('Sin workspace activo');
      setInfoDesc('Selecciona un workspace antes de crear integraciones.');
      setInfoOpen(true);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/integrations/create', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-workspace-id': workspaceId,
        },
        body: JSON.stringify({ provider, name: nm }),
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        const msg = isRecord(raw) && typeof raw['error'] === 'string' ? String(raw['error']) : 'No se pudo crear';
        setInfoTitle('Error creando integración');
        setInfoDesc(msg);
        setInfoOpen(true);
        setBusy(false);
        return;
      }

      setName('');
      setInfoTitle('Integración creada');
      setInfoDesc('Ahora puedes entrar a “Configurar” para conectar con OAuth.');
      setInfoOpen(true);

      await load();
      setBusy(false);
    } catch (e: unknown) {
      setBusy(false);
      setInfoTitle('Error creando integración');
      setInfoDesc(e instanceof Error ? e.message : 'Error desconocido');
      setInfoOpen(true);
    }
  }, [busy, load, name, provider, workspaceId]);

  return (
    <div className="container-default py-8 text-white">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Integraciones</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          Crea conexiones por workspace para capturar leads y automatizar workflows (Meta hoy; más providers después).
        </p>
      </div>

      {error ? (
        <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ✅ card pequeña (1/3) */}
        <div className="card-glass rounded-2xl border border-white/10 p-5 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Nueva integración</h2>
              <p className="text-sm text-white/70">Crea una conexión y luego haz OAuth.</p>
            </div>
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">Setup</span>
          </div>

          <div className="mt-4">
            <p className="text-xs text-white/60 mb-2">Proveedor</p>

            {/* Por ahora SOLO Meta (sin GHL) */}
            <button
              type="button"
              className="w-full rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-left text-sm text-indigo-200 hover:bg-indigo-500/15"
              onClick={() => setProvider('meta')}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">Meta Lead Ads</span>
                <span className="text-xs text-indigo-200/70">OAuth</span>
              </div>
              <p className="mt-1 text-xs text-white/60">Conecta Facebook Page / Forms y recibe leads.</p>
            </button>

            <p className="text-xs text-white/60 mt-4 mb-2">Nombre de la integración</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Meta de Clínica Ana / Campaña Febrero"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-indigo-400/50"
            />

            <div className="mt-4 flex items-center justify-end">
              {/* ✅ botón estilo “+ Nueva campaña” */}
              <button
                type="button"
                onClick={() => void createIntegration()}
                disabled={busy || loading || !name.trim()}
                className={cx(
                  'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
                  busy || loading || !name.trim()
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                )}
              >
                {busy ? 'Creando…' : '+ Crear integración'}
              </button>
            </div>

            <p className="mt-4 text-xs text-white/45">
              Aquí solo creas la instancia. La configuración (OAuth + mapping) vive dentro de su pantalla.
            </p>
          </div>
        </div>

        {/* Lista (2/3) */}
        <div className="card-glass rounded-2xl border border-white/10 p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Tus integraciones</h2>
              <p className="text-sm text-white/70">Una por cada conexión real (por usuario/workspace).</p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Refrescar
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-white/60">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-white/60">Aún no tienes integraciones.</p>
          ) : (
            <div className="space-y-3">
              {items.map((it) => (
                <div key={it.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{it.name}</p>
                      <p className="mt-1 text-xs text-white/60 break-all">
                        <span className="text-white/70">Provider:</span> {it.provider} ·{' '}
                        <span className="text-white/70">ID:</span> {it.id}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/80">
                          status: {it.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/integraciones/meta/${it.id}`}
                        className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
                      >
                        Configurar →
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <InfoModal open={infoOpen} title={infoTitle} description={infoDesc} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
