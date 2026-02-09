'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type IntegrationProvider = 'meta';

type IntegrationStatus = 'connected' | 'disconnected' | 'needs_auth' | 'error';

type IntegrationItem = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  created_at: string;
  updated_at: string;
};

type ListIntegrationsResponse =
  | { ok: true; integrations: IntegrationItem[] }
  | { ok: false; error: string; detail?: string };

type CreateIntegrationResponse =
  | { ok: true; integration: { id: string; provider: IntegrationProvider } }
  | { ok: false; error: string; detail?: string };

type OAuthStartResponse =
  | { ok: true; url: string }
  | { ok: false; error: string; detail?: string };

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

/* =======================
   Modal: Create Integration
======================= */

type CreateIntegrationModalProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  defaultName: string;
  provider: IntegrationProvider;
  onChangeName: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

function CreateIntegrationModal(props: CreateIntegrationModalProps) {
  if (!props.open) return null;

  const providerLabel = props.provider === 'meta' ? 'Meta Lead Ads' : props.provider;

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/60 backdrop-blur-[6px] p-4">
      <div className="w-full max-w-[620px] card-glass rounded-2xl border border-white/10 p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold">Nueva integración</p>
            <p className="mt-2 text-sm text-white/70">
              Vas a conectar <span className="text-white/90">{providerLabel}</span> a tu cuenta.
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

        {props.error ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
            {props.error}
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/60 mb-1">Nombre (interno)</p>
          <input
            value={props.defaultName}
            onChange={(e) => props.onChangeName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-indigo-400/50"
            placeholder="Ej: Meta Sybana ES"
            autoComplete="off"
          />

          <p className="mt-3 text-xs text-white/55">
            Al continuar, te llevaremos al login/autorización de Meta (OAuth). Luego volverás aquí.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center">
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy}
            className={cx(
              'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
              props.busy
                ? 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
            )}
          >
            {props.busy ? 'Conectando…' : 'Conectar con Meta'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
   Page
======================= */

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<IntegrationItem[]>([]);

  // create modal state
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider>('meta');
  const [name, setName] = useState<string>('Meta Lead Ads');

  const canCreate = useMemo(() => name.trim().length > 0 && !busy, [busy, name]);

  const loadIntegrations = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setItems([]);
      setError('Para ver Integraciones necesitas iniciar sesión.');
      return;
    }

    try {
      const res = await fetch('/api/integrations/list', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      const raw = await safeJson(res);

      const parsed: ListIntegrationsResponse =
        isRecord(raw) && raw.ok === true
          ? (raw as ListIntegrationsResponse)
          : isRecord(raw) && raw.ok === false
          ? (raw as ListIntegrationsResponse)
          : { ok: false, error: `Respuesta inválida (${res.status})` };

      if (!parsed.ok) {
        const msg = parsed.error || 'Failed to load integrations';
        const detail = isRecord(raw) ? getString(raw, 'detail') : null;
        setError(detail ? `${msg} — ${detail}` : msg);
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(parsed.integrations);
      setLoading(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
      setItems([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();

    const supabase = supabaseBrowser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void loadIntegrations();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [loadIntegrations]);

  const openCreate = useCallback((p: IntegrationProvider) => {
    setProvider(p);
    setName(p === 'meta' ? 'Meta Lead Ads' : 'Integración');
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const startCreateAndOAuth = useCallback(async () => {
    if (!canCreate) return;

    setBusy(true);
    setCreateError(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setCreateError('Para crear una integración necesitas iniciar sesión.');
      return;
    }

    try {
      // 1) Crear registro de integración (en tu DB)
      const resCreate = await fetch('/api/integrations/create', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ provider, name: name.trim() }),
      });

      const rawCreate = await safeJson(resCreate);
      const parsedCreate: CreateIntegrationResponse =
        isRecord(rawCreate) && rawCreate.ok === true
          ? (rawCreate as CreateIntegrationResponse)
          : isRecord(rawCreate) && rawCreate.ok === false
          ? (rawCreate as CreateIntegrationResponse)
          : { ok: false, error: `Respuesta inválida (${resCreate.status})` };

      if (!parsedCreate.ok) {
        setBusy(false);
        setCreateError(parsedCreate.error || 'No se pudo crear la integración');
        return;
      }

      const integrationId = parsedCreate.integration.id;

      // 2) Pedir URL de OAuth start (server genera state + redirect)
      //    Tu route debe devolver { ok: true, url }
      const resOAuth = await fetch('/api/integrations/meta/oauth/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ integration_id: integrationId }),
      });

      const rawOAuth = await safeJson(resOAuth);
      const parsedOAuth: OAuthStartResponse =
        isRecord(rawOAuth) && rawOAuth.ok === true
          ? (rawOAuth as OAuthStartResponse)
          : isRecord(rawOAuth) && rawOAuth.ok === false
          ? (rawOAuth as OAuthStartResponse)
          : { ok: false, error: `Respuesta inválida (${resOAuth.status})` };

      if (!parsedOAuth.ok) {
        setBusy(false);
        setCreateError(parsedOAuth.error || 'No se pudo iniciar OAuth con Meta');
        return;
      }

      const url = parsedOAuth.url;
      if (!url) {
        setBusy(false);
        setCreateError('OAuth: URL vacía');
        return;
      }

      // 3) Redirigir al OAuth de Meta
      window.location.assign(url);
    } catch (e: unknown) {
      setBusy(false);
      setCreateError(e instanceof Error ? e.message : 'Unexpected error');
    }
  }, [canCreate, name, provider]);

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Integraciones</h1>
        <p className="mt-1 text-sm text-white/70">
          Conecta fuentes externas (Meta, GHL, etc.) para recibir leads y automatizar workflows.
        </p>
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
              <p className="text-lg font-semibold text-white">Nueva integración</p>
              <p className="mt-1 text-sm text-white/70">
                Crea una integración y conecta con OAuth en 1 minuto.
              </p>
            </div>
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">Setup</span>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs text-white/60">Proveedor</p>

            {/* selector simple (sin shadcn) para mantener tu UI actual */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openCreate('meta')}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/85 hover:bg-white/10"
              >
                <span>Meta Lead Ads</span>
                <span className="text-xs text-white/55">OAuth</span>
              </button>

              {/* placeholders futuros */}
              <button
                type="button"
                disabled
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/40 cursor-not-allowed"
                title="Próximamente"
              >
                <span>GoHighLevel</span>
                <span className="text-xs text-white/40">Soon</span>
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs text-white/45">
            Aquí solo “creas” la integración. El detalle de configuración vive en su pantalla específica.
          </p>
        </div>

        {/* RIGHT: list (2/3) */}
        <div className="card-glass rounded-2xl border border-white/10 bg-white/5 p-6 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-white/60">Tus integraciones</p>

            <button
              type="button"
              onClick={() => void loadIntegrations()}
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              disabled={busy}
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
                <div key={it.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{it.name}</p>

                        <span
                          className={cx(
                            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
                            it.status === 'connected'
                              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                              : it.status === 'needs_auth'
                              ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                              : it.status === 'error'
                              ? 'border-red-400/30 bg-red-500/10 text-red-200'
                              : 'border-white/10 bg-white/5 text-white/70'
                          )}
                          title={`status: ${it.status}`}
                        >
                          {it.status.toUpperCase()}
                        </span>

                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                          {it.provider === 'meta' ? 'Meta' : it.provider}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-white/60 break-all">
                        <span className="text-white/70">ID:</span> {it.id}
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        Updated: {it.updated_at} · Created: {it.created_at}
                      </p>
                    </div>

                    {/* Acciones: por ahora solo “Configurar” como placeholder */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
                        onClick={() => openCreate('meta')}
                        title="Si está en needs_auth, vuelve a iniciar OAuth"
                      >
                        Conectar / Reautorizar
                      </button>

                      <button
                        type="button"
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                        disabled
                        title="Próximamente: pantalla de configuración por integración"
                      >
                        Configurar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateIntegrationModal
        open={createOpen}
        busy={busy}
        error={createError}
        provider={provider}
        defaultName={name}
        onChangeName={(v) => setName(v)}
        onClose={() => {
          if (!busy) setCreateOpen(false);
        }}
        onConfirm={() => void startCreateAndOAuth()}
      />
    </div>
  );
}
