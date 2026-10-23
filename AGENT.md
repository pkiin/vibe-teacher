# AGENT.md

이 저장소에서 일하는 AI 코딩 에이전트(Claude Code, Codex, Copilot 등)를 위한 작업 지침입니다.
사람이 읽는 사용 설명서는 [README.md](README.md) 이고, 이 문서는 **코드를 바꾸는 쪽**을 위한 규칙입니다.

## 1. 매 작업 끝에 반드시 할 일

작업(기능 추가, 버그 수정, 리팩터링, 설정 변경)을 마칠 때마다 아래를 순서대로 확인합니다.

1. **README.md 갱신** — 아래 2절 표를 보고 해당하는 부분을 고칩니다. 바뀐 게 없으면 그대로 두되, *확인은 매번* 합니다.
2. **AGENT.md 갱신** — 새 규칙, 새 디렉터리, 새 레시피가 생겼으면 이 문서에도 반영합니다.
3. `npm run typecheck` 통과
4. `npm test` 통과 (버그 수정이면 회귀 테스트를 함께 추가)
5. 사용자에게 무엇을 바꿨고 README 의 어느 절을 고쳤는지 짧게 보고합니다.

커밋과 푸시는 사용자가 요청할 때만 합니다.

## 2. README.md 갱신 기준

README 는 한국어로, 사용자가 **그대로 복사해 실행할 수 있는** 명령과 예시 위주로 씁니다. 코드와 README 가 어긋나면 README 가 틀린 것으로 보고 고칩니다.

| 이런 걸 바꿨다면 | README 에서 고칠 곳 |
|---|---|
| 환경변수 추가·삭제·기본값 변경 | "포트와 주소 지정" 표, 해당 기능 절 |
| CLI 인자 (`scripts/dev.mjs`, `server/src/config/env.ts`) | "포트와 주소 지정" 예시 블록 (`dev.mjs` 의 `usage()` 도 같이) |
| 설정 파일 필드 (`server/src/config/schema.ts`) | "설정 파일" JSON 예시와 설명 목록 |
| 새 어댑터 / 기본 경로 변경 | "읽는 위치 (기본값)" 표, 첫 문단의 지원 도구 목록 |
| AI 제공자·모델·전송 범위, AI 가 쓰는 문장과 규칙 대체 조건 | "AI 제공자와 외부 문서 검색" 표와 설명 |
| 로그인·권한·바인딩 규칙 | "로그인", "원격 접근", "다중 계정 운영" 절 |
| `scripts/grant-read-acl.sh` | "다중 계정 운영" 명령 블록 |
| npm 스크립트 추가·변경 | "빠른 시작", 검사와 테스트 블록 |
| 디렉터리 구조 변경 | "구조" 절 |
| 사용자 눈에 보이는 새 기능 | 첫 문단 요약 불릿 또는 새 절 |

README 에 쓰지 않는 것: 내부 구현 세부, 작업 로그, 변경 이력(그건 커밋 메시지에), 실제 사용자명·경로·토큰.

## 3. 프로젝트 한눈에 보기

AI 코딩 도구(Claude Code, Codex CLI, Copilot CLI, VS Code Copilot Chat)의 **로컬 채팅 기록을 읽기만 하는** 웹 앱입니다.
계정(홈 디렉터리) › 프로젝트(작업 폴더) › 세션 계층으로 보여 주고, 세션마다 "내 메시지 / 만들어진 것 / 알아야 할 개념"을 정리합니다.

npm workspaces 모노레포:

