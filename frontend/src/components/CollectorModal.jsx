import { useEffect, useMemo, useRef, useState } from 'react';
import { bookmarkletHref } from '../collector/bookmarklet.js';
import { Icon, Modal } from './ui.jsx';

const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia?.('(pointer: coarse)').matches;

/** Instala e explica o botão "Enviar para o sorteador" (favorito), no computador e no celular. */
export function CollectorModal({ postUrl, onClose, onOfficial, toast }) {
  const [tab, setTab] = useState(isMobileDevice() ? 'mobile' : 'desktop');
  const href = useMemo(() => bookmarkletHref(), []);
  const linkRef = useRef(null);

  // O React bloqueia "javascript:" em href; o atributo é aplicado diretamente.
  useEffect(() => {
    linkRef.current?.setAttribute('href', href);
  }, [href, tab]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(decodeURIComponent(href));
      toast('Código do botão copiado.', 'success');
    } catch {
      toast('Não foi possível copiar. Toque e segure o campo abaixo para copiar.', 'error');
    }
  };

  const openPost = postUrl ? (
    <a className="btn btn-sm btn-outline" href={postUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Abrir este post no Instagram</a>
  ) : null;

  return (
    <Modal title="Buscar comentários sem login" onClose={onClose} width={600}>
      <p className="muted small collector-intro">
        Use o botão <strong>Enviar para o sorteador</strong>. Ele lê os comentários da página do post que você abriu no instagram.com e manda tudo para cá. Não precisa de conta de desenvolvedor, token ou API.
      </p>

      <div className="segmented collector-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'desktop'} className={tab === 'desktop' ? 'is-active' : ''} onClick={() => setTab('desktop')}>Computador</button>
        <button role="tab" aria-selected={tab === 'mobile'} className={tab === 'mobile' ? 'is-active' : ''} onClick={() => setTab('mobile')}>Celular</button>
      </div>

      {tab === 'desktop' ? (
        <ol className="collector-steps">
          <li>
            <strong>Instale o botão (só na primeira vez).</strong> Arraste o botão abaixo até a barra de favoritos do navegador.
            <div className="bm-row">
              <a ref={linkRef} className="bm-button" draggable="true" onClick={(e) => { e.preventDefault(); toast('Arraste o botão até a barra de favoritos.'); }}>
                ★ Enviar para o sorteador
              </a>
            </div>
            <span className="field-hint">Não vê a barra de favoritos? Pressione <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> (Windows) ou <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> (Mac).</span>
          </li>
          <li>
            <strong>Abra o post no instagram.com, neste mesmo navegador.</strong>
            {openPost && <div className="bm-row">{openPost}</div>}
          </li>
          <li>
            <strong>Clique no favorito "Enviar para o sorteador".</strong> Uma aba do sorteador abre e recebe os comentários sozinha. Acompanhe o progresso no canto da página do Instagram.
          </li>
        </ol>
      ) : (
        <ol className="collector-steps">
          <li>
            <strong>Copie o código do botão.</strong>
            <div className="bm-row"><button className="btn btn-sm btn-primary" onClick={copy}><Icon name="copy" size={13} /> Copiar código do botão</button></div>
          </li>
          <li>
            <strong>Crie o favorito (só na primeira vez).</strong>
            <ul className="sub-steps">
              <li><b>iPhone (Safari):</b> toque em Compartilhar → <em>Adicionar Favorito</em> nesta página. Depois abra Favoritos → <em>Editar</em> → toque no favorito criado, troque o nome para <em>Enviar para o sorteador</em>, apague o endereço e cole o código.</li>
              <li><b>Android (Chrome):</b> toque em ⋮ → ☆ para favoritar esta página. Depois ⋮ → <em>Favoritos</em> → ✎ editar: nome <em>Enviar para o sorteador</em>, apague o URL e cole o código.</li>
            </ul>
          </li>
          <li>
            <strong>Abra o post no navegador, não no app.</strong> Copie o link do post no app do Instagram e cole na barra de endereço do Safari ou do Chrome.
            {openPost && <div className="bm-row">{openPost}</div>}
          </li>
          <li>
            <strong>Use o favorito.</strong>
            <ul className="sub-steps">
              <li><b>iPhone:</b> toque no ícone de livro (Favoritos) → <em>Enviar para o sorteador</em>.</li>
              <li><b>Android:</b> toque na barra de endereço, digite <em>Enviar para</em> e toque no favorito que aparecer.</li>
            </ul>
            O sorteador abre em outra aba com os comentários.
          </li>
        </ol>
      )}

      <div className="alert alert-soft collector-note">
        <Icon name="info" size={16} />
        <p className="small">
          O Instagram só mostra os comentários para quem está logado. O navegador precisa estar com o Instagram aberto <strong>como você já usa normalmente</strong>. É uma leitura não oficial: se o Instagram mudar o site, o botão pode precisar de ajuste.
        </p>
      </div>

      <button className="link-btn subtle-link" onClick={onOfficial}>
        Prefere conectar uma conta profissional pela API oficial?
      </button>
    </Modal>
  );
}
