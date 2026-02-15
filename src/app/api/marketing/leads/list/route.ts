import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type FormAnswers = Record<string, string | string[]>;

type LeadRow = {
  id: string;
  created_at: string;
  source: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  profession: string | null;
  biggest_pain: string | null;
  status: string;
  labels: string[] | null;
  notes: string | null;
  read_at: string | null;
  form_answers?: unknown | null;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFormAnswers(v: unknown): v is FormAnswers {
  if (!isRecord(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val === 'string') continue;
    if (Array.isArray(val) && val.every((x) => typeof x === 'string')) continue;
    return false;
  }
  return true;
}

function asText(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v;
}

function normKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

type DerivedLeadFields = { profession: string | null; biggest_pain: string | null };

function deriveFieldsFromAnswers(row: LeadRow): DerivedLeadFields {
  const fromCols: DerivedLeadFields = {
    profession: (row.profession ?? '').trim() ? (row.profession ?? '').trim() : null,
    biggest_pain: (row.biggest_pain ?? '').trim() ? (row.biggest_pain ?? '').trim() : null,
  };

  if (fromCols.profession && fromCols.biggest_pain) return fromCols;

  const answers = isFormAnswers(row.form_answers) ? row.form_answers : null;
  if (!answers) return fromCols;

  const entries = Object.entries(answers);

  function pickValueByKeys(keys: string[]): string | null {
    const keySet = new Set(keys.map(normKey));
    for (const [k, v] of entries) {
      if (keySet.has(normKey(k))) {
        const txt = asText(v).trim();
        if (txt) return txt;
      }
    }
    return null;
  }

  const inferredProfession =
    fromCols.profession ??
    pickValueByKeys([
      'profession',
      'profesion',
      'ocupacion',
      'ocupación',
      'a_que_te_dedicas',
      '¿a_qué_te_dedicas?',
      'a_qué_te_dedicas',
      'a_que_te_dedicas?',
    ]);

  const inferredPain =
    fromCols.biggest_pain ??
    pickValueByKeys([
      'biggest_pain',
      'pain',
      'dolor',
      'problema',
      'que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta',
      '¿que_es_lo_que_mas_te_cuesta_ahora_mismo_en_tu_consulta?',
      'qué_es_lo_que_más_te_cuesta_ahora_mismo_en_tu_consulta?',
    ]);

  return {
    profession: inferredProfession ?? null,
    biggest_pain: inferredPain ?? null,
  };
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: 'No auth' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase env' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const includeAnswers = searchParams.get('includeAnswers') === '1';

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // ⚠️ IMPORTANTE: si tu tabla leads es multi-tenant por workspace,
  // añade filtro por workspace aquí (si existe la columna workspace_id).
  // const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
  // if (!workspaceId) return NextResponse.json({ ok:false, error:'Missing workspace' }, { status: 400 });

  const select = [
    'id',
    'created_at',
    'source',
    'full_name',
    'phone',
    'email',
    'profession',
    'biggest_pain',
    'status',
    'labels',
    'notes',
    'read_at',
    'form_answers',
  ].join(', ');

  const q = supabase.from('leads').select(select).order('created_at', { ascending: false }).limit(1000);

  // Si tienes workspace_id:
  // q.eq('workspace_id', workspaceId);

  const { data, error } = await q;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

 const rawRows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];

const rows: LeadRow[] = rawRows
  .filter(isRecord)
  .map((r): LeadRow => {
    return {
      id: typeof r.id === 'string' ? r.id : '',
      created_at: typeof r.created_at === 'string' ? r.created_at : '',
      source: typeof r.source === 'string' ? r.source : '',
      full_name: typeof r.full_name === 'string' ? r.full_name : null,
      phone: typeof r.phone === 'string' ? r.phone : null,
      email: typeof r.email === 'string' ? r.email : null,
      profession: typeof r.profession === 'string' ? r.profession : null,
      biggest_pain: typeof r.biggest_pain === 'string' ? r.biggest_pain : null,
      status: typeof r.status === 'string' ? r.status : '',
      labels: Array.isArray(r.labels) && r.labels.every((x) => typeof x === 'string') ? (r.labels as string[]) : null,
      notes: typeof r.notes === 'string' ? r.notes : null,
      read_at: typeof r.read_at === 'string' ? r.read_at : null,
      form_answers: 'form_answers' in r ? (r.form_answers as unknown) : null,
    };
  })
  // opcional: elimina filas inválidas si faltan campos críticos
  .filter((r) => r.id.length > 0);


  const leads = rows.map((r) => {
    const derived = deriveFieldsFromAnswers(r);

    // devolvemos profession/pain ya resueltos
    const base = {
      id: r.id,
      created_at: r.created_at,
      source: r.source,
      full_name: r.full_name,
      phone: r.phone,
      email: r.email,
      profession: derived.profession, // ✅
      biggest_pain: derived.biggest_pain, // ✅
      status: r.status,
      labels: r.labels,
      notes: r.notes,
      read_at: r.read_at,
    };

    if (includeAnswers) {
      return { ...base, form_answers: isFormAnswers(r.form_answers) ? r.form_answers : null };
    }

    return base;
  });

  return NextResponse.json({ ok: true, leads });
}