```
shared/            도메인 타입, API DTO, LLM 출력 스키마 (zod). server 와 web 이 모두 @vibe-teacher/shared 로 import
server/            Hono API (tsx 로 직접 실행, 빌드 단계 없음)
  src/adapters/    도구별 기록 파서. 도구마다 index(어댑터) · paths(기본 경로) · records(원본 레코드 타입) · parse(정규화)
  src/index/       계정 탐색, 소스, 세션 인덱스, 인덱스 디스크 캐시
  src/analyzers/   user-messages(내 메시지) · built/(파일·명령·패키지·커밋 원문 수집)
  src/llm/         AI: digest(전송용 요약 + 비밀값 마스킹) · gate(AI 문장을 쓸 수 있는지와 못 쓰는 사유) · reader(읽는 사람 수준별 문체 지침, withReader) · claude-cli · openai-compat(OpenRouter 전용, fetch) · concepts(개념 ID·링크 검사) · models(모델 목록) · select(제공자 선택) · jobs · cache
  src/auth/        홈 디렉터리 토큰 로그인, 쿠키, 미들웨어
  src/config/      설정 스키마(zod)·저장소·환경변수/CLI 인자
  src/routes/      API 라우트. 공통 의존성과 HttpError 는 routes/deps.ts
  src/lib/         fsx(안전한 파일 IO) · jsonl · shell(셸 명령 파서) · text · hash
  src/wiki/        프로젝트 위키: build(AI 입력 snapshot) · validate(출처 검사·격리) · plan(설명 계획) · graph(선행관계) · catalog · service
  src/learner/     내 이해 정보(사용자 전체): reducer(원장 → 개념 상태) · service(원장 쓰기, revision 충돌, 예전 프로젝트별 원장 병합)
                   · knowledge(AI 개념이 나온 곳·명시적 이해 증거) · knowledge-service(내 세션 모으기·캐시)
                   · knowledge-text(설명 문장 AI 작성: 사실 → 프롬프트, 넘겨짚는 문장 거르기, 지문별 저장, 작업)
                   · prefs(사용자 설정: 읽는 사람 수준, prefs.json)
  src/repo/        레포 위키: scan(저장소 읽기 전용 스캔) · source(근거 파일 안전 읽기) · code(TS 구문 분석·내부 파일 연결) · wiki(사실 초안 조립, 판 비교) · inspect(AI 질문·필요한 코드만 추가 확인) · ai(AI 가 문장 쓰기, 표·코드 유지, 근거 표시 검사)
                   · service(저장·갱신 필요 판단, AI 작업과 실패 상태)
  src/assessment/  bank(문항 형식 검사) · service(AI 출제·서버 채점)
  src/help/        도움 패널 질문: answer(대상별 근거 고르기·프롬프트·답 검사) · service(개인 기록·작업)
  src/storage/     <home>/wiki 저장소 (경로 검사, 키별 직렬화, JSONL 원장)
  test/            vitest 테스트와 합성 픽스처
web/               Vite + React 19 + react-router UI (한국어)
  test/           화면 렌더링 검사 (vitest, Node 환경에서 서버 렌더링)
  src/i18n/ko.ts   화면 문자열 모음
  src/components/SessionUnderstand.tsx  "이번 세션 이해하기" 통합 화면 (요약 → 작업 이해하기 → 개념 → 내 지식 → 보안 점검 순서 + 도움 패널). 세션 탭은 이해하기 → 내 메시지 → 만들어진 것 순서 (pages/SessionPage.tsx)
  src/context/DisplayContext.tsx        화면 설정(본문 14px·코드 12px·촘촘한 밀도 기본), 설명 난이도와 분리해 브라우저에 저장
  src/components/SettingsPopover.tsx    오른쪽 위 톱니바퀴 설정. Modal.tsx 의 네이티브 dialog로 초점·Escape·복귀 처리
  src/components/RepoSourceViewer.tsx   근거 파일 원문·줄 강조·검색, RepoFlowView.tsx 는 검증된 파일 연결을 SVG로 표시
  src/components/SecurityReview.tsx    AI가 선정한 보안·데이터 주의사항과 출처 표시
  src/components/HelpPanel.tsx          도움 패널 (설명/질문/퀴즈), src/context/FocusContext.tsx 가 지금 보는 대상을 공유
scripts/           dev.mjs(웹+API 동시 실행), grant-read-acl.sh(다중 계정 읽기 ACL)
```

## 4. 명령어

Node.js 20 이상이 필요합니다 (루트 `package.json` 의 `engines`). 개발 서버(pkiin 머신)에서는 PATH 앞쪽의 `/usr/local/bin/node` 가 v15 라서 npm 자체가 실패하므로, 명령 앞에 `export PATH=/usr/bin:$PATH` 를 붙여 `/usr/bin/node`(v22)를 씁니다.

```bash
npm install
npm run dev                         # API :8787 + 웹 :5173 (웹의 /api 는 API 로 프록시)
npm run dev:server                  # API 만
npm run dev:web                     # 웹만
npm run build && npm start          # web/dist 빌드 후 API 가 UI 까지 한 포트로 서빙
npm run typecheck                   # shared → server → web 순서로 tsc --noEmit
npm test                            # vitest run (server/test/**, shared/test/**)
npx vitest run server/test/lib/shell.test.ts   # 파일 하나만
npx vitest run -t "codex adapter"              # 이름으로 골라 실행
```

개발 중 설정·캐시를 실제 홈과 분리하려면 `npm run dev -- --home /tmp/vt-dev` 처럼 `--home` 을 씁니다.

## 5. 지켜야 할 불변 조건 (보안·프라이버시)

이 앱은 **여러 사람의 대화 기록**을 다룹니다. 아래는 편의를 위해 완화하지 않습니다.

