import type { LearnerConceptState, LearnerProfile, Message, NormalizedSession, ToolCall } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { detectConcepts } from '../../src/analyzers/concepts/index';
import { emptyConceptCounts } from '../../src/learner/reducer';
import { buildWikiSnapshot } from '../../src/wiki/build';
import { loadWikiCatalog } from '../../src/wiki/catalog';

export const ROOT = '/home/tester/app';

type Step =
  | { human: string }
  | { assistant: string }
  | { write: string; edit?: boolean }
  | { shell: string; stdout?: string; stderr?: string; ok?: boolean };

/** 개발용 합성 세션 (실제 사용자 기록이 아님). 단계 순서대로 메시지와 도구 호출을 만든다. */
export function fakeSession(steps: Step[], over: Partial<NormalizedSession> = {}): NormalizedSession {
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  steps.forEach((s, i) => {
    const index = messages.length;
    const timestamp = `2026-10-18T09:${String(i).padStart(2, '0')}:00.000Z`;
    if ('human' in s) messages.push({ id: `m${index}`, index, role: 'human', text: s.human, timestamp });
    else if ('assistant' in s) messages.push({ id: `m${index}`, index, role: 'assistant', text: s.assistant, timestamp });
    else {
      const id = `tc${toolCalls.length}`;
      let tc: ToolCall;
      if ('write' in s) {
        const filePath = `${ROOT}/${s.write}`;
        tc = {
          id,
          name: s.edit ? 'Edit' : 'Write',
          category: s.edit ? 'file_edit' : 'file_write',
          paths: [filePath],
          input: { file_path: filePath },
          result: { ok: true, summary: 'ok', structured: { kind: s.edit ? 'update' : 'create', filePath } },
          messageIndex: index,
          timestamp,
        };
      } else {
        tc = {
          id,
          name: 'Bash',
          category: 'shell',
          command: s.shell,
          paths: [],
          input: { command: s.shell },
          result: { ok: s.ok ?? true, summary: s.stdout ?? '', structured: { stdout: s.stdout ?? '', stderr: s.stderr ?? '' } },
          messageIndex: index,
          timestamp,
        };
      }
      toolCalls.push(tc);
      messages.push({ id: `m${index}`, index, role: 'tool_use', toolCall: tc, timestamp });
    }
  });
  return {
    key: over.key ?? 'sess-key',
    accountId: 'acc',
    provider: 'claude-code',
    sourceId: 'src',
    projectId: 'proj01',
    projectRoot: ROOT,
    sessionId: 'sess',
    title: 't',
    filePath: '/x.jsonl',
    fileSize: 100,
    fileMtime: 1,
    counts: { human: messages.filter((m) => m.role === 'human').length, assistant: 0, toolCalls: toolCalls.length, slashCommands: 0, subagents: 0 },
    models: [],
    messages,
    toolCalls,
    parseWarnings: [],
    ...over,
  };
}

export function snapshotOf(session: NormalizedSession) {
  const catalog = loadWikiCatalog();
  const built = summarizeBuilt(session, '/home/tester');
  const concepts = detectConcepts(session, built);
  return buildWikiSnapshot({ session, built, concepts, catalogVersion: catalog.version, conceptIds: new Set(catalog.concepts.keys()), now: new Date('2026-10-18T10:00:00Z') });
}

/** 통제된 프로필 입력 (plan §14 의 "프로필 입력" — 실제 사람의 추정이 아님) */
export function profileWith(states: Record<string, Partial<LearnerConceptState>>, revision = 1): LearnerProfile {
  const concepts: Record<string, LearnerConceptState> = {};
  for (const [conceptId, s] of Object.entries(states)) concepts[conceptId] = { conceptId, state: 'unknown', evidenceIds: [], counts: emptyConceptCounts(), disputed: false, ...s };
  return { schemaVersion: 1, learnerId: 'l_fixture', projectId: 'proj01', revision, policyVersion: 'policy-0.1', concepts };
}

/** 사례 A: 관리자 화면 추가 (테스트는 변경 뒤 실행, 배포 설정 없음) */
export const caseA = () =>
  fakeSession([
    { human: '관리자 화면을 추가해 줘. 회원 목록을 볼 수 있게.' },
    { write: 'src/routes/admin.ts' },
    { write: 'src/server.ts', edit: true },
    { shell: 'npm test', stdout: 'Tests  3 passed (3)' },
    { assistant: '관리자 화면을 구현했습니다. 테스트도 모두 통과했습니다.' },
  ]);

/** 사례 B: 화면에서 항목이 사라짐 — UI 변경만 있고 저장소·서버 로그 없음 */
export const caseB = () =>
  fakeSession([
    { human: '할 일을 추가하고 새로고침하면 사라져요. 고쳐 주세요.' },
    { write: 'src/components/TodoList.tsx', edit: true },
    { assistant: '수정했습니다. 이제 완료되었습니다.' },
  ]);
