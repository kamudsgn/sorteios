import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { AppError, toErrorBody } from './errors.js';
import { InstagramAuth } from './instagram/auth.js';
import { parseInstagramUrl } from './instagram/url.js';
import { resolveMedia, collectComments, mediaSummary } from './instagram/collector.js';
import { buildPool, drawWinner, sanitizeSettings, animationSample } from './raffle/engine.js';
import { parseImport, parseCollected } from './raffle/importer.js';
import { winnersToCsv } from './raffle/exporter.js';
import { SessionStore } from './sessions.js';
import { createAccessGate } from './access.js';
import { createVault, resolveSecret } from './vault.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp(cfg, { fetchImpl = fetch } = {}) {
  const app = express();
  const auth = new InstagramAuth(cfg, { fetchImpl });
  const secure = cfg.appUrl.startsWith('https://');
  const sessions = new SessionStore({ secure });
  const gate = createAccessGate(cfg.accessPasswordHash, { secure });
  const vault = createVault(resolveSecret(cfg), { secure });

  app.disable('x-powered-by');
  if (cfg.isProd) app.set('trust proxy', 1); // atrás do proxy HTTPS do provedor
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json({ limit: '40mb' }), sessions.middleware());
  // Proteção simples contra CSRF: requisições que alteram estado precisam ser JSON (não enviáveis por formulário de outro site).
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Envie os dados como JSON.', { status: 415 }));
    }
    next();
  });

  // ── Saúde e senha de acesso (página publicada) ─────────────
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/access', (req, res) => res.json({ required: Boolean(gate), granted: !gate || gate.isGranted(req) }));
  app.post('/api/access', (req, res) => {
    if (gate) gate.login(req, res, req.body?.password);
    res.json({ required: Boolean(gate), granted: true });
  });
  app.post('/api/access/logout', (req, res) => {
    gate?.logout(res);
    res.json({ ok: true });
  });
  if (gate) app.use('/api', gate.middleware());
  app.use('/api', (req, res, next) => {
    req.ig = vault.read(req); // credenciais do Instagram conectadas por este navegador
    next();
  });

  const ownerOf = (s) => (s.source === 'instagram' || s.source === 'browser' ? s.post?.ownerUsername : null);
  const poolOf = (s) => buildPool(s.comments, s.settings, { ownerUsername: ownerOf(s), winners: s.winners });
  const winnersView = (s) => s.winners.map((w, i) => ({ ...w, position: i + 1 }));
  const jobView = (j) => j && { id: j.id, status: j.status, phase: j.phase, message: j.message, progress: j.progress, error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt };

  const statePayload = (s) => ({
    post: s.post,
    source: s.source,
    collectedAt: s.collectedAt,
    settings: s.settings,
    stats: poolOf(s).stats,
    winners: winnersView(s),
    job: jobView(s.job),
  });

  const requirePost = (s) => {
    if (!s.post) throw new AppError('NO_POST', 'Carregue uma publicação antes de continuar.', { status: 409 });
  };

  // Ao trocar de publicação, o histórico anterior deixa de valer.
  const setPost = (s, post, comments, source) => {
    if (s.post?.id !== post.id) {
      s.winners = [];
      s.drawCounter = 0;
    }
    s.post = post;
    s.comments = comments;
    s.source = source;
    s.collectedAt = new Date().toISOString();
  };

  // ── Conexão com o Instagram ────────────────────────────────
  app.get('/api/auth/status', wrap(async (req, res) => {
    const refreshed = await auth.refreshIfNeeded(req.ig);
    if (refreshed) {
      req.ig = refreshed;
      vault.write(res, refreshed);
    }
    res.json(await auth.status(req.ig));
  }));

  // Conectar colando um token gerado no painel da Meta
  app.post('/api/auth/token', wrap(async (req, res) => {
    const { creds } = await auth.connectWithToken(req.body?.token);
    req.ig = { ...req.ig, ...creds };
    vault.write(res, req.ig);
    res.json(await auth.status(req.ig));
  }));

  // Salvar ID e chave secreta do app da Meta (habilita o botão "Entrar com Instagram")
  app.post('/api/auth/app', wrap(async (req, res) => {
    req.ig = { ...req.ig, ...auth.saveAppConfig(req.body?.appId, req.body?.appSecret) };
    vault.write(res, req.ig);
    res.json(await auth.status(req.ig));
  }));
  app.delete('/api/auth/app', wrap(async (req, res) => {
    req.ig = { ...req.ig, appId: undefined, appSecret: undefined };
    vault.write(res, req.ig);
    res.json(await auth.status(req.ig));
  }));

  app.get('/api/auth/login', (req, res, next) => {
    try {
      req.session.oauthState = randomBytes(16).toString('hex');
      res.redirect(auth.loginUrl(req.session.oauthState, req.ig));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/callback', async (req, res) => {
    const back = (params) => res.redirect(`${cfg.appUrl}/?${new URLSearchParams(params)}`);
    const { code, state, error_description: denied } = req.query;
    try {
      if (denied) throw new AppError('OAUTH_DENIED', `Autorização cancelada: ${denied}`);
      if (!state || state !== req.session.oauthState) throw new AppError('OAUTH_STATE', 'Sessão de autorização inválida. Tente conectar novamente.');
      if (!code) throw new AppError('OAUTH_FAILED', 'O Instagram não retornou o código de autorização.');
      req.session.oauthState = null;
      req.ig = { ...req.ig, ...(await auth.exchangeCode(code, req.ig)) };
      vault.write(res, req.ig);
      back({ ig: 'connected' });
    } catch (err) {
      back({ ig_error: err instanceof AppError ? err.message : 'Falha ao conectar com o Instagram.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    // Desconecta a conta, mas mantém os dados do app da Meta para entrar de novo com um clique.
    vault.write(res, { appId: req.ig?.appId, appSecret: req.ig?.appSecret });
    res.json({ ok: true });
  });

  // ── Estado da sessão ───────────────────────────────────────
  app.get('/api/state', (req, res) => res.json(statePayload(req.session)));

  app.post('/api/reset', (req, res) => {
    const s = req.session;
    Object.assign(s, { post: null, source: null, comments: [], collectedAt: null, winners: [], drawCounter: 0 });
    res.json(statePayload(s));
  });

  // ── Coleta de comentários (job assíncrono com progresso) ───
  app.post('/api/collect', wrap(async (req, res) => {
    const s = req.session;
    if (s.job?.status === 'running') return res.status(202).json({ job: jobView(s.job) });

    const parsed = parseInstagramUrl(req.body?.url);
    const creds = req.ig;
    const client = auth.client(creds); // falha cedo se não houver conta conectada

    const job = { id: randomUUID(), status: 'running', phase: 'account', message: 'Verificando a conta conectada…', progress: {}, startedAt: new Date().toISOString() };
    s.job = job;
    const update = (p) => {
      job.phase = p.phase;
      job.message = p.message;
      job.progress = { ...job.progress, ...p, phase: undefined, message: undefined };
    };

    (async () => {
      const account = await auth.account(creds);
      update({ phase: 'resolving', message: 'Procurando a publicação na conta…' });
      const media = await resolveMedia(client, parsed, account, update);
      update({ phase: 'collecting', message: 'Coletando comentários…' });
      const { comments, counts } = await collectComments(client, media.id, update);
      setPost(s, mediaSummary(media, account), comments, 'instagram');
      job.status = 'done';
      job.phase = 'done';
      job.message = `${counts.comments} comentários e ${counts.replies} respostas coletados.`;
      job.progress = counts;
    })()
      .catch((err) => {
        job.status = 'error';
        job.error = (err instanceof AppError ? err : new AppError('INTERNAL', 'Erro inesperado durante a coleta.')).toJSON();
        if (!(err instanceof AppError)) console.error('[collect]', err);
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });

    res.status(202).json({ job: jobView(job) });
  }));

  app.get('/api/collect/:id', (req, res, next) => {
    const j = req.session.job;
    if (!j || j.id !== req.params.id) return next(new AppError('JOB_NOT_FOUND', 'Coleta não encontrada.', { status: 404 }));
    res.json({ job: jobView(j) });
  });

  // ── Alternativa: importação manual ─────────────────────────
  app.post('/api/import', (req, res) => {
    const s = req.session;
    const { comments, rejected } = parseImport(req.body?.text);
    const label = String(req.body?.label || '').trim().slice(0, 120);
    const post = {
      id: `import:${randomUUID()}`,
      permalink: null,
      caption: label || 'Lista importada manualmente',
      reportedCommentsCount: null,
      ownerUsername: null,
      imported: true,
    };
    setPost(s, post, comments, 'import');
    res.json({ ...statePayload(s), importInfo: { imported: comments.length, rejected } });
  });

  // ── Comentários enviados pelo botão "Enviar para o sorteador" ─
  app.post('/api/import-collected', (req, res) => {
    const s = req.session;
    const { post, comments, rejected } = parseCollected(req.body);
    setPost(s, post, comments, 'browser');
    res.json({ ...statePayload(s), importInfo: { imported: comments.length, rejected, partial: post.partial } });
  });

  // ── Configurações ──────────────────────────────────────────
  app.put('/api/settings', (req, res) => {
    const s = req.session;
    s.settings = sanitizeSettings(req.body, s.settings);
    res.json({ settings: s.settings, stats: poolOf(s).stats });
  });

  app.get('/api/participants', (req, res) => {
    const s = req.session;
    requirePost(s);
    const pool = poolOf(s);
    const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase();
    const status = String(req.query.status || '');
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const tickets = new Map();
    for (const t of pool.tickets) tickets.set(t.username.toLowerCase(), (tickets.get(t.username.toLowerCase()) || 0) + 1);

    let list = [...pool.users.values()].map((u) => ({
      username: u.username,
      comments: u.total,
      validComments: u.valid.length,
      tickets: tickets.get(u.key) || 0,
      status: u.status,
      reasons: [...u.invalidReasons],
    }));
    if (q) list = list.filter((u) => u.username.toLowerCase().includes(q));
    if (status) list = list.filter((u) => u.status === status);
    list.sort((a, b) => b.tickets - a.tickets || b.comments - a.comments || a.username.localeCompare(b.username));
    res.json({ total: list.length, offset, items: list.slice(offset, offset + limit) });
  });

  // ── Sorteio ────────────────────────────────────────────────
  app.post('/api/draw', (req, res) => {
    const s = req.session;
    requirePost(s);
    const pool = poolOf(s);
    const winner = drawWinner(pool, { order: s.drawCounter + 1, settings: s.settings });
    const sample = animationSample(pool);
    s.drawCounter += 1;
    s.winners.push(winner);
    res.json({ winner: { ...winner, position: s.winners.length }, sample, ...statePayload(s) });
  });

  app.delete('/api/winners/:id', (req, res, next) => {
    const s = req.session;
    const idx = s.winners.findIndex((w) => w.id === req.params.id);
    if (idx < 0) return next(new AppError('WINNER_NOT_FOUND', 'Ganhador não encontrado no histórico.', { status: 404 }));
    s.winners.splice(idx, 1);
    res.json(statePayload(s));
  });

  app.get('/api/winners.csv', (req, res) => {
    const s = req.session;
    const name = `ganhadores-${s.post?.shortcode || 'sorteio'}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(winnersToCsv(s.winners, s.post));
  });

  app.use('/api', (req, res, next) => next(new AppError('NOT_FOUND', 'Rota não encontrada.', { status: 404 })));

  // ── Frontend compilado (produção) ──────────────────────────
  if (fs.existsSync(path.join(cfg.frontendDist, 'index.html'))) {
    app.use(express.static(cfg.frontendDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(cfg.frontendDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') err = new AppError('BAD_JSON', 'JSON inválido.');
    if (err?.type === 'entity.too.large') err = new AppError('TOO_LARGE', 'Conteúdo grande demais.', { status: 413 });
    if (!(err instanceof AppError)) console.error(err);
    res.status(err instanceof AppError ? err.status : 500).json(toErrorBody(err));
  });

  return app;
}