- **스캔 대상은 읽기 전용.** `~/.claude`, `~/.codex`, `~/.copilot`, VS Code 저장소 등 스캔하는 홈에는 아무것도 쓰지 않습니다. 쓰기는 `VIBE_TEACHER_HOME`(기본 `~/.vibe-teacher`) 아래 `config.json`, `cache/index/`, `cache/enrich/` 만 허용합니다. 파일 쓰기는 `server/src/lib/fsx.ts` 의 `writeJsonAtomic` 을 씁니다.
- **LLM 에는 다이제스트만.** 원본 JSONL, 도구 출력 전문은 절대 보내지 않습니다. 보내는 내용은 `server/src/llm/digest.ts` 의 `buildDigest` 를 거치고 `maskSecrets` 로 마스킹합니다. 새 비밀값 형식을 발견하면 `SECRET_PATTERNS` 에 추가하고 테스트를 붙입니다.
- **교육 내용은 AI가 생성한다.** 개념 선정·설명·위키 구성·주의사항·선행관계·연습 문항은 AI가 작성한다. 고정 카탈로그나 규칙 기반 대체 문장을 다시 넣지 않는다. 코드는 원문 수집·접근 권한·출처 참조·스키마·순환·출력 예산을 검사한다. AI를 쓸 수 없으면 실패 사유를 표시한다. GET은 AI를 호출하지 않고 POST로만 생성한다. `llm.autoText`는 자동 POST 여부이며 수동 생성은 유지한다.
- **API는 OpenRouter만 사용한다.** 기본 모델은 `openai/gpt-5-mini`. 일반 작업은 Claude CLI를 우선하고 CLI 실패·외부 검색은 OpenRouter로 처리한다. 취소는 다른 제공자로 재시도하지 않는다. OpenAI·Anthropic 직접 호출이나 해당 API 키 사용을 추가하지 않는다. 검색에는 공개 개념 이름만 보내고 프로젝트 원문·사설 경로는 넣지 않는다. 참고 링크는 실제 API 검색 출처와 대조한다.
- **기본 바인딩은 `127.0.0.1`.** loopback 이 아닌 주소는 `VIBE_TEACHER_TOKEN` 또는 `auth.mode=home-token` 없이는 부팅을 거부합니다 (`server/src/index.ts`).
- **계정 범위 밖은 404.** 다른 계정의 리소스는 403 이 아니라 404 로 존재 자체를 숨깁니다. 계정에 딸린 라우트에는 `assertAccount` 를 호출합니다 (`server/src/routes/deps.ts`).
- **권한 없는 홈은 오류가 아니라 상태.** 읽을 수 없는 계정은 `readable: 'denied'` 로 표시하고 나머지는 계속 동작해야 합니다.
- **자식 프로세스 환경.** `claude` CLI 를 띄울 때 `CLAUDE_CONFIG_DIR` 를 제외한 `CLAUDE*` 환경변수를 지웁니다 (Claude Code 안에서 실행해도 중첩 실행이 막히지 않도록).
- **위키: 위험 알림은 사용자 상태와 무관.** `planWiki` 는 공통 알림을 profile 을 보기 전에 정한다. 숙련 추정으로 알림을 숨기거나 줄이지 않는다 (예산을 넘어도 `mandatory_overflow` 로 표시하고 모두 보여 줌).
- **위키: 사실·해석·에이전트 주장 구분.** 세션 기록에 없는 것은 `inference` + `limits`("이 세션 기록에서 찾지 못함")로만 쓰고 저장소 전체의 부재로 단정하지 않는다. 에이전트의 "완료" 보고는 `agent_reported` 로 실행 기록과 분리한다. claim·finding·item ID 와 근거 ID 는 코드가 만들며, `enforceSnapshot` 을 통과하지 못한 것은 격리하고 `status: partial` 로 낮춘다.
- **이해 증거는 명시적 입력만.** 세션 로그에서 사용자 이해 증거를 뽑지 않는다(동의 전). 자기보고·노출·건너뛰기·모르겠어요는 이해/오답으로 바꾸지 않고, 검토 전(candidate) 문항·해설 뒤 재시도·도움 사용 응답은 연습으로만 센다 (`server/src/learner/reducer.ts` 의 policy). 학습자 ID 는 인증 주체에서만 만든다 (`learnerIdFor`).
- **위키 AI 는 후보만.** AI 응답은 `server/src/wiki/ai.ts` 의 `acceptWikiAiOutput` 을 거쳐야 실린다: 제공한 ID 만 인용(하나라도 지어내면 그 제안 전체를 버림), 프로젝트 문장은 근거 주장 인용 필수, 출력도 `maskSecrets`. 주의사항도 AI가 근거를 보고 생성하며, AI 결과는 `wiki/projects/<p>/ai/<revision>.json` 레이어로 원장과 따로 둔다. 전송 전 미리 보기(`/wiki/ai/preview`)를 유지한다.
- **CLI 로그인을 고르면 API 키를 넘기지 않는다.** `claude` 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN` 을 지운다 (`childEnv`).
- **읽는 사람 수준은 문체만.** 사용자가 고른 수준(`shared/src/reader.ts` 의 `ReaderLevel`, 기본 `non-dev` = 완전 비개발자)은 AI 문장의 단어·설명 깊이에만 쓴다. 이해 증거가 아니므로 learner 원장에 넣지 않고(`learners/<id>/prefs.json`), 개념 상태·위험 알림·사실·근거를 바꾸지 않는다. 사람이 읽는 문장을 쓰는 **모든** AI 호출은 시스템 프롬프트를 `server/src/llm/reader.ts` 의 `withReader(prompt, level)` 로 감싸고, 결과는 수준별로 따로 저장한다(캐시 키·파일 이름·지문에 수준 포함). 시스템 프롬프트 본문에 특정 독자("초보", "비개발자")를 박아 넣지 않는다. 화면은 사용자가 수준을 고르기 전(`reader.chosen=false`)에는 AI 자동 작성을 시작하지 않고 먼저 묻는다.
- **레포 위키 구성과 문장은 AI가.** AI 응답은 `server/src/repo/ai.ts` 의 `applyRepoAi` 를 거친다: 명령·스크립트·API·폴더 표의 원문 값과 코드 블록은 저장소에서 읽은 그대로 보존한다. API 표의 동작 설명, 연결 그림의 파일 역할·영역 정보는 검증된 AI 설명으로 채운다. AI가 절 구성과 설명을 결정하되 원문 값과 파일 연결은 변조하지 않는다. 근거는 미리 준 표시(`F:경로` 중 실제 파일, `S1…`)만 받고 나머지는 버리며 경고로 남긴다. 입력·출력 모두 `maskSecrets`. 보내기 전 미리 보기(`/repo-wiki/ai/preview`)를 유지한다.
- **내 지식 설명 문장은 상태를 넘겨짚지 않는다.** AI 문장은 `server/src/learner/knowledge-text.ts` 의 `acceptKnowledgeText` 를 거친다: "모르십니다"류 단정, 확인되지 않았는데 "이해하고 계십니다"류는 버리고 생성 실패를 표시한다(같은 사실로 다시 부르지 않도록 거른 것도 저장). 상태 자체는 AI 가 바꾸지 못한다.
- **저장소 스캔은 읽기만.** `server/src/repo/scan.ts` 는 쓰기·명령 실행(git 포함)을 하지 않고, 심볼릭 링크를 따라가지 않으며, `.env`·키 파일을 열지 않는다(`.env.example` 은 변수 이름만). 새로 읽을 파일 종류를 늘리면 비밀값이 섞이지 않는지 테스트(`server/test/repo`)를 붙인다.
- **내 지식 위키: 언급은 증거가 아니다.** 사용자 메시지의 언급은 설명 문장의 맥락으로만 쓰고 상태는 learner 원장으로만 정한다. 붙여 넣은 글(`<pasted_content>`)은 언급으로 보지 않는다 (`ownWords`).
- **도움 패널 질문은 이해 증거가 아니다.** 질문은 `help.jsonl` 에 개인 기록으로만 남기고 learner 원장을 바꾸지 않는다. 답의 프로젝트 연결은 검증된 claim 인용이 있어야 싣는다 (`acceptHelpOutput`). 도움 패널로 물어본 개념의 문제 응답은 `helpUsed` 로 보조 응답이 된다.
- **정답은 제출 전에 내보내지 않는다.** 브라우저로 가는 문항은 `toPublicQuestion` 을 거친다.
- **"내 메시지"는 사람이 실제로 입력한 것만.** 도구 결과, `<system-reminder>` 같은 주입 메시지, 사이드체인은 `human` 으로 분류하지 않습니다. 분류 규칙을 바꾸면 해당 어댑터의 분류 테스트를 갱신합니다.
- **Codex 하위 세션과 자동 문맥을 구분한다.** `session_meta.source.subagent` 또는 `parent_thread_id`가 있는 세션은 목록에서 제외하고 직접 읽어도 사용자 입력으로 세지 않습니다. IDE 문맥의 `My request` 본문과 알려진 자동 태그는 `adapters/codex/classify.ts`에서 구분하며, 긴 자동 문맥을 지운 다음 길이를 제한합니다. 코드 블록·인라인 코드의 태그 예시를 지우지 않습니다.

## 6. 코드 규칙

- **TypeScript strict** + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`. 타입만 쓰는 import 는 `import type`. 배열 인덱싱 결과는 `undefined` 가능성을 처리합니다.
- **ESM, 확장자 없는 상대 import** (`moduleResolution: Bundler`). 디렉터리를 가리킬 때는 `./claude-code/index` 처럼 `index` 까지 씁니다.
- **타입·스키마는 shared 에.** server 와 web 이 함께 쓰는 타입, API 요청/응답 DTO, LLM 출력 스키마는 `shared/src/` 에 두고 zod 로 정의합니다.
- **한국어.** 화면 문자열, API 오류 메시지, 로그, 코드 주석, README 는 한국어입니다. 웹 화면 문자열은 컴포넌트에 직접 쓰지 말고 `web/src/i18n/ko.ts` 에 추가합니다.
- **API 오류**는 `throw new HttpError(status, code, message)` 로 던지고, 응답 형식은 `{ error: { code, message } }` 입니다.
- **파서는 순수 함수로.** 어댑터의 분류·파싱 로직은 파일 IO 와 분리해 픽스처 없이도 테스트할 수 있게 합니다. 모르는 레코드 유형은 예외를 던지지 말고 건너뛰거나 `parseWarnings` 에 남깁니다.
- **셸 명령 해석**은 `server/src/lib/shell.ts` 를 재사용합니다 (heredoc 처리 포함). 정규식으로 따로 만들지 않습니다.
- 주변 코드의 스타일(이름, 주석 밀도, 함수 길이)을 따릅니다. 새 의존성은 꼭 필요할 때만 추가하고, 추가하면 이유를 보고합니다.

