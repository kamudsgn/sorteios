import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { parseCookies } from './sessions.js';

const COOKIE = 'sorteio_ig';
const MAX_AGE_S = 90 * 24 * 60 * 60;

/** Chave do cofre: TOKEN_SECRET (produção) ou arquivo local gerado na primeira execução. */
export function resolveSecret(cfg) {
  if (cfg.tokenSecret) return createHash('sha256').update(cfg.tokenSecret).digest();
  const file = path.join(cfg.dataDir, 'cookie-secret.key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } catch {
    const key = randomBytes(32);
    try {
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    } catch {
      console.warn('[vault] Não foi possível salvar a chave; conexões serão perdidas ao reiniciar. Defina TOKEN_SECRET.');
    }
    return key;
  }
}

/**
 * Cookie criptografado (AES-256-GCM) com as credenciais do Instagram conectadas pela página.
 * HttpOnly: o JavaScript da página não consegue ler; só o servidor, que tem a chave.
 */
export function createVault(key, { secure }) {
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return {
    read(req) {
      const raw = parseCookies(req.headers.cookie)[COOKIE];
      if (!raw) return null;
      try {
        const buf = Buffer.from(raw, 'base64url');
        const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
      } catch {
        return null;
      }
    },
    write(res, data) {
      const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      if (!Object.keys(clean).length) return this.clear(res);
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(JSON.stringify(clean), 'utf8'), c.final()]);
      const value = Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
      res.append('Set-Cookie', `${COOKIE}=${value}; ${attrs}; Max-Age=${MAX_AGE_S}`);
    },
    clear(res) {
      res.append('Set-Cookie', `${COOKIE}=; ${attrs}; Max-Age=0`);
    },
  };
}
