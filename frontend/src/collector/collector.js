/* eslint-disable */
/**
 * Coletor executado como favorito ("bookmarklet") na página do post em instagram.com.
 *
 * Lê os comentários que o próprio navegador do usuário já consegue ver (mesma sessão do Instagram),
 * abre a aba do sorteador e entrega os dados por postMessage. O Instagram bloqueia envio direto
 * para outros sites (CSP), por isso a entrega é feita para a janela aberta.
 *
 * IMPORTANTE: esta função é convertida em texto (toString) e vira o favorito. Ela precisa ser
 * autossuficiente: não pode usar nada de fora do próprio corpo.
 */
export function collector(ORIGIN) {
  var W = window;
  if (W.__sorteadorRunning) { alert('O sorteador já está coletando os comentários desta página.'); return; }
  var opts = W.__sorteadorOpts || {};
  var isTest = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ORIGIN) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var match = location.pathname.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,})/);
  if ((!/(^|\.)instagram\.com$/.test(location.hostname) && !isTest) || !match) {
    alert('Abra a publicação no site do Instagram (instagram.com/p/... ou /reel/...) e toque no botão "Enviar para o sorteador" de novo.');
    return;
  }
  var shortcode = match[1];
  var target = W.open(ORIGIN + '/?receber=1', 'sorteador_receber');
  if (!target) {
    alert('O navegador bloqueou a janela do sorteador. Permita pop-ups para instagram.com e tente novamente.');
    return;
  }
  W.__sorteadorRunning = true;

  // ── Painel de progresso sobre a página do Instagram ──
  var box = document.createElement('div');
  box.setAttribute('style', 'position:fixed;z-index:2147483647;right:16px;bottom:16px;left:auto;max-width:340px;background:#121217;color:#f2f2f5;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 16px;font:13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.45)');
  box.innerHTML = '<div style="font-weight:600;margin-bottom:4px">Sorteador · coletando comentários</div><div data-msg>Iniciando…</div><button data-x style="margin-top:10px;background:#1e1e26;color:#f2f2f5;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer">Cancelar</button>';
  document.body.appendChild(box);
  var cancelled = false;
  box.querySelector('[data-x]').onclick = function () { cancelled = true; finish(); };
  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    W.__sorteadorRunning = false;
    var b = box.querySelector('[data-x]');
    if (b) b.remove();
    setTimeout(function () { box.remove(); }, 6000);
  }

  var ready = false;
  var outbox = [];
  W.addEventListener('message', function (e) {
    if (e.origin === ORIGIN && e.data && e.data.type === 'sorteador:ready') {
      ready = true;
      while (outbox.length) target.postMessage(outbox.shift(), ORIGIN);
    }
  });
  function send(msg) {
    msg.source = 'sorteador-coletor';
    if (ready && !target.closed) target.postMessage(msg, ORIGIN);
    else if (msg.type !== 'progress') outbox.push(msg);
  }
  var counts = { comments: 0, replies: 0, pages: 0 };
  function say(text) {
    box.querySelector('[data-msg]').textContent = text;
    send({ type: 'progress', message: text, progress: { comments: counts.comments, replies: counts.replies, pages: counts.pages } });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var gap = opts.gapMs != null ? opts.gapMs : 900;
  var pause = opts.pauseMs != null ? opts.pauseMs : 60000;

  var headers = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
  async function get(path) {
    for (var attempt = 0; attempt < 5; attempt++) {
      if (cancelled) throw new Error('CANCELLED');
      var res, data = null;
      try {
        res = await fetch(path, { credentials: 'include', headers: headers });
        data = await res.json().catch(function () { return null; });
      } catch (err) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (res.ok && data && data.status !== 'fail') return data;
      var msg = (data && data.message) || '';
      if (res.status === 401 || res.status === 403 || msg === 'login_required' || (data && data.require_login)) throw new Error('LOGIN');
      if (res.status === 429 || /wait|aguarde|espere/i.test(msg)) {
        say('O Instagram pediu uma pausa. Aguardando ' + Math.round(pause / 1000) + 's e continuando…');
        await sleep(pause);
        continue;
      }
      if (res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      throw new Error('HTTP ' + res.status + (msg ? ': ' + msg : ''));
    }
    throw new Error('LIMIT');
  }

  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var mediaId = 0n;
  for (var ch of shortcode.slice(0, 11)) mediaId = mediaId * 64n + BigInt(A.indexOf(ch));
  mediaId = String(mediaId);

  var seen = {};
  var comments = [];
  function add(c, parentId) {
    var id = String(c.pk || c.id || '');
    var user = c.user && c.user.username;
    if (!id || seen[id] || !user) return;
    seen[id] = 1;
    comments.push({ id: id, username: user, text: c.text || '', timestamp: c.created_at ? new Date(c.created_at * 1000).toISOString() : null, parentId: parentId });
    if (parentId) counts.replies++; else counts.comments++;
  }

  async function children(c) {
    var pk = String(c.pk || c.id);
    (c.preview_child_comments || []).forEach(function (r) { add(r, pk); });
    if (!(c.child_comment_count > (c.preview_child_comments || []).length)) return;
    var cursor = '', dir = 'max_id', guard = 0;
    while (guard++ < 1000) {
      var j = await get('/api/v1/media/' + mediaId + '/comments/' + pk + '/child_comments/' + (cursor ? '?' + dir + '=' + encodeURIComponent(cursor) : ''));
      (j.child_comments || []).forEach(function (r) { add(r, pk); });
      var next = null;
      if (j.has_more_tail_child_comments && j.next_max_child_cursor) { next = j.next_max_child_cursor; dir = 'max_id'; }
      else if (j.has_more_head_child_comments && j.next_min_child_cursor) { next = j.next_min_child_cursor; dir = 'min_id'; }
      if (!next || next === cursor) break;
      cursor = next;
      await sleep(gap);
    }
  }

  (async function () {
    var post = { shortcode: shortcode, url: location.origin + location.pathname, ownerUsername: null, caption: '', reportedCommentsCount: null };
    var partial = false, partialReason = '';
    try {
      say('Lendo a publicação…');
      try {
        var info = await get('/api/v1/media/' + mediaId + '/info/');
        var item = info.items && info.items[0];
        if (item) {
          if (item.pk) mediaId = String(item.pk);
          post.ownerUsername = item.user && item.user.username || null;
          post.caption = item.caption && item.caption.text || '';
          post.reportedCommentsCount = typeof item.comment_count === 'number' ? item.comment_count : null;
          post.thumbnailUrl = item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates[0] && item.image_versions2.candidates[0].url || null;
          if (item.comments_disabled) throw new Error('DISABLED');
        }
      } catch (err) {
        if (err.message === 'LOGIN' || err.message === 'CANCELLED' || err.message === 'DISABLED') throw err;
      }

      var base = '/api/v1/media/' + mediaId + '/comments/?can_support_threading=true&permalink_enabled=false';
      var url = base, last = '';
      while (url) {
        var j = await get(url);
        counts.pages++;
        var list = j.comments || [];
        for (var i = 0; i < list.length; i++) {
          add(list[i], null);
          try { await children(list[i]); } catch (err) {
            if (err.message === 'CANCELLED' || err.message === 'LOGIN') throw err;
            partial = true; partialReason = 'Algumas respostas não puderam ser lidas (' + err.message + ').';
          }
        }
        say('Coletando… ' + counts.comments + ' comentários e ' + counts.replies + ' respostas' + (post.reportedCommentsCount ? ' (de ~' + post.reportedCommentsCount + ')' : ''));
        var next = j.next_min_id || j.next_max_id || null;
        var key = j.next_min_id ? 'min_id' : 'max_id';
        var more = j.has_more_comments || j.has_more_headload_comments || !!next;
        if (!more || !next || next === last) break;
        last = next;
        url = base + '&' + key + '=' + encodeURIComponent(typeof next === 'string' ? next : JSON.stringify(next));
        await sleep(gap);
      }
    } catch (err) {
      var m = err.message;
      if (m === 'CANCELLED') { send({ type: 'error', message: 'Coleta cancelada.' }); say('Coleta cancelada.'); finish(); return; }
      if (m === 'DISABLED') { send({ type: 'error', message: 'Os comentários desta publicação estão desativados.' }); say('Comentários desativados nesta publicação.'); finish(); return; }
      if (!comments.length) {
        var text = m === 'LOGIN'
          ? 'O Instagram só mostra os comentários para quem está logado. Entre no Instagram neste navegador (como você usa normalmente) e toque no botão de novo.'
          : 'Não foi possível ler os comentários (' + m + '). Recarregue a página do post e tente de novo.';
        send({ type: 'error', message: text, detail: m });
        say(text);
        finish();
        return;
      }
      partial = true;
      partialReason = m === 'LIMIT' ? 'O Instagram limitou a leitura antes do fim.' : m === 'LOGIN' ? 'O Instagram pediu login no meio da coleta.' : 'A leitura parou antes do fim (' + m + ').';
    }
    say((partial ? 'Coleta parcial: ' : 'Pronto: ') + counts.comments + ' comentários e ' + counts.replies + ' respostas. Enviando para o sorteador…');
    send({ type: 'data', post: post, comments: comments, partial: partial, partialReason: partialReason });
    if (!ready) say('Abra a aba do sorteador (e digite a senha, se pedir) para receber os comentários.');
    var wait = 0;
    while (!ready && wait++ < 600) await sleep(1000);
    if (ready) say('Comentários enviados. Pode voltar para a aba do sorteador.');
    finish();
  })();
}
