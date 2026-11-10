import type { WikiResponse } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { WikiAlertCard } from './WikiAlertCard';

/**
 * 보안·취약점 점검은 지금 쓸 만한 결과를 내지 못해 화면에서 숨긴다 (세션 분석의 보안 절·목차, 레포 위키의 탭, 분석 문서 목록의 링크).
 * AI 생성과 저장은 그대로 두므로 다시 보이려면 이 값만 true 로 바꾸고 사용 방법 탭·docs/features.md 의 안내를 되살린다.
 */
export const SECURITY_REVIEW_VISIBLE: boolean = false;

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
      {wiki && !findings.length && <p className="card">{wiki.snapshot.generator.kind === 'pending' ? ko.security.generating : ko.security.empty}</p>}
      {wiki && findings.map((finding) => <WikiAlertCard key={finding.id} finding={finding} snapshot={wiki.snapshot} onJump={onJump} />)}

    </section>
  );
}
