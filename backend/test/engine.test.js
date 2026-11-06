import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstagramUrl } from '../src/instagram/url.js';
import { buildPool, defaultSettings, drawWinner, extractMentions, sanitizeSettings, validateComment } from '../src/raffle/engine.js';
import { parseImport } from '../src/raffle/importer.js';
import { winnersToCsv } from '../src/raffle/exporter.js';

const c = (id, username, text, parentId = null) => ({ id, username, text, timestamp: `2026-11-01T00:00:${String(id).padStart(2, '0')}Z`, parentId });

test('parseInstagramUrl aceita formatos válidos e rejeita inválidos', () => {
  for (const u of [
    'https://www.instagram.com/p/C1a2B3c4D5e/',
    'instagram.com/p/C1a2B3c4D5e',
    'https://instagram.com/reel/C1a2B3c4D5e/?igsh=abc',
    'https://www.instagram.com/reels/C1a2B3c4D5e/',
    'https://www.instagram.com/fulano/p/C1a2B3c4D5e/',
    'https://m.instagram.com/tv/C1a2B3c4D5e',
  ]) assert.equal(parseInstagramUrl(u).shortcode, 'C1a2B3c4D5e', u);
  assert.equal(parseInstagramUrl('https://www.instagram.com/fulano/p/C1a2B3c4D5e/').username, 'fulano');
  for (const u of ['', 'https://google.com/p/abcde', 'https://www.instagram.com/fulano/', 'https://www.instagram.com/p/', 'not a url']) {
    assert.throws(() => parseInstagramUrl(u), { code: 'INVALID_URL' }, u);
  }
  assert.throws(() => parseInstagramUrl('https://www.instagram.com/stories/fulano/123'), { code: 'UNSUPPORTED_MEDIA' });
});

test('menções: distintas, ignora e-mails e pontos finais', () => {
  assert.deepEqual([...extractMentions('oi @Ana e @ana, @joao.silva. mail a@b.com')], ['ana', 'joao.silva']);
});

test('regras de validação individuais', () => {
  const s = defaultSettings();
  s.rules.requiredText = { enabled: true, value: 'Quero Ganhar' };
  assert.deepEqual(validateComment(c(1, 'x', 'eu QUERO ganhar!'), s.rules), []);
  assert.equal(validateComment(c(1, 'x', 'quero muito'), s.rules).length, 1);
  assert.deepEqual(validateComment(c(1, 'x', 'Quero gânhar'), s.rules), [], 'ignora acentos');

  const h = defaultSettings();
  h.rules.requiredHashtag = { enabled: true, value: 'promo' };
  assert.deepEqual(validateComment(c(1, 'x', 'vamos #Promo'), h.rules), []);
  assert.equal(validateComment(c(1, 'x', 'vamos #promocao'), h.rules).length, 1, 'hashtag exata');

  const m = defaultSettings();
  m.rules.minMentions = { enabled: true, value: 2 };
  assert.equal(validateComment(c(1, 'x', '@a @a'), m.rules).length, 1, 'menções repetidas contam 1');
  assert.equal(validateComment(c(1, 'x', '@x @a'), m.rules).length, 1, 'auto-menção não conta');
  assert.equal(validateComment(c(1, 'x', '@loja @a'), m.rules, 'loja').length, 1, 'menção ao dono não conta');
  assert.deepEqual(validateComment(c(1, 'x', '@a @b'), m.rules), []);

  const r = defaultSettings();
  r.rules.requireMention = { enabled: true };
  assert.equal(validateComment(c(1, 'x', 'sem marcação'), r.rules).length, 1);
});

