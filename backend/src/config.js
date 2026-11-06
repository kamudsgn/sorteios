import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Lê o .env da raiz (sem dependências externas) e monta a configuração do backend. */
export function loadConfig(env = process.env) {
  const envPath = path.join(ROOT_DIR, '.env');
  if (env === process.env && fs.existsSync(envPath)) process.loadEnvFile(envPath);

  const port = Number(env.PORT || 3001);
  return {
    port,
    host: env.HOST || '127.0.0.1',
    // RENDER_EXTERNAL_URL é definido automaticamente pelo Render.
    appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    accessPasswordHash: (env.ACCESS_PASSWORD_HASH || '').trim(),
    // Chave que criptografa a conexão do Instagram guardada no navegador (gerada pelo Render).
    tokenSecret: (env.TOKEN_SECRET || '').trim(),
    isProd: env.NODE_ENV === 'production',
    dataDir: env.DATA_DIR || path.join(ROOT_DIR, 'backend', 'data'),
    frontendDist: path.join(ROOT_DIR, 'frontend', 'dist'),

    instagram: {
      graphBase: (env.IG_GRAPH_BASE || 'https://graph.instagram.com').replace(/\/$/, ''),
      apiVersion: env.IG_API_VERSION ?? 'v24.0',
      igUserId: env.IG_USER_ID || '',
      envToken: (env.INSTAGRAM_ACCESS_TOKEN || '').trim(),
      appId: env.IG_APP_ID || '',
      appSecret: env.IG_APP_SECRET || '',
      redirectUri: env.IG_REDIRECT_URI || '',
      authorizeUrl: env.IG_OAUTH_AUTHORIZE_URL || 'https://www.instagram.com/oauth/authorize',
      tokenUrl: env.IG_OAUTH_TOKEN_URL || 'https://api.instagram.com/oauth/access_token',
      scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
      retryBaseMs: Number(env.IG_RETRY_BASE_MS || 1000),
    },
  };
}
