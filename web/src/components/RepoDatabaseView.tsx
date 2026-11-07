import { useContext, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { RepoDatabase, RepoDbColumn, RepoDbFeatureUse, RepoDbTable, RepoSource } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { MiniMarkdown } from './MiniMarkdown';
import { FeatureContext, SourceChips, SourceContext } from './RepoWikiView';

type FileSource = Extract<RepoSource, { kind: 'file' }>;
const label = (t: Pick<RepoDbTable, 'name' | 'schema'>) => `${t.schema ? `${t.schema}.` : ''}${t.name}`;
const at = (s: FileSource) => `${s.path}${s.startLine ? `:${s.startLine}${s.endLine && s.endLine !== s.startLine ? `–${s.endLine}` : ''}` : ''}`;
export const dbAnchor = (id: string) => `repo-db-${id}`;
/** 표가 이보다 많으면 표별 컬럼은 접어 두고 맨 위 요약 표에서 골라 펼친다 */
const OPEN_TABLES = 3;

function SourceButton({ source, children }: { source: FileSource; children?: ReactNode }) {
  const open = useContext(SourceContext);
  return (
    <button type="button" className="repo-source source-link mono" onClick={() => open(source)} title={ko.source.open(source.path)}>
      {children ?? at(source)}
    </button>
  );
}

/** 컬럼의 원문 조건 (기본 키·필수·기본값·참조·허용 값) */
function Rules({ c }: { c: RepoDbColumn }) {
  const flags = [c.primaryKey && ko.db.flags.primaryKey, c.notNull && ko.db.flags.notNull, c.unique && ko.db.flags.unique, c.relation && ko.db.flags.relation].filter((x): x is string => !!x);
  return (
    <div className="db-rules">
      {flags.map((f) => (
        <span key={f} className="pill pill-outline">{f}</span>
      ))}
      {c.default && <span>{ko.db.default} <code>{c.default}</code></span>}
      {c.references && <span>{ko.db.references} <code>{c.references}</code></span>}
      {c.check && <span>{ko.db.check} <code>{c.check}</code></span>}
    </div>
  );
}

/** 지금 위키의 주요 기능 목록에 있는 연결만 이름과 함께 돌려준다 */
function useUses(uses?: RepoDbFeatureUse[]) {
  const { projectId, features } = useContext(FeatureContext);
  const list = (uses ?? []).flatMap((u) => {
    const f = features.find((x) => x.id === u.featureId);
    return f ? [{ use: u, name: f.name, to: `/projects/${projectId}/features/${u.featureId}` }] : [];
  });
  return list;
}

/** 기능 연결이 없을 때: 코드에서 쓰는 곳이 있었는지에 따라 이유가 다르다 */
const unlinked = (t: RepoDbTable, detail: boolean) => t.usages.length ? (detail ? ko.db.noFeatureDetail : ko.db.noFeature) : (detail ? ko.db.noUsageDetail : ko.db.noUsage);

function FeaturePills({ t }: { t: RepoDbTable }) {
  const list = useUses(t.features);
  if (!list.length && t.base) return <span className="pill pill-outline" title={t.base.text}>{ko.db.base}</span>;
  if (!list.length) return <span className="small muted">{unlinked(t, false)}</span>;
  return (
    <span className="db-features">
      {list.map(({ use, name, to }) => (
        <Link key={use.featureId} className="pill pill-outline" to={to} title={use.usage ?? ko.db.codeOnly}>
          {name}
        </Link>
      ))}
    </span>
  );
}

function TableDetail({ t, open }: { t: RepoDbTable; open: boolean }) {
  const uses = useUses(t.features);
  return (
    <details className="db-table" id={dbAnchor(t.id)} open={open}>
      <summary>
        <span className="db-table-head">
          <span className="mono db-table-name">{label(t)}</span>
          <span className="pill pill-outline">{ko.db.kind[t.kind]} · {t.via}</span>
          <span className="small muted">
            {ko.db.columns(t.columns.length)}
            {uses.length > 0 && ` · ${ko.db.featureCount(uses.length)}`}
          </span>
        </span>
      </summary>
      <div className="db-table-body">
        {t.description ? <MiniMarkdown text={t.description} /> : <p className="small muted">{ko.db.noDescription}</p>}
        {t.kind === 'model' && <p className="small muted">{ko.db.modelNote}</p>}
        <h4>{ko.db.usedBy}</h4>
        {uses.length ? (
          <ul className="repo-list">
            {uses.map(({ use, name, to }) => (
              <li key={use.featureId}>
                <Link to={to}>{name}</Link>
                {use.usage ? <MiniMarkdown text={use.usage} /> : <div className="small muted">{ko.db.codeOnly}</div>}
                <SourceChips sources={use.sources} />
              </li>
            ))}
          </ul>
        ) : t.base ? (
          <div className="db-link-answer">
            <div className="small muted">{ko.db.baseDetail}</div>
            <MiniMarkdown text={t.base.text} />
            <SourceChips sources={t.base.sources} />
          </div>
        ) : (
          <>
            <p className="small muted">{unlinked(t, true)}</p>
            {t.linkAnswer && (
              <div className="db-link-answer">
                <div className="small muted">{ko.db.linkAnswer}</div>
                <MiniMarkdown text={t.linkAnswer.text} />
                <SourceChips sources={t.linkAnswer.sources} />
              </div>
            )}
          </>
        )}
        <h4>{ko.db.columnsTitle}</h4>
        {t.columns.length ? (
          <div className="repo-table-wrap">
            <table className="table repo-table db-columns">
              <thead>
                <tr>
                  <th>{ko.db.columnHead.name}</th>
                  <th>{ko.db.columnHead.type}</th>
                  <th>{ko.db.columnHead.rules}</th>
                  <th>{ko.db.columnHead.content}</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <tr key={c.name}>
                    <td>
                      <SourceButton source={c.source}>{c.name}</SourceButton>
                    </td>
                    <td className="mono">{c.type}</td>
                    <td>
                      <Rules c={c} />
                    </td>
                    <td>{c.description ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">{t.kind === 'view' ? ko.db.viewNoColumns : ko.db.noColumns}</p>
        )}
        {t.columnsLimited && <p className="small muted">{ko.db.columnsLimited}</p>}
        <div className="small db-where">
          <span className="muted">{ko.db.definedAt}</span>
          <SourceButton source={t.source} />
        </div>
        {!!t.routines?.length && (
          <div className="small db-where">
            <span className="muted">{ko.db.routines}</span>
            {t.routines.map((r, i) => (
              <SourceButton key={i} source={r.source}>{r.name}</SourceButton>
            ))}
          </div>
        )}
        {t.usages.length > 0 && (
          <div className="small db-where">
            <span className="muted">{ko.db.usedAt}</span>
            {t.usages.map((u, i) => (
              <SourceButton key={i} source={u} />
            ))}
            {t.usagesLimited && <span className="muted">{ko.db.more}</span>}
          </div>
        )}
      </div>
    </details>
  );
}

/** 레포 위키 "어떻게 동작하나요"의 데이터베이스 표: 맨 위 요약 표(표 → 저장하는 내용 → 쓰는 기능)와 표별 컬럼 */
export function DatabaseView({ db }: { db: RepoDatabase }) {
  const vias = [...new Set(db.tables.map((t) => t.via))].join(', ');
  // 요약 표에서 표 이름을 누르면 접혀 있던 그 표를 펼친 뒤 이동한다
  const reveal = (id: string) => {
    const el = document.getElementById(dbAnchor(id));
    if (el instanceof HTMLDetailsElement) el.open = true;
  };
  return (
    <div className="db-view">
      <p className="small muted">{ko.db.intro(db.tables.length, vias)}</p>
      {db.limited && <p className="small muted">{ko.db.limited}</p>}
      <div className="repo-table-wrap">
        <table className="table repo-table db-overview">
          <thead>
            <tr>
              <th>{ko.db.head.table}</th>
              <th>{ko.db.head.stores}</th>
              <th>{ko.db.head.features}</th>
            </tr>
          </thead>
          <tbody>
            {db.tables.map((t) => (
              <tr key={t.id}>
                <td>
                  <a className="mono" href={`#${dbAnchor(t.id)}`} onClick={() => reveal(t.id)}>
                    {label(t)}
                  </a>{' '}
                  <span className="small muted">{ko.db.kind[t.kind]}</span>
                </td>
                <td>{t.description ? <MiniMarkdown text={t.description} /> : <span className="muted">{ko.db.noDescription}</span>}</td>
                <td>
                  <FeaturePills t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {db.tables.map((t) => (
        <TableDetail key={t.id} t={t} open={db.tables.length <= OPEN_TABLES} />
      ))}
    </div>
  );
}
