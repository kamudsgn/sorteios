import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Header } from './components/Header.jsx';
import { ConnectModal } from './components/ConnectModal.jsx';
import { CollectorModal } from './components/CollectorModal.jsx';
import { isTrustedCollectorOrigin } from './collector/bookmarklet.js';
import { PostPanel } from './components/PostPanel.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { DrawStage } from './components/DrawStage.jsx';
import { History } from './components/History.jsx';
import { ParticipantsModal, ImportModal } from './components/Modals.jsx';
import { useConfirm, useToasts } from './components/ui.jsx';

const mergeSettings = (prev, patch) => ({
  ...prev,
  ...patch,
  rules: patch.rules ? { ...prev.rules, ...patch.rules } : prev.rules,
});

export default function App() {
  const [auth, setAuth] = useState(null);
  const [state, setState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [job, setJob] = useState(null);
  const [collectError, setCollectError] = useState(null);
  const [modal, setModal] = useState(null); // 'participants' | 'import' | 'connect' | 'collector'
  const [collectorUrl, setCollectorUrl] = useState(null);
  // Aba aberta pelo botão "Enviar para o sorteador" (lido antes de limpar a URL).
  const [isReceiver] = useState(() => new URLSearchParams(window.location.search).get('receber') === '1' && Boolean(window.opener));
  const [drawing, setDrawing] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [version, setVersion] = useState(0); // força recarregar a lista de participantes
  const [toasts, toast] = useToasts();
  const [confirmDialog, confirm] = useConfirm();

  const latestSettings = useRef(null);
  const saveTimer = useRef(null);
  const pendingSave = useRef(Promise.resolve(true));
  const pendingState = useRef(null);
  const stateRef = useRef(null);

  const applyState = useCallback((data) => {
    stateRef.current = data;
    setState(data);
    setStats(data.stats);
    setSettings(data.settings);
    latestSettings.current = data.settings;
    setVersion((v) => v + 1);
  }, []);

  const refreshAuth = useCallback(() => api.authStatus().then(setAuth).catch((e) => setAuth({ connected: false, error: { message: e.message } })), []);

  // ── Inicialização ─────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ig') === 'connected') toast('Conta do Instagram conectada.', 'success');
    if (params.get('ig_error')) toast(params.get('ig_error'), 'error');
    if (params.size) window.history.replaceState(null, '', window.location.pathname);

    refreshAuth();
    api
      .state()
      .then((data) => {
        applyState(data);
        if (data.job?.status === 'running') poll(data.job.id);
      })
      .catch((e) => toast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Recebendo comentários do botão "Enviar para o sorteador" ──
  useEffect(() => {
    if (!isReceiver) return;
    setCollectError(null);
    setJob({ status: 'running', phase: 'waiting', message: 'Recebendo os comentários do Instagram…', progress: {} });
    // Avisa a aba do Instagram que esta aba está pronta (a mensagem não contém dados).
    const ping = () => { try { window.opener?.postMessage({ type: 'sorteador:ready' }, '*'); } catch { /* aba fechada */ } };
    ping();
    const timer = setInterval(ping, 1000);
    let done = false;

    const onMessage = async (e) => {
      const d = e.data;
      if (done || !d || d.source !== 'sorteador-coletor' || !isTrustedCollectorOrigin(e.origin)) return;
      if (d.type === 'progress') {
        setJob({ status: 'running', phase: 'collecting', message: d.message, progress: d.progress || {} });
        return;
      }
      done = true;
      clearInterval(timer);
      setJob(null);
      if (d.type === 'error') {
        setCollectError({ code: 'COLLECT_BROWSER', message: d.message, hint: d.detail ? `Detalhe técnico: ${d.detail}` : undefined });
        return;
      }
      if (d.type === 'data') {
        const cur = stateRef.current;
        if (cur?.winners?.length && cur.post?.shortcode !== d.post?.shortcode) {
          const ok = await confirm({ title: 'Trocar de publicação?', message: 'Os comentários recebidos são de outra publicação. O histórico de ganhadores atual será apagado.', confirmLabel: 'Usar os novos comentários' });
          if (!ok) return;
        }
        try {
          const r = await api.importCollected({ post: d.post, comments: d.comments, partial: d.partial, partialReason: d.partialReason });
          applyState(r);
          setReveal(null);
          toast(`${r.importInfo.imported} comentários recebidos do Instagram${r.importInfo.partial ? ' (coleta parcial)' : ''}.`, r.importInfo.partial ? 'error' : 'success');
        } catch (err) {
          setCollectError({ code: err.code, message: err.message, hint: err.hint });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [isReceiver, applyState, confirm, toast]);

  // ── Coleta ────────────────────────────────────────────────
  const poll = useCallback(
    async (id) => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 600));
        let j;
        try {
          ({ job: j } = await api.job(id));
        } catch (e) {
          setJob(null);
          setCollectError({ code: e.code, message: e.message, hint: e.hint });
          return;
        }
        setJob(j);
        if (j.status === 'done') {
          applyState(await api.state());
          toast(j.message, 'success');
          return;
        }
        if (j.status === 'error') {
          setCollectError(j.error);
          if (j.error?.code === 'TOKEN_INVALID') refreshAuth();
          return;
        }
      }
    },
    [applyState, refreshAuth, toast],
  );

  const load = async (url) => {
    if (state?.winners.length && state.post?.permalink !== url) {
      const ok = await confirm({
        title: 'Carregar outra publicação?',
        message: 'O histórico de ganhadores atual será apagado se a publicação for diferente. Exporte o CSV antes, se precisar.',
        confirmLabel: 'Carregar',
      });
      if (!ok) return;
    }
    setCollectError(null);
    setReveal(null);
    try {
      const { job: j } = await api.collect(url);
      setJob(j);
      poll(j.id);
    } catch (e) {
      setCollectError({ code: e.code, message: e.message, hint: e.hint });
    }
  };

  const connect = () => setModal('connect');
  const openCollector = (url = null) => {
    setCollectorUrl(url);
    setModal('collector');
  };

  const disconnect = async () => {
    await api.logout().catch(() => {});
    await refreshAuth();
    toast('Conta desconectada.');
  };

  const importList = async (text, label) => {
    if (state?.winners.length) {
      const ok = await confirm({ title: 'Importar nova lista?', message: 'O histórico de ganhadores atual será apagado.', confirmLabel: 'Importar' });
      if (!ok) return;
    }
    const data = await api.importList(text, label);
    applyState(data);
    setCollectError(null);
    setReveal(null);
    toast(`${data.importInfo.imported} comentários importados${data.importInfo.rejected ? ` · ${data.importInfo.rejected} linhas ignoradas` : ''}.`, 'success');
  };

  const reset = async () => {
    const ok = await confirm({ title: 'Limpar publicação?', message: 'Os comentários carregados e o histórico de ganhadores desta sessão serão apagados.', confirmLabel: 'Limpar', danger: true });
    if (!ok) return;
    applyState(await api.reset());
    setReveal(null);
    setCollectError(null);
  };

  // ── Configurações (salvas no backend, que é a fonte de verdade) ──
  const flushSettings = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const body = latestSettings.current;
    pendingSave.current = api
      .saveSettings(body)
      .then((r) => {
        setStats(r.stats);
        setVersion((v) => v + 1);
        if (latestSettings.current === body) {
          latestSettings.current = r.settings;
          setSettings(r.settings);
        }
        return true;
      })
      .catch(async (e) => {
        toast(e.message, 'error');
        const fresh = await api.state().catch(() => null);
        if (fresh) applyState(fresh); // exibe exatamente as regras que o servidor está aplicando
        return false;
      });
    return pendingSave.current;
  }, [applyState, toast]);

  const updateSettings = useCallback(
    (patch, { debounce = false } = {}) => {
      const next = mergeSettings(latestSettings.current, patch);
      latestSettings.current = next;
      setSettings(next);
      clearTimeout(saveTimer.current);
      if (debounce) saveTimer.current = setTimeout(flushSettings, 450);
      else flushSettings();
    },
    [flushSettings],
  );

  const toggleExclude = (username, exclude) => {
    const key = username.toLowerCase();
    const cur = latestSettings.current.excluded;
    updateSettings({ excluded: exclude ? [...new Set([...cur, key])] : cur.filter((u) => u !== key) });
  };

  // ── Sorteio ───────────────────────────────────────────────
  const draw = async () => {
    if (drawing) return;
    setDrawing(true);
    const saved = saveTimer.current ? await flushSettings() : await pendingSave.current;
    if (!saved) return setDrawing(false);
    try {
      const r = await api.draw();
      pendingState.current = r;
      setReveal({ winner: r.winner, sample: r.sample });
    } catch (e) {
      toast(e.hint ? `${e.message} ${e.hint}` : e.message, 'error');
      setDrawing(false);
    }
  };

  const onRevealed = useCallback(() => {
    if (pendingState.current) applyState(pendingState.current);
    pendingState.current = null;
    setDrawing(false);
  }, [applyState]);

  const removeWinner = async (w) => {
    const ok = await confirm({
      title: `Remover @${w.username} do histórico?`,
      message: settings?.allowRepeatWinners ? 'O registro deste sorteio será apagado.' : 'O registro será apagado e esta pessoa volta a concorrer nos próximos sorteios.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      applyState(await api.removeWinner(w.id));
      if (reveal?.winner.id === w.id) setReveal(null);
      toast(`@${w.username} removido do histórico.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const copyWinners = async () => {
    const text = state.winners.map((w) => `${w.position}º @${w.username}${w.comment.text ? ` — "${w.comment.text.replace(/\s+/g, ' ')}"` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Lista de ganhadores copiada.', 'success');
    } catch {
      toast('Não foi possível copiar automaticamente.', 'error');
    }
  };

  const hasPost = Boolean(state?.post);

  return (
    <div className="app">
      <Header auth={auth} onConnect={connect} onCollector={() => openCollector(null)} onDisconnect={disconnect} onRefresh={refreshAuth} />
      <main className="layout">
        <div className="col-side">
          <PostPanel auth={auth} state={state} stats={stats} job={job} error={collectError} onLoad={load} onConnect={connect} onCollector={openCollector} onImport={() => setModal('import')} onReset={reset} />
          <SettingsPanel settings={settings} stats={stats} source={state?.source} hasPost={hasPost} onChange={updateSettings} onOpenParticipants={() => setModal('participants')} />
        </div>
        <div className="col-main">
          <DrawStage hasPost={hasPost} stats={stats} settings={settings} winnersCount={state?.winners.length || 0} drawing={drawing} reveal={reveal} onDraw={draw} onRevealed={onRevealed} />
          <History winners={state?.winners || []} onRemove={removeWinner} onCopy={copyWinners} />
        </div>
      </main>

      {modal === 'participants' && <ParticipantsModal excluded={settings.excluded} version={version} onToggleExclude={toggleExclude} onClose={() => setModal(null)} />}
      {modal === 'import' && <ImportModal onImport={importList} onClose={() => setModal(null)} />}
      {modal === 'collector' && <CollectorModal postUrl={collectorUrl} toast={toast} onOfficial={() => setModal('connect')} onClose={() => setModal(null)} />}
      {modal === 'connect' && <ConnectModal auth={auth} toast={toast} onUpdated={(st) => { setAuth(st); setCollectError(null); }} onClose={() => setModal(null)} />}
      {confirmDialog}
      {toasts}
    </div>
  );
}
