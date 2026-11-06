// Servidor que imita a Graph API do Instagram com DADOS DE TESTE (usuários "teste_*").
// Usado somente pelos testes automatizados e pela demonstração local — nunca em produção.
import http from 'node:http';

export const TEST_TOKEN = 'IGTEST_TOKEN_NAO_REAL_USADO_SOMENTE_EM_TESTES_0001';

export function buildFixture({ comments = 120, owner = 'conta_teste' } = {}) {
  const list = [];
  for (let i = 1; i <= comments; i++) {
    const user = `teste_usuario_${String(((i - 1) % Math.ceil(comments * 0.8)) + 1).padStart(3, '0')}`;
    const tags = i % 3 === 0 ? ' @amigo_teste_a @amigo_teste_b' : i % 3 === 1 ? ' @amigo_teste_a' : '';
    const hashtag = i % 4 === 0 ? ' #SorteioTeste' : '';
    const word = i % 5 === 0 ? ' Quero GANHAR!' : ' participando';
    list.push({
      id: `c${i}`,
      username: user,
      text: `[teste]${word}${tags}${hashtag}`,
      timestamp: new Date(Date.UTC(2026, 10, 1, 12, 0, i)).toISOString(),
      like_count: 0,
      replies: i % 10 === 0 ? [
        { id: `r${i}a`, username: owner, text: 'Obrigado! (resposta da conta de teste)', timestamp: new Date(Date.UTC(2026, 10, 1, 13, 0, i)).toISOString() },
        { id: `r${i}b`, username: `teste_resposta_${i}`, text: 'eu também @amigo_teste_c', timestamp: new Date(Date.UTC(2026, 10, 1, 13, 1, i)).toISOString() },
        { id: `r${i}c`, username: `teste_resposta_${i}_2`, text: 'boa sorte', timestamp: new Date(Date.UTC(2026, 10, 1, 13, 2, i)).toISOString() },
      ] : [],
    });
  }
  return {
    owner,
    media: [
      { id: '9001', shortcode: 'OUTRO000001', permalink: 'https://www.instagram.com/p/OUTRO000001/', caption: 'Outra publicação', media_type: 'IMAGE', comments_count: 0, username: owner, timestamp: '2026-10-01T10:00:00+0000' },
      { id: '9002', shortcode: 'TESTE123abc', permalink: 'https://www.instagram.com/p/TESTE123abc/', caption: '[DADOS DE TESTE] Publicação fictícia usada só para validar o sistema', media_type: 'IMAGE', comments_count: comments + list.reduce((n, c) => n + c.replies.length, 0) + 3, username: owner, timestamp: '2026-11-01T10:00:00+0000' },
    ],
    comments: list,
  };
}

/** Sobe o servidor fake. opts.rateLimitOnce: primeira chamada de comentários devolve erro code 4. */
export async function startFakeGraph({ fixture = buildFixture(), pageSize = 25, mediaPageSize = 1, rateLimitOnce = true, port = 0 } = {}) {
  let rateLimited = !rateLimitOnce;
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    calls.push(url.pathname);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const base = `http://${req.headers.host}`;
    if (url.searchParams.get('access_token') !== TEST_TOKEN) {
      return send(400, { error: { message: 'Invalid OAuth access token - Cannot parse access token', type: 'OAuthException', code: 190 } });
    }
    const after = Number(url.searchParams.get('after') || 0);
    const page = (items, size, path) => {
      const slice = items.slice(after, after + size);
      const next = after + size < items.length ? `${base}${path}?access_token=${TEST_TOKEN}&after=${after + size}` : undefined;
      return { data: slice, paging: { cursors: { after: String(after + size) }, ...(next && { next }) } };
    };

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1 && parts[0] === 'me') return send(200, { id: '17841400000000000', user_id: '17841400000000000', username: fixture.owner });
    if (parts[0] === 'me' && parts[1] === 'media') return send(200, page(fixture.media, mediaPageSize, '/me/media'));

    if (parts[1] === 'comments') {
      const media = fixture.media.find((m) => m.id === parts[0]);
      if (!media) return send(400, { error: { message: 'Unsupported get request.', code: 100 } });
      if (!rateLimited) {
        rateLimited = true;
        return send(400, { error: { message: 'Application request limit reached', code: 4 } });
      }
      const list = media.id === '9002' ? fixture.comments : [];
      const p = page(list, pageSize, url.pathname);
      // Duplica o último comentário da página anterior para testar deduplicação.
      if (after > 0) p.data.unshift(list[after - 1]);
      p.data = p.data.map((c) => ({
        ...c,
        replies: c.replies.length ? {
          data: c.replies.slice(0, 2),
          paging: c.replies.length > 2 ? { next: `${base}/${c.id}/replies?access_token=${TEST_TOKEN}&after=2` } : {},
        } : undefined,
      }));
      return send(200, p);
    }
    if (parts[1] === 'replies') {
      const c = fixture.comments.find((x) => x.id === parts[0]);
      return send(200, { data: c ? c.replies.slice(after) : [], paging: {} });
    }
    send(404, { error: { message: 'Unknown path', code: 100 } });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const { port: p } = server.address();
  return { url: `http://127.0.0.1:${p}`, server, calls, fixture, close: () => new Promise((r) => server.close(r)) };
}

// Execução direta: `node backend/test/fakeGraph.js 4010` (demonstração local com dados de teste).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 4010);
  const n = Number(process.argv[3] || 500);
  startFakeGraph({ port, fixture: buildFixture({ comments: n }), rateLimitOnce: false }).then((f) => console.log(`Fake Graph API (DADOS DE TESTE) em ${f.url} · token: ${TEST_TOKEN}`));
}
