import { useState, type FormEvent } from 'react';
import type { OpenRouterKeyResponse, OpenRouterKeySource } from '@vibe-teacher/shared';
import { apiDelete, apiPut } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ko } from '../i18n/ko';

/**
 * 노트북 설치에서 OpenRouter 키를 저장·교체·삭제한다. 키는 서버의 앱 저장 폴더에만 두며
 * 서버는 출처(env·saved·none)만 돌려주므로 저장한 키를 화면에 다시 채우지 않는다.
 */
export function OpenRouterKeySetup({ source, onChange }: { source: OpenRouterKeySource; onChange?: () => void }) {
  const { refresh } = useAuth();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const t = ko.openRouterKey;
  if (source === 'env') return <p className="muted small">{t.fromEnv}</p>;
  const run = async (action: () => Promise<OpenRouterKeyResponse>, done: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      setKey(''); setMessage(done);
      onChange?.();
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => apiPut<OpenRouterKeyResponse>('/api/settings/openrouter-key', { key }), t.saved);
  };
  return <form className="form-grid" onSubmit={submit}>
    <label className="field">{source === 'saved' ? t.replaceLabel : t.label}
      <input type="password" autoComplete="off" spellCheck={false} maxLength={400} placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} />
    </label>
    <p className="muted small">{t.note} <a href={t.keysUrl} target="_blank" rel="noreferrer noopener">{t.getKey}</a></p>
    <div className="form-row">
      <button className="btn btn-primary" type="submit" disabled={busy || !key.trim()}>{busy ? ko.common.loading : t.save}</button>
      {source === 'saved' && <button className="btn" type="button" disabled={busy} onClick={() => void run(() => apiDelete<OpenRouterKeyResponse>('/api/settings/openrouter-key'), t.removed)}>{t.remove}</button>}
    </div>
    {message && <p role="status" className="notice notice-success small">{message}</p>}
    {error && <p role="alert" className="notice notice-error small">{error}</p>}
  </form>;
}
