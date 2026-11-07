import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { REPO_FEATURE_LIMITS, type RepoDbTable, type RepoFeature, type RepoFeatureResponse } from '@vibe-teacher/shared';
import { DatabaseView } from '../src/components/RepoDatabaseView';
import { RepoFeatureView } from '../src/components/RepoFeatureView';
import { Block, FeatureCards, FeatureContext, TABLE_FOLD_ROWS } from '../src/components/RepoWikiView';

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const file = (path: string, startLine: number) => ({ kind: 'file' as const, path, startLine, endLine: startLine });
const feature: RepoFeature = { id: 'members', name: '회원 관리', summary: '회원을 승인합니다.', files: [file('src/members.ts', 1)], sessions: [], sources: [],
  tables: [{ id: 'members', name: 'public.members', kind: 'table', usage: '승인 여부를 바꿉니다.', columns: ['id', 'approved'], source: file('db/schema.sql', 1) }] };
const table = (id: string, extra: Partial<RepoDbTable> = {}): RepoDbTable => ({
  id, name: id, schema: 'public', kind: 'table', via: 'SQL', source: file('db/schema.sql', 1), usages: [file('src/members.ts', 3)],
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true, references: 'auth.users(id)', source: file('db/schema.sql', 2) },
    { name: 'approved', type: 'boolean', notNull: true, default: 'false', check: '<b>x</b>', source: file('db/schema.sql', 3), description: '관리자가 승인했는지 (true/false)' },
  ],
  ...extra,
});
const withFeatures = (el: ReactElement) => createElement(FeatureContext.Provider, { value: { projectId: 'p1', features: [feature] } }, el);

describe('레포 위키 표 접기', () => {
  it('줄이 많은 API 목록은 접어 두고 경로 수를 보여 주며, 짧은 표는 그대로 펼친다', () => {
    const rows = Array.from({ length: TABLE_FOLD_ROWS + 1 }, (_, i) => ['GET', `/api/x${i}`, '설명', 'server/app.ts']);
    const long = render(createElement(Block, { b: { kind: 'table', head: ['방식', '경로', '동작 설명', '파일'], rows, role: 'api' } }));
    expect(long).toContain('<details class="repo-fold"><summary>API 목록 보기 (경로 9개)</summary>');
    expect(long).not.toContain('<details class="repo-fold" open');
    const short = render(createElement(Block, { b: { kind: 'table', head: ['방식', '경로'], rows: rows.slice(0, TABLE_FOLD_ROWS) } }));
    expect(short).not.toContain('<details');
    const scripts = render(createElement(Block, { b: { kind: 'table', head: ['스크립트', '명령'], rows: rows.map((r) => r.slice(0, 2)), role: 'scripts' } }));
    expect(scripts).toContain('스크립트 목록 보기 (9개)');
    // 업데이트 전에 저장된 예전 위키(role 없음)도 API 목록으로 알아본다
    const old = render(createElement(Block, { b: { kind: 'table', head: ['방식', '경로', '동작 설명', '파일'], rows } }));
    expect(old).toContain('API 목록 보기 (경로 9개)');
  });
});

