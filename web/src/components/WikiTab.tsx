import { useCallback, useEffect, useState } from 'react';
import type { LearnerProfile, UnderstandingResponse, WikiResponse } from '@vibe-teacher/shared';
import { ApiError, api, apiPost } from '../api/client';
import { useLearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading, Notice, fmtDate } from './Notice';
import { QuizCard } from './QuizCard';
import { UnderstandingPanel } from './UnderstandingPanel';
import { WikiAiPanel } from './WikiAiPanel';
import { WikiAlertCard } from './WikiAlertCard';
import { WikiItemCard } from './WikiItemCard';

const HIDE_QUIZ_KEY = 'vibe-teacher.hideQuizSuggestions';

function readHideQuiz(): boolean {
  try {
    return localStorage.getItem(HIDE_QUIZ_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHideQuiz(v: boolean): void {
  try {
    if (v) localStorage.setItem(HIDE_QUIZ_KEY, '1');
    else localStorage.removeItem(HIDE_QUIZ_KEY);
  } catch {
    // 저장하지 못해도 이번 화면에서는 숨긴다
  }
}

/** 세션 페이지의 "프로젝트 위키" 탭. 원장(snapshot)과 내 설명 계획(plan)을 함께 그린다. */
export function WikiTab({ sessionKey, projectId, onJump }: { sessionKey: string; projectId: string; onJump?: (i: number) => void }) {
  const enc = encodeURIComponent(sessionKey);
  const [wiki, setWiki] = useState<WikiResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [building, setBuilding] = useState(false);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [showDeferred, setShowDeferred] = useState(false);
  const [hideQuiz, setHideQuiz] = useState(readHideQuiz);
  const [quizOpen, setQuizOpen] = useState(false);

  const loadWiki = useCallback(
    (quiet = false) => {
      api<WikiResponse>(`/api/sessions/${enc}/wiki`)
        .then((w) => {
          setWiki(w);
          setStatus('ready');
        })
        .catch((e: Error) => {
          if (e instanceof ApiError && e.code === 'wiki_not_built') setStatus('missing');
          else if (!quiet) {
            setError(e);
            setStatus('error');
          }
        });
    },
    [enc],
  );

  useEffect(() => {
    setStatus('loading');
    loadWiki();
  }, [loadWiki]);

  useEffect(() => {
    api<UnderstandingResponse>(`/api/projects/${projectId}/understanding`)
      .then((u) => setProfile(u.profile))
      .catch(() => setProfile(null));
  }, [projectId]);

  // 내 이해 정보가 바뀌면 설명 계획만 다시 받는다 (프로젝트 사실·알림은 그대로)
  const onProfile = useCallback(
    (p: LearnerProfile) => {
      setProfile(p);
      loadWiki(true);
    },
    [loadWiki],
  );
  const learner = useLearnerActions(projectId, sessionKey, profile?.revision ?? wiki?.plan.profileRevision ?? 0, onProfile);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      setWiki(await apiPost<WikiResponse>(`/api/sessions/${enc}/wiki/build`, {}));
      setStatus('ready');
    } catch (e) {
      setError(e as Error);
    } finally {
      setBuilding(false);
    }
  };

  const buildButton = (
    <button className="btn btn-primary btn-small" disabled={building} onClick={build}>
      {building ? ko.wiki.building : wiki ? ko.wiki.rebuild : ko.wiki.build}
    </button>
  );

  if (status === 'loading') return <Loading />;
  if (status === 'error' && error) return <ErrorBox error={error} onRetry={() => loadWiki()} />;
  if (status === 'missing' || !wiki) {
    return (
      <div className="card wiki-head">
        <p>{ko.wiki.intro}</p>
        <Notice kind="info">
          <span>{ko.wiki.notBuilt}</span>
          {buildButton}
        </Notice>
        {error && <ErrorBox error={error} />}
      </div>
    );
  }

  const { snapshot, plan } = wiki;
  const items = new Map(snapshot.items.map((i) => [i.id, i]));
  const alerts = plan.commonAlertIds.map((id) => snapshot.findings.find((f) => f.id === id)).filter((f) => !!f);
  const primaryConcepts = [...new Set(snapshot.items.flatMap((i) => i.conceptIds.slice(0, 1)))];
  const cov = snapshot.coverage;

  return (
    <div className="wiki">
      <div className="card wiki-head">
        <div className="concept-head">
          <span className="muted small grow">{ko.wiki.meta(snapshot.revision, fmtDate(snapshot.builtAt))}</span>
          {buildButton}
        </div>
        <p className="small">{ko.wiki.intro}</p>
        {wiki.stale && <Notice kind="warn">{ko.wiki.stale}</Notice>}
        {snapshot.status === 'partial' && <Notice kind="warn">{ko.wiki.statusPartial}</Notice>}
        {snapshot.status === 'failed' && <Notice kind="error">{ko.wiki.statusFailed}</Notice>}
        {error && <ErrorBox error={error} />}
      </div>

      <WikiAiPanel sessionKey={sessionKey} wiki={wiki} onUpdated={() => loadWiki(true)} />

      <h2>{ko.wiki.alerts}</h2>
      <p className="small muted">{ko.wiki.alertsNote}</p>
      {plan.budget.status === 'mandatory_overflow' && <Notice kind="warn">{ko.wiki.overflow}</Notice>}
      {alerts.length ? alerts.map((f) => <WikiAlertCard key={f.id} finding={f} snapshot={snapshot} onJump={onJump} />) : <div className="muted">{ko.wiki.noAlerts}</div>}

      {plan.optionalQuestionIds.length > 0 && !hideQuiz && (
        <details className="card wiki-quiz-suggest" open={quizOpen} onToggle={(e) => setQuizOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            {ko.quiz.suggested} ({plan.optionalQuestionIds.length})
          </summary>
          <p className="small muted">{ko.quiz.suggestedNote}</p>
          {quizOpen && plan.optionalQuestionIds.map((qid) => <QuizCard key={qid} projectId={projectId} sessionKey={sessionKey} target={{ questionId: qid }} learner={learner} explanationSeen={false} />)}
          <button
            className="link small"
            onClick={() => {
              writeHideQuiz(true);
              setHideQuiz(true);
            }}
          >
            {ko.quiz.hideSuggestions}
          </button>
        </details>
      )}

      <h2>{ko.wiki.items}</h2>
      {plan.bundles.map((b) => {
        const item = items.get(b.itemId);
        return item ? <WikiItemCard key={item.id} item={item} bundle={b} wiki={wiki} profile={profile} learner={learner} projectId={projectId} sessionKey={sessionKey} onJump={onJump} /> : null;
      })}

      {plan.deferred.length > 0 && (
        <div className="card wiki-deferred">
          <div className="concept-head">
            <strong className="grow">
              {ko.wiki.deferred} ({plan.deferred.length})
            </strong>
            <button className="btn btn-small" aria-expanded={showDeferred} onClick={() => setShowDeferred((v) => !v)}>
              {showDeferred ? ko.wiki.collapse : ko.wiki.showDeferred}
            </button>
          </div>
          {!showDeferred && (
            <ul className="small">
              {plan.deferred.map((d) => (
                <li key={d.itemId}>{items.get(d.itemId)?.title}</li>
              ))}
            </ul>
          )}
          {showDeferred &&
            plan.deferred.map((d) => {
              const item = items.get(d.itemId);
              return item ? <WikiItemCard key={item.id} item={item} bundle={null} wiki={wiki} profile={profile} learner={learner} projectId={projectId} sessionKey={sessionKey} onJump={onJump} /> : null;
            })}
        </div>
      )}

      <h2>{ko.wiki.coverage}</h2>
      <div className="card small">
        <div className="wiki-coverage">
          {(['chat', 'diff', 'runtimeLogs', 'repository', 'deploymentConfig'] as const).map((k) => {
            const v = cov[k];
            const label = k === 'chat' ? ko.wiki.coverageLevel[v === 'partial' ? 'partial_chat' : v] : ko.wiki.coverageLevel[v];
            return (
              <span key={k} className={`pill ${v === 'available' || v === 'complete_for_export' ? 'pill-green' : v === 'partial' ? 'pill-yellow' : 'pill-gray'}`}>
                {ko.wiki.coverageKeys[k]}: {label}
              </span>
            );
          })}
        </div>
        <ul>
          {cov.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {plan.missingContext.length > 0 && (
          <div>
            {ko.wiki.missing}: {plan.missingContext.join(', ')}
          </div>
        )}
        <div className="muted">{ko.wiki.budget(plan.budget.used, plan.budget.limit)}</div>
        {snapshot.warnings.length > 0 && (
          <details className="evidence">
            <summary>
              {ko.wiki.warnings} ({snapshot.warnings.length})
            </summary>
            <ul>
              {snapshot.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <UnderstandingPanel conceptIds={primaryConcepts} concepts={wiki.concepts} profile={profile} learner={learner} />
    </div>
  );
}
