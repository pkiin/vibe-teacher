import type { WikiResponse } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { WikiAlertCard } from './WikiAlertCard';

/** 개인의 이해 수준이나 설명 예산과 무관하게 모든 미해결 보안·데이터 항목을 보여 준다. */
export function SecurityReview({ wiki, onJump }: { wiki: WikiResponse | null; onJump?: (i: number) => void }) {
  const findings = wiki?.snapshot.findings.filter((f) => (f.category === 'security' || f.category === 'data') && (f.lifecycle === 'open' || f.lifecycle === 'recheck_required')) ?? [];
  return (
    <section className="security-review" id="security" aria-labelledby="security-title">
      <div className="section-heading">
        <h2 id="security-title">{ko.security.title}</h2>
        {wiki && <span className="pill pill-yellow">{ko.security.count(findings.length)}</span>}
      </div>
      <p className="muted">{ko.security.intro}</p>
      <div className="security-scope">{ko.security.scope}</div>
      {!wiki && <p className="card">{ko.security.missing}</p>}
      {wiki && !findings.length && <p className="card">{ko.security.empty}</p>}
      {wiki && findings.map((finding) => <WikiAlertCard key={finding.id} finding={finding} snapshot={wiki.snapshot} onJump={onJump} />)}
      <details className="card security-checklist">
        <summary>{ko.security.pending}</summary>
        <p className="small muted">{ko.security.pendingNote}</p>
        <dl className="term-grid">
          {ko.security.checklist.map(({ title, detail }) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}
        </dl>
      </details>
    </section>
  );
}
