import { Icon, fmtDateTime } from './ui.jsx';

export function History({ winners, onRemove, onCopy }) {
  return (
    <section className="card" aria-labelledby="history-title">
      <div className="card-head">
        <h2 id="history-title">Histórico de ganhadores <span className="count mono">{winners.length}</span></h2>
        <div className="head-actions">
          <button className="btn btn-sm btn-ghost" disabled={!winners.length} onClick={onCopy}><Icon name="copy" size={14} /> Copiar lista</button>
          <a className={`btn btn-sm btn-ghost ${winners.length ? '' : 'is-disabled'}`} href={winners.length ? '/api/winners.csv' : undefined} download aria-disabled={!winners.length}>
            <Icon name="download" size={14} /> Exportar CSV
          </a>
        </div>
      </div>

      {!winners.length ? (
        <p className="empty muted small">Os ganhadores sorteados aparecem aqui, em ordem.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: 64 }} />
              <col />
              <col style={{ width: 188 }} />
              <col style={{ width: 48 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Ganhador e comentário</th>
                <th>Sorteio · data e hora</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {winners.map((w) => (
                <tr key={w.id}>
                  <td className="mono pos">{w.position}º</td>
                  <td className="winner-cell">
                    <a href={`https://www.instagram.com/${w.username}/`} target="_blank" rel="noreferrer" className="user">@{w.username}</a>
                    <span className="comment-cell" title={w.comment.text}>{w.comment.text || <em>(sem texto)</em>}</span>
                  </td>
                  <td className="mono small">
                    <span className="draw-no">nº {w.order}</span>
                    <span className="muted nowrap">{fmtDateTime(w.drawnAt)}</span>
                  </td>
                  <td>
                    <button className="icon-btn danger" aria-label={`Remover @${w.username} do histórico`} onClick={() => onRemove(w)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
