import type { FileFact } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

export type FileStatus = 'created' | 'modified' | 'deleted';

interface Entry {
  fact: FileFact;
  status: FileStatus;
  name: string;
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: Entry[];
  counts: Record<FileStatus, number>;
}

const STATUS_PILL: Record<FileStatus, string> = { created: 'pill-green', modified: 'pill-blue', deleted: 'pill-red' };

function newDir(name: string): Dir {
  return { name, dirs: new Map(), files: [], counts: { created: 0, modified: 0, deleted: 0 } };
}

/** 프로젝트 기준 상대 경로로 폴더 트리를 만든다. 프로젝트 밖 파일은 따로 모은다 */
export function buildFileTree(groups: { status: FileStatus; files: FileFact[] }[]): { root: Dir; outside: Entry[] } {
  const root = newDir('');
  const outside: Entry[] = [];
  for (const { status, files } of groups) {
    for (const fact of files) {
      if (!fact.relPath) {
        outside.push({ fact, status, name: fact.path });
        continue;
      }
      const parts = fact.relPath.split('/');
      const fileName = parts.pop() ?? fact.relPath;
      let cur = root;
      cur.counts[status] += 1;
      for (const p of parts) {
        let next = cur.dirs.get(p);
        if (!next) {
          next = newDir(p);
          cur.dirs.set(p, next);
        }
        next.counts[status] += 1;
        cur = next;
      }
      cur.files.push({ fact, status, name: fileName });
    }
  }
  return { root, outside };
}

/** 하위 폴더 하나만 있는 폴더는 a/b/c 처럼 한 줄로 합친다 */
function compress(dir: Dir): Dir {
  let d = dir;
  while (d.files.length === 0 && d.dirs.size === 1) {
    const only = [...d.dirs.values()][0]!;
    d = { ...only, name: d.name ? `${d.name}/${only.name}` : only.name };
  }
  return d;
}

const total = (d: Dir) => d.counts.created + d.counts.modified + d.counts.deleted;

function Counts({ counts }: { counts: Record<FileStatus, number> }) {
  const parts = (['created', 'modified', 'deleted'] as FileStatus[]).filter((s) => counts[s] > 0).map((s) => `${ko.built.status[s]} ${counts[s]}`);
  return <span className="muted small tree-counts">{parts.join(' · ')}</span>;
}

function FileRow({ e, onJump }: { e: Entry; onJump?: (i: number) => void }) {
  return (
    <li className="tree-file">
      <span className="mono">{e.name}</span>
      <span className={`pill ${STATUS_PILL[e.status]}`}>{ko.built.status[e.status]}</span>
      {e.fact.language && <span className="pill pill-outline">{e.fact.language}</span>}
      {e.fact.via === 'shell' && <span className="pill pill-gray">{ko.built.viaShell}</span>}
      {e.fact.count > 1 && <span className="muted small">×{e.fact.count}</span>}
      {e.fact.evidence.length > 0 && (
        <details className="evidence">
          <summary>
            {ko.common.evidence} ({e.fact.evidence.length})
          </summary>
          <ul>
            {e.fact.evidence.map((ev, i) => (
              <li key={i}>
                <code>{ev.snippet}</code>
                {ev.messageIndex != null && onJump && (
                  <button className="link" onClick={() => onJump(ev.messageIndex as number)}>
                    #{ev.messageIndex}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function DirNode({ dir, depth, onJump }: { dir: Dir; depth: number; onJump?: (i: number) => void }) {
  const d = compress(dir);
  const sub = [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...d.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <li className="tree-dir">
      <details open={depth < 1 || total(d) <= 12}>
        <summary>
          <span className="mono tree-dir-name">{d.name}/</span> <Counts counts={d.counts} />
        </summary>
        <ul className="tree">
          {sub.map((s) => (
            <DirNode key={s.name} dir={s} depth={depth + 1} onJump={onJump} />
          ))}
          {files.map((f) => (
            <FileRow key={f.fact.path} e={f} onJump={onJump} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** 이 세션에서 바뀐 파일을 저장소 폴더 구조대로 보여 준다 */
export function FileTree({ created, modified, deleted, onJump }: { created: FileFact[]; modified: FileFact[]; deleted: FileFact[]; onJump?: (i: number) => void }) {
  const { root, outside } = buildFileTree([
    { status: 'created', files: created },
    { status: 'modified', files: modified },
    { status: 'deleted', files: deleted },
  ]);
  if (!total(root) && !outside.length) return null;
  const top = [...root.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="section">
      <h3>
        {ko.built.tree} <Counts counts={root.counts} />
      </h3>
      <ul className="tree tree-root">
        {top.map((d) => (
          <DirNode key={d.name} dir={d} depth={0} onJump={onJump} />
        ))}
        {[...root.files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
          <FileRow key={f.fact.path} e={f} onJump={onJump} />
        ))}
      </ul>
      {outside.length > 0 && (
        <details className="tree-outside">
          <summary className="small">
            {ko.built.outside} ({outside.length})
          </summary>
          <ul className="tree">
            {outside.map((f) => (
              <FileRow key={f.fact.path} e={f} onJump={onJump} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
