import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

const MAX_LINES = 200_000;

/** Parser CSV simples (aspas, vírgula ou ponto e vírgula). */
function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/**
 * Importação manual (alternativa quando a API não dá acesso à publicação).
 * Formatos aceitos:
 *  - CSV com cabeçalho contendo "username" (ou "usuario") e "text"/"comentario"/"comment"
 *  - Uma linha por comentário: "@usuario texto do comentário"  ou  "usuario: texto"
 */
export function parseImport(raw) {
  const text = String(raw || '').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new AppError('IMPORT_EMPTY', 'Cole ou envie ao menos um comentário.');
  if (lines.length > MAX_LINES) throw new AppError('IMPORT_TOO_LARGE', `Limite de ${MAX_LINES} linhas por importação.`);

  const comments = [];
  let rejected = 0;
  const first = lines[0];
  const sep = first.includes(';') && !first.includes(',') ? ';' : ',';
  const header = parseCsvLine(first, sep).map((h) => h.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));
  const uIdx = header.findIndex((h) => ['username', 'usuario', 'user', 'perfil'].includes(h.replace(/^@/, '')));

  const push = (username, body, ts, i) => {
    const u = String(username || '').trim().replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(u)) { rejected++; return; }
    const id = 'imp_' + createHash('sha1').update(`${i}|${u}|${body}`).digest('hex').slice(0, 16);
    comments.push({ id, username: u, text: String(body || ''), timestamp: ts || null, parentId: null, likeCount: 0 });
  };

  if (uIdx >= 0) {
    const tIdx = header.findIndex((h) => ['text', 'texto', 'comentario', 'comment', 'comentarios'].includes(h));
    const dIdx = header.findIndex((h) => ['timestamp', 'data', 'date'].includes(h));
    lines.slice(1).forEach((line, i) => {
      const cols = parseCsvLine(line, sep);
      push(cols[uIdx], tIdx >= 0 ? cols[tIdx] : '', dIdx >= 0 ? cols[dIdx] : null, i);
    });
  } else {
    lines.forEach((line, i) => {
      // "@usuario texto" (o @ é obrigatório) ou "usuario: texto" / "usuario;texto" / "usuario<TAB>texto"
      const m = line.trim().match(/^(?:@([A-Za-z0-9._]{1,30})(?:\s+(.*))?|([A-Za-z0-9._]{1,30})\s*[:;,\t]\s*(.*))$/);
      if (!m) { rejected++; return; }
      push(m[1] || m[3], m[2] ?? m[4] ?? '', null, i);
    });
  }
  if (!comments.length) throw new AppError('IMPORT_EMPTY', 'Nenhum comentário reconhecido no conteúdo importado.', {
    hint: 'Use uma linha por comentário no formato "@usuario texto" ou um CSV com colunas username,text.',
  });
  return { comments, rejected };
}

const USER_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Comentários enviados pelo botão "Enviar para o sorteador" (lidos no navegador do usuário).
 * Tudo é revalidado aqui: o servidor não confia no formato recebido.
 */
export function parseCollected(body) {
  const post = body?.post || {};
  const list = Array.isArray(body?.comments) ? body.comments : null;
  if (!list) throw new AppError('COLLECT_INVALID', 'Nenhum comentário recebido do Instagram.');
  const shortcode = String(post.shortcode || '');
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(shortcode)) throw new AppError('COLLECT_INVALID', 'Publicação inválida recebida do coletor.');

  const byId = new Map();
  let rejected = 0;
  for (const c of list) {
    const id = String(c?.id ?? '').slice(0, 64);
    const username = String(c?.username ?? '');
    if (!id || !USER_RE.test(username)) { rejected++; continue; }
    if (byId.has(id)) continue;
    const ts = c.timestamp && !Number.isNaN(Date.parse(c.timestamp)) ? new Date(c.timestamp).toISOString() : null;
    byId.set(id, { id, username, text: String(c.text ?? '').slice(0, 5000), timestamp: ts, parentId: c.parentId ? String(c.parentId).slice(0, 64) : null, likeCount: 0 });
  }
  const owner = USER_RE.test(String(post.ownerUsername || '')) ? String(post.ownerUsername) : null;
  const thumb = /^https:\/\/[^\s"']+$/.test(String(post.thumbnailUrl || '')) ? String(post.thumbnailUrl) : null;
  return {
    comments: [...byId.values()],
    rejected,
    post: {
      id: `ig:${shortcode}`,
      shortcode,
      permalink: `https://www.instagram.com/p/${shortcode}/`,
      caption: String(post.caption || '').slice(0, 2200),
      thumbnailUrl: thumb,
      ownerUsername: owner,
      reportedCommentsCount: Number.isFinite(post.reportedCommentsCount) ? post.reportedCommentsCount : null,
      collector: 'browser',
      partial: Boolean(body.partial),
      partialReason: body.partial ? String(body.partialReason || 'A coleta não chegou ao fim.').slice(0, 300) : null,
    },
  };
}
