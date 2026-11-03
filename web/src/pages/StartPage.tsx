import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { OnboardingProfile, StartStage } from '@vibe-teacher/shared';
import { apiPut } from '../api/client';
import { ErrorBox, Loading } from '../components/Notice';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';
import { ReaderLevelSetup } from '../components/ReaderLevelPicker';

export function StartPage() {
  const { me, refresh } = useAuth();
  const saved = useApi<{ profile: OnboardingProfile | null }>('/api/me/onboarding');
  const [stage, setStage] = useState<StartStage | null>(null);
  const [goal, setGoal] = useState('');
  const [features, setFeatures] = useState('');
  const [repository, setRepository] = useState('');
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const t = ko.start;
  useEffect(() => {
    const p = saved.data?.profile;
    if (p) { setProfile(p); setStage(p.stage); setGoal(p.goal); setFeatures(p.features); setRepository(p.repository); setEditing(false); }
  }, [saved.data]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stage) return;
    setBusy(true); setError('');
    try {
      const result = await apiPut<{ profile: OnboardingProfile }>('/api/me/onboarding', { stage, goal, features, repository });
      setProfile(result.profile); setEditing(false); setCopied(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const prompt = profile ? [t.stages[profile.stage].prompt, profile.goal && `${t.goal}: ${profile.goal}`, profile.features && `${t.features}: ${profile.features}`, profile.repository && `${t.repository}: ${profile.repository}`].filter(Boolean).join('\n\n') : '';
  if (saved.loading) return <Loading />;
  if (saved.error) return <ErrorBox error={saved.error} onRetry={saved.reload} />;
  return <div className="page start-page">
    <div className="start-heading"><span className="eyebrow">{t.eyebrow}</span><h1>{editing ? t.title : t.ready}</h1><p className="muted">{editing ? t.subtitle : t.readyNote}</p></div>
    {me?.mode === 'supabase' && <div className="notice start-status">
      <span>{me.deployment === 'shared' ? t.shared : t.local} · {t.synced}</span>
      {!me.approved && <span>{t.pending} <button className="link" onClick={() => void refresh().catch((e: Error) => setError(e.message))}>{t.checkApproval}</button></span>}
      {me.deployment === 'local' && !me.localOwner && <span>{t.otherLocalOwner}</span>}
    </div>}
    {editing ? <form onSubmit={submit} className="form-grid">
      <fieldset className="stage-fieldset"><legend>{t.stageLabel}</legend><div className="stage-grid">{(Object.keys(t.stages) as StartStage[]).map((id, index) => <label key={id} className={`card stage-card ${stage === id ? 'selected' : ''}`}>
        <input type="radio" name="stage" value={id} checked={stage === id} onChange={() => setStage(id)} required />
        <span className="stage-number">0{index + 1}</span><strong>{t.stages[id].title}</strong><span className="muted">{t.stages[id].description}</span>
      </label>)}</div></fieldset>
      <section className="card form-grid">
        <label className="field">{t.goal}<textarea rows={3} maxLength={2000} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t.goalPlaceholder} /></label>
        {(stage === 'features' || stage === 'repository') && <label className="field">{t.features}<textarea rows={3} maxLength={4000} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={t.featuresPlaceholder} /></label>}
        {stage === 'repository' && <label className="field">{t.repository}<input maxLength={1000} value={repository} onChange={(e) => setRepository(e.target.value)} placeholder={t.repositoryPlaceholder} /><span className="muted small">{t.repositoryNote}</span></label>}
        <p className="muted small">{t.optional}</p>
        <button className="btn btn-primary" disabled={!stage || busy} type="submit">{busy ? ko.common.loading : t.submit}</button>
      </section>
    </form> : profile && <section className="card start-guide">
      <span className="pill pill-blue">{t.stages[profile.stage].title}</span>
      <h2>{t.stages[profile.stage].heading}</h2>
      {profile.goal && <p className="start-goal">{profile.goal}</p>}
      <ol>{t.stages[profile.stage].steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <h3>{t.promptTitle}</h3><p className="muted small">{t.promptNote}</p><pre className="start-prompt">{prompt}</pre>
      <div className="start-actions">
        <button className="btn btn-primary" onClick={() => void navigator.clipboard.writeText(prompt).then(() => setCopied(true)).catch(() => setError(t.copyError))}>{copied ? ko.common.copied : t.copy}</button>
        <Link className="btn" to="/accounts">{profile.stage === 'repository' ? t.openRepository : t.openRecords}</Link>
        <button className="link" onClick={() => { setEditing(true); setError(''); }}>{t.edit}</button>
      </div>
    </section>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {!editing && me?.reader && !me.reader.chosen && <ReaderLevelSetup />}
  </div>;
}
