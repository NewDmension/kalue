import crypto from 'crypto';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function keyFromEnv(): Buffer {
  const hex = requireEnv('OAUTH_TOKEN_ENCRYPTION_KEY').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes hex (64 chars).');
  }
  return Buffer.from(hex, 'hex');
}

type EncryptedPayload = {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64
};

export function encryptToken(plain: string): string {
  const key = keyFromEnv();
  const iv = crypto.randomBytes(12); // recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decryptToken(blob: string): string {
  const key = keyFromEnv();
  const json = Buffer.from(blob, 'base64').toString('utf8');

  const raw: unknown = JSON.parse(json);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).v !== 1 ||
    (raw as Record<string, unknown>).alg !== 'aes-256-gcm'
  ) {
    throw new Error('Invalid encrypted token payload');
  }

  const r = raw as Record<string, unknown>;
  const ivB64 = typeof r.iv === 'string' ? r.iv : '';
  const tagB64 = typeof r.tag === 'string' ? r.tag : '';
  const ctB64 = typeof r.ct === 'string' ? r.ct : '';

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
