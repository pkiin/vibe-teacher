import type { TurnGroup } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { MiniMarkdown } from './MiniMarkdown';
import { fmtDate } from './Notice';

/** 요청과 그 작업 뒤의 답변 원문. 가장 최근 보고는 처음부터 펼쳐 읽는다. */
export function TurnReports({ groups, paths, onJump }: { groups: TurnGroup[]; paths: ReadonlyMap<string, string>; onJump?: (index: number) => void }) {
  const latestReport = [...groups].reverse().find((group) => group.finalAssistantText?.trim());
  const latestTurn = groups.at(-1);
  return <section className="section turn-reports" aria-labelledby="turn-reports-title">
    <h2 id="turn-reports-title">{ko.built.reports}</h2>
    <p className="muted">{ko.built.reportsIntro}</p>
    {!groups.length && <p className="muted">{ko.built.noReports}</p>}
    {[...groups].reverse().map((group, index) => <details key={group.promptIndex} className="turn-report" open={group === latestReport || (group === latestTurn && !group.finalAssistantText)}>
      <summary>
        <span className="turn-report-heading">
          <strong>{ko.built.requestNumber(groups.length - index)}</strong>
          {group === latestReport && <span className="pill pill-blue">{ko.built.latestReport}</span>}
          {group.interrupted && <span className="pill pill-red">{ko.session.interrupted}</span>}
          {!group.finalAssistantText && <span className="pill pill-gray">{ko.built.noReportYet}</span>}
          <span className="small muted">{fmtDate(group.finalAssistantAt ?? group.endedAt ?? group.startedAt)}</span>
        </span>
        <span className="report-request-preview">{group.promptText}</span>
      </summary>
      <div className="turn-report-body">
        <div className="report-request">
          <div className="row-between"><h3>{ko.built.myRequest}</h3>{onJump && <button className="link small" onClick={() => onJump(group.promptIndex)}>{ko.built.openRequest}</button>}</div>
          <div className="report-request-text">{group.promptText}</div>
        </div>
        <div className="agent-report">
          <h3>{ko.built.agentReport} <span className="pill pill-outline">{ko.built.original}</span></h3>
          {group.finalAssistantText ? <>
            <MiniMarkdown text={group.finalAssistantText} />
            <details className="report-plain"><summary className="small muted">{ko.built.plainReport}</summary><pre>{group.finalAssistantText}</pre></details>
          </> : <p className="muted">{group.interrupted ? ko.built.interruptedReport : ko.built.pendingReport}</p>}
        </div>
        {(group.filesTouched.length > 0 || group.toolCallIds.length > 0) && <details className="report-records">
          <summary className="small">{ko.built.relatedActivity(group.filesTouched.length, group.toolCallIds.length)}</summary>
          {group.filesTouched.length > 0 && <ul className="small">{group.filesTouched.map((file) => <li key={file}><code>{paths.get(file) ?? file}</code></li>)}</ul>}
        </details>}
      </div>
    </details>)}
  </section>;
}
