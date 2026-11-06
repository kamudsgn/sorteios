import { randomBytes } from 'node:crypto';
import { defaultSettings } from './raffle/engine.js';

const COOKIE = 'sorteio_sid';
const TTL = 12 * 60 * 60 * 1000;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Estado do sorteio por sessão do navegador (em memória).
 * Mantém publicação, comentários, configurações e ganhadores enquanto a sessão estiver ativa.
 */
export class SessionStore {
  constructor({ secure = false } = {}) {
    this.sessions = new Map();
    this.secure = secure;
    setInterval(() => this.sweep(), 30 * 60 * 1000).unref();
  }

  middleware() {
    return (req, res, next) => {
      const sid = parseCookies(req.headers.cookie)[COOKIE];
      let s = sid && this.sessions.get(sid);
      if (!s) {
        s = this.create();
        res.append('Set-Cookie', `${COOKIE}=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${this.secure ? '; Secure' : ''}`);
      }
      s.lastSeen = Date.now();
      req.session = s;
      next();
    };
  }

  create() {
    const s = {
      id: randomBytes(24).toString('hex'),
      post: null,
      source: null, // 'instagram' | 'import'
      comments: [],
      collectedAt: null,
      settings: defaultSettings(),
      winners: [],
      drawCounter: 0,
      job: null,
      oauthState: null,
      lastSeen: Date.now(),
    };
    this.sessions.set(s.id, s);
    return s;
  }

  sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.lastSeen > TTL) this.sessions.delete(id);
  }
}
