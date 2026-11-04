import { describe, expect, it, vi } from 'vitest';
import type { EnrichmentRecord } from '@vibe-teacher/shared';
import { sessionAnalysisDocuments } from '../../src/wiki/documents';
import { caseA, snapshotOf } from './helpers';

const session = caseA();
const snapshot = snapshotOf(session);
const summary: EnrichmentRecord = { sessionKey: session.key, promptVersion: 1, provider: 'claude-cli', durationMs: 1, createdAt: '2026-11-04T00:00:00Z', data: { summary: { title: '관리자 화면 작업', oneLiner: '회원 목록을 추가했습니다.', narrative: '기록을 확인했습니다.', features: [], outcome: 'partial', nextSteps: [] }, concepts: [] } };

describe('저장된 대화 분석 문서 목록', () => {
  it('완료된 분석과 요약만 저장된 결과를 구분하고 생성 중인 빈 문서는 제외한다', async () => {
    const sessions = [session, { ...session, key: 'summary-only' }, { ...session, key: 'pending' }, { ...session, key: 'missing' }];
    const wiki = { current: vi.fn(async (_projectId: string, key: string) => key === session.key ? snapshot : key === 'pending' ? { ...snapshot, generator: { ...snapshot.generator, kind: 'pending' as const } } : null), isStale: vi.fn(() => false) };
    const enrich = { getCached: vi.fn(async (s: { key: string }) => s.key === session.key || s.key === 'summary-only' ? { ...summary, sessionKey: s.key } : null) };
    const result = await sessionAnalysisDocuments(sessions, wiki, enrich, 'junior');
    expect(result.totalSessions).toBe(4);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.find((d) => d.sessionKey === session.key)).toMatchObject({ status: 'complete', title: summary.data.summary.title, sections: ['summary', 'wiki', 'concepts', 'security'] });
    expect(result.documents.find((d) => d.sessionKey === 'summary-only')).toMatchObject({ status: 'partial', sections: ['summary'] });
    expect(enrich.getCached).toHaveBeenCalledWith(session, 'junior');
  });
  it('요약 없이 남은 분석도 유지하고 변경된 기록을 갱신 대상으로 표시한다', async () => {
    const result = await sessionAnalysisDocuments([session], { current: async () => snapshot, isStale: () => true }, { getCached: async () => null }, 'non-dev');
    expect(result.documents[0]).toMatchObject({ sessionKey: session.key, title: session.title, status: 'partial', stale: true, sections: ['wiki', 'concepts', 'security'] });
  });
});
