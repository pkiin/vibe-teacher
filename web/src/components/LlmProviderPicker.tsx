import { useEffect, useMemo, useState } from 'react';
import type { LlmModelsResponse, LlmProviderOption, LlmProviderSetting, SettingsResponse } from '@vibe-teacher/shared';
import { api, apiPut } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading, Notice, fmtDate } from './Notice';

const CHOICES: LlmProviderSetting[] = ['auto', 'claude-cli', 'openrouter', 'none'];

export interface ModelSettings {
  /** Claude CLI 모델. 비우면 기본값 */
  claude: string | null;
  openrouter: string;
}

/**
 * OpenRouter 모델 선택. 목록은 서버가 각 서비스의 모델 목록 API 에서 받아 온다 (관리자만).
 * OpenRouter 는 설정된 모델을 포함한 모델 목록을 보여 준다.
 */
export function LlmModelSelect({ provider, value, onChange, disabled }: { provider: 'openrouter'; value: string; onChange: (model: string) => void; disabled?: boolean }) {
  const [data, setData] = useState<LlmModelsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);

  const load = (refresh = false) => {
    setError(null);
    api<LlmModelsResponse>(`/api/settings/llm-models?provider=${provider}${refresh ? '&refresh=1' : ''}`)
      .then(setData)
      .catch((e: Error) => setError(e));
  };
  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.models ?? []).filter((m) => (!freeOnly || m.free || m.id === value) && (!q || `${m.id} ${m.name}`.toLowerCase().includes(q) || m.id === value));
  }, [data, query, freeOnly, value]);
  const selected = data?.models.find((m) => m.id === value);
  const label = provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';

  return (
    <div className="llm-models">
      <div className="llm-models-row">
        <input type="search" placeholder={ko.sources.models.search} value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} aria-label={ko.sources.models.search} />
        {provider === 'openrouter' && (
          <label className="small nowrap">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> {ko.sources.models.freeOnly}
          </label>
        )}
        <button type="button" className="btn btn-small" onClick={() => load(true)} disabled={disabled}>
          {ko.sources.models.refresh}
        </button>
      </div>
      {error && <ErrorBox error={error} onRetry={() => load(true)} />}
      {!data && !error && <Loading text={ko.sources.models.loading} />}
      {data && (
        <>
          <select className="llm-models-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={`${label} ${ko.sources.models.label}`}>
            {!selected && <option value={value}>{`${value} (${ko.sources.models.notInList})`}</option>}
            {filtered.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name === m.id ? m.id : `${m.name} — ${m.id}`}
                {m.free ? ` · ${ko.sources.models.free}` : ''}
                {m.structured ? '' : ' · JSON 강제 미지원'}
              </option>
            ))}
          </select>
          <div className="small muted">
            {ko.sources.models.count(filtered.length, data.models.filter((m) => m.free).length, data.models.length)} · {ko.sources.models.source(label, fmtDate(data.fetchedAt))}
          </div>
          {selected && (
            <div className="small llm-model-info">
              {selected.free ? <span className="pill pill-green">{ko.sources.models.free}</span> : <span>{ko.sources.models.price(selected.promptPrice, selected.completionPrice)}</span>}
              {selected.contextLength && <span className="muted"> · {ko.sources.models.context(selected.contextLength)}</span>}
              <span className="muted"> · {selected.structured ? ko.sources.models.structured : ko.sources.models.noStructured}</span>
              {selected.description && <div className="muted">{selected.description}</div>}
            </div>
          )}
          {provider === 'openrouter' && (selected?.free ?? value.endsWith(':free')) && <Notice kind="warn">{ko.sources.models.freeNote}</Notice>}
        </>
      )}
    </div>
  );
}

/** 제공자 선택 라디오. 각 선택지가 지금 실제로 쓸 수 있는지(로그인·키 여부)를 함께 보여 주고, OpenRouter 는 모델도 고른다. */
export function LlmProviderChoice({
  value,
  onChange,
  options,
  defaultModel,
  models,
  onModelChange,
  envOverride,
  disabled,
  name = 'llm-provider',
}: {
  value: LlmProviderSetting;
  onChange: (v: LlmProviderSetting) => void;
  options: LlmProviderOption[];
  defaultModel: string;
  models: ModelSettings;
  onModelChange?: (provider: 'openrouter', model: string) => void;
  envOverride?: string;
  disabled?: boolean;
  name?: string;
}) {
  const option = (id: string) => options.find((o) => o.id === id);
  const modelOf = (id: LlmProviderSetting) => (id === 'openrouter' ? models.openrouter : models.claude || defaultModel);
  return (
    <div className="llm-choice" role="radiogroup" aria-label={ko.sources.llmTitle}>
      {envOverride && <Notice kind="warn">{ko.sources.llmEnvOverride(envOverride)}</Notice>}
      {CHOICES.map((id) => {
        const o = option(id);
        const c = ko.sources.llmChoice[id];
        const desc = typeof c.desc === 'function' ? c.desc(modelOf(id)) : c.desc;
        return (
          <div key={id} className={`llm-choice-item ${value === id ? 'selected' : ''}`}>
            <label className="llm-choice-label">
              <input type="radio" name={name} checked={value === id} disabled={disabled} onChange={() => onChange(id)} />
              <span className="grow">
                <strong>{c.label}</strong>
                {o && (
                  <span className={`pill ${o.available ? 'pill-green' : 'pill-gray'}`}>
                    {o.available ? `${ko.sources.llmAvailable}${o.detail ? ` · ${o.detail}` : ''}` : ko.sources.llmUnavailable}
                  </span>
                )}
                <span className="small muted llm-choice-desc">{desc}</span>
                {o && !o.available && <span className="small llm-choice-reason">{ko.sources.llmNoKey[id] ?? o.reason}</span>}
              </span>
            </label>
            {value === id && id === 'openrouter' && onModelChange && (
              <LlmModelSelect provider={id} value={models.openrouter} onChange={(m) => onModelChange(id, m)} disabled={disabled} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * AI 버튼 옆에 두는 빠른 전환 (관리자만). 고르는 즉시 설정에 저장하고 로그인 정보(llmStatus)를 새로 받는다.
 */
export function LlmQuickSwitch({ onChanged }: { onChanged?: () => void }) {
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<SettingsResponse>('/api/settings')
      .then(setSettings)
      .catch((e: Error) => setError(e));
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!settings) return null;
  const current = settings.llmStatus.resolvedProvider;
  const save = async (llm: Record<string, string>) => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      setSettings(await apiPut<SettingsResponse>('/api/settings', { llm }));
      await refresh();
      setSaved(true);
      onChanged?.();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="llm-quick">
      <summary className="small">
        {ko.sources.llmCurrent}: <strong>{current === 'none' ? ko.sources.llmChoice.none.label : ko.sources.llmChoice[current].label}</strong>
        {current === 'openrouter' ? ` (${settings.llm.openrouterModel})` : ''} · {ko.sources.llmChange}
      </summary>
      <LlmProviderChoice
        name="llm-quick"
        value={settings.llm.provider}
        onChange={(provider) => save({ provider })}
        options={settings.llmOptions}
        defaultModel={settings.llmDefaultModel}
        models={{ claude: settings.llm.model, openrouter: settings.llm.openrouterModel }}
        onModelChange={(provider, model) => save({ openrouterModel: model })}
        envOverride={settings.llmEnvOverride}
        disabled={busy}
      />
      {saved && <div className="small muted">{ko.sources.llmSaved}</div>}
    </details>
  );
}
