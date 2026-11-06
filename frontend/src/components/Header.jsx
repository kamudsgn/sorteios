import { useEffect, useRef, useState } from 'react';
import { Icon, InstagramGlyph, Spinner, fmtDateTime } from './ui.jsx';

export function Header({ auth, onConnect, onCollector, onDisconnect, onRefresh }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  let pill;
  if (!auth) pill = <span className="conn-pill"><Spinner size={12} /> Verificando conexão…</span>;
  else if (auth.connected)
    pill = (
      <button className="conn-pill is-on" onClick={() => setOpen((v) => !v)}>
        {auth.account.profilePictureUrl ? <img src={auth.account.profilePictureUrl} alt="" className="conn-avatar" /> : <span className="dot dot-on" />}
        @{auth.account.username}
      </button>
    );
  else if (auth.error)
    pill = (
      <button className="conn-pill is-err" onClick={() => setOpen((v) => !v)}>
        <span className="dot dot-err" /> Conexão com problema
      </button>
    );
  else
    pill = (
      <button className="btn btn-sm btn-outline" onClick={onCollector}>
        <InstagramGlyph size={15} /> Botão do Instagram
      </button>
    );

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Icon name="check" size={15} /></span>
        <span className="brand-name">Sorteador</span>
        <span className="brand-sub">de comentários</span>
      </div>
      <div className="conn" ref={ref}>
        {pill}
        {open && auth && (
          <div className="popover">
            {auth.connected ? (
              <>
                <div className="pop-title">Conta conectada</div>
                <div className="pop-row"><strong>@{auth.account.username}</strong></div>
                <div className="pop-row muted small">
                  {{ oauth: 'Conectada pelo login do Instagram', manual: 'Conectada com token colado', server: 'Token definido no servidor' }[auth.source]}
                  {auth.expiresAt && <> · expira em {fmtDateTime(auth.expiresAt).slice(0, 10)}</>}
                </div>
                <p className="small muted pop-note">Somente publicações desta conta podem ter os comentários coletados pela API oficial.</p>
              </>
            ) : (
              <>
                <div className="pop-title err">{auth.error?.message}</div>
                {auth.error?.hint && <p className="small muted pop-note">{auth.error.hint}</p>}
              </>
            )}
            <div className="pop-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); onRefresh(); }}><Icon name="refresh" size={14} /> Verificar</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); onConnect(); }}>{auth.connected ? 'Trocar conta' : 'Conectar'}</button>
              {auth.canDisconnect && <button className="btn btn-sm btn-ghost danger" onClick={() => { setOpen(false); onDisconnect(); }}>Desconectar</button>}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
