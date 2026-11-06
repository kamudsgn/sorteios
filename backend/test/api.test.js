// Teste de ponta a ponta do backend contra uma Graph API falsa (DADOS DE TESTE).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { startFakeGraph, TEST_TOKEN } from './fakeGraph.js';

let fake;
let server;
let base;

function makeCfg(token = TEST_TOKEN) {
  const cfg = loadConfig({ NODE_ENV: 'test', IG_GRAPH_BASE: fake.url, IG_API_VERSION: '', INSTAGRAM_ACCESS_TOKEN: token, IG_RETRY_BASE_MS: '5', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sorteio-')) });
  cfg.frontendDist = '/nonexistent';
  return cfg;
}

async function startApp(cfg) {
  const app = createApp(cfg);
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}

/** Cliente HTTP com cookie de sessão. */
function client(url) {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(url + p, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

async function waitJob(call, id) {
  for (let i = 0; i < 200; i++) {
    const { data } = await call('GET', `/api/collect/${id}`);
    if (data.job.status !== 'running') return data.job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout');
}

before(async () => {
  fake = await startFakeGraph();
  ({ s: server, url: base } = await startApp(makeCfg()));
});
after(async () => {
  server.close();
  await fake.close();
});

test('fluxo completo: coleta paginada com respostas, sorteio sem repetição, histórico e CSV', async () => {
  const call = client(base);

  const st = await call('GET', '/api/auth/status');
  assert.equal(st.data.connected, true);
  assert.equal(st.data.account.username, 'conta_teste');
  assert.equal(JSON.stringify(st.data).includes(TEST_TOKEN), false, 'token nunca vai para o frontend');

  const bad = await call('POST', '/api/collect', { url: 'https://example.com/x' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'INVALID_URL');

  const start = await call('POST', '/api/collect', { url: 'https://www.instagram.com/p/TESTE123abc/' });
  assert.equal(start.status, 202);
  const dup = await call('POST', '/api/collect', { url: 'https://www.instagram.com/p/TESTE123abc/' });
  assert.equal(dup.data.job.id, start.data.job.id, 'não inicia coleta duplicada');
  const job = await waitJob(call, start.data.job.id);
  assert.equal(job.status, 'done', JSON.stringify(job.error));

  // 120 comentários + 12×3 respostas, sem duplicatas mesmo com itens repetidos entre páginas
  const { data: state } = await call('GET', '/api/state');
  assert.equal(state.stats.topLevelComments, 120);
  assert.equal(state.stats.replies, 36);
  assert.equal(state.stats.totalComments, 156);
  assert.equal(state.post.ownerUsername, 'conta_teste');
  assert.ok(fake.calls.some((p) => p.endsWith('/replies')), 'seguiu paginação de respostas');
  // dono (12 respostas) é excluído por padrão
  assert.equal(state.stats.excludedComments, 12);
  assert.equal(state.stats.tickets, 144);

  // Regras: 2 menções + hashtag
  let r = await call('PUT', '/api/settings', { rules: { minMentions: { enabled: true, value: 2 }, requiredHashtag: { enabled: true, value: 'sorteioteste' } } });
  assert.equal(r.status, 200);
  // i%3==0 e i%4==0 → i%12==0 → 10 comentários
  assert.equal(r.data.stats.validComments, 10);
  assert.equal(r.data.stats.tickets, 10);

  const invalid = await call('PUT', '/api/settings', { rules: { minMentions: { enabled: true, value: 0 } } });
  assert.equal(invalid.status, 400);

  // Exclusão
  r = await call('PUT', '/api/settings', { excluded: ['@teste_usuario_012'] });
  // teste_usuario_012 tinha 2 comentários válidos (i=12 e i=108)
  assert.equal(r.data.stats.tickets, 8);
  assert.equal(r.data.stats.eligibleParticipants, 7);

  // Sortear todos sem repetição
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    const d = await call('POST', '/api/draw', {});
    assert.equal(d.status, 200);
    const w = d.data.winner;
    assert.ok(!seen.has(w.username), 'não repete');
    assert.notEqual(w.username, 'teste_usuario_012');
    assert.match(w.comment.text, /#SorteioTeste/);
    assert.equal(w.order, i + 1);
    assert.equal(w.position, i + 1);
    seen.add(w.username);
  }
  const none = await call('POST', '/api/draw', {});
  assert.equal(none.status, 409);
  assert.equal(none.data.error.code, 'NO_PARTICIPANTS');

  // Remover ganhador do histórico devolve a pessoa ao sorteio
  const { data: s2 } = await call('GET', '/api/state');
  const removed = s2.winners[3];
  const del = await call('DELETE', `/api/winners/${removed.id}`);
  assert.equal(del.data.winners.length, 6);
  assert.equal(del.data.stats.eligibleParticipants, 1);
  const again = await call('POST', '/api/draw', {});
  assert.equal(again.data.winner.username, removed.username);
  assert.equal(again.data.winner.order, 8, 'número de ordem continua crescente');

  // CSV
  const csv = await call('GET', '/api/winners.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal(csv.data.trim().split('\r\n').length, 8);

  // Participantes
  const parts = await call('GET', '/api/participants?status=excluded');
  assert.deepEqual(parts.data.items.map((p) => p.username), ['teste_usuario_012']);

  // Recarregar a mesma publicação mantém histórico
  const re = await call('POST', '/api/collect', { url: 'instagram.com/p/TESTE123abc' });
  await waitJob(call, re.data.job.id);
  assert.equal((await call('GET', '/api/state')).data.winners.length, 7);
});

test('publicação que não pertence à conta conectada é recusada com orientação clara', async () => {
  const call = client(base);
  const a = await call('POST', '/api/collect', { url: 'https://www.instagram.com/outra_conta/p/ABCDE12345/' });
  const j1 = await waitJob(call, a.data.job.id);
  assert.equal(j1.error.code, 'MEDIA_NOT_ACCESSIBLE');
  const b = await call('POST', '/api/collect', { url: 'https://www.instagram.com/p/NAOEXISTE99/' });
  const j2 = await waitJob(call, b.data.job.id);
  assert.equal(j2.error.code, 'MEDIA_NOT_ACCESSIBLE');
  assert.match(j2.error.hint, /Importar lista/);
});

test('token inválido e ausência de conexão geram erros explícitos', async () => {
  const bad = await startApp(makeCfg('TOKEN_ERRADO'));
  const call = client(bad.url);
  const st = await call('GET', '/api/auth/status');
  assert.equal(st.data.connected, false);
  assert.equal(st.data.error.code, 'TOKEN_INVALID');
  const start = await call('POST', '/api/collect', { url: 'https://www.instagram.com/p/TESTE123abc/' });
  const job = await waitJob(call, start.data.job.id);
  assert.equal(job.error.code, 'TOKEN_INVALID');
  bad.s.close();

  const none = await startApp(makeCfg(''));
  const call2 = client(none.url);
  const r = await call2('POST', '/api/collect', { url: 'https://www.instagram.com/p/TESTE123abc/' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'NOT_CONNECTED');
  none.s.close();
});

test('importação manual e proteção contra POST não-JSON', async () => {
  const call = client(base);
  const r = await call('POST', '/api/import', { text: '@teste_a oi @x\n@teste_b oi\n@teste_a de novo', label: 'teste' });
  assert.equal(r.data.source, 'import');
  assert.equal(r.data.stats.tickets, 3);
  assert.equal(r.data.stats.uniqueUsers, 2);
  const form = await fetch(base + '/api/draw', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);
});

test('senha de acesso protege a API quando ACCESS_PASSWORD_HASH está definido', async () => {
  const { randomBytes, scryptSync } = await import('node:crypto');
  const salt = randomBytes(8).toString('hex');
  const cfg = makeCfg();
  cfg.accessPasswordHash = `scrypt$${salt}$${scryptSync('senha-de-teste', salt, 32).toString('hex')}`;
  const app = await startApp(cfg);
  const call = client(app.url);
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.deepEqual((await call('GET', '/api/access')).data, { required: true, granted: false });
  const blocked = await call('GET', '/api/state');
  assert.equal(blocked.status, 401);
  assert.equal(blocked.data.error.code, 'ACCESS_REQUIRED');
  assert.equal((await call('GET', '/api/auth/status')).status, 401);
  assert.equal((await call('POST', '/api/access', { password: 'errada' })).status, 401);

  const res = await fetch(app.url + '/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-de-teste' }) });
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.match(cookies, /sorteio_access=/);
  const ok = await fetch(app.url + '/api/state', { headers: { cookie: cookies } });
  assert.equal(ok.status, 200);
  app.s.close();
});
