import { useEffect, useState } from 'react';
import { Icon, InstagramGlyph, Spinner, fmtDateTime, fmtNumber } from './ui.jsx';

const isLikelyIgUrl = (v) => /(instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(p|reels?|tv)\/[\w-]{5,}/i.test(v);

export function PostPanel({ auth, state, stats, job, error, onLoad, onConnect, onCollector, onImport, onReset }) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const running = job?.status === 'running';
  const post = state?.post;

  useEffect(() => {
    if (post?.permalink && !url) setUrl(post.permalink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.permalink]);

  const invalid = touched && url.trim() && !isLikelyIgUrl(url);
  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!url.trim() || !isLikelyIgUrl(url) || running) return;
    // Sem conta conectada pela API oficial, a busca é feita pelo botão do navegador.
    if (auth && !auth.connected) onCollector(url.trim());
    else onLoad(url.trim());
  };

  const notConnected = auth && !auth.connected;

  return (
    <section className="card" aria-labelledby="post-title">
      <div className="card-head">
        <h2 id="post-title"><span className="step-dot">1</span> Publicação</h2>
        {post && !running && (
          <button className="link-btn" onClick={onReset}>Limpar</button>
        )}
      </div>

      <form onSubmit={submit} className="url-form" noValidate>
        <div className={`input-wrap ${invalid ? 'has-error' : ''}`}>
          <Icon name="link" className="input-icon" />
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.instagram.com/p/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={running}
            aria-label="Link da publicação do Instagram"
            aria-invalid={invalid || undefined}
          />
        </div>
        {invalid && <p className="field-error">Link inválido. Use o link de um post ou reel (instagram.com/p/… ou /reel/…).</p>}
        <button className="btn btn-primary btn-block" disabled={running || !url.trim()}>
          {running ? <><Spinner /> Carregando…</> : post && post.permalink === url.trim() ? <><Icon name="refresh" /> Atualizar comentários</> : 'Buscar comentários'}
        </button>
      </form>

      {notConnected && !error && !running && !post && (
        <div className="notice">
          <InstagramGlyph size={16} />
          <div>
            <p>Sem login: os comentários são buscados pelo botão <strong>Enviar para o sorteador</strong>, direto da página do post no Instagram.</p>
            <button className="link-btn" onClick={() => onCollector(isLikelyIgUrl(url) ? url.trim() : null)}>Como funciona / instalar o botão</button>
          </div>
        </div>
      )}

      {running && (
        <div className="progress" aria-live="polite">
          <div className="progress-bar"><span /></div>
          <p className="small">{job.message}</p>
          {(job.progress?.comments > 0 || job.progress?.pages > 0) && (
            <p className="small muted mono">
              {fmtNumber(job.progress.comments)} comentários · {fmtNumber(job.progress.replies)} respostas · {fmtNumber(job.progress.pages)} páginas
            </p>
          )}
        </div>
      )}

      {error && !running && <CollectError error={error} onConnect={onConnect} onImport={onImport} onCollector={() => onCollector(isLikelyIgUrl(url) ? url.trim() : post?.permalink || null)} onRetry={() => onLoad(url.trim())} />}

      {post && !running && (
        <div className="post-info">
          <div className="post-head">
            {post.thumbnailUrl ? <img className="post-thumb" src={post.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <div className="post-thumb post-thumb-empty"><Icon name={state.source === 'import' ? 'upload' : 'link'} /></div>}
            <div className="post-meta">
              {state.source === 'import' ? (
                <span className="badge badge-warn">Importação manual · não verificada pela API</span>
              ) : state.source === 'browser' ? (
                <span className="badge badge-warn">Lido pelo navegador · fonte não oficial{post.ownerUsername ? ` · @${post.ownerUsername}` : ''}</span>
              ) : (
                <span className="badge badge-ok"><Icon name="shield" size={12} /> API oficial · @{post.ownerUsername}</span>
              )}
              <p className="post-caption">{post.caption || 'Sem legenda'}</p>
              <p className="small muted">
                Coletado às {fmtDateTime(state.collectedAt).slice(-8)}
                {post.permalink && <> · <a href={post.permalink} target="_blank" rel="noreferrer">abrir <Icon name="external" size={11} /></a></>}
              </p>
            </div>
          </div>
          <div className="metrics">
            <Metric label="Comentários" value={stats?.topLevelComments} />
            <Metric label="Respostas" value={stats?.replies} />
            <Metric label="Participantes" value={stats?.uniqueUsers} />
          </div>
          {post.partial && (
            <div className="alert alert-soft partial-note">
              <Icon name="alert" size={16} />
              <p className="small"><strong>Coleta parcial.</strong> {post.partialReason} O sorteio usa apenas os {fmtNumber(stats?.totalComments)} comentários recebidos. Para tentar completar, use o botão de novo na página do post.</p>
            </div>
          )}
          {typeof post.reportedCommentsCount === 'number' && post.reportedCommentsCount !== stats?.totalComments && (
            <p className="small muted note">
              <Icon name="info" size={12} /> A publicação informa {fmtNumber(post.reportedCommentsCount)} comentários; a API devolveu {fmtNumber(stats?.totalComments)}.
              Comentários ocultos, excluídos, filtrados ou de contas restritas não são retornados pelo Instagram.
            </p>
          )}
        </div>
      )}

      {!running && (
        <button className="link-btn subtle-link" onClick={onImport}>
          <Icon name="upload" size={13} /> A publicação não é da conta conectada? Importar lista
        </button>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span className="metric-value mono">{fmtNumber(value)}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function CollectError({ error, onConnect, onImport, onCollector, onRetry }) {
  const actions = [];
  if (error.code === 'COLLECT_BROWSER') actions.push(<button key="b" className="btn btn-sm btn-outline" onClick={onCollector}><Icon name="refresh" size={14} /> Como usar o botão</button>);
  if (error.code === 'NOT_CONNECTED') actions.push(<button key="b" className="btn btn-sm btn-outline" onClick={onCollector}>Buscar sem login</button>);
  if (['TOKEN_INVALID', 'PERMISSION_DENIED'].includes(error.code)) actions.push(<button key="c" className="btn btn-sm btn-outline" onClick={onConnect}>Conectar Instagram</button>);
  if (error.code === 'MEDIA_NOT_ACCESSIBLE') {
    actions.push(<button key="b" className="btn btn-sm btn-outline" onClick={onCollector}>Buscar sem login (botão do navegador)</button>);
    actions.push(<button key="i" className="btn btn-sm btn-ghost" onClick={onImport}><Icon name="upload" size={14} /> Importar lista</button>);
  }
  if (['RATE_LIMITED', 'NETWORK_ERROR', 'GRAPH_ERROR', 'NETWORK', 'INTERNAL'].includes(error.code)) actions.push(<button key="r" className="btn btn-sm btn-outline" onClick={onRetry}><Icon name="refresh" size={14} /> Tentar novamente</button>);
  return (
    <div className="alert" role="alert">
      <Icon name="alert" size={16} />
      <div>
        <p className="alert-title">{error.message}</p>
        {error.hint && <p className="small">{error.hint}</p>}
        {actions.length > 0 && <div className="alert-actions">{actions}</div>}
      </div>
    </div>
  );
}
