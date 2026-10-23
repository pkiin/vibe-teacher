import type { LearnerConceptState, LearnerProfile, Message, NormalizedSession, ToolCall } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { emptyConceptCounts } from '../../src/learner/reducer';
import { buildWikiSnapshot } from '../../src/wiki/build';
import { acceptWikiAiOutput, buildEvidencePool, mergeWikiAi, type WikiAiOutput } from '../../src/wiki/ai';
import type { LlmProvider, LlmRequest } from '../../src/llm/types';

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

/** 모델 대신 사용하는 명시적인 합성 응답. 실제 기록으로 학습 규칙을 재현하지 않는다. */
export function aiOutput(evidenceId: string): WikiAiOutput {
  const concept = (id: string, name: string) => ({ id, name, category: '설계', summary: `${name}의 정의입니다.`, explanation: `${name}을 이해하면 기능의 처리 경계를 판단할 수 있습니다.`, whyHere: '이번 작업의 접근 범위를 판단하는 데 필요합니다.', evidenceIds: [evidenceId], level: 'beginner' as const, example: null, confusions: [], deep: null, links: [] });
  return {
    concepts: [concept('authorization', '권한 검사'), concept('auth', '인증'), concept('testing', '테스트')],
    claimCandidates: [{ ref: 'new-1', statement: '제공된 세션에 작업 기록이 있습니다.', kind: 'observed_artifact', evidenceIds: [evidenceId], limits: '제공된 기록 범위' }],
    findings: [{ ref: 'check-1', category: 'security', title: '접근 범위 확인', statement: '접근 범위를 확인할 자료가 더 필요합니다.', evidenceStatus: 'needs_check', impact: 'undetermined', lifecycle: 'open', claimRefs: ['new-1'], checks: ['허용된 계정 범위를 확인해 보세요.'], conceptIds: ['authorization'], missingContext: ['권한 정책'] }],
    itemCandidates: [{ title: '누가 이 기능을 사용할 수 있나요?', question: '허용 범위는 무엇인가요?', why: '이번 작업의 접근 범위를 판단하는 데 필요합니다.', text: '관련 작업 기록이 있습니다. 이 기록만으로 전체 권한 정책을 확인할 수는 없습니다.', conceptIds: ['authorization'], claimRefs: ['new-1'], findingRefs: ['check-1'], actions: ['허용 범위를 확인해 보세요.'], unverified: ['배포 환경'], depth: 'D2' }],
    prerequisites: [{ from: 'authorization', to: 'auth' }],
  };
}

export function snapshotOf(session: NormalizedSession) {
  const base = buildWikiSnapshot({ session, built: summarizeBuilt(session), concepts: [] });
  const pool = buildEvidencePool(session, base);
  const ev = pool.find((e) => e.sourceKind === 'tool_call') ?? pool[0]!;
  const layer = acceptWikiAiOutput({ snapshot: base, pool, output: aiOutput(ev.id), result: { provider: 'claude-cli', model: 'fixture', durationMs: 1 } });
  return mergeWikiAi(base, layer).snapshot;
}

export const fakeAi: LlmProvider = {
  id: 'claude-cli', availability: async () => ({ ok: true }),
  complete: async <T,>(req: LlmRequest<T>) => {
    let data: unknown;
    if (req.schemaName === 'wiki_ai_candidates') data = aiOutput(/(ev_[a-z0-9]+)/.exec(req.user)![1]!);
    else if (req.schemaName === 'wiki_ai_texts') { const input = JSON.parse(req.user); data = { concepts: input.concepts.map((c: { id: string }) => ({ id: c.id, summary: '같은 개념의 다른 설명입니다.', explanation: 'AI가 동일한 개념을 읽는 사람에 맞춰 설명합니다.' })), narratives: input.items.map((i: { id: string }) => ({ itemId: i.id, text: '같은 프로젝트 사실을 읽는 사람 수준에 맞춰 설명합니다.' })) }; }
    else if (req.schemaName === 'concept_documentation') data = { concepts: [] };
    else if (req.schemaName === 'repo_inspect_plan') data = { questions: [] };
    else if (req.schemaName === 'concept_practice') data = { prompt: '로그인한 사용자는 모든 기능을 사용해도 됩니다.', format: 'true_false', kind: 'distinction', options: [{ id: 'o', text: 'O' }, { id: 'x', text: 'X' }], correctOptionId: 'x', explanation: '로그인 여부와 기능을 사용할 권한은 별도로 확인합니다.' };
    else if (req.schemaName === 'repo_wiki_text') {
      const source = /F:([^\s|]+)/.exec(req.user)?.[0] ?? /\bS\d+\b/.exec(req.user)?.[0] ?? 'F:README.md';
      data = { sections: [{ id: 'overview', page: 'user', title: '프로젝트 설명', paragraphs: ['제공된 자료를 읽고 작성한 AI 설명입니다.'], items: [], sources: [source], sourceBlocks: [] }, { id: 'mechanism', page: 'system', title: '실제 코드 연결', paragraphs: ['코드에 적힌 연결을 확인합니다.'], sources: [source], items: [], sourceBlocks: ['mechanism'] }], changes: [] };
    } else if (req.schemaName === 'session_enrichment') data = { summary: { title: '세션', oneLiner: '작업을 정리했습니다.', narrative: '자료를 확인했습니다.', features: [], outcome: 'partial', nextSteps: [] }, concepts: [] };
    else if (req.schemaName === 'knowledge_texts') data = { texts: [...req.user.matchAll(/--- (K\d+) ---/g)].map((m) => ({ id: m[1], text: '이번 작업과 연결된 개념입니다. 이해를 확인할 응답은 아직 없습니다.' })) };
    else throw new Error(`정의하지 않은 합성 응답: ${req.schemaName}`);
    return { data: req.schema.parse(data), provider: 'claude-cli', model: 'fixture', durationMs: 1, sources: [] };
  },
};

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
