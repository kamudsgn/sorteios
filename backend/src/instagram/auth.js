import { AppError } from '../errors.js';
import { GraphClient } from './graphClient.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Conexão com a conta profissional do Instagram.
 *
 * As credenciais conectadas pela própria página (login pelo Instagram, token colado e dados do app da Meta)
 * ficam num cookie criptografado no navegador do operador (`creds`), então sobrevivem aos reinícios do
 * servidor gratuito. O backend descriptografa a cada requisição; o navegador nunca consegue ler o conteúdo.
 *
 * Prioridade do token: conectado pela página (creds) → INSTAGRAM_ACCESS_TOKEN do servidor.
 * Prioridade do app da Meta: variáveis do servidor (IG_APP_ID/IG_APP_SECRET) → salvo pela página.
 */
export class InstagramAuth {
  constructor(cfg, { fetchImpl = fetch } = {}) {
    this.cfg = cfg.instagram;
    this.appUrl = cfg.appUrl;
    this.fetch = fetchImpl;
    this.accountCache = new Map(); // token → { account, at }
  }

  redirectUri() {
    return this.cfg.redirectUri || `${this.appUrl}/api/auth/callback`;
  }

  appConfig(creds) {
    if (this.cfg.appId && this.cfg.appSecret) return { appId: this.cfg.appId, appSecret: this.cfg.appSecret, source: 'server' };
    if (creds?.appId && creds?.appSecret) return { appId: creds.appId, appSecret: creds.appSecret, source: 'browser' };
    return null;
  }

  currentToken(creds) {
    if (creds?.token) return { token: creds.token, source: creds.tokenSource || 'browser', expiresAt: creds.expiresAt || null };
    if (this.cfg.envToken) return { token: this.cfg.envToken, source: 'server', expiresAt: null };
    return null;
  }

  client(creds) {
    const t = this.currentToken(creds);
    if (!t) {
      throw new AppError('NOT_CONNECTED', 'Nenhuma conta do Instagram conectada.', {
        status: 401,
        hint: 'Clique em "Conectar Instagram" no topo da página.',
      });
    }
    return new GraphClient({ ...this.cfg, token: t.token, fetchImpl: this.fetch });
  }

  /** Consulta a conta dona do token (com cache de 5 min). */
  async accountFor(token) {
    const hit = this.accountCache.get(token);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.account;
    const client = new GraphClient({ ...this.cfg, token, fetchImpl: this.fetch });
    const me = await client.get(client.accountPath, { fields: 'id,username,profile_picture_url' });
    const account = { id: String(me.user_id || me.id), username: me.username, profilePictureUrl: me.profile_picture_url || null };
    this.accountCache.set(token, { account, at: Date.now() });
    return account;
  }

  async account(creds) {
    const t = this.currentToken(creds);
    return t ? this.accountFor(t.token) : null;
  }

  async status(creds) {
    const t = this.currentToken(creds);
    const app = this.appConfig(creds);
    const base = {
      connected: false,
      source: t?.source || null, // 'oauth' | 'manual' | 'server'
      canDisconnect: Boolean(creds?.token),
      expiresAt: t?.expiresAt || null,
      appConfigured: Boolean(app),
      appSource: app?.source || null,
      appId: app?.appId || null,
      redirectUri: this.redirectUri(),
      oauthAvailable: Boolean(app),
    };
    if (!t) return base;
    try {
      return { ...base, connected: true, account: await this.accountFor(t.token) };
    } catch (err) {
      if (err instanceof AppError) return { ...base, error: err.toJSON() };
      throw err;
    }
  }

