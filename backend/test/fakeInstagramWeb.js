// Imitação local das rotas do site instagram.com usadas pelo botão "Enviar para o sorteador".
// Apenas DADOS DE TESTE (usuários "teste_web_*"). Uso: node backend/test/fakeInstagramWeb.js 4020
import fs from 'node:fs';
import http from 'node:http';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const toId = (code) => String([...code.slice(0, 11)].reduce((n, ch) => n * 64n + BigInt(A.indexOf(ch)), 0n));

const SHORTCODE = 'TESTE123abc';
const MEDIA_ID = toId(SHORTCODE);
const PAGE = 15;
const comments = Array.from({ length: 120 }, (_, k) => {
  const i = k + 1;
  const replies = i % 10 === 0
    ? Array.from({ length: 4 }, (_, r) => ({ pk: `r${i}_${r}`, text: `resposta ${r} @amigo_web`, created_at: 1793900000 + i * 10 + r, user: { username: `teste_resposta_${i}_${r}` } }))
    : [];
  return {
    pk: `c${i}`,
    text: `[teste] comentário ${i}${i % 3 === 0 ? ' @amigo_web_a @amigo_web_b' : ''}${i % 4 === 0 ? ' #SorteioTeste' : ''}`,
    created_at: 1793900000 + i * 10,
    user: { username: `teste_web_${String(i).padStart(3, '0')}` },
    child_comment_count: replies.length,
    replies,
  };
});

export function startFakeInstagramWeb(port = 4020) {
  let throttled = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/__collector.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(new URL('../../frontend/src/collector/collector.js', import.meta.url)));
    }
    if (url.pathname.startsWith('/p/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Instagram SIMULADO (teste)</title><body style="font-family:sans-serif;background:#fafafa;padding:40px"><h1>Instagram SIMULADO — dados de teste</h1><p>Post ${SHORTCODE} com 120 comentários fictícios.</p><button id="run" style="font-size:18px;padding:12px 20px">Executar o botão (teste)</button><script type="module">import { collector } from '/__collector.js'; window.__sorteadorOpts = { gapMs: 30, pauseMs: 1500 }; document.getElementById('run').onclick = () => collector('http://localhost:3002');</script></body>`);
    }
    if (!req.headers['x-ig-app-id']) return json(400, { status: 'fail', message: 'useragent mismatch' });
    const parts = url.pathname.split('/').filter(Boolean); // api v1 media {id} ...
    if (parts[3] !== MEDIA_ID) return json(404, { status: 'fail', message: 'Media not found' });
    if (parts[4] === 'info') {
      return json(200, { status: 'ok', items: [{ pk: MEDIA_ID, code: SHORTCODE, user: { username: 'conta_teste_web' }, caption: { text: '[TESTE] Post simulado' }, comment_count: 168 }] });
    }
    if (parts[4] === 'comments' && !parts[5]) {
      const cursor = url.searchParams.get('min_id');
      const offset = cursor ? JSON.parse(cursor).offset : 0;
      if (offset === PAGE * 2 && !throttled) { throttled = true; return json(429, { status: 'fail', message: 'Please wait a few minutes before you try again.' }); }
      const page = comments.slice(offset, offset + PAGE).map(({ replies, ...c }) => ({ ...c, preview_child_comments: replies.slice(0, 1) }));
      // repete um item da página anterior (deduplicação)
      if (offset) page.unshift({ ...comments[offset - 1], replies: undefined, preview_child_comments: [] });
      const more = offset + PAGE < comments.length;
      return json(200, { status: 'ok', comments: page, has_more_headload_comments: more, ...(more && { next_min_id: JSON.stringify({ offset: offset + PAGE }) }) });
    }
    if (parts[4] === 'comments' && parts[6] === 'child_comments') {
      const c = comments.find((x) => x.pk === parts[5]);
      const offset = Number(url.searchParams.get('max_id') || 1);
      const slice = c.replies.slice(offset, offset + 2);
      const more = offset + 2 < c.replies.length;
      return json(200, { status: 'ok', child_comments: slice, has_more_tail_child_comments: more, next_max_child_cursor: more ? String(offset + 2) : null });
    }
    json(404, { status: 'fail', message: 'not found' });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 4020);
  startFakeInstagramWeb(port).then(() => console.log(`Instagram SIMULADO (dados de teste) em http://localhost:${port}/p/${SHORTCODE}/`));
}
