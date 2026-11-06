import { useState } from 'react';
import { Icon, Toggle, fmtNumber } from './ui.jsx';

export function SettingsPanel({ settings, stats, source, hasPost, onChange, onOpenParticipants }) {
  if (!settings) return null;
  const r = settings.rules;
  const setRule = (key, patch, debounce) => onChange({ rules: { [key]: { ...r[key], ...patch } } }, { debounce });

  return (
    <section className="card" aria-labelledby="settings-title">
      <div className="card-head">
        <h2 id="settings-title"><span className="step-dot">2</span> Configurações</h2>
      </div>

      <div className="group">
        <Toggle
          label="Permitir ganhadores repetidos"
          description={settings.allowRepeatWinners ? 'A mesma pessoa pode ganhar mais de uma vez.' : 'Quem já ganhou sai dos próximos sorteios.'}
          checked={settings.allowRepeatWinners}
          onChange={(v) => onChange({ allowRepeatWinners: v })}
        />
        <div className="field">
          <span className="field-label">Chances no sorteio</span>
          <div className="segmented" role="radiogroup" aria-label="Chances no sorteio">
            {[
              ['comment', '1 por comentário'],
              ['profile', '1 por perfil'],
            ].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={settings.entryMode === v} className={settings.entryMode === v ? 'is-active' : ''} onClick={() => onChange({ entryMode: v })}>
                {l}
              </button>
            ))}
          </div>
          <span className="field-hint">
            {settings.entryMode === 'comment' ? 'Cada comentário válido é uma chance. Quem comenta mais, tem mais chances.' : 'Cada perfil com ao menos um comentário válido tem uma única chance.'}
          </span>
        </div>
        <Toggle label="Incluir respostas a comentários" checked={settings.includeReplies} onChange={(v) => onChange({ includeReplies: v })} />
        <Toggle
          label="Excluir o dono da publicação"
          description={source === 'import' ? 'Indisponível na importação manual.' : undefined}
          checked={settings.excludeOwner}
          disabled={source === 'import'}
          onChange={(v) => onChange({ excludeOwner: v })}
        />
      </div>

      <div className="group">
        <div className="group-title">
          Validação dos comentários
          {hasPost && (
            <span className="group-meta mono">{fmtNumber(stats?.validComments)} válidos · {fmtNumber(stats?.invalidComments)} ignorados</span>
          )}
        </div>

        <RuleRow label="Palavra ou frase obrigatória" enabled={r.requiredText.enabled} onToggle={(v) => setRule('requiredText', { enabled: v })}>
          <input className="input" placeholder="ex.: quero ganhar" value={r.requiredText.value} onChange={(e) => setRule('requiredText', { value: e.target.value }, true)} />
          {!r.requiredText.value.trim() && <span className="field-hint warn">Digite a palavra ou frase para a regra valer.</span>}
        </RuleRow>

        <RuleRow label="Hashtag obrigatória" enabled={r.requiredHashtag.enabled} onToggle={(v) => setRule('requiredHashtag', { enabled: v })}>
          <div className="input-prefix">
            <span>#</span>
            <input className="input" placeholder="sorteio" value={r.requiredHashtag.value} onChange={(e) => setRule('requiredHashtag', { value: e.target.value.replace(/^#+/, '').replace(/\s/g, '') }, true)} />
          </div>
          {!r.requiredHashtag.value && <span className="field-hint warn">Digite a hashtag para a regra valer.</span>}
        </RuleRow>

        <RuleRow label="Mínimo de pessoas marcadas" enabled={r.minMentions.enabled} onToggle={(v) => setRule('minMentions', { enabled: v })}>
          <div className="stepper">
            <button aria-label="Diminuir" onClick={() => setRule('minMentions', { value: Math.max(1, r.minMentions.value - 1) })}>−</button>
            <span className="mono">{r.minMentions.value}</span>
            <button aria-label="Aumentar" onClick={() => setRule('minMentions', { value: Math.min(50, r.minMentions.value + 1) })}>+</button>
          </div>
        </RuleRow>

        <Toggle label="Exigir ao menos uma marcação" checked={r.requireMention.enabled} onChange={(v) => setRule('requireMention', { enabled: v })} />
        <p className="field-hint">
          Comentários que não cumprem as regras ativas são ignorados. Nas marcações não contam o próprio autor nem a conta da publicação. Os textos são comparados sem diferenciar maiúsculas e acentos.
        </p>
      </div>

      <div className="group">
        <div className="group-title">Exclusão de participantes</div>
        <ExclusionInput value={settings.excluded} onChange={(excluded) => onChange({ excluded })} />
        <button className="btn btn-sm btn-ghost btn-block" disabled={!hasPost} onClick={onOpenParticipants}>
          <Icon name="users" size={14} /> Ver e remover participantes
        </button>
      </div>
    </section>
  );
}

function RuleRow({ label, enabled, onToggle, children }) {
  return (
    <div className={`rule ${enabled ? 'is-on' : ''}`}>
      <Toggle label={label} checked={enabled} onChange={onToggle} />
      {enabled && <div className="rule-body">{children}</div>}
    </div>
  );
}

function ExclusionInput({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const names = raw.split(/[\s,;]+/).map((s) => s.replace(/^@+/, '').toLowerCase()).filter((s) => /^[a-z0-9._]{1,30}$/.test(s));
    if (names.length) onChange([...new Set([...value, ...names])]);
    setDraft('');
  };
  return (
    <div className="chips-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {value.map((u) => (
        <span key={u} className="chip">
          @{u}
          <button aria-label={`Remover @${u} da exclusão`} onClick={() => onChange(value.filter((x) => x !== u))}><Icon name="x" size={11} /></button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? '' : '@usuario, @outro… (Enter para adicionar)'}
        onChange={(e) => (/[\s,;]$/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => { e.preventDefault(); add(draft + ' ' + e.clipboardData.getData('text')); }}
        onBlur={() => draft && add(draft)}
        aria-label="Adicionar usuários excluídos"
      />
    </div>
  );
}
