import { useEffect, useState } from 'react';
import { api } from '../api.js';
import App from '../App.jsx';
import { Icon, Spinner } from './ui.jsx';

/** Exige a senha de acesso quando o servidor está publicado (ACCESS_PASSWORD_HASH). */
export function Root() {
  const [status, setStatus] = useState('checking'); // checking | locked | open | offline

  useEffect(() => {
    api.access().then((a) => setStatus(a.granted ? 'open' : 'locked')).catch(() => setStatus('offline'));
    const lock = () => setStatus('locked');
    window.addEventListener('sorteio:locked', lock);
    return () => window.removeEventListener('sorteio:locked', lock);
  }, []);

  if (status === 'open') return <App />;
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="brand-mark gate-mark"><Icon name="check" size={18} /></span>
        <h1>Sorteador de comentários</h1>
        {status === 'checking' && <Spinner />}
        {status === 'offline' && <p className="muted">Servidor indisponível. Se a página ficou parada, ele pode levar até 1 minuto para acordar. Recarregue em instantes.</p>}
        {status === 'locked' && <GateForm onOpen={() => setStatus('open')} />}
      </div>
    </div>
  );
}

function GateForm({ onOpen }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlock(pw);
      onOpen();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="gate-form">
      <p className="muted">Área restrita. Digite a senha de acesso.</p>
      <input className="input" type="password" autoComplete="current-password" autoFocus placeholder="Senha" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Senha de acesso" />
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={!pw || busy}>{busy ? <Spinner /> : 'Entrar'}</button>
    </form>
  );
}