## 7. 자주 하는 작업 레시피

### 새 AI 도구 어댑터 추가
1. `server/src/adapters/<provider>/` 에 `paths.ts`, `records.ts`, `parse.ts`, `index.ts` 를 만들고 `HistoryAdapter` (`adapters/types.ts`) 를 구현합니다.
2. `adapters/registry.ts` 의 `adapters` 배열에 등록합니다.
3. provider 이름을 세 곳에 추가합니다: `shared/src/domain.ts` (`Provider`, `PROVIDERS`), `server/src/config/schema.ts` (`ProviderSchema`), `web/src/i18n/ko.ts` (`provider`).
4. `server/test/fixtures/<provider>/` 에 **합성** 픽스처를 만들고 `server/test/adapters/` 에 테스트를 씁니다.
5. README "읽는 위치" 표와 첫 문단을 고칩니다.

### 개념과 위키 생성 변경
- 고정 개념 목록을 추가하지 않는다. `wiki/ai.ts`에서 AI가 필요한 개념·주장·주의사항·카드를 함께 작성하고 출처를 검사한다.
- 새 개념은 세션 snapshot과 AI 레이어에 저장하고 세션 카드·도움 패널·내 지식에 연결한다. 전역 카탈로그로 계정 간 자료를 섞지 않는다.
- 생성 문항은 candidate 연습으로만 기록하고 정답·해설은 제출 전 공개하지 않는다.

