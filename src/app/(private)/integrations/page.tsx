'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

type ProviderKey = 'meta';

type IntegrationStatus = 'draft' | 'connected' | 'error';

type IntegrationItem = {
  id: string;
  provider: ProviderKey;
  name: string;
  status: IntegrationStatus;
  created_at: string;
};

type ProviderDef = {
  key: ProviderKey;
  title: string;
  subtitle: string;
  badge: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    key: 'meta',
    title: 'Meta Lead Ads',
    subtitle: 'Conecta Facebook Page / Forms y recibe leads.',
    badge: 'OAuth',
  },
];

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

function getStatus(v: unknown): IntegrationStatus {
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

function pickErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw;

  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const base = typeof r.error === 'string' ? r.error : fallback;

    const detail = typeof r.detail === 'string' ? r.detail : '';
    const hint = typeof r.hint === 'string' ? r.hint : '';
    const code = typeof r.code === 'string' ? r.code : '';

    const extras = [detail && `detail: ${detail}`, hint && `hint: ${hint}`, code && `code: ${code}`]
      .filter(Boolean)
      .join('\n');

    return extras ? `${base}\n${extras}` : base;
  }

  return fallback;
}

/* =======================
   Modal: Info
======================= */

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

/* =======================
   Modal: Create Wizard (GHL style)
======================= */

type CreateWizardModalProps = {
  open: boolean;
  provider: ProviderDef | null;
  busy: boolean;
  name: string;
  setName: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

function CreateWizardModal(props: CreateWizardModalProps) {
  if (!props.open || !props.provider) return null;

  const canCreate = !props.busy && props.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/60 backdrop-blur-[6px] p-4">
      <div className="w-full max-w-[620px] card-glass rounded-2xl border border-white/10 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-white">Crear integración</p>
            <p className="mt-1 text-sm text-white/70">
              {props.provider.title} · {props.provider.badge}
            </p>
          </div>

          <button
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            className={cx(
              'rounded-xl border px-3 py-2 text-sm transition',
              props.busy
                ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
            )}
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/90 font-semibold">{props.provider.title}</p>
          <p className="mt-1 text-xs text-white/60">{props.provider.subtitle}</p>
        </div>

        <div className="mt-4">
          <p className="text-xs text-white/60 mb-1">Nombre de la integración</p>
          <input
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="Ej: Meta Clínica Ana · Campaña Febrero"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-indigo-400/50"
          />
          <p className="mt-2 text-xs text-white/50">
            Consejo: usa un nombre que te ayude a distinguir “cuenta / clínica / campaña”.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            className={cx(
              'rounded-xl border px-4 py-2 text-sm transition',
              props.busy
                ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
            )}
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={props.onCreate}
            disabled={!canCreate}
            className={cx(
              'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
              !canCreate
                ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
            )}
          >
            {props.busy ? 'Creando…' : '+ Crear integración'}
          </button>
        </div>

        <div className="mt-4 text-xs text-white/45">
          Después de crearla, entrarás a “Configurar” para hacer OAuth y el mapping de campos.
        </div>
      </div>
    </div>
  );
}

function statusBadge(status: IntegrationStatus): { text: string; className: string } {
  if (status === 'connected') {
    return { text: 'CONNECTED', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' };
  }
  if (status === 'error') {
    return { text: 'ERROR', className: 'border-red-400/30 bg-red-500/10 text-red-200' };
  }
  return { text: 'DRAFT', className: 'border-white/15 bg-white/5 text-white/70' };
}

export default function IntegracionesPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<IntegrationItem[]>([]);

  // Wizard modal state
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [wizardProvider, setWizardProvider] = useState<ProviderDef | null>(null);
  const [wizardName, setWizardName] = useState<string>('');

  // info modal
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
        setError(pickErrorMessage(raw, `Respuesta inválida (${res.status})`));
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

  const openWizard = useCallback(
    (p: ProviderDef) => {
      if (busy) return;
      setWizardProvider(p);
      setWizardName('');
      setWizardOpen(true);
    },
    [busy]
  );

  const closeWizard = useCallback(() => {
    if (busy) return;
    setWizardOpen(false);
    setWizardProvider(null);
    setWizardName('');
  }, [busy]);

  const createIntegration = useCallback(async () => {
    if (busy) return;

    const nm = wizardName.trim();
    if (!nm) return;
    if (!wizardProvider) return;

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
        body: JSON.stringify({ provider: wizardProvider.key, name: nm }),
      });

      const raw = await safeJson(res);
      if (!res.ok) {
        setInfoTitle('Error creando integración');
        setInfoDesc(pickErrorMessage(raw, `No se pudo crear (${res.status})`));
        setInfoOpen(true);
        setBusy(false);
        return;
      }

      closeWizard();

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
  }, [busy, closeWizard, load, wizardName, wizardProvider, workspaceId]);

  return (
    <div className="container-default py-8 text-white">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Integraciones</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          Crea conexiones por workspace para capturar leads y automatizar workflows (Meta hoy; más providers después).
        </p>
      </div>

      {error ? (
        <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200 whitespace-pre-line">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* card pequeña (1/3) */}
        <div className="card-glass rounded-2xl border border-white/10 p-5 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Nueva integración</h2>
              <p className="text-sm text-white/70">Elige una plataforma y sigue el asistente.</p>
            </div>
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">Setup</span>
          </div>

          <p className="text-xs text-white/60 mb-2">Plataformas</p>

          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => openWizard(p)}
                disabled={busy}
                className={cx(
                  'w-full rounded-2xl border p-4 text-left transition',
                  busy
                    ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                    : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.title}</div>
                    <div className="text-xs text-white/70 mt-1">{p.subtitle}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                    {p.badge}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-white/45">
            El asistente crea la instancia. La pantalla “Configurar” hará OAuth + mapping.
          </p>
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
              disabled={busy}
              className={cx(
                'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
                busy
                  ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                  : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              )}
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
              {items.map((it) => {
                const b = statusBadge(it.status);
                return (
                  <div key={it.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{it.name}</p>
                          <span className={cx('shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold', b.className)}>
                            {b.text}
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-white/60 break-all">
                          <span className="text-white/70">Provider:</span> {it.provider} ·{' '}
                          <span className="text-white/70">ID:</span> {it.id}
                        </p>

                        {it.created_at ? (
                          <p className="mt-1 text-xs text-white/50">Creada: {it.created_at}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link
  href={`/integrations/meta/${it.id}`}
  className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
>
  Configurar →
</Link>

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CreateWizardModal
        open={wizardOpen}
        provider={wizardProvider}
        busy={busy}
        name={wizardName}
        setName={setWizardName}
        onClose={closeWizard}
        onCreate={() => void createIntegration()}
      />

      <InfoModal open={infoOpen} title={infoTitle} description={infoDesc} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
