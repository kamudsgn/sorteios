import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal, Spinner, fmtNumber } from './ui.jsx';

const STATUS = {
  eligible: ['Elegível', 'badge-ok'],
  invalid: ['Inválido', 'badge-warn'],
  excluded: ['Excluído', 'badge-err'],
  winner: ['Já ganhou', 'badge-soft'],
  owner: ['Dono da publicação', 'badge-soft'],
};
const FILTERS = [['', 'Todos'], ['eligible', 'Elegíveis'], ['invalid', 'Inválidos'], ['excluded', 'Excluídos'], ['winner', 'Já ganharam']];
const PAGE = 100;

export function ParticipantsModal({ excluded, version, onToggleExclude, onClose }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ total: 0, items: [] });
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .participants({ q, status, offset: 0, limit })
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, status, limit, version]);

  return (
    <Modal title="Participantes" onClose={onClose} width={680}>
      <div className="part-tools">
        <div className="input-wrap">
          <Icon name="search" className="input-icon" />
          <input autoFocus placeholder="Buscar @usuário" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        </div>
        <div className="filters">
          {FILTERS.map(([v, l]) => (
            <button key={v} className={`filter ${status === v ? 'is-active' : ''}`} onClick={() => { setStatus(v); setLimit(PAGE); }}>{l}</button>
          ))}
        </div>
      </div>
      <p className="small muted part-count">{loading ? <Spinner size={12} /> : `${fmtNumber(data.total)} perfis`}</p>
      {error && <p className="field-error">{error}</p>}
      <ul className="part-list">
        {data.items.map((p) => {
          const isExcluded = excluded.includes(p.username.toLowerCase());
          const [label, cls] = STATUS[p.status];
          return (
            <li key={p.username}>
              <div className="part-main">
                <a href={`https://www.instagram.com/${p.username}/`} target="_blank" rel="noreferrer" className="user">@{p.username}</a>
                <span className="small muted mono">
                  {p.comments} coment.{['eligible', 'invalid', 'winner'].includes(p.status) && ` · ${p.validComments} válidos`}{p.tickets ? ` · ${p.tickets} chance${p.tickets > 1 ? 's' : ''}` : ''}
                </span>
                {p.status === 'invalid' && p.reasons.length > 0 && <span className="small muted">{p.reasons.join(' · ')}</span>}
              </div>
              <span className={`badge ${cls}`}>{label}</span>
              {p.status !== 'owner' && (
                <button className={`btn btn-sm ${isExcluded ? 'btn-ghost' : 'btn-ghost danger'}`} onClick={() => onToggleExclude(p.username, !isExcluded)}>
                  {isExcluded ? 'Restaurar' : 'Remover'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {data.items.length < data.total && (
        <button className="btn btn-sm btn-ghost btn-block" onClick={() => setLimit((l) => l + PAGE)}>Carregar mais</button>
      )}
    </Modal>
  );
}

export function ImportModal({ onImport, onClose }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onImport(text, label);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Importar lista de comentários"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={submit}>{busy ? <Spinner /> : 'Importar'}</button>
        </>
      }
    >
      <div className="alert alert-soft">
        <Icon name="info" size={16} />
        <p className="small">
          Use esta opção quando a publicação não pertence à conta conectada. Os dados importados <strong>não são verificados pela API do Instagram</strong> e o sorteio fica marcado como “importação manual”. Use apenas comentários exportados pelo dono da publicação.
        </p>
      </div>
      <label className="field">
        <span className="field-label">Identificação (opcional)</span>
        <input className="input" placeholder="ex.: Sorteio de aniversário — post de 12/10" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Comentários</span>
        <textarea className="input textarea mono" rows={9} placeholder={'@maria Quero muito! @joao @ana\n@pedro.silva participando #sorteio\n\nou CSV com cabeçalho: username,text'} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="field-hint">Uma linha por comentário (“@usuario texto”) ou CSV com as colunas <code>username</code> e <code>text</code>.</span>
      </label>
      <label className="file-btn">
        <Icon name="upload" size={14} /> Escolher arquivo .csv ou .txt
        <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} hidden />
      </label>
      {error && (
        <p className="field-error">{error.message}{error.hint ? ` ${error.hint}` : ''}</p>
      )}
    </Modal>
  );
}
