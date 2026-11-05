import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMeResponse, EnrichmentRecord, KnowledgeSource, ReaderLevel } from '@vibe-teacher/shared';
import { UnifiedAiPanel } from '../src/components/UnifiedAiPanel';
import { SessionAnalysisTree } from '../src/components/SessionAnalysisTree';
import { KnowledgeSourceLinks } from '../src/components/KnowledgeList';
import { ko } from '../src/i18n/ko';

const auth = vi.hoisted(() => ({ me: null as AuthMeResponse | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ me: auth.me, refresh: vi.fn() }) }));
vi.mock('../src/components/LlmProviderPicker', () => ({ LlmQuickSwitch: () => '지금 쓰는 AI: 테스트 제공자 · 바꾸기' }));
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const enrichment: EnrichmentRecord = {
  sessionKey: 's1', provider: 'claude-cli', model: 'fixture-private-model', promptVersion: 1, readerLevel: 'non-dev', createdAt: '2026-11-04T00:00:00Z', durationMs: 33000, costUsd: 0.108,
  data: { summary: { title: '로그인 기능', oneLiner: '로그인을 추가했습니다.', narrative: '로그인 처리를 추가했습니다.', features: [], outcome: 'partial', nextSteps: [] }, concepts: [] },
};
beforeEach(() => {
  auth.me = { mode: 'supabase', authenticated: true, isAdmin: false, canEnrich: true, tokenRequired: false, serviceUser: 'tester', llmStatus: { available: true, resolvedProvider: 'claude-cli' }, autoText: true, reader: { readerLevel: 'non-dev', chosen: true } };
});

describe('세션 분석의 기술 정보 표시', () => {
  const panel = () => render(createElement(UnifiedAiPanel, { sessionKey: 's1', wiki: null, enrichment, onEnrichment: () => {}, onWikiUpdated: () => {} }));
  it.each<ReaderLevel>(['non-dev', 'beginner'])('%s 일반 사용자에게 분석 안내와 결과를 보여 주고 모델·요금·전송 상세를 숨긴다', (level) => {
    auth.me!.reader = { readerLevel: level, chosen: true };
    auth.me!.canManageInstallation = true;
    const html = panel();
    expect(html).toContain(ko.aiUnified.intro);
    expect(html).toContain(ko.aiUnified.rerun);
    expect(html).toContain(ko.analysis.saved);
    for (const text of [ko.sources.llmCurrent, ko.aiUnified.notice, ko.aiUnified.preview, enrichment.model!, '$0.108']) expect(html).not.toContain(text);
  });
  it.each<ReaderLevel>(['junior', 'senior'])('%s 사용자에게 전송 내용·모델·요금을 보여 주고 관리자 설정 변경은 제공하지 않는다', (level) => {
    auth.me!.reader = { readerLevel: level, chosen: true };
    const html = panel();
    for (const text of [ko.sources.llmCurrent, ko.aiUnified.notice, ko.aiUnified.preview, enrichment.model!, '$0.108']) expect(html).toContain(text);
    expect(html).not.toContain('테스트 제공자 · 바꾸기');
  });
  it('관리자는 쉬운 난이도에서도 상세 정보와 AI 변경을 볼 수 있다', () => {
    // 서버는 설치 관리자인 관리자에게 canManageInstallation 을 함께 보낸다.
    auth.me!.isAdmin = true;
    auth.me!.canManageInstallation = true;
    const html = panel();
    expect(html).toContain('테스트 제공자 · 바꾸기');
    expect(html).toContain(ko.aiUnified.preview);
    expect(html).toContain('$0.108');
  });
  it('SSH 터널 서버에 다른 계정으로 접속한 관리자는 상세 정보만 보고 AI 설정은 바꾸지 못한다', () => {
    auth.me!.isAdmin = true;
    auth.me!.canManageInstallation = false;
    const html = panel();
    expect(html).toContain(ko.aiUnified.preview);
    expect(html).not.toContain('테스트 제공자 · 바꾸기');
  });
  it('난이도를 아직 선택하지 않았으면 기술 정보를 숨긴다', () => {
    auth.me!.reader = { readerLevel: 'junior', chosen: false };
    expect(panel()).not.toContain(ko.aiUnified.preview);
  });
});

describe('위키 문서 연결', () => {
  it('프로젝트 문서 트리에서 분석 문서와 하위 절을 고정 주소로 연다', () => {
    const html = render(createElement(SessionAnalysisTree, { projectId: 'p1', data: { totalSessions: 2, documents: [{ sessionKey: 'claude:s/1', title: '로그인 추가', createdAt: enrichment.createdAt, status: 'complete', stale: false, sections: ['summary', 'wiki', 'concepts', 'security'] }] } }));
    for (const section of ['', '#summary', '#wiki', '#concepts', '#security']) expect(html).toContain(`href="/sessions/claude%3As%2F1/analysis${section}"`);
    expect(html).toContain('href="/projects/p1?tab=sessions"');
    expect(html).toContain('<ul>');
  });
  it('분석 문서가 없을 때 대화 목록으로 연결한다', () => {
    const html = render(createElement(SessionAnalysisTree, { projectId: 'p1', data: { totalSessions: 4, documents: [] } }));
    expect(html).toContain(ko.analysis.empty);
    expect(html).toContain('href="/projects/p1?tab=sessions"');
  });
  it('지식 개념에서 분석 문서의 개념과 프로젝트 위키로 연결하며 네 번째 이후 출처도 열 수 있다', () => {
    const sources: KnowledgeSource[] = Array.from({ length: 5 }, (_, i) => ({ sessionKey: `s${i}`, sessionTitle: `작업 ${i}`, projectId: 'p1', projectName: '예제 앱', via: 'concept_hit' }));
    const html = render(createElement(KnowledgeSourceLinks, { conceptId: 'auth', sources: [...sources, sources[0]!] }));
    for (let i = 0; i < 5; i++) expect(html).toContain(`href="/sessions/s${i}/analysis#concept-auth"`);
    expect(html).toContain('href="/projects/p1?tab=wiki"');
    expect(html).toContain(ko.analysis.moreSources(2));
    expect(html.match(/href="\/sessions\/s0\/analysis/g)).toHaveLength(1);
  });
});
