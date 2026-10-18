import { useState } from 'react';
import type { ReactNode } from 'react';
import type { BuiltSummary as Built, CommandFact, Evidence, FileFact } from '@vibe-teacher/shared';
import { FocusChip } from './FocusChip';
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

function FileTable({ title, files, onJump, fileExtra }: { title: string; files: FileFact[]; onJump?: (i: number) => void; fileExtra?: (f: FileFact) => ReactNode }) {
  if (!files.length) return null;
  return (
    <section className="section">
      <h3>
        {title} <span className="badge">{files.length}</span>
      </h3>
      <ul className="file-list">
        {files.map((f) => (
          <li key={f.path}>
            <FocusChip focus={{ kind: 'file', id: f.path }} label={f.relPath ?? f.path} className="mono file-name" />
            {f.language && <span className="pill pill-outline">{f.language}</span>}
            {f.via === 'shell' && <span className="pill pill-gray">{ko.built.viaShell}</span>}
            {f.count > 1 && <span className="muted small">×{f.count}</span>}
            {fileExtra?.(f)}
            <EvidenceList evidence={f.evidence} onJump={onJump} />
          </li>
        ))}
      </ul>
    </section>
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

/** fileExtra: 파일 줄마다 덧붙일 내용 (통합 화면에서 관련 위키 항목·개념) */
export function BuiltSummaryView({ built, onJump, fileExtra }: { built: Built; onJump?: (i: number) => void; fileExtra?: (f: FileFact) => ReactNode }) {
  const empty = !built.filesCreated.length && !built.filesModified.length && !built.filesDeleted.length && !built.commandsRun.length && !built.packagesInstalled.length;
  return (
    <div className="built">
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

      <FileTable title={ko.built.filesCreated} files={built.filesCreated} onJump={onJump} fileExtra={fileExtra} />
      <FileTable title={ko.built.filesModified} files={built.filesModified} onJump={onJump} fileExtra={fileExtra} />
      <FileTable title={ko.built.filesDeleted} files={built.filesDeleted} onJump={onJump} fileExtra={fileExtra} />
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

      {built.timeline.length > 0 && (
        <section className="section">
          <h3>{ko.built.timeline}</h3>
          <ol className="timeline">
            {built.timeline.map((g) => (
              <li key={g.promptIndex}>
                <div className="tl-prompt">
                  {onJump ? (
                    <button className="link" onClick={() => onJump(g.promptIndex)}>
                      “{g.promptText.length > 140 ? g.promptText.slice(0, 140) + '…' : g.promptText}”
                    </button>
                  ) : (
                    <span>“{g.promptText}”</span>
                  )}
                  {g.interrupted && <span className="pill pill-red">{ko.session.interrupted}</span>}
                </div>
                <div className="tl-meta muted small">
                  {ko.common.toolCalls} {g.toolCallIds.length} · 파일 {g.filesTouched.length}
                </div>
                {g.finalAssistantText && <div className="tl-answer">{g.finalAssistantText}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
