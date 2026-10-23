import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import type { Account, HealthResponse, LlmProviderSetting, Provider, RescanResponse, SettingsResponse, SourceStatus } from '@vibe-teacher/shared';
import { apiDelete, apiPatch, apiPost, apiPut } from '../api/client';
import { Breadcrumb } from '../components/Layout';
import { LlmProviderChoice } from '../components/LlmProviderPicker';
import { ErrorBox, Loading, Notice } from '../components/Notice';
import { SourceCard } from '../components/SourceCard';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

const PROVIDERS: Provider[] = ['claude-code', 'codex', 'copilot-cli', 'copilot-vscode'];

export function SourcesPage() {
  const { me, refresh: refreshAuth } = useAuth();
  const isAdmin = !!me?.isAdmin;
  const sources = useApi<SourceStatus[]>(isAdmin ? '/api/sources' : null);
  const accounts = useApi<Account[]>(isAdmin ? '/api/accounts' : null);
  const settings = useApi<SettingsResponse>(isAdmin ? '/api/settings' : null);
  const health = useApi<HealthResponse>(isAdmin ? '/api/health' : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);

  const [scanMode, setScanMode] = useState<'current' | 'list' | 'all'>('current');
  const [homes, setHomes] = useState('');
  const [homeRoots, setHomeRoots] = useState('/home');
  const [llmProvider, setLlmProvider] = useState<LlmProviderSetting>('auto');
  const [openrouterModel, setOpenrouterModel] = useState('openrouter/free');
  const [llmModel, setLlmModel] = useState('');
  const [llmBudget, setLlmBudget] = useState('0.5');
  const [llmCliPath, setLlmCliPath] = useState('');
  const [autoText, setAutoText] = useState(true);

  const [authMode, setAuthMode] = useState<'none' | 'home-token'>('none');
  const [admins, setAdmins] = useState('');
  const [sessionTtl, setSessionTtl] = useState('168');
  const [enrichFor, setEnrichFor] = useState<'admins' | 'everyone'>('admins');

  const [newProvider, setNewProvider] = useState<Provider>('claude-code');
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (!settings.data) return;
    setScanMode(settings.data.scan.mode);
    setHomes(settings.data.scan.homes.join('\n'));
    setHomeRoots(settings.data.scan.homeRoots.join('\n'));
    setLlmProvider(settings.data.llm.provider);
    setLlmModel(settings.data.llm.model ?? '');
    setLlmBudget(String(settings.data.llm.maxBudgetUsd));
    setLlmCliPath(settings.data.llm.claudeCliPath ?? '');
    setAutoText(settings.data.llm.autoText ?? true);
    setOpenrouterModel(settings.data.llm.openrouterModel);
    setAuthMode(settings.data.auth.mode);
    setAdmins(settings.data.auth.admins.join(', '));
    setSessionTtl(String(settings.data.auth.sessionTtlHours));
    setEnrichFor(settings.data.auth.enrichFor);
  }, [settings.data]);

  const reloadAll = () => {
    sources.reload();
    accounts.reload();
    settings.reload();
  };

  const run = async (fn: () => Promise<void>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ kind: 'success', text: okText });
      reloadAll();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveScan = () =>
    run(async () => {
      await apiPut('/api/settings', {
        scan: {
          mode: scanMode,
          homes: homes.split('\n').map((s) => s.trim()).filter(Boolean),
          homeRoots: homeRoots.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      });
    }, ko.sources.saved);

  const saveLlm = () =>
    run(async () => {
      await apiPut('/api/settings', {
        llm: {
          provider: llmProvider,
          model: llmModel.trim() || null,
          maxBudgetUsd: Number(llmBudget) || 0.5,
          claudeCliPath: llmCliPath.trim() || null,
          autoText,
          openrouterModel,
        },
      });
    }, ko.sources.saved);

  const saveAuth = () =>
    run(async () => {
      await apiPut('/api/settings', {
        auth: {
          mode: authMode,
          admins: admins.split(',').map((s) => s.trim()).filter(Boolean),
          sessionTtlHours: Number(sessionTtl) || 168,
          enrichFor,
        },
      });
      await refreshAuth();
    }, ko.sources.saved);

  const rescan = () =>
    run(async () => {
      const r = await apiPost<RescanResponse>('/api/rescan');
      setMsg({ kind: 'success', text: `계정 ${r.accounts} · 소스 ${r.sources} · 프로젝트 ${r.projects} · 세션 ${r.sessions} (${r.durationMs}ms)` });
    });

  const addSource = () =>
    run(async () => {
      if (!newPath.trim()) return;
      await apiPost('/api/sources', { provider: newProvider, path: newPath.trim(), label: newLabel.trim() || undefined });
      setNewPath('');
      setNewLabel('');
    }, '추가했습니다');

  const byAccount = new Map<string, SourceStatus[]>();
  for (const s of sources.data ?? []) byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  const accountName = (id: string) => (accounts.data ?? []).find((a) => a.id === id)?.username ?? (id === 'other' ? '기타 경로' : id);

  if (me && !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <Breadcrumb items={[{ label: ko.sources.title }]} />
      <h1>{ko.sources.title}</h1>
      <p className="muted">{ko.sources.subtitle}</p>
      {health.data && (
        <p className="muted small">
          {ko.sources.running}: <span className="mono">{health.data.runningAs.username}</span> · 설정 파일 <span className="mono">{health.data.home}/config.json</span>
        </p>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <section className="section card">
        <h2>{ko.sources.scanTitle}</h2>
        <div className="form-grid">
          {(['current', 'list', 'all'] as const).map((m) => (
            <label key={m} className="radio">
              <input type="radio" name="scanMode" checked={scanMode === m} onChange={() => setScanMode(m)} />
              {ko.sources.scanMode[m]}
            </label>
          ))}
          {scanMode === 'list' && (
            <label className="field">
              {ko.sources.homes}
              <textarea rows={3} value={homes} onChange={(e) => setHomes(e.target.value)} placeholder="/home/user01&#10;/home/user02" />
            </label>
          )}
          {scanMode === 'all' && (
            <label className="field">
              {ko.sources.homeRoots}
              <textarea rows={2} value={homeRoots} onChange={(e) => setHomeRoots(e.target.value)} />
            </label>
          )}
          <div className="muted small">{ko.sources.scanHint}</div>
          <div>
            <button className="btn btn-primary" disabled={busy} onClick={saveScan}>
              {ko.sources.save}
            </button>{' '}
            <button className="btn" disabled={busy} onClick={rescan}>
              {ko.common.rescan}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>기록 위치</h2>
        {sources.loading && <Loading />}
        {sources.error && <ErrorBox error={sources.error} onRetry={sources.reload} />}
        {Array.from(byAccount.entries()).map(([accountId, list]) => (
          <div key={accountId} className="account-group">
            <h3>
              {accountName(accountId)} <span className="muted small mono">{(accounts.data ?? []).find((a) => a.id === accountId)?.homePath}</span>
            </h3>
            <div className="source-grid">
              {list.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  busy={busy}
                  onToggle={(enabled) => run(() => apiPatch(`/api/sources/${s.id}`, { enabled }).then(() => undefined))}
                  onRemove={s.kind === 'custom' ? () => run(() => apiDelete(`/api/sources/${s.id}`).then(() => undefined), '삭제했습니다') : undefined}
                />
              ))}
            </div>
          </div>
        ))}
        {(accounts.data ?? [])
          .filter((a) => a.readable !== 'ok')
          .map((a) => (
            <div key={a.id} className="muted small">
              {a.username} <span className="mono">{a.homePath}</span> — {ko.readable[a.readable]}
            </div>
          ))}
      </section>

      <section className="section card">
        <h2>{ko.sources.addTitle}</h2>
        <div className="form-row">
          <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as Provider)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {ko.provider[p]}
              </option>
            ))}
          </select>
          <input className="grow" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder={ko.sources.addPath} />
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={ko.sources.addLabel} />
          <button className="btn btn-primary" disabled={busy || !newPath.trim()} onClick={addSource}>
            {ko.sources.add}
          </button>
        </div>
      </section>

      <section className="section card">
        <h2>{ko.sources.llmTitle}</h2>
        {settings.data && (
          <Notice kind={settings.data.llmStatus.available ? 'success' : 'warn'}>
            {settings.data.llmStatus.available
              ? `사용 가능: ${ko.sources.llmProvider[settings.data.llmStatus.resolvedProvider] ?? settings.data.llmStatus.resolvedProvider}${settings.data.llmStatus.cliVersion ? ` (${settings.data.llmStatus.cliVersion})` : ''}`
              : `${ko.enrich.unavailable}: ${settings.data.llmStatus.reason ?? ''}`}
            {settings.data.llmStatus.cliPath && <div className="mono small">{settings.data.llmStatus.cliPath}</div>}
          </Notice>
        )}
        <div className="form-grid">
          {settings.data && (
            <LlmProviderChoice
              value={llmProvider}
              onChange={setLlmProvider}
              options={settings.data.llmOptions}
              defaultModel={settings.data.llmDefaultModel}
              models={{ claude: llmModel.trim() || null, openrouter: openrouterModel }}
              onModelChange={(_, m) => setOpenrouterModel(m)}
              envOverride={settings.data.llmEnvOverride}
            />
          )}
          <label className="field">
            {ko.sources.llmModelClaude}
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder={ko.sources.cliModelDefault} />
          </label>
          <label className="field">
            {ko.sources.llmBudget}
            <input value={llmBudget} onChange={(e) => setLlmBudget(e.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={autoText} onChange={(e) => setAutoText(e.target.checked)} />
            <span>
              {ko.sources.autoText}
              <div className="small muted">{ko.sources.autoTextHelp}</div>
            </span>
          </label>
          <label className="field">
            {ko.sources.llmCliPath}
            <input value={llmCliPath} onChange={(e) => setLlmCliPath(e.target.value)} placeholder="/usr/local/bin/claude" />
          </label>
          <div>
            <button className="btn btn-primary" disabled={busy} onClick={saveLlm}>
              {ko.sources.save}
            </button>
          </div>
        </div>
      </section>

      <section className="section card">
        <h2>{ko.login.authTitle}</h2>
        <Notice kind="warn">{ko.login.warnSelfLock}</Notice>
        <div className="form-grid">
          {(['none', 'home-token'] as const).map((m) => (
            <label key={m} className="radio">
              <input type="radio" name="authMode" checked={authMode === m} onChange={() => setAuthMode(m)} />
              {ko.login.authMode[m]}
            </label>
          ))}
          <label className="field">
            {ko.login.admins}
            <input value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="user99, user01" />
          </label>
          <label className="field">
            {ko.login.sessionTtl}
            <input value={sessionTtl} onChange={(e) => setSessionTtl(e.target.value)} />
          </label>
          <label className="field">
            AI 분석 허용 범위
            <select value={enrichFor} onChange={(e) => setEnrichFor(e.target.value as 'admins' | 'everyone')}>
              {(['admins', 'everyone'] as const).map((v) => (
                <option key={v} value={v}>
                  {ko.login.enrichFor[v]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button className="btn btn-primary" disabled={busy} onClick={saveAuth}>
              {ko.sources.save}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
