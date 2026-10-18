import { useEffect, useState } from 'react';
import type { LlmProviderOption, LlmProviderSetting, SettingsResponse } from '@vibe-teacher/shared';
import { api, apiPut } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ko } from '../i18n/ko';
import { ErrorBox, Notice } from './Notice';

const CHOICES: LlmProviderSetting[] = ['claude-cli', 'anthropic-sdk', 'auto', 'none'];

/** 제공자 선택 라디오. 각 선택지가 지금 실제로 쓸 수 있는지(로그인·키 여부)를 함께 보여 준다. */
export function LlmProviderChoice({
  value,
  onChange,
  options,
  defaultModel,
  model,
  envOverride,
  disabled,
  name = 'llm-provider',
}: {
  value: LlmProviderSetting;
  onChange: (v: LlmProviderSetting) => void;
  options: LlmProviderOption[];
  defaultModel: string;
  model?: string | null;
  envOverride?: string;
  disabled?: boolean;
  name?: string;
}) {
  const option = (id: string) => options.find((o) => o.id === id);
  return (
    <div className="llm-choice" role="radiogroup" aria-label={ko.sources.llmTitle}>
      {envOverride && <Notice kind="warn">{ko.sources.llmEnvOverride(envOverride)}</Notice>}
      {CHOICES.map((id) => {
        const o = option(id);
        const c = ko.sources.llmChoice[id];
        const desc = typeof c.desc === 'function' ? c.desc(model || defaultModel) : c.desc;
        return (
          <label key={id} className={`llm-choice-item ${value === id ? 'selected' : ''}`}>
            <input type="radio" name={name} checked={value === id} disabled={disabled} onChange={() => onChange(id)} />
            <span className="grow">
              <strong>{c.label}</strong>
              {o && (
                <span className={`pill ${o.available ? 'pill-green' : 'pill-gray'}`}>
                  {o.available ? `${ko.sources.llmAvailable}${o.detail ? ` · ${o.detail}` : ''}` : ko.sources.llmUnavailable}
                </span>
              )}
              <span className="small muted llm-choice-desc">{desc}</span>
              {o && !o.available && <span className="small llm-choice-reason">{id === 'anthropic-sdk' ? ko.sources.llmNoKey : o.reason}</span>}
            </span>
          </label>
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
  const change = async (provider: LlmProviderSetting) => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      setSettings(await apiPut<SettingsResponse>('/api/settings', { llm: { provider } }));
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
        {ko.sources.llmCurrent}: <strong>{current === 'none' ? ko.sources.llmChoice.none.label : ko.sources.llmChoice[current].label}</strong> · {ko.sources.llmChange}
      </summary>
      <LlmProviderChoice
        name="llm-quick"
        value={settings.llm.provider}
        onChange={change}
        options={settings.llmOptions}
        defaultModel={settings.llmDefaultModel}
        model={settings.llm.model}
        envOverride={settings.llmEnvOverride}
        disabled={busy}
      />
      {saved && <div className="small muted">{ko.sources.llmSaved}</div>}
    </details>
  );
}
