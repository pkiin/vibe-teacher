import { describe, expect, it } from 'vitest';
import { cleanCodexUserText, isCodexSubagentSession } from '../../src/adapters/codex/classify';

describe('Codex 사람 입력 구분', () => {
  it.each([
    ['일반 요청', '로그인 화면을 고쳐줘', '로그인 화면을 고쳐줘'],
    ['IDE 문맥', '# Context from my IDE setup:\n\n## Active file: app.ts\n\n## Open tabs:\n- app.ts\n\n## My request:\n로그인 화면을 고쳐줘', '로그인 화면을 고쳐줘'],
    ['IDE 문맥만 있는 메시지', '# Context from my IDE setup:\n## Active file: app.ts', ''],
    ['환경 정보', '<environment_context>\n<cwd>/workspace/demo</cwd>\n</environment_context>', ''],
    ['환경 정보 뒤 요청', '<environment_context>\n자동 문맥\n</environment_context>\n버튼도 고쳐줘', '버튼도 고쳐줘'],
    ['저장소 지침', '# AGENTS.md instructions for /workspace/demo\n\n<INSTRUCTIONS>\n자동으로 붙은 작업 규칙\n</INSTRUCTIONS>', ''],
    ['지침 뒤 요청', '# AGENTS.md instructions for /workspace/demo\n\n<INSTRUCTIONS>작업 규칙</INSTRUCTIONS>\n버튼도 고쳐줘', '버튼도 고쳐줘'],
    ['사용자 설정', '<user_instructions>작업 규칙</user_instructions>\n테스트를 실행해줘', '테스트를 실행해줘'],
    ['권한 정보', '<permissions instructions>읽기 전용</permissions instructions>', ''],
    ['권한 정보의 다른 표기', '<permissions_instructions>읽기 전용</permissions_instructions>', ''],
    ['자동 앱 문맥', '<external_codex_apps_open_page>페이지 정보</external_codex_apps_open_page>', ''],
    ['하위 에이전트 알림', '<subagent_notification>검토 결과</subagent_notification>', ''],
    ['중단 알림', '<turn_aborted>실행 중단 안내</turn_aborted>', ''],
    ['미완성 자동 문맥', '<environment_context>\n아직 기록 중인 문맥', ''],
    ['본문의 태그 설명', '이 <environment_context>예시</environment_context>를 설명해줘', '이 <environment_context>예시</environment_context>를 설명해줘'],
    ['인라인 코드', '`<environment_context>예시</environment_context>`를 설명해줘', '`<environment_context>예시</environment_context>`를 설명해줘'],
    ['코드 블록', '이 예시를 설명해줘\n```xml\n<environment_context>예시</environment_context>\n```', '이 예시를 설명해줘\n```xml\n<environment_context>예시</environment_context>\n```'],
    ['물결 코드 블록', '~~~xml\n<user_instructions>예시</user_instructions>\n~~~', '~~~xml\n<user_instructions>예시</user_instructions>\n~~~'],
    ['일반 AGENTS 문서 제목', '# AGENTS.md instructions for /workspace/demo\n이 문서를 설명해줘', '# AGENTS.md instructions for /workspace/demo\n이 문서를 설명해줘'],
    ['알 수 없는 태그', '<example>직접 작성한 내용</example>', '<example>직접 작성한 내용</example>'],
  ])('%s', (_label, raw, expected) => {
    expect(cleanCodexUserText(raw)).toBe(expected);
  });

  it('여러 내용 조각으로 나뉜 자동 문맥 뒤의 실제 요청을 남긴다', () => {
    const raw = '<user_instructions>\n규칙\n</user_instructions>\n<environment_context>문맥</environment_context>\n# Context from my IDE setup:\n## Open tabs:\n- app.ts\n## My request:\n첫 요청\n\n## My request:\n직접 쓴 두 번째 제목';
    expect(cleanCodexUserText(raw)).toBe('첫 요청\n\n## My request:\n직접 쓴 두 번째 제목');
  });

  it.each([
    [{ source: { subagent: { other: 'guardian' } } }, true],
    [{ source: { subagent: { thread_spawn: { depth: 1 } } } }, true],
    [{ source: 'subagent' }, true],
    [{ source: 'vscode', parent_thread_id: 'parent-demo' }, true],
    [{ source: 'vscode' }, false],
    [{ source: 'cli' }, false],
    [{ source: 'exec' }, false],
    [{ parent_thread_id: null }, false],
    [{}, false],
  ])('세션 메타데이터로 위임 여부를 판단한다: %j', (meta, expected) => {
    expect(isCodexSubagentSession(meta)).toBe(expected);
  });
});
