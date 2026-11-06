import { AppError } from '../errors.js';

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am']);
const KINDS = { p: 'post', reel: 'reel', reels: 'reel', tv: 'video' };

/**
 * Valida o link de uma publicação e extrai o shortcode.
 * Aceita: instagram.com/p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, /usuario/p/CODE (com ou sem https, www, query).
 */
export function parseInstagramUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new AppError('INVALID_URL', 'Cole o link de uma publicação do Instagram.');

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw invalid();
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) throw invalid();

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'stories' || parts[0] === 's') {
    throw new AppError('UNSUPPORTED_MEDIA', 'Stories e destaques não têm comentários públicos para sorteio.', {
      hint: 'Use o link de um post, carrossel ou reel.',
    });
  }

  let username = null;
  let i = 0;
  if (!KINDS[parts[0]] && parts.length >= 3 && KINDS[parts[1]]) {
    username = parts[0].toLowerCase();
    i = 1;
  }
  const kind = KINDS[parts[i]];
  const shortcode = parts[i + 1];
  if (!kind || !shortcode || !/^[A-Za-z0-9_-]{5,64}$/.test(shortcode)) throw invalid();

  return { shortcode, kind, username, canonicalUrl: `https://www.instagram.com/${parts[i] === 'reels' ? 'reel' : parts[i]}/${shortcode}/` };
}

function invalid() {
  return new AppError('INVALID_URL', 'Link inválido. Use o link de um post ou reel do Instagram.', {
    hint: 'Exemplo: https://www.instagram.com/p/C1a2B3c4D5e/',
  });
}

/** Extrai o shortcode de um permalink retornado pela API. */
export function shortcodeFromPermalink(permalink) {
  try {
    return parseInstagramUrl(permalink).shortcode;
  } catch {
    return null;
  }
}
