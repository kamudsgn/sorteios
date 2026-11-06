import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { parseCookies } from './sessions.js';

const COOKIE = 'sorteio_access';
const VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Senha de acesso à página publicada (ACCESS_PASSWORD_HASH = "scrypt$<salt>$<hash>").
 * O acesso liberado vira um cookie assinado (HMAC) que sobrevive a reinícios do servidor.
 * Sem ACCESS_PASSWORD_HASH configurado, o acesso é livre (uso local).
 */
export function createAccessGate(passwordHash, { secure }) {
  if (!passwordHash) return null;
  const [algo, salt, hash] = passwordHash.split('$');
  if (algo !== 'scrypt' || !salt || !/^[0-9a-f]{64}$/.test(hash || '')) {
    throw new Error('ACCESS_PASSWORD_HASH inválido. Formato esperado: scrypt$<salt>$<hash hex>');
  }
  const expected = Buffer.from(hash, 'hex');
  const key = createHash('sha256').update(`sorteio-access:${passwordHash}`).digest();
  const sign = (exp) => createHmac('sha256', key).update(String(exp)).digest('hex');
  const failures = new Map(); // ip → { count, until }

  const isGranted = (req) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE] || '';
    const [exp, sig] = raw.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const good = Buffer.from(sign(exp));
    const got = Buffer.from(sig);
    return good.length === got.length && timingSafeEqual(good, got);
  };

  return {
    isGranted,

    login(req, res, password) {
      const ip = req.ip || 'x';
      const f = failures.get(ip);
      if (f && f.until > Date.now()) {
        throw new AppError('ACCESS_LOCKED', 'Muitas tentativas. Aguarde um minuto e tente de novo.', { status: 429 });
      }
      const ok = typeof password === 'string' && password.length <= 200 && timingSafeEqual(scryptSync(password, salt, 32), expected);
      if (!ok) {
        const count = (f?.count || 0) + 1;
        failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
        throw new AppError('ACCESS_DENIED', 'Senha incorreta.', { status: 401 });
      }
      failures.delete(ip);
      const exp = Date.now() + VALIDITY_MS;
      res.append('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VALIDITY_MS / 1000}${secure ? '; Secure' : ''}`);
    },

    logout(res) {
      res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    },

    middleware() {
      return (req, res, next) => {
        if (isGranted(req)) return next();
        next(new AppError('ACCESS_REQUIRED', 'Digite a senha de acesso para usar o sorteador.', { status: 401 }));
      };
    },
  };
}
