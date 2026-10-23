import { useState } from 'react';
import type { EnrichmentRecord, LearnerProfile, WikiResponse } from '@vibe-teacher/shared';
import type { LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { MiniMarkdown } from './MiniMarkdown';
import { ErrorBox, Notice, fmtDate } from './Notice';
import { WikiAlertCard } from './WikiAlertCard';
import { WikiItemCard } from './WikiItemCard';

/** AI 세션 분석 결과 요약 (없으면 안내만) */
export function SessionSummaryCard({ enrichment }: { enrichment: EnrichmentRecord | null }) {
  if (!enrichment) return <div className="small muted">{ko.understand.noSummary}</div>;
  const s = enrichment.data.summary;
  return (
    <div className="enrich-result">
      <h4 className="enrich-title">
        {s.title}{' '}
        <span className={`pill ${s.outcome === 'completed' ? 'pill-green' : s.outcome === 'partial' ? 'pill-yellow' : 'pill-gray'}`}>{ko.enrich.outcome[s.outcome]}</span>
        <span className="pill pill-yellow">AI</span>
      </h4>
      <p className="enrich-oneliner">{s.oneLiner}</p>
      <details>
        <summary className="small">{ko.common.more}</summary>
        <MiniMarkdown text={s.narrative} />
        {s.features.length > 0 && (
          <>
            <h4>{ko.enrich.features}</h4>
            <ul className="features">
              {s.features.map((f, i) => (
                <li key={i}>
                  <strong>{f.name}</strong> — {f.detail}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      {s.nextSteps.length > 0 && (
        <>
          <h4>{ko.enrich.nextSteps}</h4>
          <ul className="small">
            {s.nextSteps.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 위키 머리: 만들기/다시 만들기, snapshot 정보, 오래됨·부분 결과 안내 */
export function WikiHeader({ wiki, building, error, onBuild }: { wiki: WikiResponse | null; building: boolean; error: Error | null; onBuild: () => void }) {
  const button = (
    <button className="btn btn-primary btn-small" disabled={building} onClick={onBuild}>
      {building ? ko.wiki.building : wiki ? ko.wiki.rebuild : ko.wiki.build}
    </button>
  );
  if (!wiki) {
    return (
      <div className="card wiki-head">
        <p className="small">{ko.wiki.intro}</p>
        <Notice kind="info">
          <span>{ko.wiki.notBuilt}</span>
          {button}
        </Notice>
        {error && <ErrorBox error={error} />}
      </div>
    );
  }
  return (
    <div className="card wiki-head">
      <div className="concept-head">
        <span className="muted small grow">{ko.wiki.meta(wiki.snapshot.revision, fmtDate(wiki.snapshot.builtAt))}</span>
        {button}
      </div>
      <p className="small">{ko.wiki.intro}</p>
      {wiki.stale && <Notice kind="warn">{ko.wiki.stale}</Notice>}
      {wiki.snapshot.generator.kind === 'pending' && <Notice kind="info">{ko.wiki.aiPending}</Notice>}
      {wiki.snapshot.generator.kind !== 'pending' && wiki.snapshot.status === 'partial' && <Notice kind="warn">{ko.wiki.statusPartial}</Notice>}
      {wiki.snapshot.status === 'failed' && <Notice kind="error">{ko.wiki.statusFailed}</Notice>}
      {error && <ErrorBox error={error} />}
    </div>
  );
}

/** 먼저 확인할 것 + 지금 알아 두면 좋은 것 + 분량 때문에 접어 둔 항목 */
export function WikiBody({ wiki, profile, learner, projectId, sessionKey, onJump, aiWriting = false }: { wiki: WikiResponse; profile: LearnerProfile | null; learner: LearnerActions; projectId: string; sessionKey: string; onJump?: (i: number) => void; aiWriting?: boolean }) {
  const [showDeferred, setShowDeferred] = useState(false);
  const { snapshot, plan } = wiki;
  const items = new Map(snapshot.items.map((i) => [i.id, i]));
  // 보안·데이터 항목은 위쪽 전용 섹션에서 예산과 관계없이 모두 보여 준다.
  const alerts = snapshot.findings.filter((f) => plan.commonAlertIds.includes(f.id) && f.category !== 'security' && f.category !== 'data');
  const card = (id: string, bundle: (typeof plan.bundles)[number] | null) => {
    const item = items.get(id);
    return item ? <WikiItemCard key={item.id} item={item} bundle={bundle} wiki={wiki} profile={profile} learner={learner} projectId={projectId} sessionKey={sessionKey} onJump={onJump} aiWriting={aiWriting} /> : null;
  };
  return (
    <>
      <h3>{ko.security.otherAlerts}</h3>
      <p className="small muted">{ko.wiki.alertsNote}</p>
      {plan.budget.status === 'mandatory_overflow' && <Notice kind="warn">{ko.wiki.overflow}</Notice>}
      {alerts.length ? alerts.map((f) => <WikiAlertCard key={f.id} finding={f} snapshot={snapshot} onJump={onJump} />) : null}

      <h3>{ko.wiki.items}</h3>
      {plan.bundles.map((b) => card(b.itemId, b))}
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
          {!showDeferred ? (
            <ul className="small">
              {plan.deferred.map((d) => (
                <li key={d.itemId}>{items.get(d.itemId)?.title}</li>
              ))}
            </ul>
          ) : (
            plan.deferred.map((d) => card(d.itemId, null))
          )}
        </div>
      )}
    </>
  );
}

/** 확인한 범위와 확인하지 못한 범위, 첫 화면 분량, 검사 기록 */
export function WikiCoverage({ wiki }: { wiki: WikiResponse }) {
  const { snapshot, plan } = wiki;
  const cov = snapshot.coverage;
  return (
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
  );
}
