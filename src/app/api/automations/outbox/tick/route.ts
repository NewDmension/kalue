// src/app/api/automations/outbox/tick/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/supabase/serviceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(_req: NextRequest) {
  const sb = supabaseServiceRole();

  const { data: claimed, error } = await sb.rpc('workflow_claim_outbox', {
    p_batch_size: 25,
    p_locker: `outbox-${process.env.VERCEL_REGION ?? 'local'}`,
  });

  if (error) return json(500, { ok: false, error: 'claim_failed', detail: error.message });

  const rows = Array.isArray(claimed) ? claimed : [];
  if (rows.length === 0) return json(200, { ok: true, processed: 0 });

  let processed = 0;

  for (const r of rows) {
    const id = r.id as string;

    try {
      // TODO: aquí conectamos provider real:
      // - email: Resend (payload.subject/payload.body)
      // - sms: Twilio/MessageBird/etc
      // Por ahora: simular enviado
      await sb
        .from('workflow_message_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: 'stub' })
        .eq('id', id);

      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      await sb.from('workflow_message_outbox').update({ status: 'failed', error: msg }).eq('id', id);
    }
  }

  return json(200, { ok: true, processed });
}