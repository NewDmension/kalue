export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'won',
  'lost',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Etiquetas libres para filtrar.
 * Ajusta a las que uses de verdad (o déjalas genéricas).
 */
export const LEAD_LABELS = [
  'meta',
  'instagram',
  'whatsapp',
  'email',
  'hot',
  'warm',
  'cold',
] as const;

export type LeadLabel = (typeof LEAD_LABELS)[number];

export function normalizeLabel(input: string): LeadLabel | null {
  const k = input.trim().toLowerCase();
  return isLeadLabel(k) ? k : null;
}

export function isLeadLabel(input: string): input is LeadLabel {
  return (LEAD_LABELS as readonly string[]).includes(input);
}
