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

// ✅ Wizard types (PRO)
type WizardStep = 'page' | 'forms' | 'final';
type MetaForm = { id: string; name: string };

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

// ✅ Subscriptions (tu tabla real) — SIN provider (porque tu DB dice que no existe)
type SubscriptionStatus = 'active' | 'paused' | 'draft' | 'error' | string;

type MetaSubscriptionRow = {
  id: string;
  workspace_id: string;
  integration_id: string;
  page_id: string;
  form_id: string | null;
  status: SubscriptionStatus | null;
  webhook_subscribed: boolean | null;
  // opcionales si existen en tu tabla (la UI los usa solo si vienen)
  page_name?: string | null;
  form_name?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ListSubsResponse =
  | { ok: true; subscriptions: MetaSubscriptionRow[] }
  | { ok: false; error: string; detail?: unknown };

type ToggleSubsResponse =
  | { ok: true }
  | { ok: false; error: string; detail?: unknown };

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

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pickErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw;

  if (isRecord(raw)) {
    const base = typeof raw.error === 'string' ? raw.error : fallback;

    const detailVal = raw.detail;
    const detail =
      typeof detailVal === 'string'
        ? detailVal
        : detailVal !== undefined
          ? safeStringify(detailVal)
          : '';

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

async function fetchForms(args: {
  integrationId: string;
  workspaceId: string;
  token: string;
  pageId: string;
}): Promise<MetaForm[]> {
  const url = `/api/integrations/meta/forms?integrationId=${encodeURIComponent(args.integrationId)}&pageId=${encodeURIComponent(args.pageId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-workspace-id': args.workspaceId,
      authorization: `Bearer ${args.token}`,
    },
  });

  const raw = await safeJson(res);
  if (!res.ok) {
    throw new Error(pickErrorMessage(raw, `No se pudieron cargar Forms (${res.status})`));
  }

  const formsRaw = isRecord(raw) ? raw.forms : null;
  if (!Array.isArray(formsRaw)) return [];

  const forms: MetaForm[] = [];
  for (const f of formsRaw) {
    if (isRecord(f) && typeof f.id === 'string' && typeof f.name === 'string') {
      forms.push({ id: f.id, name: f.name });
    }
  }
  return forms;
}

async function upsertMappings(args: {
  integrationId: string;
  workspaceId: string;
  token: string;
  page: MetaPage;
  forms: MetaForm[];
}): Promise<void> {
  const res = await postJson({
    url: '/api/integrations/meta/mappings/upsert',
    token: args.token,
    workspaceId: args.workspaceId,
    body: {
      integrationId: args.integrationId,
      pageId: args.page.id,
      pageName: args.page.name,
      forms: args.forms.map((f) => ({ formId: f.id, formName: f.name })),
    },
  });

  const raw = await safeJson(res);
  if (!res.ok) {
    throw new Error(pickErrorMessage(raw, `No se pudo guardar el mapping (${res.status})`));
  }
}

async function subscribeWebhook(args: {
  integrationId: string;
  workspaceId: string;
  token: string;
  pageId: string;
}): Promise<{ ok: boolean; raw: unknown; status: number }> {
  const res = await postJson({
    url: '/api/integrations/meta/webhooks/subscribe',
    token: args.token,
    workspaceId: args.workspaceId,
    body: { integrationId: args.integrationId, pageId: args.pageId },
  });

  const raw = await safeJson(res);
  return { ok: res.ok, raw, status: res.status };
}

function useWorkspaceIdReady(): { workspaceId: string; ready: boolean } {
  const [workspaceId, setWorkspaceId] = useState<string>('');

  useEffect(() => {
    const fromLib = (getActiveWorkspaceId() ?? '').trim();
    if (fromLib) {
      setWorkspaceId(fromLib);
      return;
    }

    try {
      const fromLs = (window.localStorage.getItem('kalue.activeWorkspaceId') ?? '').trim();
      if (fromLs) setWorkspaceId(fromLs);
    } catch {
      // ignore
    }
  }, []);

  return { workspaceId, ready: workspaceId.length > 0 };
}

function isNeedsLeadsRetrievalPayload(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const err = typeof raw.error === 'string' ? raw.error : '';
  const code = typeof raw.code === 'string' ? raw.code : '';
  if (err === 'missing_permission' && code === 'needs_leads_retrieval') return true;
  const asText = safeStringify(raw);
  return asText.includes('leads_retrieval') || asText.includes('needs_leads_retrieval');
}

async function fetchSubscriptions(args: {
  integrationId: string;
  workspaceId: string;
  token: string;
}): Promise<MetaSubscriptionRow[]> {
  const url = `/api/integrations/meta/subscriptions/list?integrationId=${encodeURIComponent(args.integrationId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-workspace-id': args.workspaceId,
      authorization: `Bearer ${args.token}`,
    },
  });

  const raw = (await safeJson(res)) as unknown;

  if (!res.ok) {
    throw new Error(pickErrorMessage(raw, `No se pudieron cargar conexiones (${res.status})`));
  }

  if (!isRecord(raw)) return [];
  const ok = raw.ok;
  if (ok !== true) {
    const msg = typeof raw.error === 'string' ? raw.error : 'Respuesta inválida';
    throw new Error(msg);
  }

  const listRaw = raw.subscriptions;
  if (!Array.isArray(listRaw)) return [];

  const out: MetaSubscriptionRow[] = [];
  for (const r of listRaw) {
    if (!isRecord(r)) continue;
    const id = typeof r.id === 'string' ? r.id : '';
    const workspace_id = typeof r.workspace_id === 'string' ? r.workspace_id : '';
    const integration_id = typeof r.integration_id === 'string' ? r.integration_id : '';
    const page_id = typeof r.page_id === 'string' ? r.page_id : '';
    const form_id = typeof r.form_id === 'string' ? r.form_id : null;

    if (!id || !workspace_id || !integration_id || !page_id) continue;

    out.push({
      id,
      workspace_id,
      integration_id,
      page_id,
      form_id,
      status: typeof r.status === 'string' ? r.status : null,
      webhook_subscribed: typeof r.webhook_subscribed === 'boolean' ? r.webhook_subscribed : null,
      page_name: typeof r.page_name === 'string' ? r.page_name : null,
      form_name: typeof r.form_name === 'string' ? r.form_name : null,
      updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
      created_at: typeof r.created_at === 'string' ? r.created_at : null,
    });
  }

  return out;
}

async function toggleSubscription(args: {
  workspaceId: string;
  token: string;
  integrationId: string;
  subscriptionId: string;
  enabled: boolean;
}): Promise<void> {
  const res = await postJson({
    url: '/api/integrations/meta/subscriptions/toggle',
    token: args.token,
    workspaceId: args.workspaceId,
    body: {
      integrationId: args.integrationId,
      subscriptionId: args.subscriptionId,
      enabled: args.enabled,
    },
  });

  const raw = (await safeJson(res)) as unknown;
  if (!res.ok) {
    throw new Error(pickErrorMessage(raw, `No se pudo actualizar (${res.status})`));
  }

  if (isRecord(raw) && raw.ok === false) {
    throw new Error(typeof raw.error === 'string' ? raw.error : 'No se pudo actualizar');
  }
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

  // ✅ Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>('page');
  const [selectedPageId, setSelectedPageId] = useState<string>('');

  const [formsLoading, setFormsLoading] = useState<boolean>(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [selectedFormIds, setSelectedFormIds] = useState<Record<string, boolean>>({});
  const [activateBusy, setActivateBusy] = useState<boolean>(false);

  // ✅ permission banner
  const [needsLeadsRetrieval, setNeedsLeadsRetrieval] = useState<boolean>(false);

  // ✅ Subscriptions UI
  const [subsLoading, setSubsLoading] = useState<boolean>(false);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [subs, setSubs] = useState<MetaSubscriptionRow[]>([]);
  const [subsBusyId, setSubsBusyId] = useState<string | null>(null);

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

  const resetWizard = useCallback(() => {
    setWizardStep('page');
    setSelectedPageId('');
    setForms([]);
    setFormsError(null);
    setFormsLoading(false);
    setSelectedFormIds({});
    setActivateBusy(false);
    setNeedsLeadsRetrieval(false);
  }, []);

  const loadPages = useCallback(async (): Promise<void> => {
    setPagesError(null);
    setPages([]);

    resetWizard();

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
  }, [normalizedId, ready, resetWizard, workspaceId]);

  const loadSubscriptions = useCallback(async (): Promise<void> => {
    setSubsError(null);
    setSubs([]);

    if (!ready) return;
    if (!normalizedId || !isUuid(normalizedId)) return;

    const token = await getAccessToken();
    if (!token) {
      setSubsError('Sin sesión. Vuelve a iniciar sesión.');
      return;
    }

    setSubsLoading(true);
    try {
      const list = await fetchSubscriptions({ integrationId: normalizedId, workspaceId, token });
      setSubs(list);
      setSubsLoading(false);
    } catch (e: unknown) {
      setSubsLoading(false);
      setSubsError(e instanceof Error ? e.message : 'No se pudieron cargar conexiones activas');
    }
  }, [normalizedId, ready, workspaceId]);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  useEffect(() => {
    if (integration?.status === 'connected') {
      void loadPages();
      void loadSubscriptions();
    } else {
      setPages([]);
      setPagesError(null);
      setPagesLoading(false);

      setSubs([]);
      setSubsError(null);
      setSubsLoading(false);

      resetWizard();
    }
  }, [integration?.status, loadPages, loadSubscriptions, resetWizard]);

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
            await loadSubscriptions();
            setInfo('Meta conectada ✅');
            window.setTimeout(() => setInfo(null), 2500);
          } else {
            setInfo('OAuth OK. Esperando que el servidor refleje el estado…');
            window.setTimeout(() => setInfo(null), 4000);
          }
        })();

        return;
      }

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
  }, [loadIntegration, loadPages, loadSubscriptions, stopPolling]);

  const startPollingUntilConnected = useCallback(() => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + 45_000;

    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        if (pollDeadlineRef.current && Date.now() > pollDeadlineRef.current) {
          stopPolling();
          return;
        }

        const row = await loadIntegration();
        if (row?.status === 'connected') {
          stopPolling();
          await loadPages();
          await loadSubscriptions();
          setInfo('Meta conectada ✅');
          window.setTimeout(() => setInfo(null), 2500);
        }
      })();
    }, 1200);
  }, [loadIntegration, loadPages, loadSubscriptions, stopPolling]);

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

      setOauthBusy(false);
      openOauthPopup(url);

      setInfo('Abriendo ventana de conexión…');
      window.setTimeout(() => setInfo('Esperando confirmación de Meta…'), 900);
      startPollingUntilConnected();
    } catch (e: unknown) {
      setOauthBusy(false);
      setError(e instanceof Error ? e.message : 'Error iniciando OAuth');
    }
  }, [normalizedId, oauthBusy, ready, startPollingUntilConnected, workspaceId]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const status: IntegrationStatus = integration?.status ?? 'draft';
  const b = statusBadge(status);
  const isConnected = status === 'connected';

  const selectedPage = useMemo<MetaPage | null>(() => {
    if (!selectedPageId) return null;
    const p = pages.find((x) => x.id === selectedPageId);
    return p ?? null;
  }, [pages, selectedPageId]);

  const selectedForms = useMemo<MetaForm[]>(() => {
    const out: MetaForm[] = [];
    for (const f of forms) {
      if (selectedFormIds[f.id]) out.push(f);
    }
    return out;
  }, [forms, selectedFormIds]);

  const handleSelectPage = useCallback(async (pageId: string) => {
    setError(null);
    setInfo(null);
    setNeedsLeadsRetrieval(false);

    setSelectedPageId(pageId);
    setWizardStep('page');

    setForms([]);
    setFormsError(null);
    setFormsLoading(false);
    setSelectedFormIds({});
    setActivateBusy(false);
  }, []);

  const handleLoadForms = useCallback(async () => {
    setFormsError(null);
    setForms([]);
    setSelectedFormIds({});
    setNeedsLeadsRetrieval(false);

    if (!ready) return;
    if (!normalizedId || !isUuid(normalizedId)) return;
    if (!selectedPage) {
      setFormsError('Selecciona una Page primero.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setFormsError('Sin sesión. Vuelve a iniciar sesión.');
      return;
    }

    setFormsLoading(true);
    try {
      const data = await fetchForms({
        integrationId: normalizedId,
        workspaceId,
        token,
        pageId: selectedPage.id,
      });

      setForms(data);
      setFormsLoading(false);
      setWizardStep('forms');

      if (data.length === 1) {
        setSelectedFormIds({ [data[0].id]: true });
      }
    } catch (e: unknown) {
      setFormsLoading(false);
      setFormsError(e instanceof Error ? e.message : 'Error cargando Forms');
    }
  }, [normalizedId, ready, selectedPage, workspaceId]);

  const toggleForm = useCallback((formId: string) => {
    setSelectedFormIds((prev) => {
      const next: Record<string, boolean> = { ...prev };
      next[formId] = !Boolean(prev[formId]);
      return next;
    });
  }, []);

  const selectAllForms = useCallback(() => {
    setSelectedFormIds(() => {
      const next: Record<string, boolean> = {};
      for (const f of forms) next[f.id] = true;
      return next;
    });
  }, [forms]);

  const clearAllForms = useCallback(() => {
    setSelectedFormIds({});
  }, []);

  const handleSaveAndActivate = useCallback(async () => {
    if (activateBusy) return;

    setError(null);
    setInfo(null);
    setNeedsLeadsRetrieval(false);

    if (!ready) {
      setError('No hay workspace activo.');
      return;
    }
    if (!normalizedId || !isUuid(normalizedId)) {
      setError('Integration ID inválido.');
      return;
    }
    if (!selectedPage) {
      setError('Selecciona una Page primero.');
      return;
    }
    if (selectedForms.length === 0) {
      setError('Selecciona al menos un Lead Form.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setError('Sin sesión. Vuelve a iniciar sesión.');
      return;
    }

    setActivateBusy(true);
    setInfo('Guardando mapping y activando webhook…');

    try {
      await upsertMappings({
        integrationId: normalizedId,
        workspaceId,
        token,
        page: selectedPage,
        forms: selectedForms,
      });

      const sub = await subscribeWebhook({
        integrationId: normalizedId,
        workspaceId,
        token,
        pageId: selectedPage.id,
      });

      if (!sub.ok) {
        const needs = isNeedsLeadsRetrievalPayload(sub.raw);

        setActivateBusy(false);
        setInfo(null);

        if (needs) {
          setNeedsLeadsRetrieval(true);
          setWizardStep('forms');
          return;
        }

        throw new Error(pickErrorMessage(sub.raw, `No se pudo suscribir el webhook (${sub.status})`));
      }

      setActivateBusy(false);
      setWizardStep('final');
      setInfo('✅ Listo: mappings guardados y webhook activado. Ya puedes recibir leads.');
      window.setTimeout(() => setInfo(null), 3500);

      // 🔄 refresca conexiones activas
      await loadSubscriptions();
    } catch (e: unknown) {
      setActivateBusy(false);
      setInfo(null);
      setError(e instanceof Error ? e.message : 'No se pudo activar la integración.');
    }
  }, [activateBusy, loadSubscriptions, normalizedId, ready, selectedForms, selectedPage, workspaceId]);

  const handleToggleSubscription = useCallback(
    async (row: MetaSubscriptionRow, enabled: boolean) => {
      if (!ready) return;
      if (!normalizedId || !isUuid(normalizedId)) return;

      const token = await getAccessToken();
      if (!token) {
        setError('Sin sesión. Vuelve a iniciar sesión.');
        return;
      }

      setSubsBusyId(row.id);
      setError(null);
      setInfo(null);

      try {
        await toggleSubscription({
          workspaceId,
          token,
          integrationId: normalizedId,
          subscriptionId: row.id,
          enabled,
        });

        setSubsBusyId(null);
        setInfo(enabled ? 'Conexión activada ✅' : 'Conexión desactivada ✅');
        window.setTimeout(() => setInfo(null), 2000);

        await loadSubscriptions();
      } catch (e: unknown) {
        setSubsBusyId(null);
        setError(e instanceof Error ? e.message : 'No se pudo actualizar la conexión.');
      }
    },
    [loadSubscriptions, normalizedId, ready, workspaceId]
  );

  const subsActive = useMemo(() => {
    return subs.filter((s) => (s.webhook_subscribed ?? false) && (s.status ?? '') === 'active');
  }, [subs]);

  const subsOther = useMemo(() => {
    return subs.filter((s) => !((s.webhook_subscribed ?? false) && (s.status ?? '') === 'active'));
  }, [subs]);

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
            {/* CARD 1: ESTADO */}
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
                  <li>Permite listar Pages y Lead Forms.</li>
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

            {/* CARD 2: WIZARD */}
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

              {pages.length > 0 ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">
                  <div className="flex items-center justify-between">
                    <p className="text-white/90 font-semibold">Pages disponibles ({pages.length})</p>

                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70">
                      Wizard PRO
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span
                      className={cx(
                        'rounded-full border px-2 py-1',
                        wizardStep === 'page'
                          ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                          : 'border-white/10 bg-white/5 text-white/60'
                      )}
                    >
                      1) Page
                    </span>
                    <span
                      className={cx(
                        'rounded-full border px-2 py-1',
                        wizardStep === 'forms'
                          ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                          : 'border-white/10 bg-white/5 text-white/60'
                      )}
                    >
                      2) Forms
                    </span>
                    <span
                      className={cx(
                        'rounded-full border px-2 py-1',
                        wizardStep === 'final'
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-white/10 bg-white/5 text-white/60'
                      )}
                    >
                      3) Activado
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2">
                    {pages.map((p) => {
                      const selected = p.id === selectedPageId;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => void handleSelectPage(p.id)}
                            className={cx(
                              'w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition',
                              selected
                                ? 'border-indigo-400/30 bg-indigo-500/10'
                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                            )}
                          >
                            <div className="min-w-0">
                              <div className={cx('truncate', selected ? 'text-white' : 'text-white/90')}>{p.name}</div>
                              <div className="font-mono text-[11px] text-white/45">{p.id}</div>
                            </div>
                            <span
                              className={cx(
                                'rounded-full border px-2 py-1 text-[10px]',
                                selected
                                  ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                                  : 'border-white/10 bg-white/5 text-white/70'
                              )}
                            >
                              {selected ? 'seleccionada' : 'detectar'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-white/60">
                      {selectedPage ? (
                        <>
                          Page seleccionada: <span className="text-white/85 font-semibold">{selectedPage.name}</span>
                        </>
                      ) : (
                        <>Selecciona una Page para continuar.</>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleLoadForms()}
                      disabled={!selectedPage || formsLoading}
                      className={cx(
                        'rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200 hover:bg-indigo-500/15 transition',
                        !selectedPage || formsLoading ? 'opacity-60 cursor-not-allowed' : ''
                      )}
                      title="Listar Lead Forms de la Page seleccionada"
                    >
                      {formsLoading ? 'Cargando Forms…' : 'Continuar →'}
                    </button>
                  </div>

                  {formsError ? (
                    <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-[11px] text-red-200 whitespace-pre-line">
                      {formsError}
                    </div>
                  ) : null}

                  {needsLeadsRetrieval ? (
                    <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-[12px] text-amber-200">
                      <p className="font-semibold">
                        ⚠️ Falta permiso de Meta: <span className="font-mono">leads_retrieval</span>
                      </p>
                      <p className="mt-2 text-amber-100/80 leading-relaxed">
                        El mapping se ha guardado en <span className="font-mono">draft</span>, pero Meta no permite suscribir el webhook
                        <span className="font-mono"> leadgen</span> sin ese permiso.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleConnectMeta()}
                          className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200 hover:bg-indigo-500/15"
                        >
                          Re-conectar
                        </button>
                        <button
                          type="button"
                          onClick={() => setNeedsLeadsRetrieval(false)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/80 hover:bg-white/10"
                        >
                          Entendido
                        </button>
                      </div>
                      <div className="mt-2 text-[11px] text-amber-100/70">
                        Acción en Meta Developers: tu app debe tener acceso a <span className="font-mono">leads_retrieval</span> (Advanced
                        Access / App Review) y estar en modo <span className="font-semibold">Live</span>.
                      </div>
                    </div>
                  ) : null}

                  {wizardStep === 'forms' ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white/90">Lead Forms ({forms.length})</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => selectAllForms()}
                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                          >
                            Seleccionar todo
                          </button>
                          <button
                            type="button"
                            onClick={() => clearAllForms()}
                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                          >
                            Limpiar
                          </button>
                        </div>
                      </div>

                      {forms.length === 0 ? (
                        <div className="mt-3 text-[11px] text-white/60">No se detectaron forms para esta Page.</div>
                      ) : (
                        <ul className="mt-3 space-y-2">
                          {forms.map((f) => {
                            const checked = Boolean(selectedFormIds[f.id]);
                            return (
                              <li key={f.id}>
                                <button
                                  type="button"
                                  onClick={() => toggleForm(f.id)}
                                  className={cx(
                                    'w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition',
                                    checked
                                      ? 'border-indigo-400/30 bg-indigo-500/10'
                                      : 'border-white/10 bg-black/20 hover:bg-white/10'
                                  )}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-white/90">{f.name}</div>
                                    <div className="font-mono text-[11px] text-white/45">{f.id}</div>
                                  </div>
                                  <span
                                    className={cx(
                                      'rounded-full border px-2 py-1 text-[10px]',
                                      checked
                                        ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                                        : 'border-white/10 bg-white/5 text-white/70'
                                    )}
                                  >
                                    {checked ? 'incluido' : '—'}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setWizardStep('page')}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                        >
                          ← Volver
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleSaveAndActivate()}
                          disabled={activateBusy || selectedForms.length === 0 || !selectedPage}
                          className={cx(
                            'rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/15 transition',
                            activateBusy || selectedForms.length === 0 || !selectedPage ? 'opacity-60 cursor-not-allowed' : ''
                          )}
                          title="Guarda los mappings y suscribe el webhook leadgen"
                        >
                          {activateBusy ? 'Activando…' : 'Guardar y activar'}
                        </button>
                      </div>

                      <div className="mt-2 text-[11px] text-white/55">
                        Esto guardará el mapping (Page+Form) y activará el webhook para recibir leads en tiempo real.
                      </div>
                    </div>
                  ) : null}

                  {wizardStep === 'final' && selectedPage ? (
                    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-xs text-emerald-200">
                      <p className="font-semibold">✅ Integración activada</p>
                      <p className="mt-2 text-emerald-100/80">
                        Page: <span className="font-semibold">{selectedPage.name}</span> · Forms:{' '}
                        <span className="font-semibold">{selectedForms.length}</span>
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => resetWizard()}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/80 hover:bg-white/10"
                        >
                          Configurar otra Page/Form
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ✅ NUEVA CARD: CONEXIONES ACTIVAS */}
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white/90 font-semibold">Conexiones activas</p>
                    <p className="mt-1 text-[11px] text-white/55">
                      Esto indica qué Page/Form están operativos para recibir leads en este workspace.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resetWizard()}
                      className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200 hover:bg-indigo-500/15"
                    >
                      Añadir conexión
                    </button>

                    <button
                      type="button"
                      onClick={() => void loadSubscriptions()}
                      disabled={!isConnected || subsLoading}
                      className={cx(
                        'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/80 hover:bg-white/10',
                        !isConnected || subsLoading ? 'opacity-60 cursor-not-allowed' : ''
                      )}
                    >
                      {subsLoading ? 'Cargando…' : 'Refrescar'}
                    </button>
                  </div>
                </div>

                {subsError ? (
                  <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-[11px] text-red-200 whitespace-pre-line">
                    {subsError}
                  </div>
                ) : null}

                {!subsLoading && subs.length === 0 ? (
                  <div className="mt-3 text-[11px] text-white/55">
                    Aún no hay conexiones guardadas. Usa el wizard para crear la primera.
                  </div>
                ) : null}

                {subsActive.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold text-emerald-200">Operativas ({subsActive.length})</p>
                    <ul className="mt-2 space-y-2">
                      {subsActive.map((s) => {
                        const title = s.page_name ? s.page_name : `Page ${s.page_id}`;
                        const form = s.form_name ? s.form_name : s.form_id ? `Form ${s.form_id}` : 'Form (todos)';
                        const busy = subsBusyId === s.id;

                        return (
                          <li
                            key={s.id}
                            className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-emerald-100 font-semibold">{title}</div>
                                <div className="mt-1 text-[11px] text-emerald-100/70">{form}</div>
                                <div className="mt-2 font-mono text-[10px] text-emerald-100/50">
                                  page_id: {s.page_id} {s.form_id ? `· form_id: ${s.form_id}` : ''}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => void handleToggleSubscription(s, false)}
                                disabled={busy}
                                className={cx(
                                  'rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 hover:bg-amber-500/15',
                                  busy ? 'opacity-60 cursor-not-allowed' : ''
                                )}
                              >
                                {busy ? '…' : 'Desactivar'}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {subsOther.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold text-white/80">No operativas ({subsOther.length})</p>
                    <ul className="mt-2 space-y-2">
                      {subsOther.map((s) => {
                        const title = s.page_name ? s.page_name : `Page ${s.page_id}`;
                        const form = s.form_name ? s.form_name : s.form_id ? `Form ${s.form_id}` : 'Form (todos)';
                        const busy = subsBusyId === s.id;

                        const isEnabled = (s.webhook_subscribed ?? false) && (s.status ?? '') === 'active';

                        return (
                          <li key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-white/90 font-semibold">{title}</div>
                                <div className="mt-1 text-[11px] text-white/60">{form}</div>
                                <div className="mt-2 font-mono text-[10px] text-white/45">
                                  status: {String(s.status ?? 'null')} · webhook_subscribed: {String(s.webhook_subscribed ?? 'null')}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => void handleToggleSubscription(s, true)}
                                disabled={busy || isEnabled}
                                className={cx(
                                  'rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200 hover:bg-indigo-500/15',
                                  busy || isEnabled ? 'opacity-60 cursor-not-allowed' : ''
                                )}
                              >
                                {busy ? '…' : isEnabled ? 'Activa' : 'Activar'}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
