import type { KnowledgeEntry } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

/** 대시보드 숫자. 상태는 카드 배지와 같은 기준이고, 오답 수는 세지 않는다 */
export function knowledgeStats(entries: readonly KnowledgeEntry[]) {
  let demonstrated = 0, partial = 0, solved = 0, untried = 0;
  for (const e of entries) {
    const s = e.state, c = s.counts;
    if (!s.disputed && s.state === 'demonstrated') demonstrated += 1;
    else if (!s.disputed && s.state === 'partial') partial += 1;
    solved += c.correct + (c.practiceCorrect ?? 0);
    if (c.correct + c.incorrect + c.practice + c.dontKnow + c.skipped === 0) untried += 1;
  }
  return { total: entries.length, learned: demonstrated + partial, demonstrated, partial, solved, untried };
}

function StatTile({ label, value, unit, note }: { label: string; value: number; unit: string; note?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value.toLocaleString('ko-KR')}<span className="stat-unit">{unit}</span></span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

/**
 * 내 지식 상단 대시보드: 알게 된 개념·맞힌 문제·아직 안 풀어 본 개념과 알게 된 개념 막대.
 * 맞힌 것을 먼저 보여 줘 성취감을 주고, 아직 안 푼 개념은 문제 풀기로 이어지게 안내한다.
 * 내가 한 질문·푼 문제는 아래 "내 기억 검색"에서 다시 본다.
 */
export function KnowledgeDashboard({ entries }: { entries: readonly KnowledgeEntry[] }) {
  const st = knowledgeStats(entries);
  const d = ko.knowledge.dashboard;
  const pct = st.total ? Math.round((st.learned / st.total) * 100) : 0;
  return (
    <section className="knowledge-dashboard" aria-label={d.title}>
      <div className="stat-row">
        <StatTile label={d.learned} value={st.learned} unit={d.conceptUnit} note={d.learnedNote(st.demonstrated, st.partial)} />
        <StatTile label={d.solved} value={st.solved} unit={d.timesUnit} />
        <StatTile label={d.untried} value={st.untried} unit={d.conceptUnit} {...(st.untried ? { note: d.untriedNote } : {})} />
      </div>
      {st.total > 0 && (
        <div className="learned-meter">
          <div className="meter" role="progressbar" aria-label={d.meterLabel} aria-valuemin={0} aria-valuemax={st.total} aria-valuenow={st.learned} aria-valuetext={d.progress(st.learned, st.total)}>
            {st.learned > 0 && <span className="meter-fill" style={{ width: `${Math.max(pct, 2)}%` }} />}
          </div>
          <p className="small">{d.progress(st.learned, st.total)}</p>
        </div>
      )}
    </section>
  );
}