### 설정 필드 추가
- `server/src/config/schema.ts` 에 zod 로 정의하고 **반드시 `.default()`** 를 줍니다 (기존 사용자의 `config.json` 이 그대로 읽혀야 함).
- 호환되지 않는 변경이면 `version` 을 올리고 마이그레이션을 씁니다.
- README "설정 파일" 절을 고칩니다.

### 환경변수 / CLI 인자 추가
- `server/src/config/env.ts` 와 `scripts/dev.mjs` (`usage()` 포함), 필요하면 `web/vite.config.ts` 까지 맞춥니다. 우선순위는 **CLI 인자 > 환경변수 > .env > 설정 파일 > 기본값**.
- 사용자가 설정할 만한 값이면 `.env.example` 에도 주석과 함께 추가합니다. `.env` 는 `server/src/config/dotenv.ts` 와 `scripts/dev.mjs` 가 읽고, 실제 값이 든 `.env` 는 절대 커밋하지 않습니다.
- README 표와 예시를 고칩니다.

### API 라우트 추가
- `server/src/routes/<name>.ts` 에 만들고 `server/src/app.ts` 에 등록합니다. 요청/응답 타입은 `shared/src/api.ts`.
- 계정에 딸린 데이터면 `assertAccount`, 관리자 전용이면 `requireAdmin` 을 호출합니다.
- 웹에서는 `web/src/api/client.ts` 의 `api<T>()` 로 호출합니다.

