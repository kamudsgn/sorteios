import { randomInt, randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

export function defaultSettings() {
  return {
    allowRepeatWinners: false,
    entryMode: 'comment', // 'comment' = 1 chance por comentário válido · 'profile' = 1 chance por perfil
    includeReplies: true,
    excludeOwner: true,
    rules: {
      requiredText: { enabled: false, value: '' },
      requiredHashtag: { enabled: false, value: '' },
      minMentions: { enabled: false, value: 2 },
      requireMention: { enabled: false },
    },
    excluded: [],
  };
}

const userKey = (u) => String(u || '').trim().replace(/^@+/, '').toLowerCase();

export const normalizeText = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Menções distintas do texto (sem o @), em minúsculas. */
export function extractMentions(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?:^|[^\w.@])@([A-Za-z0-9._]{1,30})/g)) {
    const name = m[1].replace(/\.+$/, '').toLowerCase();
    if (name) out.add(name);
  }
  return out;
}

export function extractHashtags(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) out.add(normalizeText(m[1]));
  return out;
}

/** Valida e sanitiza as configurações recebidas do frontend (nada é alterado em silêncio). */
export function sanitizeSettings(input, current = defaultSettings()) {
  const s = structuredClone(current);
  const i = input || {};
  if ('allowRepeatWinners' in i) s.allowRepeatWinners = Boolean(i.allowRepeatWinners);
  if ('entryMode' in i) {
    if (!['comment', 'profile'].includes(i.entryMode)) throw new AppError('INVALID_SETTINGS', 'Modo de participação inválido.');
    s.entryMode = i.entryMode;
  }
  if ('includeReplies' in i) s.includeReplies = Boolean(i.includeReplies);
  if ('excludeOwner' in i) s.excludeOwner = Boolean(i.excludeOwner);
  const r = i.rules || {};
  if (r.requiredText) {
    s.rules.requiredText = { enabled: Boolean(r.requiredText.enabled), value: String(r.requiredText.value ?? '').slice(0, 200) };
  }
  if (r.requiredHashtag) {
    s.rules.requiredHashtag = {
      enabled: Boolean(r.requiredHashtag.enabled),
      value: String(r.requiredHashtag.value ?? '').trim().replace(/^#+/, '').slice(0, 100),
    };
  }
  if (r.minMentions) {
    const n = Math.floor(Number(r.minMentions.value));
    if (!Number.isFinite(n) || n < 1 || n > 50) throw new AppError('INVALID_SETTINGS', 'A quantidade mínima de menções deve estar entre 1 e 50.');
    s.rules.minMentions = { enabled: Boolean(r.minMentions.enabled), value: n };
  }
  if (r.requireMention) s.rules.requireMention = { enabled: Boolean(r.requireMention.enabled) };
  if ('excluded' in i) {
    if (!Array.isArray(i.excluded)) throw new AppError('INVALID_SETTINGS', 'Lista de exclusão inválida.');
    s.excluded = [...new Set(i.excluded.map(userKey).filter((u) => /^[a-z0-9._]{1,30}$/.test(u)))];
  }
  return s;
}

/** Retorna os motivos pelos quais um comentário não atende às regras ativas (vazio = válido). */
export function validateComment(comment, rules, ownerKey) {
  const reasons = [];
  const text = comment.text || '';
  if (rules.requiredText.enabled && rules.requiredText.value.trim()) {
    if (!normalizeText(text).includes(normalizeText(rules.requiredText.value))) reasons.push('Sem a palavra/frase obrigatória');
  }
  if (rules.requiredHashtag.enabled && rules.requiredHashtag.value) {
    if (!extractHashtags(text).has(normalizeText(rules.requiredHashtag.value))) reasons.push('Sem a hashtag obrigatória');
  }
  if (rules.minMentions.enabled || rules.requireMention.enabled) {
    const mentions = extractMentions(text);
    mentions.delete(userKey(comment.username));
    if (ownerKey) mentions.delete(ownerKey);
    if (rules.requireMention.enabled && mentions.size < 1) reasons.push('Sem marcação de outra pessoa');
    if (rules.minMentions.enabled && mentions.size < rules.minMentions.value) {
      reasons.push(`Menos de ${rules.minMentions.value} pessoa(s) marcada(s)`);
    }
  }
  return reasons;
}

/**
 * Monta o conjunto de participações elegíveis a partir dos comentários e das configurações.
 * Essa é a única fonte de verdade usada pelo sorteio e pelas estatísticas.
 */
export function buildPool(comments, settings, { ownerUsername, winners = [] } = {}) {
  const ownerKey = userKey(ownerUsername);
  const excluded = new Set(settings.excluded);
  const winnerKeys = new Set(winners.map((w) => userKey(w.username)));
  const users = new Map(); // key → { username, total, valid: [], status }

  const stats = {
    totalComments: comments.length,
    topLevelComments: 0,
    replies: 0,
    consideredComments: 0,
    validComments: 0,
    invalidComments: 0,
    excludedComments: 0,
    uniqueUsers: 0,
    validParticipants: 0,
    eligibleParticipants: 0,
    blockedWinners: 0,
    tickets: 0,
  };

  for (const c of comments) {
    if (c.parentId) stats.replies++;
    else stats.topLevelComments++;
    if (c.parentId && !settings.includeReplies) continue;
    const key = userKey(c.username);
    let u = users.get(key);
    if (!u) users.set(key, (u = { key, username: c.username, total: 0, valid: [], invalidReasons: new Set() }));
    u.total++;
    stats.consideredComments++;

    if (excluded.has(key) || (settings.excludeOwner && ownerKey && key === ownerKey)) {
      stats.excludedComments++;
      continue;
    }
    const reasons = validateComment(c, settings.rules, ownerKey);
    if (reasons.length) {
      stats.invalidComments++;
      reasons.forEach((r) => u.invalidReasons.add(r));
    } else {
      stats.validComments++;
      u.valid.push(c);
    }
  }

  const tickets = [];
  for (const u of users.values()) {
    if (excluded.has(u.key)) u.status = 'excluded';
    else if (settings.excludeOwner && ownerKey && u.key === ownerKey) u.status = 'owner';
    else if (!u.valid.length) u.status = 'invalid';
    else if (!settings.allowRepeatWinners && winnerKeys.has(u.key)) u.status = 'winner';
    else u.status = 'eligible';

    if (u.valid.length) stats.validParticipants++;
    if (u.status === 'winner') stats.blockedWinners++;
    if (u.status !== 'eligible') continue;

    stats.eligibleParticipants++;
    u.valid.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    if (settings.entryMode === 'profile') tickets.push({ username: u.username, comment: u.valid[0], entries: 1 });
    else for (const c of u.valid) tickets.push({ username: u.username, comment: c, entries: u.valid.length });
  }
  stats.uniqueUsers = users.size;
  stats.tickets = tickets.length;
  return { tickets, stats, users };
}

/** Sorteia uma participação usando o gerador criptográfico do Node (crypto.randomInt). */
export function drawWinner(pool, { order, settings }) {
  if (!pool.tickets.length) {
    throw new AppError('NO_PARTICIPANTS', 'Não há participantes elegíveis para sortear.', {
      status: 409,
      hint: settings.allowRepeatWinners
        ? 'Revise as regras de validação e a lista de exclusão.'
        : 'Todos os elegíveis já ganharam. Ative "Permitir ganhadores repetidos" ou revise as regras.',
    });
  }
  const index = randomInt(0, pool.tickets.length);
  const t = pool.tickets[index];
  return {
    id: randomUUID(),
    order,
    username: t.username,
    comment: { id: t.comment.id, text: t.comment.text, timestamp: t.comment.timestamp, isReply: Boolean(t.comment.parentId) },
    validEntries: settings.entryMode === 'profile' ? 1 : t.entries,
    drawnAt: new Date().toISOString(),
    poolTickets: pool.tickets.length,
    poolParticipants: pool.stats.eligibleParticipants,
    entryMode: settings.entryMode,
    allowRepeatWinners: settings.allowRepeatWinners,
  };
}

/** Nomes aleatórios do conjunto elegível, apenas para a animação visual (o resultado já foi definido). */
export function animationSample(pool, size = 24) {
  const names = [...new Set(pool.tickets.map((t) => t.username))];
  const out = [];
  for (let i = 0; i < Math.min(size, names.length * 3); i++) out.push(names[randomInt(0, names.length)]);
  return out;
}
