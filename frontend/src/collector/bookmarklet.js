import { collector } from './collector.js';

/** Endereço do favorito ("javascript:...") com a origem deste sorteador embutida. */
export function bookmarkletHref(origin = window.location.origin) {
  return 'javascript:' + encodeURIComponent(`(${collector.toString()})(${JSON.stringify(origin)});void 0`);
}

/** Origens aceitas ao receber comentários: Instagram (e localhost só em testes locais). */
export function isTrustedCollectorOrigin(origin) {
  if (/^https:\/\/([a-z0-9-]+\.)*instagram\.com$/.test(origin)) return true;
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  return local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
