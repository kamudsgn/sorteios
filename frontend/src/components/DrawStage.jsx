import { useEffect, useRef, useState } from 'react';
import { Icon, Spinner, fmtNumber, fmtTime } from './ui.jsx';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Palco do sorteio. O ganhador já vem decidido pelo backend; a animação apenas
 * percorre nomes elegíveis antes de revelar o resultado real.
 */
export function DrawStage({ hasPost, stats, settings, winnersCount, drawing, reveal, onDraw, onRevealed }) {
  const [phase, setPhase] = useState('idle'); // idle | spinning | revealed
  const [ticker, setTicker] = useState('');
  const timers = useRef([]);

  useEffect(() => {
    if (!reveal) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const names = reveal.sample.length ? reveal.sample : [reveal.winner.username];
    const steps = reducedMotion() ? 2 : 22;
    let t = 0;
    setPhase('spinning');
    for (let i = 0; i < steps; i++) {
      t += 45 + Math.pow(i / steps, 2.4) * 210; // desacelera no final
      timers.current.push(setTimeout(() => setTicker(names[i % names.length]), t));
    }
    timers.current.push(
      setTimeout(() => {
        setTicker(reveal.winner.username);
        setPhase('revealed');
        onRevealed();
      }, t + 160),
    );
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.winner.id]);

  const eligible = stats?.eligibleParticipants ?? 0;
  const tickets = stats?.tickets ?? 0;
  const canDraw = hasPost && tickets > 0 && !drawing;
  const w = reveal?.winner;

  let body;
  if (!hasPost) {
    body = (
      <div className="stage-empty">
        <div className="stage-orb" />
        <p className="stage-empty-title">Pronto para sortear</p>
        <p className="muted">Cole o link da publicação e carregue os comentários para começar.</p>
      </div>
    );
  } else if (phase === 'spinning') {
    body = (
      <div className="stage-spin" aria-live="off">
        <span className="stage-kicker">Sorteando…</span>
        <span className="ticker mono">@{ticker}</span>
      </div>
    );
  } else if (phase === 'revealed' && w) {
    body = (
      <div className="winner" aria-live="polite">
        <span className="stage-kicker">{w.position}º ganhador</span>
        <a className="winner-name" href={`https://www.instagram.com/${w.username}/`} target="_blank" rel="noreferrer">@{w.username}</a>
        <blockquote className="winner-comment">
          {w.comment.text || <em className="muted">(comentário sem texto)</em>}
          {w.comment.isReply && <span className="badge badge-soft">resposta</span>}
        </blockquote>
        <p className="small muted mono">
          Sorteio nº {w.order} · {fmtTime(w.drawnAt)} · {fmtNumber(w.poolParticipants)} participantes / {fmtNumber(w.poolTickets)} participações
          {w.entryMode === 'comment' && w.validEntries > 1 && <> · tinha {w.validEntries} chances</>}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="stage-ready">
        <span className="stage-kicker">Participantes elegíveis</span>
        <span className="stage-big mono">{fmtNumber(eligible)}</span>
        <p className="muted small">
          {settings?.entryMode === 'profile' ? '1 chance por perfil' : `${fmtNumber(tickets)} participações · 1 por comentário válido`}
        </p>
      </div>
    );
  }

  return (
    <section className={`card stage phase-${phase}`} aria-labelledby="draw-title">
      <div className="card-head">
        <h2 id="draw-title"><span className="step-dot">3</span> Sorteio</h2>
        <div className="stage-counters mono small">
          <span><b>{fmtNumber(hasPost ? eligible : 0)}</b> restantes</span>
          <span><b>{fmtNumber(winnersCount)}</b> ganhadores</span>
        </div>
      </div>

      <div className="stage-body">{body}</div>

      <div className="stage-actions">
        <button className="btn-draw" disabled={!canDraw} onClick={onDraw}>
          {drawing ? <><Spinner size={18} /> Sorteando…</> : winnersCount > 0 ? 'Sortear próximo ganhador' : 'Sortear ganhador'}
        </button>
        {hasPost && tickets === 0 && !drawing && (
          <p className="field-error center">
            {stats?.blockedWinners > 0 && !settings?.allowRepeatWinners
              ? 'Todos os participantes elegíveis já ganharam. Ative "Permitir ganhadores repetidos" para continuar.'
              : 'Nenhum comentário atende às regras atuais. Revise a validação ou as exclusões.'}
          </p>
        )}
        <p className="fairness small muted"><Icon name="shield" size={12} /> O ganhador é escolhido no servidor com <span className="mono">crypto.randomInt</span>. A animação é apenas visual.</p>
      </div>
    </section>
  );
}
