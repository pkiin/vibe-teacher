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
| AI 분석 제공자·모델·전송 범위 | "AI 분석 (선택)" 표와 설명 |
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
  src/analyzers/   user-messages(내 메시지) · built/(파일·명령·패키지·커밋·스택) · concepts/(개념 사전 매칭)
  src/llm/         AI 보강: digest(전송용 요약 + 비밀값 마스킹) · claude-cli · anthropic-sdk · openai-compat(OpenRouter·OpenAI, fetch) · models(모델 목록) · select(제공자 선택) · jobs · cache
  src/auth/        홈 디렉터리 토큰 로그인, 쿠키, 미들웨어
  src/config/      설정 스키마(zod)·저장소·환경변수/CLI 인자
  src/routes/      API 라우트. 공통 의존성과 HttpError 는 routes/deps.ts
  src/lib/         fsx(안전한 파일 IO) · jsonl · shell(셸 명령 파서) · text · hash
  src/wiki/        프로젝트 위키: build(세션 → 원장, 규칙) · validate(출처 검사·격리) · plan(설명 계획) · graph(선행관계) · catalog · service
  src/learner/     내 이해 정보: reducer(원장 → 개념 상태, 순수 함수) · service(원장 쓰기, revision 충돌)
  src/assessment/  문항 은행(bank) · 출제·채점(service)
  src/help/        도움 패널 질문: answer(대상별 근거 고르기·프롬프트·답 검사·AI 없는 대체 답) · service(개인 기록·작업)
  src/storage/     <home>/wiki 저장소 (경로 검사, 키별 직렬화, JSONL 원장)
  data/            concepts.ko.json (개념 사전) · prerequisites.json (선행관계) · questions.json (문항 은행)
  test/            vitest 테스트와 합성 픽스처