### 캐시 형식이 바뀌는 변경
- LLM 프롬프트나 출력 스키마를 바꾸면 `shared/src/enrich.ts` 의 `ENRICH_PROMPT_VERSION` 을 올립니다 (AI 분석 캐시 무효화).
- 세션 요약(`SessionSummary`) 형태나 인덱싱 결과가 바뀌면 `server/src/index/cache.ts` 의 `CACHE_VERSION` 을 올립니다.
- 프로젝트는 같은 계정 안에서 `realpath` 기준으로 묶는다. 인덱스 디스크 캐시에는 기록된 원래 경로를 남기고 매 스캔마다 실제 경로를 다시 확인한다. 예전 ID는 `SessionIndex.getProjectIds()`로 조회하며, `createWikiServices`와 프로젝트 저장소에 이 resolver를 넘겨 위키·AI·질문·레포 이력을 함께 읽는다. 예전 파일은 보존하고 새 쓰기는 대표 ID로 한다. 이름·Git 원격 주소만으로 다른 폴더나 계정을 합치지 않는다.

### 위키 생성 변경
- AI의 claim·finding·item은 제공된 근거와 올바른 개념 참조가 있어야 한다. 없는 참조를 일부 지워 카드를 살리지 않고 해당 후보를 거른다.
- AI 위험 판단은 근거 상태·영향·생명주기를 구분하고 관찰 범위를 보존한다. 모든 프로젝트에 같은 점검 목록을 붙이지 않는다.
- 입력 형식 변경은 `RULES_VERSION`(AI 파이프라인 식별자)을 올린다. 이전 규칙 기반 snapshot은 현재 화면에 사용하지 않고 이력 파일은 보존한다.

### 문항·선행관계 추가
- 문항은 `assessment/service.ts`에서 AI로 생성한다. 객관식은 정답 1개·선택지 3개 이상, OX는 `o`,`x`. 생성 문항은 `candidate`로 보존한다.
- 선행관계는 AI 결과에서 받아 구조·참조·순환을 검사한다. 고정 선행관계 파일은 사용하지 않는다.
- 위키 AI 프롬프트나 출력 스키마(`WikiAiOutputSchema`)를 바꾸면 `shared/src/wiki.ts` 의 `WIKI_AI_PROMPT_VERSION` 을 올린다 (저장된 AI 레이어 무효화).
- 내 지식 설명 문장 프롬프트·사실 형식을 바꾸면 `server/src/learner/knowledge-text.ts` 의 `KNOWLEDGE_TEXT_PROMPT_VERSION` 을 올린다. 레포 위키는 시스템 프롬프트와 입력 전체가 지문(`inputHash`)에 들어간다. 공통 문체나 문장 형식이 바뀌면 `repo/service.ts`의 `REPO_TEXT_VERSION`도 올려 기존 문장 레이어를 갱신 대상으로 돌린다.
- 읽는 사람 문체 지침(`server/src/llm/reader.ts`)을 바꾸면 `ENRICH_PROMPT_VERSION`, `WIKI_AI_PROMPT_VERSION`, `KNOWLEDGE_TEXT_PROMPT_VERSION` 을 함께 올린다 (이 셋은 지문에 시스템 프롬프트 본문이 들어가지 않는다). 수준을 추가하면 `READER_LEVELS`, `reader.ts` 의 지침, `web/src/i18n/ko.ts` 의 `reader.levels`, README "읽는 사람 수준" 표를 함께 고친다.
- 위키용 개념 필드를 바꾸면 `server/src/wiki/catalog.ts` 의 `CATALOG_VERSION`, 상태 전이 규칙을 바꾸면 `POLICY_VERSION`, 원장 형식을 바꾸면 `shared/src/wiki.ts` 의 `WIKI_SCHEMA_VERSION` 을 올린다.