describe('데이터베이스 표 보기', () => {
  it('요약 표에 저장하는 내용과 쓰는 주요 기능 링크를, 표별로 컬럼·조건·들어가는 내용을 보여 준다', () => {
    const html = render(withFeatures(createElement(DatabaseView, { db: { limited: false, tables: [table('members', {
      description: '회원 승인 상태를 저장합니다.', features: [{ featureId: 'members', usage: '승인 여부를 바꿉니다.', sources: [file('src/members.ts', 3)] }, { featureId: 'gone', usage: '목록에 없는 기능', sources: [] }],
    })] } })));
    expect(html).toContain('코드에서 읽은 데이터베이스 표 1개입니다 (SQL)');
    expect(html).toContain('<a class="mono" href="#repo-db-members">public.members</a>');
    expect(html).toContain('회원 승인 상태를 저장합니다.');
    expect(html).toContain('href="/projects/p1/features/members"');
    expect(html).not.toContain('목록에 없는 기능');
    expect(html).toContain('<details class="db-table" id="repo-db-members" open="">');
    expect(html).toContain('기본 키');
    expect(html).toContain('참조 <code>auth.users(id)</code>');
    expect(html).toContain('기본값 <code>false</code>');
    expect(html).toContain('관리자가 승인했는지 (true/false)');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('src/members.ts:3');
  });

  it('표가 많으면 표별 컬럼은 접어 두고, 설명·기능 연결이 없으면 그 사실을 보여 준다', () => {
    const html = render(withFeatures(createElement(DatabaseView, { db: { limited: true, tables: ['a', 'b', 'c', 'd'].map((id) => table(id, { kind: id === 'd' ? 'model' : 'table' })) } })));
    expect(html).not.toContain('open=""');
    expect(html).toContain('표나 파일이 많아 일부만 읽었습니다.');
    expect(html).toContain('설명을 만들지 못했습니다.');
    expect(html).toContain('연결된 주요 기능을 찾지 못했습니다.');
    expect(html).toContain('실제 표 이름은 프레임워크가 정합니다.');
    expect(html).toContain('코드에서 이 표를 쓰는 곳은 있지만 주요 기능과 잇지 못했습니다.');
  });

  it('코드에서 쓰는 곳이 없는 표는 그 이유를 따로 알리고, 표를 쓰는 SQL 함수를 보여 준다', () => {
    const html = render(withFeatures(createElement(DatabaseView, { db: { limited: false, tables: [
      table('unused', { usages: [] }),
      table('locks', { routines: [{ name: 'vt_lock', source: file('db/schema.sql', 9) }] }),
    ] } })));
    expect(html).toContain('코드에서 쓰는 곳을 찾지 못했습니다.');
    expect(html).toContain('코드에서 이 표를 쓰는 곳을 찾지 못해 주요 기능과 잇지 못했습니다.');
    expect(html).toContain('SQL 함수:');
    expect(html).toMatch(/title="[^"]*db\/schema\.sql[^"]*">vt_lock<\/button>/);
  });

  it('주요 기능과 잇지 못한 표에는 "어느 기능과 관계가 있나요?"에 AI가 답한 내용을 보여 준다', () => {
    const answer = { text: '모든 저장이 거치는 잠금이라 특정 기능에 속하지 않습니다.', sources: [file('src/storage.ts', 190)] };
    const html = render(withFeatures(createElement(DatabaseView, { db: { limited: false, tables: [table('locks', { linkAnswer: answer })] } })));
    expect(html).toContain('AI에게 &quot;이 표는 주요 기능 중 무엇과 관계가 있나요?&quot;라고 물어본 답:');
    expect(html).toContain('모든 저장이 거치는 잠금이라 특정 기능에 속하지 않습니다.');
    expect(html).toContain('src/storage.ts:190');
    // 기능과 이어진 표에는 답을 따로 보이지 않는다
    const linked = render(withFeatures(createElement(DatabaseView, { db: { limited: false, tables: [table('members', { linkAnswer: answer, features: [{ featureId: 'members', sources: [] }] })] } })));
    expect(linked).not.toContain('물어본 답');
  });

  it('공통 기반에서만 쓰는 표는 요약 표에 공통 기반으로, 상세에 그 이유와 근거를 보여 주고 "잇지 못했다"고 하지 않는다', () => {
    const base = { text: '회원 로그인과 승인 확인에 쓰는 공통 기반입니다.', sources: [file('src/auth.ts', 12)] };
    const html = render(withFeatures(createElement(DatabaseView, { db: { limited: false, tables: [table('members', { base, linkAnswer: { text: '보이지 않아야 할 답', sources: [] } })] } })));
    expect(html).toContain('title="회원 로그인과 승인 확인에 쓰는 공통 기반입니다.">공통 기반</span>');
    expect(html).toContain('주요 기능이 아니라 여러 기능을 받치는 공통 기반');
    expect(html).toContain('src/auth.ts:12');
    expect(html).not.toContain('잇지 못했습니다');
    expect(html).not.toContain('보이지 않아야 할 답');
  });

  it('주요 기능 카드와 기능 페이지에 그 기능이 쓰는 표를 보여 준다', () => {
    expect(render(createElement(FeatureCards, { projectId: 'p1', features: [feature] }))).toContain('데이터베이스 표 1개');
    const response: RepoFeatureResponse = { feature, page: null, stale: false, staleReasons: [], limits: REPO_FEATURE_LIMITS };
    const page = render(createElement(RepoFeatureView, { data: response }));
    expect(page).toContain('이 기능이 쓰는 데이터베이스 표');
    expect(page).toContain('public.members');
    expect(page).toContain('승인 여부를 바꿉니다.');
    expect(page).toContain('컬럼: id, approved');
  });
});