web/               Vite + React 19 + react-router UI (한국어)
  src/i18n/ko.ts   화면 문자열 모음
  src/components/SessionUnderstand.tsx  "이번 세션 이해하기" 통합 화면 (위키·만들어진 것·개념 + 도움 패널)
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
- **AI 분석은 사용자가 버튼을 눌렀을 때만.** 자동 호출이나 백그라운드 일괄 호출을 넣지 않습니다.
- **기본 바인딩은 `127.0.0.1`.** loopback 이 아닌 주소는 `VIBE_TEACHER_TOKEN` 또는 `auth.mode=home-token` 없이는 부팅을 거부합니다 (`server/src/index.ts`).
- **계정 범위 밖은 404.** 다른 계정의 리소스는 403 이 아니라 404 로 존재 자체를 숨깁니다. 계정에 딸린 라우트에는 `assertAccount` 를 호출합니다 (`server/src/routes/deps.ts`).
- **권한 없는 홈은 오류가 아니라 상태.** 읽을 수 없는 계정은 `readable: 'denied'` 로 표시하고 나머지는 계속 동작해야 합니다.
- **자식 프로세스 환경.** `claude` CLI 를 띄울 때 `CLAUDE_CONFIG_DIR` 를 제외한 `CLAUDE*` 환경변수를 지웁니다 (Claude Code 안에서 실행해도 중첩 실행이 막히지 않도록).
- **위키: 위험 알림은 사용자 상태와 무관.** `planWiki` 는 공통 알림을 profile 을 보기 전에 정한다. 숙련 추정으로 알림을 숨기거나 줄이지 않는다 (예산을 넘어도 `mandatory_overflow` 로 표시하고 모두 보여 줌).
- **위키: 사실·해석·에이전트 주장 구분.** 세션 기록에 없는 것은 `inference` + `limits`("이 세션 기록에서 찾지 못함")로만 쓰고 저장소 전체의 부재로 단정하지 않는다. 에이전트의 "완료" 보고는 `agent_reported` 로 실행 기록과 분리한다. claim·finding·item ID 와 근거 ID 는 코드가 만들며, `enforceSnapshot` 을 통과하지 못한 것은 격리하고 `status: partial` 로 낮춘다.
- **이해 증거는 명시적 입력만.** 세션 로그에서 사용자 이해 증거를 뽑지 않는다(동의 전). 자기보고·노출·건너뛰기·모르겠어요는 이해/오답으로 바꾸지 않고, 검토 전(candidate) 문항·해설 뒤 재시도·도움 사용 응답은 연습으로만 센다 (`server/src/learner/reducer.ts` 의 policy). 학습자 ID 는 인증 주체에서만 만든다 (`learnerIdFor`).
- **위키 AI 는 후보만.** AI 응답은 `server/src/wiki/ai.ts` 의 `acceptWikiAiOutput` 을 거쳐야 실린다: 제공한 ID 만 인용(하나라도 지어내면 그 제안 전체를 버림), 프로젝트 문장은 근거 주장 인용 필수, 출력도 `maskSecrets`. finding 과 공통 알림은 AI 가 바꾸지 못하며, AI 결과는 `wiki/projects/<p>/ai/<revision>.json` 레이어로 원장과 따로 둔다. 전송 전 미리 보기(`/wiki/ai/preview`)를 유지한다.
- **CLI 로그인을 고르면 API 키를 넘기지 않는다.** `claude` 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN` 을 지운다 (`childEnv`).
- **도움 패널 질문은 이해 증거가 아니다.** 질문은 `help.jsonl` 에 개인 기록으로만 남기고 learner 원장을 바꾸지 않는다. 답의 프로젝트 연결은 검증된 claim 인용이 있어야 싣는다 (`acceptHelpOutput`). 도움 패널로 물어본 개념의 문제 응답은 `helpUsed` 로 보조 응답이 된다.
- **정답은 제출 전에 내보내지 않는다.** 브라우저로 가는 문항은 `toPublicQuestion` 을 거친다.
- **"내 메시지"는 사람이 실제로 입력한 것만.** 도구 결과, `<system-reminder>` 같은 주입 메시지, 사이드체인은 `human` 으로 분류하지 않습니다. 분류 규칙을 바꾸면 해당 어댑터의 분류 테스트를 갱신합니다.

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

### 개념 사전 항목 추가
- `server/data/concepts.ko.json` 에 추가합니다. `id` 는 `^[a-z0-9-]+$`, 중복 불가. 트리거는 대소문자 무시 정규식 문자열입니다 (JSON 이므로 `\` 는 `\\`).
- 설명은 초보자가 읽을 수 있는 한국어 2~4문장, 링크는 가능하면 공식 문서(한국어판이 있으면 그것).
- `npm test -- server/test/analyzers/concepts.test.ts` 로 스키마 검증을 확인합니다.

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

### 위키 규칙 추가 (`server/src/wiki/build.ts`)
- finding 은 근거 상태(`evidenceStatus`)·영향(`impact`)·생명주기를 따로 채우고, 하나의 점수로 합치지 않는다. 확실하지 않으면 `needs_check` / `undetermined`.
- statement 에 관찰 범위와 불확실성을 쓴다. 정규식에 안 보인다는 이유만으로 "없다"고 쓰지 않는다.
- 관련 개념은 카탈로그에 있는 ID 만 쓴다. `server/test/wiki/helpers.ts` 의 `fakeSession` 으로 합성 세션 테스트를 붙인다.
- 판단 규칙이 바뀌면 `RULES_VERSION` 을 올린다.

### 문항·선행관계 추가
- 문항은 `server/data/questions.json`. 객관식은 정답 1개·선택지 3개 이상, OX 는 선택지 `o`,`x`. 직접 쓴 문항은 `reviewStatus: "candidate"` 로 두고, 사람이 검토한 것만 `reviewed` 로 바꾼다.
- 선행관계는 `server/data/prerequisites.json`. 검토 전이면 `status: "proposed"`. `npm test` 의 shipped catalog 테스트가 순환·없는 개념을 잡는다.
- 위키 AI 프롬프트나 출력 스키마(`WikiAiOutputSchema`)를 바꾸면 `shared/src/wiki.ts` 의 `WIKI_AI_PROMPT_VERSION` 을 올린다 (저장된 AI 레이어 무효화).
- 위키용 개념 필드를 바꾸면 `server/src/wiki/catalog.ts` 의 `CATALOG_VERSION`, 상태 전이 규칙을 바꾸면 `POLICY_VERSION`, 원장 형식을 바꾸면 `shared/src/wiki.ts` 의 `WIKI_SCHEMA_VERSION` 을 올린다.

### AI 제공자 추가
- `shared/src/api.ts` 의 `LlmProviderId`, `server/src/config/schema.ts` 와 `server/src/routes/settings.ts` 의 provider enum, `server/src/llm/select.ts` 의 `providers()`·`IDS`·auto 순서·`modelFor` 를 함께 고친다.
- 화면 문구는 `web/src/i18n/ko.ts` 의 `sources.llmChoice`·`llmNoKey`, 키는 `.env.example` 에 주석과 함께 추가한다.
- 응답은 항상 zod 스키마로 다시 검사한다 (`LlmProvider.complete`). 네트워크는 테스트에서 fetch 를 주입해 막는다.

### 버전 올리기
- 루트 `package.json` 의 `version` 과 `server/src/index.ts` 의 `VERSION` 을 함께 바꿉니다.

## 8. 테스트

- vitest, 테스트 위치는 `server/test/**` (`shared/test/**` 도 수집됨). 구조는 `src/` 를 따라갑니다.
- **픽스처는 합성 데이터만.** 실제 대화 기록, 실제 사용자명, 실제 홈 경로, 실제 키·토큰을 넣지 않습니다. 실제 기록에서 형식을 확인했다면 내용을 바꿔 최소한으로 재현합니다.
- 테스트는 실제 `~/.claude` 등에 의존하지 않습니다. 경로는 픽스처 디렉터리나 임시 디렉터리를 넘깁니다.
- LLM 호출은 테스트에서 실제로 하지 않습니다 (가짜 제공자나 스텁 사용).

## 9. plan.md 진행 상황

설계 문서는 저장소 루트의 `plan.md` (코딩 에이전트 세션 기반 적응형 프로젝트 지식 위키). 작은 단계부터 순서대로 구현한다. 단계를 끝내면 여기를 갱신한다.

- [x] M0 기준선 (Node ≥ 20, vitest ESM 경고 정리)
- [x] shared 타입: `wiki.ts` · `learner.ts` · `assessment.ts`
- [x] 개념 카탈로그 확장(위키 개념 13개 + 깊이 필드) · 선행관계 그래프(T13)
- [x] 문항 은행(38개, 모두 candidate) · 서버 채점 · 정답 비노출(T30, T37, T38)
- [x] 저장소 · 학습자 원장/reducer · revision 충돌(T01–T06, T16, T24, T25, T31)
- [x] 규칙 기반 위키 빌더 · 출처 검사 · 설명 계획/예산(T07–T15, T20, T21)
- [x] API: 세션 위키 · 내 이해 정보 · 출제/응답, 계정·학습자 격리(T29, T32)
- [x] 웹: 프로젝트 위키 탭, 근거 열람, 설명 깊이 버튼, 이해 확인 카드, 객관식/OX, 내 이해 정보 열람·정정
- [x] `.env` 읽기와 `.env.example` (AI 키 `ANTHROPIC_API_KEY`)
- [x] AI 제공자 선택 UI (Claude Code 로그인 / API 키 / 자동 / 끔, 선택지별 사용 가능 여부), API 기본 모델 `claude-opus-5-5` + effort 설정 + 거절 시 서버 대체(fallbacks)
- [x] OpenRouter·OpenAI 제공자 (fetch, SDK 없음), OpenRouter 모델 목록에서 고르기(기본 `openrouter/free`, 무료만 보기), `.env.example` 에 키 칸
- [x] 위키 AI 보강 (M3 일부): 항목별 프로젝트 맞춤 설명·새 사실·새 항목·개념 제안, ID 검사·격리, 별도 레이어, 전송 미리 보기
- [x] 통합 화면 "이번 세션 이해하기": 위키·만들어진 것·개념을 한 탭에 잇고 오른쪽 도움 패널(설명/질문/퀴즈), AI 버튼 하나로 합침
- [x] 도움 패널 질문 (M3): 대상별 근거로 답, 인용 검사, AI 없을 때 대체 답, 개인 기록, 재시도 중복 방지
- [ ] Markdown 내보내기 (개인 정보 기본 제외, T22)
- [ ] 프로젝트 단위 위키(여러 세션 통합) · 두 번째 세션의 `supersedes` / `resolved_in_scope` (사례 C, T17, T18, T27)
- [ ] 프로젝트 확인(project_awareness) 문항 — 검증된 claim 으로만 생성
- [ ] 브라우저 E2E (`npm run test:e2e`) — 현재 개발 서버에는 브라우저가 없어 HTTP 수준으로만 확인함
- [ ] 기존 쓰기 API 전체에 JSON/Origin 정책 적용 (지금은 새 위키 API 에만 `requireJson`)

## 10. 커밋 메시지

사용자가 커밋을 요청하면 기존 이력의 형식을 따릅니다: 한국어 제목 한 줄, 빈 줄, `- ` 불릿으로 주요 변경점. 커밋 전에 typecheck 와 test 를 통과시킵니다.

## 11. 하지 말 것

- 스캔 대상 홈에 파일 쓰기, 권한 변경, 잠금 파일 만들기
- root 로 실행해야만 동작하는 기능 (다중 계정은 ACL 로 해결합니다 — README "다중 계정 운영")
- 원본 기록이나 도구 출력을 LLM·로그·외부 서비스로 보내기
- 보안 기본값 완화 (바인딩, 토큰, 404 숨김, 로그인 실패 잠금)
- `web/dist/`, `node_modules/`, `.env*`, `*.local.json` 커밋
- README 를 확인하지 않고 작업 끝내기