### 화면과 한국어 설명
- 글씨와 여백은 화면 설정 변수(`--ui-font-size`, `--code-font-size`, `--card-padding` 등)로 정하고, 설명 난이도·학습자 이해 상태와 연동하지 않는다. 설정은 오른쪽 위 톱니바퀴 팝업 하나로 모은다.
- 색상은 `web/src/styles/app.css`의 의미별 토큰(`--panel`, `--surface`, `--text` 등)으로 정한다. 새 패널에도 라이트·다크 모드, 키보드 초점, 좁은 화면, 동작 줄이기를 함께 확인한다.
- 기술 용어는 쉬운 말을 먼저 쓰고 필요한 원어만 덧붙인다. 퀴즈 문장을 바꾸면 문항 version과 은행 version을 올리되 정답·검토 상태를 임의로 바꾸지 않는다.
- 개념의 작업 연결 설명은 확인한 사실과 알아둘 이유(`whyItMatters`)를 잇는다. 잘린 대화·링크·언급 횟수를 본문에 나열하지 않고 원문은 접힌 기록에 둔다. `contextKind=mention`은 대화 언급만 확인된 경우로, 구현·실행 사실로 표현하지 않는다. 자동 감지 개념을 추가할 때는 실용적인 이유도 함께 작성한다.
- 레포 위키의 `security` 절도 AI가 근거를 읽고 작성한다. 세션마다 보안·데이터 항목과 근거를 보존하며, 위키가 만들어진 세션 수와 미점검 범위를 표시한다. 설치 버전별 취약점 검사나 실제 서비스 점검을 한 것으로 표현하지 않는다.
- 레포 위키 문장 형식·공통 문체가 바뀌면 `repo/service.ts`의 `REPO_TEXT_VERSION`도 올린다. 예전 문장 레이어는 GET에서 사용하지 않고 자동 작성 대상으로 돌린다.
- 레포 위키 API 표는 방식·경로·동작 설명·파일 순서다. 동작 설명은 경로별 코드 발췌를 받은 AI가 작성하고, `applyRepoAi`에서 방식·경로·파일이 일치하고 해당 파일 근거가 확인된 설명만 병합한다. 원문 경로·파일과 다른 자료 블록은 보존한다. 같은 원문 블록(`sourceBlocks` id)은 페이지마다 처음 고른 절에만 싣고 근거도 그 절에만 붙인다. 저장된 예전 레이어는 `compose`에서 `dropRepeatedBlocks`로 같은 그림·표·코드를 한 번만 남긴다(문장 블록은 지우지 않는다).

