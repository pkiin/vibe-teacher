import { describe, expect, it } from 'vitest';
import { buildTurnGroups } from '../../src/analyzers/turn-groups';
import { fakeSession } from '../wiki/helpers';

describe('요청별 작업 결과 답변', () => {
  it('긴 보고의 마지막 줄과 마크다운을 잘라 내지 않고 원문과 위치를 보존한다', () => {
    const report = '# 작업 결과\n\n' + '- 구현한 기능과 확인 사항\n'.repeat(500) + '\n마지막 줄도 그대로 보존합니다.';
    const session = fakeSession([{ human: '기능을 추가해 줘' }, { write: 'src/app.ts' }, { assistant: report }]);
    const [group] = buildTurnGroups(session);
    expect(report.length).toBeGreaterThan(4000);
    expect(group?.finalAssistantText).toBe(report);
    expect(group?.finalAssistantIndex).toBe(2);
    expect(group?.finalAssistantAt).toBe(session.messages[2]?.timestamp);
  });

  it('최종 답변 뒤에 진행 알림이 있더라도 최종 답변을 선택하고 하위 에이전트는 제외한다', () => {
    const session = fakeSession([{ human: '수정해 줘' }, { assistant: '최종 작업 결과' }, { assistant: '추가 알림' }, { assistant: '하위 에이전트 완료' }]);
    session.messages[1]!.meta = { phase: 'final_answer' };
    session.messages[2]!.meta = { phase: 'commentary' };
    session.messages[3]!.meta = { subagentId: 'child-1', phase: 'final_answer' };
    expect(buildTurnGroups(session)[0]?.finalAssistantText).toBe('최종 작업 결과');
  });

  it('도구를 실행하기 전의 진행 메시지를 작업 결과로 표시하지 않는다', () => {
    const session = fakeSession([{ human: '수정해 줘' }, { assistant: '파일을 확인하겠습니다.' }, { write: 'src/app.ts' }]);
    expect(buildTurnGroups(session)[0]?.finalAssistantText).toBeUndefined();
    session.messages[1]!.meta = { phase: 'commentary' };
    expect(buildTurnGroups(session)[0]?.finalAssistantText).toBeUndefined();
  });

  it('여러 요청의 답변을 섞지 않고 마지막 답변이 없는 요청도 보존한다', () => {
    const session = fakeSession([{ human: '첫 요청' }, { assistant: '첫 결과' }, { human: '둘째 요청' }, { assistant: '진행 중' }]);
    session.messages[3]!.meta = { phase: 'commentary' };
    const groups = buildTurnGroups(session);
    expect(groups.map((group) => [group.promptText, group.finalAssistantText])).toEqual([['첫 요청', '첫 결과'], ['둘째 요청', undefined]]);
  });
});
