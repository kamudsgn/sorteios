import { useEffect, useRef, useState } from 'react';
import { Icon, InstagramGlyph, Modal, Spinner, fmtDateTime } from './ui.jsx';

export function Header({ auth, onConnect, onDisconnect, onRefresh }) {
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
      <button className="btn btn-sm btn-outline" onClick={onConnect}>
        <InstagramGlyph size={15} /> Conectar Instagram
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
                  {auth.source === 'oauth' ? 'Conectada pelo login do Instagram' : 'Token definido no servidor (.env)'}
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
              {auth.oauthAvailable && <button className="btn btn-sm btn-ghost" onClick={onConnect}>Trocar conta</button>}
              {auth.canDisconnect && <button className="btn btn-sm btn-ghost danger" onClick={() => { setOpen(false); onDisconnect(); }}>Desconectar</button>}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export function ConnectHelp({ onClose }) {
  return (
    <Modal title="Conectar uma conta do Instagram" onClose={onClose} width={560}>
      <div className="steps">
        <p className="muted">
          O login pelo Instagram ainda não foi configurado neste servidor. Escolha uma das opções e reinicie o backend:
        </p>
        <div className="step">
          <span className="step-n">A</span>
          <div>
            <strong>Token do painel da Meta (mais rápido)</strong>
            <p className="small muted">App Dashboard → Instagram → <em>API setup with Instagram login</em> → <em>Generate token</em>. Cole em <code>INSTAGRAM_ACCESS_TOKEN</code> no arquivo <code>.env</code>.</p>
          </div>
        </div>
        <div className="step">
          <span className="step-n">B</span>
          <div>
            <strong>Botão “Conectar Instagram” (OAuth)</strong>
            <p className="small muted">Preencha <code>IG_APP_ID</code>, <code>IG_APP_SECRET</code> e <code>IG_REDIRECT_URI</code> (HTTPS) no <code>.env</code>.</p>
          </div>
        </div>
        <p className="small muted">
          Requisitos: conta <strong>profissional</strong> (Empresa ou Criador de conteúdo) e as permissões <code>instagram_business_basic</code> e <code>instagram_business_manage_comments</code>. O passo a passo completo está no README.
        </p>
      </div>
    </Modal>
  );
}
