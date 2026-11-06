import { AppError } from '../errors.js';

// Códigos da Graph API que indicam falha temporária / limite de requisições.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002]);
const TRANSIENT_CODES = new Set([1, 2, 341]);
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cliente mínimo da Graph API do Instagram.
 * - Anexa o token apenas no servidor (nunca sai para o frontend).
 * - Repete automaticamente em falhas temporárias e limites de taxa (backoff exponencial).
 * - Segue paginação por `paging.next`, validando que o link aponta para o mesmo host.
 */
export class GraphClient {
  constructor({ graphBase, apiVersion, token, igUserId, retryBaseMs = 1000, fetchImpl = fetch }) {
    this.base = graphBase;
    this.version = apiVersion;
    this.token = token;
    this.accountPath = igUserId || 'me';
    this.retryBaseMs = retryBaseMs;
    this.fetch = fetchImpl;
    this.host = new URL(graphBase).host;
  }

  buildUrl(path, params = {}) {
    const prefix = this.version ? `/${this.version}` : '';
    const url = new URL(`${this.base}${prefix}/${String(path).replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    url.searchParams.set('access_token', this.token);
    return url;
  }

  get(path, params) {
    return this.request(this.buildUrl(path, params));
  }

  /** Busca uma URL de paginação devolvida pela própria API. */
  getNext(nextUrl) {
    const url = new URL(nextUrl);
    if (url.host !== this.host) {
      throw new AppError('GRAPH_ERROR', 'Link de paginação inesperado retornado pela API.', { status: 502 });
    }
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', this.token);
    return this.request(url);
  }

  async request(url, attempt = 1) {
    let res;
    let body = null;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' } });
      body = await res.json().catch(() => null);
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(this.retryBaseMs * 2 ** (attempt - 1));
        return this.request(url, attempt + 1);
      }
      throw new AppError('NETWORK_ERROR', 'Não foi possível conectar à API do Instagram.', {
        status: 502,
        hint: 'Verifique a conexão de internet do servidor e tente novamente.',
      });
    }

    if (res.ok && body && !body.error) return body;

    const err = body?.error || {};
    const code = Number(err.code);

    if (code === 190 || res.status === 401) {
      throw new AppError('TOKEN_INVALID', 'O token do Instagram é inválido ou expirou.', {
        status: 401,
        hint: 'Conecte a conta novamente (botão "Conectar Instagram") ou gere um novo token no painel da Meta.',
        details: { graphCode: code || undefined, subcode: err.error_subcode },
      });
    }

    const isRate = RATE_LIMIT_CODES.has(code) || res.status === 429;
    const isTransient = isRate || TRANSIENT_CODES.has(code) || res.status >= 500;
    if (isTransient && attempt < MAX_ATTEMPTS) {
      const wait = Math.min(this.retryBaseMs * 2 ** (attempt - 1) * (isRate ? 4 : 1), 60_000);
      await sleep(wait);
      return this.request(url, attempt + 1);
    }

    if (isRate) {
      throw new AppError('RATE_LIMITED', 'Limite de requisições da API do Instagram atingido.', {
        status: 429,
        hint: 'Aguarde alguns minutos e carregue novamente. Os comentários já coletados não são duplicados.',
      });
    }

    if (code === 10 || (code >= 200 && code < 300)) {
      throw new AppError('PERMISSION_DENIED', 'A conta conectada não tem permissão para ler estes dados.', {
        status: 403,
        hint: 'Confirme que o app tem a permissão instagram_business_manage_comments e que a conta é profissional (Empresa ou Criador).',
        details: { graphCode: code, message: err.message },
      });
    }

    throw new AppError('GRAPH_ERROR', `A API do Instagram retornou um erro${err.message ? `: ${err.message}` : ` (HTTP ${res.status})`}.`, {
      status: 502,
      details: { graphCode: code || undefined, subcode: err.error_subcode, fbtraceId: err.fbtrace_id },
    });
  }

  /** Itera todas as páginas de um edge (ex.: /{media-id}/comments). */
  async *paginate(path, params) {
    let body = await this.get(path, params);
    for (;;) {
      yield body.data || [];
      const next = body.paging?.next;
      if (!next) return;
      body = await this.getNext(next);
    }
  }
}
