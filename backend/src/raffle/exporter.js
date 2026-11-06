// Proteção contra "CSV injection" ao abrir no Excel/Sheets.
const safe = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

export function winnersToCsv(winners, post) {
  const head = ['Posição', 'Nº do sorteio', 'Usuário', 'Perfil', 'Comentário', 'Data do comentário', 'Data/hora do sorteio', 'Participações no sorteio', 'Modo', 'Publicação'];
  const rows = winners.map((w, i) => [
    i + 1,
    w.order,
    w.username,
    `https://www.instagram.com/${w.username}/`,
    w.comment.text,
    fmt(w.comment.timestamp),
    fmt(w.drawnAt),
    w.poolTickets,
    w.entryMode === 'profile' ? '1 chance por perfil' : '1 chance por comentário',
    post?.permalink || '',
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(safe).join(';')).join('\r\n') + '\r\n';
}
