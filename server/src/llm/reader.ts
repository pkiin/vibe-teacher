import { DEFAULT_READER_LEVEL, type ReaderLevel } from '@vibe-teacher/shared';

/**
 * 읽는 사람 수준별 문체 지침. 모든 AI 시스템 프롬프트 끝에 붙인다 (withReader).
 * 수준이 바뀌면 프롬프트가 달라지므로 저장된 AI 문장도 수준별로 따로 둔다.
 */
const GUIDES: Record<ReaderLevel, string> = {
  'non-dev': `읽는 사람: 개발을 전혀 모르는 사람(비개발자).
- 전문 용어(API, 라우트, 엔드포인트, 의존성, 빌드, 커밋, 배포, 스키마, 미들웨어, 런타임 등)는 쓰지 말고 일상어로 풀어 씁니다. 꼭 써야 하면 처음 한 번만 괄호로 짧게 풀이합니다. 예: "API(프로그램끼리 정보를 주고받는 창구)".
- 무엇을 하는지, 왜 중요한지, 사용하는 사람에게 무엇이 달라지는지를 먼저 말하고, 어떻게 만들어졌는지는 꼭 필요할 때만 짧게 말합니다.
- 비유를 쓸 수 있지만 사실과 어긋나지 않게 합니다. 한 문장은 짧게, 한 문장에 한 가지 내용만.
- 파일 경로·명령어는 그대로 옮기되, 그것이 무엇인지 한 마디 덧붙입니다.`,
  beginner: `읽는 사람: 코딩을 배우기 시작한 사람(입문 개발자).
- 파일, 폴더, 함수, 변수, 서버, 패키지 같은 기본 용어는 그대로 써도 됩니다.
- 그보다 어려운 용어(인증·인가, 미들웨어, 마이그레이션, 비동기, 캐시 등)는 처음 나올 때 한 줄로 풀어 줍니다.
- 왜 그렇게 하는지 이유를 함께 말해 배울 수 있게 합니다.`,
  junior: `읽는 사람: 실무 경험이 조금 있는 개발자(주니어).
- 흔한 개발 용어는 설명 없이 씁니다. 이 프로젝트에서만 쓰는 개념이나 헷갈리기 쉬운 부분만 짚어 줍니다.
- 구조와 흐름, 주의할 점을 중심으로 간결하게 씁니다.`,
  senior: `읽는 사람: 숙련 개발자.
- 용어 설명과 기초 설명은 생략합니다. 구조, 설계 선택, 경계 조건, 위험을 정확하고 짧게 씁니다.
- 일반론보다 이 프로젝트에 특정한 내용을 우선합니다.`,
};

export function readerGuide(level: ReaderLevel = DEFAULT_READER_LEVEL): string {
  return GUIDES[level] ?? GUIDES[DEFAULT_READER_LEVEL];
}

/** 시스템 프롬프트에 읽는 사람 지침을 붙인다. 앞의 규칙(사실만, 근거, 형식)이 문체 지침보다 우선한다 */
export function withReader(system: string, level: ReaderLevel = DEFAULT_READER_LEVEL): string {
  return `${system}

=== 문체: 읽는 사람에 맞추기 ===
${readerGuide(level)}
(위 규칙 — 사실만 쓰기, 근거 표시, 출력 형식 — 이 문체 지침보다 우선합니다.)`;
}
