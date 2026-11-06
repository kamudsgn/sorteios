import { useState } from 'react';
import { api } from '../api.js';
import { Icon, InstagramGlyph, Modal, Spinner } from './ui.jsx';

const META_APPS = 'https://developers.facebook.com/apps/';

/** Conectar o Instagram sem mexer em código: botão de login ou token colado. */
export function ConnectModal({ auth, onUpdated, onClose, toast }) {
  const [editingApp, setEditingApp] = useState(!auth?.appConfigured);
  const [showToken, setShowToken] = useState(false);

  return (
    <Modal title="Conectar Instagram" onClose={onClose} width={560}>
      <div className="connect">
        {auth?.appConfigured && !editingApp ? (
          <div className="connect-main">
            <a className="btn-ig" href="/api/auth/login">
              <InstagramGlyph size={20} /> Entrar com Instagram
            </a>
            <p className="small muted center">
              Você vai para a página oficial do Instagram, faz login e autoriza. Depois volta para cá já conectado.
            </p>
            {auth.appSource === 'browser' && (
              <button className="link-btn center-block" onClick={() => setEditingApp(true)}>Alterar dados do app da Meta</button>
            )}
          </div>
        ) : (
          <AppSetup auth={auth} onSaved={(st) => { onUpdated(st); setEditingApp(false); toast('App salvo. Agora é só clicar em "Entrar com Instagram".', 'success'); }} onCancel={auth?.appConfigured ? () => setEditingApp(false) : null} />
        )}

        <div className="connect-divider"><span>ou</span></div>

        {!showToken ? (
          <button className="btn btn-ghost btn-block" onClick={() => setShowToken(true)}>
            <Icon name="link" size={14} /> Já tenho um token de acesso: colar token
          </button>
        ) : (
          <TokenForm onConnected={(st) => { onUpdated(st); toast(`Conectado como @${st.account.username}.`, 'success'); onClose(); }} />
        )}

        <p className="small muted connect-foot">
          <Icon name="shield" size={12} /> Requer conta <strong>profissional</strong> (Empresa ou Criador). A conexão fica salva criptografada neste navegador, e o sistema nunca pede sua senha do Instagram.
        </p>
      </div>
    </Modal>
  );
}

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <code>{value}</code>
      <button
        className="btn btn-sm btn-outline"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem permissão */ }
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function AppSetup({ auth, onSaved, onCancel }) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveApp(appId, appSecret));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="connect-setup" onSubmit={save}>
      <div className="setup-head">
        <InstagramGlyph size={18} />
        <div>
          <strong>Ativar o botão "Entrar com Instagram"</strong>
          <p className="small muted">Configuração feita uma única vez, em cerca de 5 minutos. Depois, conectar é só um clique.</p>
        </div>
      </div>
      <ol className="setup-steps small">
        <li>Abra o <a href={META_APPS} target="_blank" rel="noreferrer">painel de apps da Meta <Icon name="external" size={11} /></a> e crie um app com o caso de uso <em>Instagram</em>.</li>
        <li>Em <em>Instagram → API setup with Instagram login → Set up Instagram business login</em>, cole este endereço em <em>Redirect URL</em>:
          <CopyField value={auth?.redirectUri || ''} />
        </li>
        <li>Na mesma tela, copie o <em>Instagram app ID</em> e o <em>Instagram app secret</em> e cole abaixo.</li>
      </ol>
      <label className="field">
        <span className="field-label">Instagram app ID</span>
        <input className="input mono" inputMode="numeric" placeholder="ex.: 1234567890123456" value={appId} onChange={(e) => setAppId(e.target.value.trim())} />
      </label>
      <label className="field">
        <span className="field-label">Instagram app secret</span>
        <input className="input mono" type="password" autoComplete="off" placeholder="32 caracteres" value={appSecret} onChange={(e) => setAppSecret(e.target.value.trim())} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <div className="setup-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>}
        <button className="btn btn-primary" disabled={!appId || !appSecret || busy}>{busy ? <Spinner /> : 'Salvar e ativar login'}</button>
      </div>
    </form>
  );
}

function TokenForm({ onConnected }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConnected(await api.connectToken(token));
    } catch (err) {
      setError(`${err.message}${err.hint ? ` ${err.hint}` : ''}`);
      setBusy(false);
    }
  };
  return (
    <form className="connect-setup" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Token de acesso do Instagram</span>
        <textarea className="input textarea mono" rows={3} autoFocus placeholder="IGAA…" value={token} onChange={(e) => setToken(e.target.value)} />
        <span className="field-hint">
          Gere em <a href={META_APPS} target="_blank" rel="noreferrer">developers.facebook.com/apps</a> → seu app → <em>Instagram → API setup with Instagram login → Generate token</em>.
        </span>
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={token.trim().length < 40 || busy}>{busy ? <Spinner /> : 'Conectar com token'}</button>
    </form>
  );
}
