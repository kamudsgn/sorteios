import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';
import { GraphClient } from './graphClient.js';

const DAY = 24 * 60 * 60 * 1000;

/** Guarda o token obtido via OAuth em disco, apenas no servidor (permissão 600). */
class TokenStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'instagram-token.json');
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

/**
 * Conexão com a conta profissional do Instagram.
 * Prioridade: token salvo pelo OAuth → INSTAGRAM_ACCESS_TOKEN do .env.
 */
export class InstagramAuth {
  constructor(cfg, { fetchImpl = fetch } = {}) {
    this.cfg = cfg.instagram;
    this.store = new TokenStore(cfg.dataDir);
    this.fetch = fetchImpl;
    this.accountCache = null; // { token, account, at }
  }

  get oauthConfigured() {
    return Boolean(this.cfg.appId && this.cfg.appSecret && this.cfg.redirectUri);
  }

  currentToken() {
    const saved = this.store.read();
    if (saved?.accessToken) return { token: saved.accessToken, source: 'oauth', saved };
    if (this.cfg.envToken) return { token: this.cfg.envToken, source: 'env', saved: null };
    return null;
  }

  client(token = this.currentToken()?.token) {
    if (!token) {
      throw new AppError('NOT_CONNECTED', 'Nenhuma conta do Instagram conectada.', {
        status: 401,
        hint: 'Clique em "Conectar Instagram" ou defina INSTAGRAM_ACCESS_TOKEN no arquivo .env do backend.',
      });
    }
    return new GraphClient({ ...this.cfg, token, fetchImpl: this.fetch });
  }

  /** Dados da conta conectada (cache de 5 min). */
  async account() {
    const current = this.currentToken();
    if (!current) return null;
    if (this.accountCache?.token === current.token && Date.now() - this.accountCache.at < 5 * 60 * 1000) {
      return this.accountCache.account;
    }
    await this.maybeRefresh();
    const fresh = this.currentToken();
    const client = this.client(fresh.token);
    const me = await client.get(client.accountPath, { fields: 'id,username,profile_picture_url' });
    const account = {
      id: String(me.user_id || me.id),
      username: me.username,
      profilePictureUrl: me.profile_picture_url || null,
    };
    this.accountCache = { token: fresh.token, account, at: Date.now() };
    return account;
  }

  async status() {
    const current = this.currentToken();
    const base = {
      connected: false,
      source: current?.source || null,
      oauthAvailable: this.oauthConfigured,
      canDisconnect: current?.source === 'oauth',
      expiresAt: current?.saved?.expiresAt || null,
    };
    if (!current) return base;
    try {
      const account = await this.account();
      return { ...base, connected: true, account };
    } catch (err) {
      if (err instanceof AppError) return { ...base, error: err.toJSON() };
      throw err;
    }
  }

  loginUrl(state) {
    if (!this.oauthConfigured) {
      throw new AppError('OAUTH_NOT_CONFIGURED', 'O login pelo Instagram não está configurado no servidor.', {
        hint: 'Preencha IG_APP_ID, IG_APP_SECRET e IG_REDIRECT_URI no .env ou use INSTAGRAM_ACCESS_TOKEN.',
      });
    }
    const url = new URL(this.cfg.authorizeUrl);
    url.searchParams.set('enable_fb_login', '0');
    url.searchParams.set('force_authentication', '1');
    url.searchParams.set('client_id', this.cfg.appId);
    url.searchParams.set('redirect_uri', this.cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.cfg.scopes.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Troca o código do OAuth por um token de longa duração (60 dias) e salva no servidor. */
  async handleCallback(code) {
    const form = new URLSearchParams({
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.cfg.redirectUri,
      code: String(code).replace(/#_$/, ''),
    });
    const res = await this.fetch(this.cfg.tokenUrl, { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    const short = body?.data?.[0] || body;
    if (!res.ok || !short?.access_token) {
      throw new AppError('OAUTH_FAILED', 'O Instagram recusou a autorização.', {
        hint: body?.error_message || body?.error?.message || 'Tente conectar novamente.',
      });
    }

    const longUrl = new URL(`${this.cfg.graphBase}/access_token`);
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', this.cfg.appSecret);
    longUrl.searchParams.set('access_token', short.access_token);
    const longRes = await this.fetch(longUrl);
    const long = await longRes.json().catch(() => null);
    if (!longRes.ok || !long?.access_token) {
      throw new AppError('OAUTH_FAILED', 'Não foi possível obter o token de longa duração.', {
        hint: long?.error?.message || 'Tente conectar novamente.',
      });
    }

    this.store.write({
      accessToken: long.access_token,
      userId: String(short.user_id || ''),
      obtainedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + Number(long.expires_in || 60 * 24 * 3600) * 1000).toISOString(),
    });
    this.accountCache = null;
  }

  /** Renova o token do OAuth quando faltam menos de 10 dias para expirar (precisa ter mais de 24h). */
  async maybeRefresh() {
    const saved = this.store.read();
    if (!saved?.accessToken || !saved.expiresAt) return;
    const age = Date.now() - new Date(saved.obtainedAt).getTime();
    const remaining = new Date(saved.expiresAt).getTime() - Date.now();
    if (age < DAY || remaining > 10 * DAY || remaining <= 0) return;
    try {
      const url = new URL(`${this.cfg.graphBase}/refresh_access_token`);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', saved.accessToken);
      const res = await this.fetch(url);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.access_token) {
        this.store.write({
          ...saved,
          accessToken: body.access_token,
          obtainedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + Number(body.expires_in) * 1000).toISOString(),
        });
      }
    } catch {
      // A renovação é oportunista; o token atual continua válido até expirar.
    }
  }

  disconnect() {
    this.store.clear();
    this.accountCache = null;
  }
}
