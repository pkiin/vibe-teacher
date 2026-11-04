import { useState } from 'react';
import type { BuiltSummary as Built, CommandFact, Evidence } from '@vibe-teacher/shared';
import { FileTree } from './FileTree';
import { TurnReports } from './TurnReports';
import { ko } from '../i18n/ko';

function EvidenceList({ evidence, onJump }: { evidence: Evidence[]; onJump?: (i: number) => void }) {
  if (!evidence.length) return null;
  return (
    <details className="evidence">
      <summary>
        {ko.common.evidence} ({evidence.length})
      </summary>
      <ul>
        {evidence.map((e, i) => (
          <li key={i}>
            <code>{e.snippet}</code>
            {e.messageIndex != null && onJump && (
              <button className="link" onClick={() => onJump(e.messageIndex as number)}>
                #{e.messageIndex}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CommandGroups({ commands, onJump }: { commands: CommandFact[]; onJump?: (i: number) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ install: true, git: true, test: true, run: true, build: true, scaffold: true, deploy: true });
  const groups = new Map<string, CommandFact[]>();
  for (const c of commands) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
  const order = ['scaffold', 'install', 'run', 'build', 'test', 'git', 'deploy', 'file', 'inspect', 'other'];
  return (
    <section className="section">
      <h3>
        {ko.built.commands} <span className="badge">{commands.length}</span>
      </h3>
      {order
        .filter((cat) => groups.has(cat))
        .map((cat) => {
          const list = groups.get(cat) ?? [];
          const isOpen = open[cat] ?? false;
          return (
            <div key={cat} className="cmd-group">
              <button className="cmd-group-head" onClick={() => setOpen({ ...open, [cat]: !isOpen })}>
                <span>{isOpen ? '▾' : '▸'}</span> {ko.built.category[cat] ?? cat} <span className="badge">{list.length}</span>
              </button>
              {isOpen && (
                <ul className="cmd-list">
                  {list.map((c) => (
                    <li key={c.command}>
                      <code>{c.command}</code>
                      {c.count > 1 && <span className="muted small">×{c.count}</span>}
                      {c.failed > 0 && (
                        <span className="pill pill-red">
                          {ko.built.failed} {c.failed}
                        </span>
                      )}
                      <EvidenceList evidence={c.evidence} onJump={onJump} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}

/** 만들어진 것: 요청별 작업 보고를 먼저 읽고 파일·명령·패키지·커밋 기록을 펼쳐 본다. */
export function BuiltSummaryView({ built, onJump }: { built: Built; onJump?: (i: number) => void }) {
  const rel = new Map([...built.filesCreated, ...built.filesModified, ...built.filesDeleted].map((f) => [f.path, f.relPath ?? f.path]));
  const empty = !built.filesCreated.length && !built.filesModified.length && !built.filesDeleted.length && !built.commandsRun.length && !built.packagesInstalled.length;
  return (
    <div className="built">
      <TurnReports groups={built.timeline} paths={rel} onJump={onJump} />
      <details className="card built-records">
        <summary><strong>{ko.built.activityTitle}</strong></summary>
        <p className="small muted">{ko.built.activityIntro}</p>
        <div className="stat-row">
          <div className="stat">
            <div className="stat-num">{built.filesCreated.length}</div>
            <div className="stat-label">{ko.built.filesCreated}</div>
          </div>
          <div className="stat">
            <div className="stat-num">{built.filesModified.length}</div>
            <div className="stat-label">{ko.built.filesModified}</div>
          </div>
          <div className="stat">
            <div className="stat-num">{built.packagesInstalled.length}</div>
            <div className="stat-label">{ko.built.packages}</div>
          </div>
          <div className="stat">
            <div className="stat-num">{built.gitCommits.length}</div>
            <div className="stat-label">{ko.built.commits}</div>
          </div>
          <div className="stat">
            <div className="stat-num">{built.stats.errors}</div>
            <div className="stat-label">{ko.built.errors}</div>
          </div>
          {built.stats.durationMin != null && (
            <div className="stat">
              <div className="stat-num">{built.stats.durationMin}분</div>
              <div className="stat-label">{ko.built.durationMin}</div>
            </div>
          )}
        </div>
        {empty && <div className="muted">{ko.built.nothing}</div>}

        <FileTree created={built.filesCreated} modified={built.filesModified} deleted={built.filesDeleted} onJump={onJump} />


        {built.dirsCreated.length > 0 && (
          <section className="section">
            <h3>{ko.built.dirsCreated}</h3>
            <div className="chips">
              {built.dirsCreated.map((d) => (
                <span key={d} className="chip mono">
                  {d}
                </span>
              ))}
            </div>
          </section>
        )}

        {built.packagesInstalled.length > 0 && (
          <section className="section">
            <h3>
              {ko.built.packages} <span className="badge">{built.packagesInstalled.length}</span>
            </h3>
            <div className="chips">
              {built.packagesInstalled.map((p) => (
                <span key={`${p.manager}:${p.name}`} className="chip" title={p.evidence.map((e) => e.snippet).join('\n')}>
                  <span className="muted small">{p.manager}</span> {p.name}
                  {p.dev && <span className="muted small"> (dev)</span>}
                </span>
              ))}
            </div>
          </section>
        )}

        {(built.gitCommits.length > 0 || built.gitInitialized) && (
          <section className="section">
            <h3>
              {ko.built.commits} <span className="badge">{built.gitCommits.length}</span>
            </h3>
            {built.gitInitialized && <div className="muted small">{ko.built.gitInit}</div>}
            <ul className="commit-list">
              {built.gitCommits.map((c, i) => (
                <li key={i}>
                  {c.hash && <code className="hash">{c.hash.slice(0, 7)}</code>}
                  <span>{c.message ?? '(메시지 미상)'}</span>
                  {c.pushed && <span className="pill pill-green">{ko.built.pushed}</span>}
                  <EvidenceList evidence={c.evidence} onJump={onJump} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {built.serversStarted.length > 0 && (
          <section className="section">
            <h3>{ko.built.servers}</h3>
            <ul className="cmd-list">
              {built.serversStarted.map((s) => (
                <li key={s.command}>
                  <code>{s.command}</code>
                  {s.port && <span className="pill pill-outline">:{s.port}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {built.commandsRun.length > 0 && <CommandGroups commands={built.commandsRun} onJump={onJump} />}

        {built.stack.length > 0 && (
          <section className="section">
            <h3>{ko.built.stack}</h3>
            <div className="chips">
              {built.stack.map((s) => (
                <span key={s.id} className="chip" title={s.evidence.map((e) => e.snippet).join('\n')}>
                  <span className="muted small">{ko.built.kind[s.kind]}</span> {s.name}
                </span>
              ))}
            </div>
          </section>
        )}
      </details>
    </div>
  );
}