  /** Valida um token colado pelo usuário e devolve as credenciais para salvar. */
  async connectWithToken(raw) {
    const token = String(raw || '').trim().replace(/^Bearer\s+/i, '');
    if (!/^[A-Za-z0-9._|-]{40,1000}$/.test(token)) {
      throw new AppError('INVALID_TOKEN_FORMAT', 'Isso não parece um token de acesso do Instagram.', {
        hint: 'Copie o token inteiro gerado no painel da Meta (começa com "IG").',
      });
    }
    this.accountCache.delete(token);
    let account;
    try {
      account = await this.accountFor(token);
    } catch (err) {
      if (err.code === 'TOKEN_INVALID') {
        throw new AppError('TOKEN_INVALID', 'O Instagram não aceitou este token.', {
          status: 400,
          hint: 'Gere um novo token em "API setup with Instagram login" → "Generate token" e cole aqui.',
        });
      }
      throw err;
    }
    return { creds: { token, tokenSource: 'manual', obtainedAt: new Date().toISOString(), expiresAt: null }, account };
  }

  saveAppConfig(appId, appSecret) {
    const id = String(appId || '').trim();
    const secret = String(appSecret || '').trim();
    if (!/^\d{6,30}$/.test(id)) throw new AppError('INVALID_APP', 'O ID do app do Instagram deve conter só números.');
    if (!/^[0-9a-f]{32}$/i.test(secret)) throw new AppError('INVALID_APP', 'A chave secreta do app deve ter 32 caracteres (letras a-f e números).');
    return { appId: id, appSecret: secret };
  }

  loginUrl(state, creds) {
    const app = this.appConfig(creds);
    if (!app) {
      throw new AppError('OAUTH_NOT_CONFIGURED', 'O botão "Entrar com Instagram" ainda não foi configurado.', {
        hint: 'Abra "Conectar Instagram" e preencha o ID e a chave secreta do app da Meta.',
      });
    }
    const url = new URL(this.cfg.authorizeUrl);
    url.searchParams.set('enable_fb_login', '0');
    url.searchParams.set('force_authentication', '1');
    url.searchParams.set('client_id', app.appId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.cfg.scopes.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Troca o código do login por um token de longa duração (~60 dias). */
  async exchangeCode(code, creds) {
    const app = this.appConfig(creds);
    if (!app) throw new AppError('OAUTH_NOT_CONFIGURED', 'O app da Meta não está configurado.');
    const form = new URLSearchParams({
      client_id: app.appId,
      client_secret: app.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(),
      code: String(code).replace(/#_$/, ''),
    });
    const res = await this.fetch(this.cfg.tokenUrl, { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    const short = body?.data?.[0] || body;
    if (!res.ok || !short?.access_token) {
      throw new AppError('OAUTH_FAILED', `O Instagram recusou a autorização${body?.error_message ? `: ${body.error_message}` : '.'}`);
    }

    const longUrl = new URL(`${this.cfg.graphBase}/access_token`);
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', app.appSecret);
    longUrl.searchParams.set('access_token', short.access_token);
    const longRes = await this.fetch(longUrl);
    const long = await longRes.json().catch(() => null);
    if (!longRes.ok || !long?.access_token) {
      throw new AppError('OAUTH_FAILED', 'Não foi possível obter o token de longa duração. Tente conectar novamente.');
    }
    return {
      token: long.access_token,
      tokenSource: 'oauth',
      obtainedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + Number(long.expires_in || 60 * 24 * 3600) * 1000).toISOString(),
    };
  }

  /**
   * Renova tokens conectados pela página: quando faltam menos de 10 dias para expirar,
   * ou semanalmente quando a validade é desconhecida. Retorna credenciais novas ou null.
   */
  async refreshIfNeeded(creds) {
    if (!creds?.token || !creds.obtainedAt) return null;
    const age = Date.now() - new Date(creds.obtainedAt).getTime();
    if (age < DAY) return null;
    if (creds.expiresAt) {
      const remaining = new Date(creds.expiresAt).getTime() - Date.now();
      if (remaining > 10 * DAY || remaining <= 0) return null;
    } else if (age < 7 * DAY) return null;
    try {
      const url = new URL(`${this.cfg.graphBase}/refresh_access_token`);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', creds.token);
      const res = await this.fetch(url);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.access_token) return null;
      return {
        ...creds,
        token: body.access_token,
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + Number(body.expires_in) * 1000).toISOString(),
      };
    } catch {
      return null; // a renovação é oportunista
    }
  }
}