test('pool: modo por comentário x por perfil, exclusões, dono e respostas', () => {
  const comments = [c(1, 'ana', 'a'), c(2, 'ana', 'b'), c(3, 'bia', 'c'), c(4, 'loja', 'resposta', '1'), c(5, 'caio', 'resp', '3'), c(6, 'Dan', 'd')];
  const s = defaultSettings();
  let p = buildPool(comments, s, { ownerUsername: 'loja' });
  assert.equal(p.stats.tickets, 5); // ana×2, bia, caio, dan (loja excluída)
  assert.equal(p.stats.eligibleParticipants, 4);

  s.entryMode = 'profile';
  p = buildPool(comments, s, { ownerUsername: 'loja' });
  assert.equal(p.stats.tickets, 4);
  assert.equal(p.tickets.find((t) => t.username === 'ana').comment.id, 1, 'usa o primeiro comentário válido');

  s.includeReplies = false;
  p = buildPool(comments, s, { ownerUsername: 'loja' });
  assert.equal(p.stats.tickets, 3);

  s.excluded = sanitizeSettings({ excluded: ['@DAN', 'bia'] }).excluded;
  p = buildPool(comments, s, { ownerUsername: 'loja' });
  assert.deepEqual(p.tickets.map((t) => t.username), ['ana']);
});

test('sorteio sem repetição esgota participantes e nunca repete', () => {
  const comments = Array.from({ length: 50 }, (_, i) => c(i + 1, `u${i % 20}`, 'x'));
  const s = defaultSettings();
  const winners = [];
  for (let i = 0; i < 20; i++) {
    const pool = buildPool(comments, s, { winners });
    winners.push(drawWinner(pool, { order: i + 1, settings: s }));
  }
  assert.equal(new Set(winners.map((w) => w.username)).size, 20);
  assert.throws(() => drawWinner(buildPool(comments, s, { winners }), { order: 21, settings: s }), { code: 'NO_PARTICIPANTS' });

  s.allowRepeatWinners = true;
  assert.equal(buildPool(comments, s, { winners }).stats.tickets, 50, 'com repetição, todos voltam');
});

test('sorteio nunca escolhe comentário inválido e é aproximadamente uniforme', () => {
  const comments = [c(1, 'a', '#ok'), c(2, 'b', '#ok'), c(3, 'c', 'sem'), c(4, 'd', '#ok')];
  const s = sanitizeSettings({ rules: { requiredHashtag: { enabled: true, value: '#ok' } } });
  const pool = buildPool(comments, s);
  const freq = {};
  for (let i = 0; i < 6000; i++) {
    const w = drawWinner(pool, { order: i, settings: s });
    freq[w.username] = (freq[w.username] || 0) + 1;
  }
  assert.equal(freq.c, undefined);
  for (const u of ['a', 'b', 'd']) assert.ok(freq[u] > 1700 && freq[u] < 2300, `${u}=${freq[u]}`);
});

test('configurações inválidas são rejeitadas, não corrigidas em silêncio', () => {
  assert.throws(() => sanitizeSettings({ entryMode: 'x' }), { code: 'INVALID_SETTINGS' });
  assert.throws(() => sanitizeSettings({ rules: { minMentions: { enabled: true, value: 0 } } }), { code: 'INVALID_SETTINGS' });
});

test('importação: linhas e CSV', () => {
  const a = parseImport('@ana quero @bia\nbia: eu também\n!!!inválido\nlinha sem arroba');
  assert.deepEqual(a.comments.map((x) => [x.username, x.text]), [['ana', 'quero @bia'], ['bia', 'eu também']]);
  assert.equal(a.rejected, 2);
  const b = parseImport('username,text\nana,"oi, @bia"\n@caio,ok');
  assert.deepEqual(b.comments.map((x) => [x.username, x.text]), [['ana', 'oi, @bia'], ['caio', 'ok']]);
});

test('CSV de ganhadores protege contra fórmulas', () => {
  const csv = winnersToCsv([{ order: 1, username: 'ana', comment: { text: '=HYPERLINK("x")', timestamp: null }, drawnAt: new Date().toISOString(), poolTickets: 3, entryMode: 'comment' }], null);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});