### 레포 위키의 코드 근거와 파일 보기
- 파일 읽기는 `repo/source.ts`를 사용한다. 계정 권한을 검사한 프로젝트 아래의 허용된 텍스트만 읽고 숨김 설정·키·심볼릭 링크·특수 파일을 거절한다. 환경 변수 예제는 이름만, 코드의 비밀값은 가려서 반환한다. 응답은 `Cache-Control: no-store`.
- 코드 발췌와 파일 연결은 `repo/code.ts`의 TypeScript 구문 분석으로 모으며 코드·명령을 실행하지 않는다. 파일 근거의 줄·내용 지문을 보존하고, 없는 줄 인용은 버린다. AI는 `flow`의 파일·연결을 바꾸지 못한다. Python은 `from` 줄만 읽고(`pythonImportNames` 가 괄호·`\` 여러 줄 목록을 따라감), `from . import a`·`from .pkg import a` 의 이름은 실제 하위 모듈 파일이 있을 때만 잇는다. `from . import` 로 자기 패키지 `__init__.py` 를 잇지 않는다.
- `flow`의 파일 ID·원문 경로·열·연결·근거는 보존하고, 파일별 동작 설명과 프론트엔드·백엔드·공통 등의 영역 정보만 AI가 작성해 `applyRepoAi`에서 출처 검사 후 입힌다. 이름만으로 영역을 규칙 분류하지 않는다. 상자와 화살표 위치는 설명 줄바꿈·글자 크기를 반영한다. 열은 시작 파일에서의 깊이이고 0열이 곧 시작 파일이다(화면 라벨 `시작 파일 - 이름`, 나머지는 파일 이름만). 시작 파일에서 닿지 않는 파일만 모인 폴더는 `codeFlow`가 그 폴더의 `FOLDER_ENTRY`(`__main__.py`·`__init__.py`·`index.ts` 등)를 0열 시작 파일로 삼아 바깥 폴더부터 층을 나누고, 그래도 남은 파일은 마지막 열에 몰지 않고 1열부터 따로 층을 나눈다. 화면(`flowLayout`)은 영역마다 쓰는 깊이만 왼쪽부터 채우고, 깊이가 하나뿐인 영역만 여러 열로 나눈다(깊이가 다른 열을 쪼개면 화살표가 다른 상자에서 나오는 것처럼 보이므로 나누지 않는다).
- 줄 인용은 제공된 발췌 전체 또는 그 안에 포함된 더 좁은 범위를 허용하고 원래 지문을 보존한다. 읽지 않은 줄, 역순·0·안전한 정수 범위를 벗어난 줄은 거절한다. 여러 발췌 사이의 읽지 않은 구간을 합쳐 인용할 수는 없다.
- 원본 그래프의 모든 노드에 검증된 동작 설명과 유효한 영역이 있어야 레포 위키를 완료로 저장한다. 누락 시 `repo_wiki_flow` 작업으로 한 번 보완하고 다시 검사한다. 여전히 누락되면 생성 실패로 저장하며 설명 없는 성공 캐시를 만들지 않는다. 보완은 `repo-inspect` 프로필을 쓰고 기존 입력과 같은 코드 발췌만 전달한다.
- `repo/inspect.ts`는 AI가 최대 6곳의 확인 위치·질문을 고른 뒤 `readRepoText`로 합계 24,000자 이내의 마스킹된 발췌를 읽고 짧은 답을 받는다. 저장소 밖·숨김 설정·키·심볼릭 링크는 읽지 않으며 알려진 지문과 다른 파일도 추가 확인에서 제외한다. 추가 답의 출처는 실제 제공한 줄 범위와 대조한다. GET 미리 보기는 AI를 호출하지 않고 기본 입력과 추가 확인 상한을 알린다.
- `LlmRequest.task=repo-inspect`만 Claude CLI의 `haiku`·`--effort low`로 실행한다. CLI 도구는 계속 비활성화하고 서버가 파일을 읽는다. CLI 실패는 기존 OpenRouter 경로를 쓰며 취소는 전파한다. 보조 확인 실패는 경고를 남기고 원래 코드 근거로 작성할 수 있다.
- 실제 파일 내용의 지문이 위키 근거와 달라지면 현재 파일임을 알리고 예전 줄 강조를 끈다. 글꼴을 적용해도 줄 번호가 변하지 않도록 비밀값 마스킹은 줄바꿈을 보존한다.

### AI 제공자 추가
- `shared/src/api.ts` 의 `LlmProviderId`, `server/src/config/schema.ts` 와 `server/src/routes/settings.ts` 의 provider enum, `server/src/llm/select.ts` 의 `providers()`·`IDS`·라우팅(Claude CLI 우선, 실패·검색은 OpenRouter)·`modelFor` 를 함께 고친다.
- 화면 문구는 `web/src/i18n/ko.ts` 의 `sources.llmChoice`·`llmNoKey`, 키는 `.env.example` 에 주석과 함께 추가한다.
- 응답은 항상 zod 스키마로 다시 검사한다 (`LlmProvider.complete`). 네트워크는 테스트에서 fetch 를 주입해 막는다.

### 버전 올리기
- 루트 `package.json` 의 `version` 과 `server/src/index.ts` 의 `VERSION` 을 함께 바꿉니다.

## 8. 테스트

- vitest, 테스트 위치는 `server/test/**`, `shared/test/**`, `web/test/**`. 구조는 `src/` 를 따라갑니다. 웹 렌더링 검사는 웹의 JSX·DOM 타입 설정을 사용합니다.
- **픽스처는 합성 데이터만.** 실제 대화 기록, 실제 사용자명, 실제 홈 경로, 실제 키·토큰을 넣지 않습니다. 실제 기록에서 형식을 확인했다면 내용을 바꿔 최소한으로 재현합니다.
- 테스트는 실제 `~/.claude` 등에 의존하지 않습니다. 경로는 픽스처 디렉터리나 임시 디렉터리를 넘깁니다.
- LLM 호출은 테스트에서 실제로 하지 않습니다 (가짜 제공자나 스텁 사용).

## 9. 구현 상태

`plan.md`는 초기 설계이며 현재의 AI 전용 생성 정책과 다른 고정 카탈로그·규칙 대체 제안이 들어 있다. 현재 사용자 지시와 이 문서의 AI 생성 정책을 우선한다. 남은 확장은 Markdown 내보내기, revision 간 프로젝트 사실 갱신, 브라우저 E2E 자동화다.

## 10. 커밋 메시지

사용자가 커밋을 요청하면 기존 이력의 형식을 따릅니다: 한국어 제목 한 줄, 빈 줄, `- ` 불릿으로 주요 변경점. 커밋 전에 typecheck 와 test 를 통과시킵니다.

## 11. 하지 말 것

- 스캔 대상 홈에 파일 쓰기, 권한 변경, 잠금 파일 만들기
- root 로 실행해야만 동작하는 기능 (다중 계정은 ACL 로 해결합니다 — README "다중 계정 운영")
- 원본 기록이나 도구 출력을 LLM·로그·외부 서비스로 보내기
- 보안 기본값 완화 (바인딩, 토큰, 404 숨김, 로그인 실패 잠금)
- `web/dist/`, `node_modules/`, `.env*`, `*.local.json` 커밋
- README 를 확인하지 않고 작업 끝내기
