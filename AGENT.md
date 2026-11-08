# AGENT.md

이 저장소에서 일하는 AI 코딩 에이전트(Claude Code, Codex, Copilot 등)를 위한 작업 지침입니다.
사람이 읽는 설치 안내는 [README.md](README.md), 상세 사용 설명서는 `docs/`에 있고, 이 문서는 **코드를 바꾸는 쪽**을 위한 규칙입니다.

## 1. 매 작업 끝에 반드시 할 일

작업(기능 추가, 버그 수정, 리팩터링, 설정 변경)을 마칠 때마다 아래를 순서대로 확인합니다.

1. **README.md와 관련 문서 확인·갱신** — 아래 2절 표를 보고 해당 문서를 고칩니다. README의 소개·빠른 시작·환경변수·문서 링크는 매번 확인하고, 바뀐 게 없으면 그대로 둡니다.
2. **AGENT.md 갱신** — 새 규칙, 새 디렉터리, 새 레시피가 생겼으면 이 문서에도 반영합니다.
3. `npm run typecheck` 통과
4. `npm test` 통과 (버그 수정이면 회귀 테스트를 함께 추가)
5. 사용자에게 무엇을 바꿨고 README 또는 어떤 상세 문서를 고쳤는지 짧게 보고합니다.

커밋과 푸시는 사용자가 요청할 때만 합니다.
새 기능 작업은 최신 `main`에서 새 작업 브랜치를 만들어 진행합니다.

## 2. README.md와 상세 문서 갱신 기준

README와 상세 문서는 한국어로, 사용자가 **그대로 복사해 실행할 수 있는** 명령과 예시 위주로 씁니다. 코드와 문서가 어긋나면 문서가 틀린 것으로 보고 고칩니다.

README는 저장소를 클론해 **자기 노트북에서 사용하는 사람**을 기준으로 소개·`npm run build && npm start`·필수 환경변수·포트 변경·문서 링크를 중심으로 짧게 유지합니다. 코드 개발자는 `docs/development.md`에서 `npm run dev`와 개발 설정을, 공용 서버 접속 사용자·운영자는 `docs/deployment.md`에서 `shared`·`ssh` 설정과 회원별 키 관리를 안내합니다. 로그인·기능별 세부 설명은 해당 문서로 연결합니다. 새 사용자 문서를 만들면 README의 문서 표에 추가하고, 문서 안의 상대 경로와 절 링크도 확인합니다.

OpenRouter 키는 관리자가 제공한 키가 있으면 사용하고, 제공받지 못한 경우 본인이 발급한 키를 사용한다고 안내합니다. 사용자가 반드시 직접 발급해야 한다고 단정하지 않습니다.

| 이런 걸 바꿨다면 | 고칠 문서와 위치 |
|---|---|
| 환경변수 추가·삭제·기본값 변경 | [설정](docs/configuration.md)의 환경변수 표, `.env.example`·`.env.admin.example`. 첫 실행에 필요하면 README "환경변수"도 갱신 |
| CLI 인자 (`scripts/dev.mjs`, `server/src/config/env.ts`) | [개발 서버 관리](docs/development.md)의 "포트와 주소 변경" (`dev.mjs`의 `usage()`도 같이) |
| 설정 파일 필드 (`server/src/config/schema.ts`) | [설정](docs/configuration.md)의 "설정 파일" JSON 예시와 설명 목록 |
| 새 어댑터 / 기본 경로 변경 | [설정](docs/configuration.md)의 "읽는 위치 (기본값)" 표, README의 지원 도구 목록 |
| AI 제공자·모델·전송 범위, AI가 쓰는 문장과 규칙 대체 조건 | [AI와 데이터 저장](docs/ai.md)의 "AI 제공자와 외부 문서 검색" 표와 설명 |
| 로그인·권한·바인딩 규칙 | [로그인](docs/authentication.md), [서버 운영](docs/deployment.md)의 해당 절 |
| `scripts/grant-read-acl.sh` | [서버 운영](docs/deployment.md)의 "다중 계정 운영" 명령 블록 |
| Supabase 마이그레이션·표 추가 (`supabase/migrations/`) | [로그인](docs/authentication.md)의 "Supabase 최초 설정", [AI 호출 기록](docs/ai.md), [Supabase 저장 분석](docs/supabase-storage.md)의 해당 표 |
| npm 스크립트 추가·변경 | [개발 서버 관리](docs/development.md)의 실행·검사 명령. 첫 실행에 영향이 있으면 README "빠른 시작"도 갱신 |
| 디렉터리 구조 변경 | [개발 서버 관리](docs/development.md)의 "프로젝트 구조", 이 문서의 구조 |
| 사용자 눈에 보이는 새 기능 | [주요 기능](docs/features.md)의 해당 절. 프로젝트 소개가 바뀌면 README 요약도 갱신 |

README에 쓰지 않는 것: 내부 구현 세부, 작업 로그, 변경 이력(그건 커밋 메시지에), 실제 사용자명·경로·토큰. 내부 작업 규칙은 이 문서에 두며 사용자 문서에 실제 비밀값을 넣지 않습니다.

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
  src/llm/         AI: digest(전송용 요약 + 비밀값 마스킹) · gate(AI 문장을 쓸 수 있는지와 못 쓰는 사유) · reader(읽는 사람 수준별 문체 지침, withReader) · claude-cli · openai-compat(OpenRouter 전용, fetch) · concepts(개념 ID·링크 검사) · models(모델 목록) · select(제공자 선택) · credentials(로컬 개인 키·공용 서버 UUID별 키 선택) · log(AI 호출·작업 기록 형식, withAiRun) · jobs · cache
  src/auth/        홈 디렉터리 토큰 로그인·Supabase 이메일 회원가입/로그인·HttpOnly 세션 갱신, 쿠키, 미들웨어
  src/cloud/       공개 Supabase 설정·사용자 토큰 Data API, RLS 문서/추가 전용 원장 저장소, 사용자별 서비스·작업 큐, ai-log(vt_ai_calls·vt_ai_runs 추가 전용 AI 호출 기록)
  src/config/      설정 스키마(zod)·저장소·환경변수/CLI 인자
  src/routes/      API 라우트. 공통 의존성과 HttpError 는 routes/deps.ts
  src/lib/         fsx(안전한 파일 IO) · jsonl · shell(셸 명령 파서) · text · hash
                   · concurrent(순서를 보존하는 동시 IO 상한) · progress(AsyncLocalStorage로 작업별 실제 IO·AI 단계 추적)
                   · peer(loopback 연결을 연 OS 계정 uid를 /proc/net/tcp에서 찾기, web/vite.config.ts 프록시도 사용)
  src/wiki/        프로젝트 위키: build(AI 입력 snapshot) · validate(출처 검사·격리) · plan(설명 계획) · graph(선행관계) · catalog · service
  src/learner/     내 이해 정보(사용자 전체): reducer(원장 → 개념 상태) · service(원장 쓰기, revision 충돌, 예전 프로젝트별 원장 병합)
                   · knowledge(AI 개념이 나온 곳·명시적 이해 증거) · knowledge-service(내 세션 모으기·캐시)
                   · knowledge-text(설명 문장 AI 작성: 사실 → 프롬프트, 넘겨짚는 문장 거르기, 지문별 저장, 작업)
                   · knowledge-view(재방문용 목록 캐시: 사용자·수준·계정 권한·범위 분리, 현재 원장 상태를 다시 적용)
                   · prefs(사용자 설정: 읽는 사람 수준, prefs.json)
  src/repo/        레포 위키: scan(저장소 읽기 전용 스캔) · database(SQL·Prisma·ORM 표 정의, SQL 함수가 쓰는 표, 코드에서 쓰는 줄을 구문으로 읽기) · db-link(기능과 이어지지 않은 표마다 관계있는 주요 기능을 짧게 묻기) · ref-fix(확인하지 못한 근거 표시를 보낸 표시 중에서 다시 고르게 묻기) · db-calls(공용 모듈 함수를 부르는 기능 코드 찾기) · session-made(세션별 '만들어진 것' 규칙 요약) · feature-pick(주요 기능만 먼저 따로 묻기) · source(근거 파일 안전 읽기) · code(TS 구문 분석·내부 파일 연결) · wiki(사실 초안 조립, 판 비교) · inspect(AI 질문·필요한 코드만 추가 확인) · ai(AI 가 문장·주요 기능 목록 쓰기, 표·코드 유지, 근거 표시 검사)
                   · service(저장·갱신 필요 판단, AI 작업과 실패 상태) · feature(주요 기능별 페이지: AI가 질문을 만들며 여러 단계로 코드 확인, 프롬프트 원문·모델 근거 검사) · prompt-text(AI가 가리킨 코드에서 실제 프롬프트만 구문 분석으로 꺼내기)
  src/assessment/  bank(문항 형식 검사) · service(AI 출제·서버 채점)
  src/help/        도움 패널 질문: answer(대상별 근거 고르기·프롬프트·답 검사) · service(개인 기록·작업)
  src/memory/      개인 장기 기억: search(원장 사건의 검색 표현·한국어 키워드 검색) · service(권한 범위별 조회·POST 후 자동 색인) · mem0(PostgreSQL pgvector·OpenRouter 추출/임베딩) · database(Supabase 우선 설정·비공개 스키마·연결 검사) · supermemory(선택적 클라우드 어댑터)
  src/storage/     <home>/wiki 저장소 (경로 검사, 키별 직렬화, JSONL 원장)
  test/            vitest 테스트와 합성 픽스처
web/               Vite + React 19 + react-router UI (한국어)
  test/           화면 렌더링 검사 (vitest, Node 환경에서 서버 렌더링)
  src/i18n/ko.ts   화면 문자열 모음
  src/components/SessionUnderstand.tsx  "세션 (대화 기록) 분석" 문서 (작업 요약 → 작업 설명 → 개념 → 내 지식 → 보안 점검 + 도움 패널). 고정 주소 /sessions/:sessionKey/analysis, 예전 탭 주소도 유지 (pages/SessionPage.tsx)
  src/components/SessionAnalysisTree.tsx 저장된 분석 문서·하위 절의 트리. wiki/documents.ts와 /api/projects/:id/session-analyses가 원문·AI 호출 없이 저장된 결과만 모은다
  src/context/DisplayContext.tsx        화면 설정(본문 14px·코드 12px·촘촘한 밀도 기본), 설명 난이도와 분리해 브라우저에 저장
  src/components/SettingsPopover.tsx    오른쪽 위 톱니바퀴 설정. Modal.tsx 의 네이티브 dialog로 초점·Escape·복귀 처리
  src/components/RepoSourceViewer.tsx   근거 파일 원문·줄 강조·검색, RepoFlowView.tsx 는 검증된 파일 연결을 SVG로 표시
  src/components/RepoDatabaseView.tsx   데이터베이스 표: 요약 표(표 → 저장하는 내용 → 쓰는 기능)와 표별 컬럼·조건·들어가는 내용
  src/components/SecurityReview.tsx    AI가 선정한 보안·데이터 주의사항과 출처 표시
  src/components/HelpPanel.tsx          도움 패널 (설명/질문/퀴즈), src/context/FocusContext.tsx 가 지금 보는 대상을 공유
  src/components/CodeBlock.tsx          의존성 없는 코드 색칠(토큰 분석, React 텍스트로만 그림). 파일 보기·레포 위키 코드·기능 페이지가 함께 쓴다
  src/pages/FeaturePage.tsx             주요 기능 페이지 (/projects/:id/features/:featureId). 본문은 components/RepoFeatureView.tsx, 기능 카드는 RepoWikiView 의 FeatureCards
scripts/           dev.mjs(웹+API 동시 실행), memory-db.mjs(로컬 PostgreSQL 준비), check-memory-db.ts(Supabase·PostgreSQL 접속 검사), setup-accounts.ts(관리자 회원 스키마 준비), postgres-init.sql(pgvector 확장), grant-read-acl.sh(다중 계정 읽기 ACL)
                   inspect-cloud.ts(관리자 읽기 전용 DB 행 수·통계 확인, 개인 데이터 출력 금지)
docs/              configuration.md(환경변수·기록 경로·설정) · development.md(개발 서버·검사·구조)
                   deployment.md(서버 운영·SSH·ACL) · authentication.md(로그인·회원 관리)
                   features.md(주요 기능) · ai.md(AI·데이터 저장·기존 mem0) · supabase-storage.md(저장 분석)
compose.yaml       프로젝트 전용 PostgreSQL + pgvector, loopback 바인딩과 이름 있는 볼륨
supabase/migrations/ 회원·관리자 승인·본인 데이터 RLS·기기 간 쓰기 잠금 SQL, AI 호출 기록 표 (관리자가 순서대로 1회 적용, scripts/setup-accounts.ts 의 MIGRATIONS 목록)
```

## 4. 명령어

루트 `package.json`의 `engines`는 Node.js 20 이상이지만, 현재 Vite·Vitest를 함께 실행하려면 Node.js 22.12 이상을 사용합니다. 개발 서버(pkiin 머신)에서는 PATH 앞쪽의 `/usr/local/bin/node`가 v15라서 npm 자체가 실패하므로, 명령 앞에 `export PATH=/usr/bin:$PATH`를 붙여 `/usr/bin/node`(v22)를 씁니다.

```bash
npm install
npm run memory:db                   # 로컬 PostgreSQL + pgvector 준비 (.env에 접속 설정 생성)
npm run memory:check                # 설정된 Supabase·PostgreSQL 접속과 합성 쓰기·검색 검사 (AI 호출 없음)
npm run accounts:setup              # 관리자: 같은 프로젝트의 Supabase 회원·승인·RLS·AI 호출 기록 스키마 준비 (없는 표만)
npm run cloud:inspect               # 관리자: Supabase 행 수·RLS·누적 읽기·쓰기 확인 (읽기 전용)
npm run dev                         # API :3318 + 웹 :3317 (웹의 /api 는 API 로 프록시)
npm run dev:server                  # API 만
npm run dev:web                     # 웹만
npm run build && npm start          # web/dist 빌드 후 API 가 UI 까지 한 포트로 서빙
npm run typecheck                   # shared → server → web 순서로 tsc --noEmit
npm test                            # vitest run (server/test/**, shared/test/**)
npx vitest run server/test/lib/shell.test.ts   # 파일 하나만
npx vitest run -t "codex adapter"              # 이름으로 골라 실행
```

개발 중 설정·캐시를 실제 홈과 분리하려면 `npm run dev -- --home /tmp/vt-dev` 처럼 `--home` 을 씁니다.

개발 기본 포트는 웹 `3317`, API `3318`입니다. 변경 시 `scripts/dev.mjs`·`web/vite.config.ts`·설정 스키마·`.env.example`·README를 함께 맞춥니다. `mem0ai/oss`는 `server/package.json`에 고정한 `mem0ai` `3.3.1`을 사용하며 1.x로 낮추지 않습니다.

## 5. 지켜야 할 불변 조건 (보안·프라이버시)

이 앱은 **여러 사람의 대화 기록**을 다룹니다. 아래는 편의를 위해 완화하지 않습니다.

- **스캔 대상은 읽기 전용.** `~/.claude`, `~/.codex`, `~/.copilot`, VS Code 저장소 등 스캔하는 홈에는 아무것도 쓰지 않습니다. 파일 쓰기는 `VIBE_TEACHER_HOME`(기본 `~/.vibe-teacher`) 아래 설정·캐시·`wiki/`에 허용합니다. 장기 기억 검색 DB는 `VIBE_TEACHER_SUPABASE_DATABASE_URL` 우선, 없으면 `VIBE_TEACHER_MEMORY_DATABASE_URL`의 PostgreSQL에만 쓰며, 로컬 준비 명령은 프로젝트 `.env`에 DB 접속 설정을 저장하고 전용 Docker 볼륨을 사용합니다. JSON 파일 쓰기는 `server/src/lib/fsx.ts` 의 `writeJsonAtomic` 을 씁니다.
- **LLM 에는 다이제스트만.** 원본 JSONL, 도구 출력 전문은 절대 보내지 않습니다. 보내는 내용은 `server/src/llm/digest.ts` 의 `buildDigest` 를 거치고 `maskSecrets` 로 마스킹합니다. 새 비밀값 형식을 발견하면 `SECRET_PATTERNS` 에 추가하고 테스트를 붙입니다.
- **교육 내용은 AI가 생성한다.** 개념 선정·설명·위키 구성·주의사항·선행관계·연습 문항은 AI가 작성한다. 고정 카탈로그나 규칙 기반 대체 문장을 다시 넣지 않는다. 코드는 원문 수집·접근 권한·출처 참조·스키마·순환·출력 예산을 검사한다. AI를 쓸 수 없으면 실패 사유를 표시한다. GET은 AI를 호출하지 않고 POST로만 생성한다. `llm.autoText`는 자동 POST 여부이며 수동 생성은 유지한다.
- **AI 생성·외부 문서 검색 API는 OpenRouter만 사용한다.** 기본 모델은 `openai/gpt-5-mini`. 로컬의 auto 설정은 Claude CLI를 우선하고 CLI 실패·외부 문서 검색은 OpenRouter로 처리한다. 공용 서버 shared는 사용자별 키 추적을 위해 OpenRouter로 실행한다. 취소는 다른 제공자로 재시도하지 않는다. OpenAI·Anthropic 직접 호출이나 해당 API 키 사용을 추가하지 않는다. 문서 검색에는 공개 개념 이름만 보내고 프로젝트 원문·사설 경로는 넣지 않는다. 참고 링크는 실제 API 검색 출처와 대조한다. 개인 기억 정리·임베딩도 OpenRouter를 사용한다. 명시적으로 선택한 Supermemory 클라우드 어댑터만 아래 장기 기억 규칙에 따라 별도 API를 사용한다.
- **기본 바인딩은 `127.0.0.1`.** loopback 이 아닌 주소는 `VIBE_TEACHER_TOKEN`, `auth.mode=home-token` 또는 Supabase shared 로그인 없이는 부팅을 거부합니다 (`server/src/index.ts`). Supabase local은 loopback만 허용하고 처음 인증한 UUID를 앱 저장소 `local-owner`에 묶습니다.
- **Supabase 회원 데이터는 사용자 JWT + RLS.** `VIBE_TEACHER_AUTH_MODE=supabase`가 기존 인증보다 우선합니다. `/auth/v1/user`로 검증한 UUID만 학습자·저장소 주체로 사용하고 사용자 metadata·이메일·OS 사용자명·요청의 userId로 권한을 만들지 않습니다. 공개 키만 일반 설치에 배포하며 관리자 AI 키는 `.env.admin`에 둡니다. 서비스 키나 DB 암호를 사용자의 브라우저·로컬 설치로 내려주지 않습니다. 회원의 승인·관리자·OS 계정 연결은 `vt_members`와 검증하는 SQL RPC에서만 변경합니다. Supabase 관리자도 연결된 OS 계정과 본인 학습 행만 조회하며 회원 관리 목록만 별도 허용합니다.
- **회원 모드 저장과 작업을 분리한다.** `CloudRuntime`에서 사용자별 `WikiStorage`·AI 분석 캐시·작업 큐를 만듭니다. 새 위키·질문·학습·설정 서비스는 `deps.storage`를 재사용해야 하며 파일 저장소를 새로 만들어 우회하지 않습니다. CloudStorage는 실패 시 로컬로 대체 저장하지 않습니다. 원본 로그·소스 파일은 현재 기기에서 읽고 업로드하지 않습니다. 단, AI에 실제로 보낸 요청 본문(마스킹한 요약·발췌)은 아래 AI 호출 기록에 남깁니다. 회원 모드는 Supabase 공유 원장의 키워드 검색을 사용하며 mem0 직접 DB 설정을 적용하지 않습니다. 기존 비회원/홈 토큰 데이터는 자동으로 업로드하거나 합치지 않습니다.
- **회원 모드의 AI 호출은 빠짐없이 기록한다.** `OpenAiCompatProvider`·`ClaudeCliProvider`는 성공·실패·취소와 관계없이 실제 요청 하나마다 `AiLog.call`(`server/src/llm/log.ts`)을 호출한다: 보낸 본문 전체(CLI는 인자·표준 입력), 응답 원문, 스키마를 통과한 결과, 요청·응답 모델, 토큰, 요금, 생성 ID. API 키·인증 헤더·실행 파일 경로·환경변수는 넣지 않는다. 사용자 작업은 `withAiRun(storage, { feature, … }, signal, fn)`으로 감싸고, 안의 모든 `complete()`에 `trace: run.trace`를 넘기며, 저장한 최종 결과물은 `run.result(file, value)`로 남긴다. 기록은 `WikiStorage.aiLog`(CloudStorage의 `CloudAiLog`)를 통해 사용자 토큰으로 `vt_ai_calls`·`vt_ai_runs`에 추가만 하며 `user_id`는 인증 주체에서만 받는다. 저장 전 `toJsonb`로 비밀값을 다시 가리고 NUL 문자를 바꾼다. 회원에게 조회·수정 권한을 주지 않는다(연습 문항 정답 보호, 관리자는 대시보드에서 조회). 기록 실패는 경고만 남기고 AI 작업 실패로 바꾸지 않는다.
- **계정 범위 밖은 404.** 다른 계정의 리소스는 403 이 아니라 404 로 존재 자체를 숨깁니다. 계정에 딸린 라우트에는 `assertAccount` 를 호출합니다 (`server/src/routes/deps.ts`).
- **권한 없는 홈은 오류가 아니라 상태.** 읽을 수 없는 계정은 `readable: 'denied'` 로 표시하고 나머지는 계속 동작해야 합니다.
- **자식 프로세스 환경.** `claude` CLI 를 띄울 때 `CLAUDE_CONFIG_DIR` 를 제외한 `CLAUDE*` 환경변수를 지웁니다 (Claude Code 안에서 실행해도 중첩 실행이 막히지 않도록).
- **위키: 위험 알림은 사용자 상태와 무관.** `planWiki` 는 공통 알림을 profile 을 보기 전에 정한다. 숙련 추정으로 알림을 숨기거나 줄이지 않는다 (예산을 넘어도 `mandatory_overflow` 로 표시하고 모두 보여 줌).
- **위키: 사실·해석·에이전트 주장 구분.** 세션 기록에 없는 것은 `inference` + `limits`("이 세션 기록에서 찾지 못함")로만 쓰고 저장소 전체의 부재로 단정하지 않는다. 에이전트의 "완료" 보고는 `agent_reported` 로 실행 기록과 분리한다. claim·finding·item ID 와 근거 ID 는 코드가 만들며, `enforceSnapshot` 을 통과하지 못한 것은 격리하고 `status: partial` 로 낮춘다.
- **숙련과 학습 활동을 구분한다.** 세션 로그에서 사용자 이해 증거를 자동 추출하지 않는다. 질문·노출·건너뛰기·모르겠어요는 이해/오답으로 바꾸지 않는다. AI가 만든(candidate) 문항도 처음 풀고 앱 안 도움 없이 낸 응답은 상태 근거로 센다. 화면의 `알고 있어요`는 OX 확인 문제(`AssessmentRequest.purpose='self_check'`)를 맞혔을 때만 서버가 자기보고 known 을 기록하며, known 과 처음 푼 정답이 함께 있으면 OX 하나여도 partial 이다. 자기보고만으로는 상태를 올리지 않는다. 해설 뒤 재시도·도움 사용 응답·이미 푼 문항은 연습 정답·오답과 학습 과정으로 기록해 설명 방침에 활용하되 숙련 확정 근거로 쓰지 않는다. 정답·오답이 섞이면 마지막 오답 뒤의 정답만으로 상태 규칙을 다시 본다. `문제가 이상해요`(`question_feedback` 이벤트)로 알린 문제의 응답은 상태·정답 수·학습 흐름에서 뺀다 (`learner/reducer.ts`, policy-0.4). 직접 선택한 개념별 설명 방식은 우선한다. 학습자 ID 는 인증 주체에서만 만든다 (`learnerIdFor`).
- **위키 AI 는 후보만.** AI 응답은 `server/src/wiki/ai.ts` 의 `acceptWikiAiOutput` 을 거쳐야 실린다: 제공한 ID 만 인용(하나라도 지어내면 그 제안 전체를 버림), 프로젝트 문장은 근거 주장 인용 필수, 출력도 `maskSecrets`. 주의사항도 AI가 근거를 보고 생성하며, AI 결과는 `wiki/projects/<p>/ai/<revision>.json` 레이어로 원장과 따로 둔다. 전송 전 미리 보기(`/wiki/ai/preview`)를 유지한다.
- **CLI 로그인을 고르면 API 키를 넘기지 않는다.** `claude` 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN` 을 지운다 (`childEnv`).
- **읽는 사람 수준은 문체만.** 사용자가 고른 수준(`shared/src/reader.ts` 의 `ReaderLevel`, 기본 `non-dev` = 완전 비개발자)은 AI 문장의 단어·설명 깊이에만 쓴다. 이해 증거가 아니므로 learner 원장에 넣지 않고(`learners/<id>/prefs.json`), 개념 상태·위험 알림·사실·근거를 바꾸지 않는다. 사람이 읽는 문장을 쓰는 **모든** AI 호출은 시스템 프롬프트를 `server/src/llm/reader.ts` 의 `withReader(prompt, level)` 로 감싸고, 결과는 수준별로 따로 저장한다(캐시 키·파일 이름·지문에 수준 포함). 시스템 프롬프트 본문에 특정 독자("초보", "비개발자")를 박아 넣지 않는다. 화면은 사용자가 수준을 고르기 전(`reader.chosen=false`)에는 AI 자동 작성을 시작하지 않고 먼저 묻는다.
- **레포 위키 구성과 문장은 AI가.** AI 응답은 `server/src/repo/ai.ts` 의 `applyRepoAi` 를 거친다: 명령·스크립트·API·폴더 표의 원문 값과 코드 블록은 저장소에서 읽은 그대로 보존한다. API 표의 동작 설명, 연결 그림의 파일 역할·영역 정보는 검증된 AI 설명으로 채운다. AI가 절 구성과 설명을 결정하되 원문 값과 파일 연결은 변조하지 않는다. 근거는 미리 준 표시(`F:경로` 중 실제 파일, `S1…`)만 받고 나머지는 버리며 경고로 남긴다. 입력·출력 모두 `maskSecrets`. 보내기 전 미리 보기(`/repo-wiki/ai/preview`)를 유지한다.
- **데이터베이스 표는 코드가 읽고 설명·기능 연결은 AI가 쓴다.** 주요 기능이 아니라 로그인·잠금·기록 같은 공통 기반에서만 쓰는 표는 AI가 `base`에 이유를 쓰고, 표 설명과 같은 근거가 확인되며 주요 기능과 이어지지 않을 때만 `RepoDbTable.base`로 싣는다. 공통 기반 표는 `incompleteRepoDbTables().unlinked`에서 빼므로 표 연결 질문을 보내지 않는다. `server/src/repo/database.ts`가 SQL(`CREATE`/`ALTER TABLE`·`COMMENT ON`)·Prisma·Drizzle·TypeORM·Mongoose·Sequelize·Knex·SQLAlchemy·SQLModel·Django 정의를 구문으로 읽어 표·컬럼·타입·제약을 원문 그대로 둔다(코드·명령 실행 없음, 값은 `maskSecrets`). 코드에 표 이름이 없는 ORM 모델은 `kind: 'model'`로 두고 실제 표 이름을 추측하지 않는다. 사용처는 서버가 찾는다: 따옴표 안의 정확한 표 이름·`/rest/v1/<표>`·SQL 문, 정의 파일을 (한 단계 거쳐서까지) 불러오는 파일의 모델 이름, Prisma 접근자, 그 표를 본문에서 쓰는 SQL 함수(`parseSqlRoutines`, 다른 함수를 세 단계까지 거친 것 포함, 같은 이름은 나중 정의)를 부르는 줄(`DbUsage.via`, 표의 `routines`에 정의 위치). 표를 쓰는 줄이 공용 모듈 안에 있으면 `repo/db-calls.ts`의 `findModuleCalls`가 그 줄을 감싸는 함수에서 같은 파일 안의 호출자를 세 단계까지 따라가 공개 이름을 고르고, 다른 파일에서 `x.name(…)`(`this.` 제외)이나 불러온 내보낸 함수 `name(…)`을 부르는 줄을 파일마다 한 줄씩(표마다 12파일) 더한다(`DbUsage.through`=모듈 경로, `via`=함수 이름, 흔한 이름은 `STOP`으로 뺀다). 마스킹이 `key = …` 같은 코드를 가려 구문이 깨지므로 함수 윤곽은 `readRepoText(..., { functions: true })`가 원문으로 만들어 이름·줄 범위·부르는 이름만 돌려준다(원문은 돌려주지 않고, 쓰는 줄 글은 마스킹한 글에서 가져온다). 순서는 직접 쓰는 줄 → 공용 모듈 호출 줄 → 표 이름을 셋 이상 늘어놓은 줄(`listing`)이며 표마다 `DB_LIMITS.usages`(16)까지 싣는다. 컬럼 주석과 사용 줄 원문은 AI 입력(`DbScan.hints`)에만 쓴다. `applyRepoAi`는 자료에 있는 표 id·컬럼 이름·지금 위키의 주요 기능 id만 받고, 모든 근거가 확인되며 그중 하나가 그 표의 정의·컬럼·SQL 함수·사용 줄이 있는 파일일 때만 설명과 기능 연결을 싣는다. 기능 파일에 그 표의 사용 줄이 있으면 AI가 고르지 않아도 `usage` 없는 연결(코드에서 확인)로 둔다. 이 연결을 `RepoFeature.tables`로 거꾸로 모아 기능 카드·기능 페이지에 보인다. 설명이 빠진 표(`incompleteRepoDbTables().undescribed`)가 있으면 표 자료(`dbUser`)만 보내 `repo_wiki_database` 보완 호출을 한 번 한다(withReader, 기본 작업). 쓰는 곳이 있는데 어떤 주요 기능과도 이어지지 않은 표(`unlinkedUsed`)는 주요 기능을 잘못 고른 신호다. 전체 입력을 다시 보내지 않고 `repo/db-link.ts`의 `askDbFeatureLinks`가 표마다 "이 표는 지금 주요 기능 중 무엇과 관계가 있나요?" 질문을 서버에서 만들어 한 번에 묻는다(`task=repo-inspect`, `repo_wiki_db_links`, withReader). 보내는 것은 서버가 `readRepoText`로 읽은 사용 줄 앞뒤 발췌(`REPO_DB_LINK_LIMITS`: 표마다 3곳·합계 24,000자, 스캔 때와 지문이 다른 파일은 읽지 않음, `maskSecrets`), 그 파일을 불러오는 파일(`DbScan.importers` → `Materials.dbImporters`)과 그 파일이 속한 기능 id, 지금 주요 기능 목록뿐이다. 답은 자연어 `answer`와 기능 연결·`newFeatures`이며 `mergeRepoDbRepair`(이미 통과한 표 설명은 바꾸지 않고, 새 id만 붙이며 검사·16개 상한은 `applyRepoAi`)로 합친다. 발췌 근거는 `additionalSources`로, 답 문장은 `dbAnswers`로 `applyRepoAi`에 넘겨 같은 근거 검사를 거친다. 그래도 기능과 잇지 못한 표에만 답을 `RepoDbTable.linkAnswer`로 싣는다. 실패하거나 연결하지 못하면 경고만 남기고 원문 표를 싣는다. AI가 `database` 블록을 절에 넣지 않으면 동작 페이지 끝에 `origin: 'source'` 절로 싣고, 사용자 페이지에는 싣지 않는다.
- **주요 기능은 사용자가 하는 일로, 본문보다 먼저 따로 묻는다.** `server/src/repo/feature-pick.ts`의 `askRepoFeatures`가 "이 프로젝트 자체의 주요 기능은 무엇이라고 생각하나요?"(`REPO_FEATURE_QUESTION`)를 묻는다(`repo_wiki_features`, 일반 작업이라 Claude CLI면 기본 모델, withReader). 입력(`Materials.featureUser`)은 README·실행 스크립트·API 경로·표를 쓰는 파일·파일 목록과 모든 세션의 '만들어진 것'(`repo/session-made.ts`)이다. 답은 자연어 `answer`, 사용자가 직접 하는 일 단위의 `features`, 로그인·저장·기록·설정 같은 `foundations`(공통 기반)다. 표 이름이나 공용 저장 모듈로 기능을 만들지 않고 표는 근거로만 쓴다(예전의 "모든 표를 기능에 잇도록 기능을 고르라"는 규칙은 쓰지 않는다). 고른 목록은 본문 입력에 '정해진 주요 기능'으로 붙고 본문 응답의 `features`를 대신하며, 검사는 `applyRepoAi`가 같게 한다. 이때 표 연결 질문은 새 기능을 만들지 않는다(`newFeatures: false`). 질문이 실패하면 경고를 남기고 본문 작성에서 고른다. 취소는 전파한다. 질문 입력과 시스템 프롬프트는 문장 레이어 지문(`textInputHash`)에 들어가고 미리 보기에도 보인다. 연결 근거 검사는 완화하지 않는다.
- **세션의 '만들어진 것'은 규칙으로 모아 저장한다.** `sessionMade`는 `summarizeBuilt` 결과에서 요청(`ownWords`, 160자)·요청 뒤 에이전트 보고 앞부분(240자)·만들고 고친 파일(세션 작업 폴더 안 상대 경로만, 많이 손댄 순)·지운 파일·커밋 첫 줄·패키지 이름만 뽑고 모두 `maskSecrets`한다(처음 2개와 마지막 4개 요청). AI를 부르지 않는다. 레포 위키 판을 만들 때 프로젝트의 모든 세션(최대 `SESSION_MADE_LIMITS.sessions`)에서 모으고 `repo/sessions-made.json`(`SESSION_MADE_VERSION`)에 POST에서만 저장한다. 세션 파일의 수정 시각·크기가 같으면 다시 읽지 않는다. 질문 글(`sessionMadeText`)은 여러 세션에서 손댄 파일을 먼저 보이고 최근 세션부터 24,000자까지 싣는다.
- **주요 기능 페이지는 질문을 AI가 만들고 코드는 서버가 읽는다.** `server/src/repo/feature.ts`: 기능 목록은 레포 위키 AI 출력(`features`)을 `applyRepoAi`에서 검사한 것만 쓴다(참조를 하나라도 확인하지 못하면 그 기능을 거른다, id는 `FEATURE_ID`라 파일 이름에 안전). 주요 기능 목록은 이것 하나다. 사용자 페이지에는 `{ kind: 'features' }` 블록으로 같은 목록을 넣고(AI가 `sourceBlocks`에 `features`로 위치를 고르거나, 없으면 첫 절 다음), AI가 절로 기능을 따로 나열하게 하지 않는다. 분석은 POST로만 시작하며 질문 계획 → (읽기 → 답·후속 질문) × `REPO_FEATURE_LIMITS.rounds` → 페이지 작성 순서다. 파일은 `readRepoText`로만 읽고 글자 수 상한을 지킨다. 근거는 실제로 보낸 발췌 안의 범위만 받는다(`resolveFeatureRef`). 시스템·사용자 프롬프트는 AI가 가리킨 줄을 저장소에서 그대로 옮기고 AI가 다시 쓴 프롬프트를 싣지 않는다. 화면에 보이는 프롬프트 문장은 `repo/prompt-text.ts`의 `extractPrompts`가 구문 분석으로 꺼낸다: 요청 객체의 역할 키(`system`·`user`·`prompt` 등, AI 요청 키가 둘 이상인 객체)와 `{ role, content }` 메시지만 보고, 호출 인자로 넘기는 요청을 우선한다. 값은 같은 파일 변수·상수, 상대 경로로 불러온 파일(`readRepoText`, 읽기 상한), 저장소 함수의 반환값(매개변수에 실제 인자를 넣음)까지 따라간다. 고정 문장이 없는 값은 식 그대로 slot으로 둔다. 역할 키가 없으면 범위 안 문장이 하나일 때만 쓰고 오류·로그 문구는 뺀다. 이 결과는 저장하지 않고 페이지를 읽을 때 `withPromptText`로 계산한다(파일 지문이 분석 때와 같을 때만 파일 전체로 따라간다). 모델 값은 가리킨 줄에 그 문자열이 있을 때만 싣는다(`acceptFeaturePage`). AI 호출 단서 줄(`AI_MARKER`)은 어디를 볼지 알려 주는 입력일 뿐 화면 설명으로 쓰지 않는다. 질문 단계는 `task=repo-inspect`, 페이지 작성은 일반 작업이다.
- **내 지식 설명 문장은 응원하되 상태를 넘겨짚지 않는다.** 맞힌 것을 칭찬하고 문제 풀기를 권하는 문장이다. AI 사실(`entryFacts`)에는 맞힌 횟수만 넣고 오답·질문 수·검토 여부는 넣지 않는다. AI 문장은 `server/src/learner/knowledge-text.ts` 의 `acceptKnowledgeText` 를 거친다: "모르십니다"류 단정, 확인되지 않았는데 "이해하고 계십니다"류, 맞힌 문제가 없는데 "맞히셨어요"류는 버리고 생성 실패를 표시한다(같은 사실로 다시 부르지 않도록 거른 것도 저장). 상태 자체는 AI 가 바꾸지 못한다.
- **저장소 스캔은 읽기만.** `server/src/repo/scan.ts` 는 쓰기·명령 실행(git 포함)을 하지 않고, 심볼릭 링크를 따라가지 않으며, `.env`·키 파일을 열지 않는다(`.env.example` 은 변수 이름만). 표 정의용 `.sql`·`.prisma` 파일은 `readRepoText`로만 읽고 테스트 폴더·`down.sql`은 건너뛴다(`isSchemaFile`, 최대 `DB_LIMITS`). 새로 읽을 파일 종류를 늘리면 비밀값이 섞이지 않는지 테스트(`server/test/repo`)를 붙인다.
- **내 지식 위키: 언급은 증거가 아니다.** 사용자 메시지의 언급은 설명 문장의 맥락으로만 쓰고 상태는 learner 원장으로만 정한다. 붙여 넣은 글(`<pasted_content>`)은 언급으로 보지 않는다 (`ownWords`).
- **도움 패널 질문은 숙련 증거가 아니다.** 질문·답변은 `help.jsonl`, 질문 활동은 learner 원장에 연결한다. 반복 질문은 설명 수요로만 활용한다. 대화 ID는 본인의 같은 프로젝트·세션 기록과 대조하며, 후속 질문은 원래 대상과 대화를 유지한다. 답의 프로젝트 연결은 검증된 claim 인용이 있어야 싣는다 (`acceptHelpOutput`). 도움 패널로 물어본 개념의 문제 응답은 `helpUsed` 로 보조 응답이 된다.
- **장기 기억은 출처가 있는 개인 활동이다.** 로컬 원장이 진실이며 `MemoryService`가 현재 접근 범위를 적용한다. 과거 AI 답변을 현재 프로젝트 사실로 쓰지 않는다. 기본은 mem0 OSS + PostgreSQL pgvector이며 추출·임베딩 API는 OpenRouter만 쓴다. 추출은 앱의 zod 스키마로 검사하고 mem0에는 `infer:false`로 넣는다. SDK의 자유로운 숙련·프로필 추론을 원장에 주입하지 않는다. DB 주소는 `VIBE_TEACHER_SUPABASE_DATABASE_URL` 우선, 없으면 `VIBE_TEACHER_MEMORY_DATABASE_URL`로 지정하고 사용자·앱·모델별 안전한 테이블 이름(접미사까지 PostgreSQL 63바이트 이내)을 사용한다. 암호는 색인 지문과 응답에 넣지 않는다. SDK 설정 파일은 앱 저장소 안으로 지정하고 import 전에 `MEM0_TELEMETRY=false`로 외부 텔레메트리를 끈다. GET은 원장만 읽으며 AI 권한을 확인한 POST 활동 뒤에만 최신 2개를 자동 색인한다. 수동 갱신은 최대 10개다. 검색 결과 ID는 현재 범위의 원기록과 대조한다. 접속 DB·앱·모델 지문별 테이블·매핑을 나누며 원기록 지문별 runId로 중복을 막는다. Supabase는 인증서·호스트 검증 TLS와 `vibe_teacher` 비공개 스키마를 사용한다. 스키마가 공개 API 역할에 노출되었거나 pooler가 search_path를 무시하면 원문 저장 전에 실패한다. 기존 객체 권한은 자동 변경하지 않는다. 공유 pooler에서는 프로젝트 ID도 지문에 포함한다. `database.ts`의 설정·준비를 우회해 SDK를 만들지 않는다. 공개 CA는 `server/data/supabase-ca.crt`이며 사용자 키가 아니다. 새 `sb_secret_` 키와 PostgreSQL URL 암호도 `maskSecrets`에서 가린다. 실패는 표시하고 키워드 검색을 유지한다. `local`은 API 없는 검색, `supermemory`는 명시적으로 선택하는 기존 클라우드 어댑터다.
- **질문 예시는 요청 UI다.** `ko.help.questionExamples`의 대상별 템플릿과 AI 후속 질문은 클릭하면 직접 질문한다. 이를 고정 교육 답변이나 AI 미사용 시 대체 답변으로 쓰지 않는다.
- **정답은 제출 전에 내보내지 않는다.** 브라우저로 가는 문항은 `toPublicQuestion` 을 거친다. 문제 은행(`learners/<id>/question-bank.jsonl`, `LearnerService.saveQuestion`)에는 정답이 공개된 뒤(답했거나 모르겠어요)에만 문제·정답·해설을 남긴다. 제출 전 문항은 사용자 토큰으로 읽을 수 있는 저장소에 쓰지 않는다(회원 모드의 AI 호출 기록은 회원이 조회할 수 없음). `문제가 이상해요`는 문제 은행에 있는 본인 문제에만 받고, 개념·프로젝트는 요청 값이 아니라 은행 기록에서 정한다. 화면에서는 정답을 공개한 뒤에만 퀴즈 카드 머리의 `신고` 버튼(`QuestionReport`)을 보이고, 모달에서 사유·이유를 쓴 뒤 제출 확인을 한 번 더 거쳐 보낸다(되돌릴 수 없으므로).
- **"내 메시지"는 사람이 실제로 입력한 것만.** 도구 결과, `<system-reminder>` 같은 주입 메시지, 사이드체인은 `human` 으로 분류하지 않습니다. 분류 규칙을 바꾸면 해당 어댑터의 분류 테스트를 갱신합니다.
- **Codex 하위 세션과 자동 문맥을 구분한다.** `session_meta.source.subagent` 또는 `parent_thread_id`가 있는 세션은 목록에서 제외하고 직접 읽어도 사용자 입력으로 세지 않습니다. IDE 문맥의 `My request` 본문과 알려진 자동 태그는 `adapters/codex/classify.ts`에서 구분하며, 긴 자동 문맥을 지운 다음 길이를 제한합니다. 코드 블록·인라인 코드의 태그 예시를 지우지 않습니다.

- **메일 인증의 복귀 주소는 앱 주소다.** 가입 요청에 `redirect_to`를 전달한다. `VIBE_TEACHER_PUBLIC_URL` > 요청 Origin > 요청 URL의 origin 순서로 정하며 Vite 프록시 뒤에서도 웹 포트를 보존한다. local은 loopback, shared는 HTTPS만 허용하고 사용자 정보·경로·쿼리·해시가 붙은 주소는 거절한다. Supabase 대시보드의 Redirect URLs 등록은 별도이며 앱 환경변수로 자동 변경하지 않는다. `web/src/auth/email-confirmation.ts`가 React·라우터 시작 전에 콜백 토큰·외부 오류를 URL에서 제거하고 가입용 access token만 POST 본문으로 보낸다. `/api/auth/email-confirmation`은 `/auth/v1/user`의 `email_confirmed_at`을 확인하고 결과만 반환한다. 콜백에서 로그인 쿠키·로컬 소유자를 만들거나 refresh token을 사용·보관하지 않는다. 확인된 결과만 완료 화면에 표시하며 토큰과 외부 오류 원문을 로그·화면·저장소에 남기지 않는다. 만료·검증 실패·서버 장애는 완료와 구분하고 로그인 버튼으로 이어 간다.

- **SSH 터널 서버는 연결을 연 OS 계정으로 기록 범위를 정한다.** `VIBE_TEACHER_DEPLOYMENT=ssh`는 Supabase 회원 모드 전용이며 리눅스·loopback 바인딩만 허용한다 (`server/src/index.ts`, `cloudConfig`). 볼 수 있는 OS 계정은 `vt_members.account_ids`가 아니라 커널이 기록한 상대편 소켓의 uid 하나다 (`lib/peer.ts` → `AuthService.withSshAccount`). Supabase 관리자도 범위가 넓어지지 않는다. uid를 확인하지 못하면 빈 범위로 둔다. 서비스 계정 이름이나 첫 로그인으로 대체하지 않는다. `x-vibe-teacher-peer-uid` 헤더는 연결을 연 쪽이 서버와 같은 uid일 때만 믿는다 (`trustedPeerUid`, vite 개발 프록시용). vite 프록시는 이 헤더를 항상 덮어쓴다. 설치 설정(소스 설정 탭: 스캔 범위·기록 위치·AI 설정·다시 읽기)은 서버 실행 계정 uid로 접속한 설치 관리자만 다룬다 (`AuthService.canManageInstallation` → `requireInstallationAdmin(c, deps)`, 화면은 `me.canManageInstallation`만 본다). 다른 계정으로 접속한 Supabase 관리자는 회원 관리(`requireAdmin`)만 한다. AI 키·승인은 `shared`와 같다.

- **공용 서버 AI 키는 인증 UUID로 선택한다.** `llm/credentials.ts`는 `shared`·`ssh` 요청에 `VIBE_TEACHER_USER_OPENROUTER_KEYS`의 본인 UUID 키만 전달합니다. 일반 회원은 관리자 키·서버의 공통 키·CLI로 우회하지 못합니다. 관리자 계정만 본인 매핑이 없을 때 개발용 키를 사용할 수 있습니다. 승인 검사는 별도로 유지합니다. 키 목록과 관리자 전용 변수는 하위 제공자 환경에서 지우고 응답·로그에 노출하지 않습니다. `CloudRuntime`은 사용자별 환경을 분리하고 키·관리자 상태가 바뀌면 제공자 캐시를 무효화합니다. 로컬 사용자는 `.env`에 설정한 키(관리자 제공 또는 본인 발급)를 사용하며 관리자 개발용 키는 관리자에게만 적용합니다.

- **인증 메일 재발송은 접수와 전달을 구분한다.** 로그인 화면·인증 실패 화면은 `ResendConfirmation`을 사용한다. 공개 키로 `/auth/v1/resend`에 가입용 재발송만 요청하며 가입과 같은 복귀 주소 검사를 적용한다. 계정 존재·인증 여부를 공개 조회하거나 메일 전달을 보장하지 않는다. 가입·재발송 후 60초 대기는 UI 안내이며 Supabase 발송 제한은 별도로 유지한다. 알려진 발송 한도·수신 주소 제한·미인증 오류 코드만 안전한 문구로 바꾸고 외부 오류 원문은 노출하지 않는다. 관리자가 삭제한 `vt_members`는 자동 복구하지 않는다.

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
5. `docs/configuration.md`의 "읽는 위치" 표와 README의 지원 도구 목록을 고칩니다.

### 개념과 위키 생성 변경
- 고정 개념 목록을 추가하지 않는다. `wiki/ai.ts`에서 AI가 필요한 개념·주장·주의사항·카드를 함께 작성하고 출처를 검사한다.
- 새 개념은 세션 snapshot과 AI 레이어에 저장하고 세션 카드·도움 패널·내 지식에 연결한다. 전역 카탈로그로 계정 간 자료를 섞지 않는다.
- 생성 문항은 candidate로 저장하고(처음 풀고 도움 없이 낸 응답은 상태에 반영) 정답·해설은 제출 전 공개하지 않는다.

### 설정 필드 추가
- `server/src/config/schema.ts` 에 zod 로 정의하고 **반드시 `.default()`** 를 줍니다 (기존 사용자의 `config.json` 이 그대로 읽혀야 함).
- 호환되지 않는 변경이면 `version` 을 올리고 마이그레이션을 씁니다.
- `docs/configuration.md`의 "설정 파일" 절을 고칩니다.

### 환경변수 / CLI 인자 추가
- `server/src/config/env.ts` 와 `scripts/dev.mjs` (`usage()` 포함), 필요하면 `web/vite.config.ts` 까지 맞춥니다. 우선순위는 **CLI 인자 > 환경변수 > .env > 설정 파일 > 기본값**.
- 사용자가 설정할 만한 값이면 `.env.example` 에도 주석과 함께 추가합니다. 관리자 비밀값 예제는 `.env.admin.example`에 둡니다. `.env` 는 `server/src/config/dotenv.ts` 와 `scripts/dev.mjs` 가 읽고 `.env.admin`은 API 서버·DB 관리 스크립트만 읽습니다. 우선순위는 셸 > `.env` > `.env.admin`입니다. 실제 값이 든 환경 파일은 절대 커밋하지 않습니다.
- 환경 예제의 기본값은 개인 노트북의 `local`·loopback 바인딩·`npm start` 포트 `3318`로 맞춥니다. 웹 포트 `3317`은 개발 서버 전용임을 명시하며 인증 복귀 주소는 기본 미설정으로 두어 사용·개발 주소를 따라가게 합니다. 일반 로컬 사용자·개발자는 `.env.example`을 복사한 `.env`의 `OPENROUTER_API_KEY`에 관리자가 제공한 키를 넣고, 제공받지 못했다면 본인이 발급한 키를 넣습니다. `.env.admin.example`은 관리자 설정이 필요할 때만 쓰며 관리자 키 빈 값·회원별 키 `{}`를 기본으로 둡니다. `shared`·`ssh`로 바꿀 값, 회원별 UUID 키, 프록시·터널 포트는 `docs/deployment.md`에 안내합니다. 두 예제의 활성 변수를 중복하지 않습니다. 기존 모드·장기 기억·고급 옵션은 `docs/ai.md`와 `docs/configuration.md`의 해당 절에 두고 파일별 배치와 복사 명령을 일치시킵니다.
- `docs/configuration.md`의 표와 예시를 고치고, 첫 실행에 영향이 있으면 README의 표와 빠른 시작도 고칩니다.

### API 라우트 추가
- `server/src/routes/<name>.ts` 에 만들고 `server/src/app.ts` 에 등록합니다. 요청/응답 타입은 `shared/src/api.ts`.
- 계정에 딸린 데이터면 `assertAccount`, 관리자 전용이면 `requireAdmin` 을 호출합니다.
- 웹에서는 `web/src/api/client.ts` 의 `api<T>()` 로 호출합니다.

### 캐시 형식이 바뀌는 변경
- LLM 프롬프트나 출력 스키마를 바꾸면 `shared/src/enrich.ts` 의 `ENRICH_PROMPT_VERSION` 을 올립니다 (AI 분석 캐시 무효화).
- 세션 요약(`SessionSummary`) 형태나 인덱싱 결과가 바뀌면 `server/src/index/cache.ts` 의 `CACHE_VERSION` 을 올립니다.
- 프로젝트는 같은 계정 안에서 `realpath` 기준으로 묶는다. 인덱스 디스크 캐시에는 기록된 원래 경로를 남기고 매 스캔마다 실제 경로를 다시 확인한다. 예전 ID는 `SessionIndex.getProjectIds()`로 조회하며, `createWikiServices`와 프로젝트 저장소에 이 resolver를 넘겨 위키·AI·질문·레포 이력을 함께 읽는다. 예전 파일은 보존하고 새 쓰기는 대표 ID로 한다. 이름·Git 원격 주소만으로 다른 폴더나 계정을 합치지 않는다.

### 회원 모드 저장소 읽기
- Supabase 회원 모드에서는 `storage.readJson`마다 Supabase 왕복(수백 ms)이다. 예전 프로젝트 ID·수준별 파일처럼 서로 독립인 읽기는 `Promise.all`로 동시에 하고, 화면 목록에 필요 없는 큰 파일(`repo/materials.json` 등)은 읽지 않는다. 화면이 이미 받은 응답에 있는 데이터는 다시 요청하지 않는다.
- `CloudStorage`는 같은 시점의 문서 읽기를 최대 40키·URL 예산별로 합치고, 같은 읽기를 합치며, 사용자별 문서·원장을 5초/256항목/8MiB 이내로 캐시한다. 저장 후 이전 읽기 응답이 캐시를 되살리지 못하게 하고, 잠금 안의 문서는 새로 읽는다. 원장은 추가 전용이므로 과거 prefix는 재사용하되 마지막 seq 뒤의 행을 반드시 조회한다. 잠금·실패·기기 간 revision 검사를 캐시로 우회하지 않는다.
- 같이 저장하는 문서는 `storage.writeJsonBatch`를 쓴다(회원 모드는 한 upsert 요청, 파일 저장소는 독립 파일 병렬 쓰기). 세션 목록의 IO는 `mapConcurrent(..., 6, ...)`로 제한한다. 의존하는 AI 후속 질문은 순서를 유지한다.
- 브라우저 GET 캐시는 메모리 5초/150항목/8MiB 이내이며 쓰기·인증 변경·작업 완료에 비운다. 인증·폴링·원문·미리보기는 제외하고 명시적 새로고침은 `cache: 'no-store'`로 호출한다. 인증·회원 권한 조회는 동시에 진행 중인 동일 토큰 요청만 합치고 응답 TTL 캐시는 만들지 않는다.
- `JobQueue`의 진행률은 `lib/progress.ts`의 실제 단계만 사용한다. 제공자는 실제 AI 호출을 `beginActivity('ai')`로 감싸고 기록 저장 전 끝낸다. `CloudClient`는 Supabase 읽기·쓰기를 추적한다. 100%는 최종 저장 후 성공한 작업에서만 사용하고 시간 기반 가짜 진행률은 만들지 않는다. 화면은 `JobProgress`를 재사용한다. `/api/me/storage` 통계는 사용자별 저장소의 HTTP 요청 수이며 DB 스캔 통계와 구분한다.
- 내 지식은 `/api/me/knowledge/saved`의 저장된 목록을 먼저 표시하고 최신 조회와 병렬로 갱신한다. 저장된 보기는 AI 자동 작성을 시작하지 않고, 현재 원장의 학습 상태를 적용한다. GET의 `knowledge-views` 쓰기는 파생 목록 캐시이며 학습 이벤트를 추가하지 않는다. 같은 내용은 다시 쓰지 않는다. 캐시는 현재 계정 권한·수준·범위가 일치해야 재사용하며, 늦은 캐시 응답이 새 화면을 덮어쓰면 안 된다. 이전 AI 설명은 학습 상태·정의·허용된 출처가 유지된 경우에만 표시를 붙여 남긴다.

### 위키 생성 변경
- AI의 claim·finding·item은 제공된 근거와 올바른 개념 참조가 있어야 한다. 없는 참조를 일부 지워 카드를 살리지 않고 해당 후보를 거른다.
- AI 위험 판단은 근거 상태·영향·생명주기를 구분하고 관찰 범위를 보존한다. 모든 프로젝트에 같은 점검 목록을 붙이지 않는다.
- 입력 형식 변경은 `RULES_VERSION`(AI 파이프라인 식별자)을 올린다. 이전 규칙 기반 snapshot은 현재 화면에 사용하지 않고 이력 파일은 보존한다.

### 문항·선행관계 추가
- 문항은 `assessment/service.ts`에서 AI로 생성한다. 객관식은 정답 1개·선택지 3개 이상, OX는 `o`,`x`. 생성 문항은 `candidate`로 보존한다. 생성 입력에는 같은 개념의 문제 은행 문제(`previousQuestions`)와 `문제가 이상해요` 사유(`userFeedback`)를 넣어 반복과 같은 문제점을 피한다.
- 선행관계는 AI 결과에서 받아 구조·참조·순환을 검사한다. 고정 선행관계 파일은 사용하지 않는다.
- 위키 AI 프롬프트나 출력 스키마(`WikiAiOutputSchema`)를 바꾸면 `shared/src/wiki.ts` 의 `WIKI_AI_PROMPT_VERSION` 을 올린다 (저장된 AI 레이어 무효화).
- 내 지식 설명 문장 프롬프트·사실 형식을 바꾸면 `server/src/learner/knowledge-text.ts` 의 `KNOWLEDGE_TEXT_PROMPT_VERSION` 을 올린다.
- 레포 위키의 원문 자료(스캔 결과·draft 블록·`RepoFacts`) 형식을 바꾸면 `server/src/repo/wiki.ts` 의 `REPO_WIKI_VERSION` 을 올린다. 판(revision) 지문에 들어가므로 새 판의 문장 레이어가 따로 생기고, 예전 위키는 업데이트 전까지 예전 문장과 업데이트 안내를 보여 준다.
- 주요 기능 페이지의 프롬프트·출력 스키마·저장 형식(`RepoFeaturePage`)을 바꾸면 `server/src/repo/feature.ts` 의 `FEATURE_PAGE_VERSION` 을 올린다. 레포 위키 출력의 `features` 형식을 바꾸면 `repo/service.ts` 의 `REPO_TEXT_VERSION` 을 올린다. 레포 위키는 시스템 프롬프트와 입력 전체가 지문(`inputHash`)에 들어간다. 공통 문체나 문장 형식이 바뀌면 `repo/service.ts`의 `REPO_TEXT_VERSION`도 올려 기존 문장 레이어를 갱신 대상으로 돌린다.
- 읽는 사람 문체 지침(`server/src/llm/reader.ts`)을 바꾸면 `ENRICH_PROMPT_VERSION`, `WIKI_AI_PROMPT_VERSION`, `KNOWLEDGE_TEXT_PROMPT_VERSION` 을 함께 올린다 (이 셋은 지문에 시스템 프롬프트 본문이 들어가지 않는다). 수준을 추가하면 `READER_LEVELS`, `reader.ts` 의 지침, `web/src/i18n/ko.ts` 의 `reader.levels`, `docs/features.md`의 "읽는 사람 수준과 화면 설정"을 함께 고친다.
- 위키용 개념 필드를 바꾸면 `server/src/wiki/catalog.ts` 의 `CATALOG_VERSION`, 상태 전이 규칙을 바꾸면 `POLICY_VERSION`, 원장 형식을 바꾸면 `shared/src/wiki.ts` 의 `WIKI_SCHEMA_VERSION` 을 올린다.

### 화면과 한국어 설명
- `만들어진 것`은 `TurnReports`에서 요청별 에이전트 보고 원문을 먼저 보여 주고 마지막 보고를 펼친다. `TurnGroup.finalAssistantText`와 어댑터의 assistant 본문은 표시용 원문이므로 300/4,000자로 자르지 않는다. 도구 입력·출력과 AI 전송용 `digest`의 제한은 유지한다. Codex `phase`를 보존해 commentary를 최종 보고로 쓰지 않으며, phase가 없는 도구는 마지막 도구 활동 뒤의 답변을 사용한다. `agent_message`만 남은 요청도 위치를 보존하고 같은 요청의 response_item 중복만 제거한다. 화면은 에이전트 보고와 실제 작업 기록을 구분하고 Markdown의 HTML·위험한 URL·외부 이미지를 실행하지 않는다.
- 세션 화면은 "세션 (대화 기록) 분석"으로 안내한다. UnifiedAiPanel의 분석 시작은 요약과 작업·개념·보안 분석을 함께 실행하고, 기반 snapshot이 없거나 오래됐으면 만든다. 기술 정보(제공자·전송 미리 보기·모델·시간·요금)는 관리자 또는 직접 선택한 junior/senior에게만 표시한다(`useTechnicalDetails`); 표시 조건으로 서버 권한을 넓히지 않는다. 분석 문서 링크는 `lib/session-analysis.ts`로 만들고 레포 위키·개념 출처에서 같은 고정 주소·개념 앵커로 연결한다. 문서 목록은 계정 권한을 먼저 검사하고 동시 읽기 상한을 지킨다.
- 글씨와 여백은 화면 설정 변수(`--ui-font-size`, `--code-font-size`, `--card-padding` 등)로 정하고, 설명 난이도·학습자 이해 상태와 연동하지 않는다. 설정은 오른쪽 위 톱니바퀴 팝업 하나로 모은다.
- 색상은 `web/src/styles/app.css`의 의미별 토큰(`--panel`, `--surface`, `--text` 등)으로 정한다. 새 패널에도 라이트·다크 모드, 키보드 초점, 좁은 화면, 동작 줄이기를 함께 확인한다.
- 내 지식·퀴즈·학습 기록 문구는 응원하는 말투로 쓴다. 화면에는 맞힌 횟수만 세고 오답 수·질문 수는 원장에 두어 설명 방침에만 쓴다. 맞힌 문제가 없으면 `간단히 확인하기`(도움 패널은 `퀴즈` 탭)로 문제 풀기를 권한다. 확인 기록이 없는 상태(`unknown`)는 배지로 표시하지 않고, 상태는 카드마다 배지 하나로만 보인다. 카드 제목 옆에는 개념 분류만 두고, 상태·자기보고·학습 흐름 배지는 `LearningHistory`의 첫 줄(`status`)에 모은다. 상태 배지와 겹치는 `practicing`은 표시하지 않는다. `알고 있어요` 버튼(내 지식·도움 패널·세션 분석 카드)은 바로 기록하지 않고 `QuizCard purpose="self_check"`를 연다. 내 지식 카드는 한 번 보는 동안 처음 놓인 묶음을 유지한다(답한 뒤 카드가 옮겨져 채점 결과가 사라지지 않게). 내 지식 카드의 `질문하기`는 `FocusContext`가 있으면 도움 패널 질문 탭을, 없으면 첫 근거 세션의 분석 문서(`askConceptPath`, `?ask=<개념 ID>`)를 연다. 도움 질문 API는 세션 근거가 필요하므로 세션 없는 질문 경로를 따로 만들지 않는다. 내 지식 상단 대시보드(`KnowledgeDashboard`)는 카드 배지와 같은 기준으로 알게 된 개념·맞힌 문제·아직 안 풀어 본 개념을 세고(오답 수는 세지 않음), 숫자는 타일, 비율은 같은 색 옅은 단계 트랙의 막대 하나로 그린다. `MemoryPanel`(내 기억 검색)은 사람이 다시 볼 기록만 보여 준다: 답을 받은 내 질문(`/api/me/questions`)과 문제 은행의 풀어 본 문제(`/api/me/solved`, 맞힌 문제만 표시). 둘 다 현재 계정 권한의 프로젝트만, AI 호출 없이 `q` 키워드로 거르며 패널을 펼쳤을 때만 읽는다. 퀴즈 응답·자기보고·열람 같은 내부 원장 기록은 저장과 도움 패널 기억 검색에는 계속 쓰되 이 목록에 보이지 않는다. 기억 저장소 설정과 색인 갱신은 `useTechnicalDetails` 사용자의 기술 정보에만 둔다. `사실 아직 잘 몰라요`(정정 이벤트, 배지 `더 알아보는 중`)는 `익히는 중`·`문제로 확인했어요` 카드에만 두고, 나머지 카드에는 `잘 모르겠어요`(자기보고 unsure)를 둔다. "검토 전"·"숙련 인증"처럼 부족함을 강조하는 문구를 쓰지 않는다.
- 기술 용어는 쉬운 말을 먼저 쓰고 필요한 원어만 덧붙인다. 퀴즈 문장을 바꾸면 문항 version과 은행 version을 올리되 정답·검토 상태를 임의로 바꾸지 않는다.
- 개념의 작업 연결 설명은 확인한 사실과 알아둘 이유(`whyItMatters`)를 잇는다. 잘린 대화·링크·언급 횟수를 본문에 나열하지 않고 원문은 접힌 기록에 둔다. `contextKind=mention`은 대화 언급만 확인된 경우로, 구현·실행 사실로 표현하지 않는다. 자동 감지 개념을 추가할 때는 실용적인 이유도 함께 작성한다.
- 레포 위키의 `security` 절도 AI가 근거를 읽고 작성한다. 세션마다 보안·데이터 항목과 근거를 보존하며, 위키가 만들어진 세션 수와 미점검 범위를 표시한다. 설치 버전별 취약점 검사나 실제 서비스 점검을 한 것으로 표현하지 않는다.
- 레포 위키 문장 형식·공통 문체가 바뀌면 `repo/service.ts`의 `REPO_TEXT_VERSION`도 올린다. 예전 문장 레이어는 GET에서 사용하지 않고 자동 작성 대상으로 돌린다.
- 레포 위키의 표 블록에는 `role`(`api`·`scripts`)을 붙이고, 화면은 `TABLE_FOLD_ROWS`(8줄)를 넘는 표를 `<details>`로 접어 `ko.repo.fold` 문구로 펼친다. 데이터베이스 표는 `RepoDatabaseView`가 그리며 표가 `OPEN_TABLES`(3개)를 넘으면 표별 상세를 접고, 요약 표의 표 이름을 누르면 그 상세를 펼친다.
- 레포 위키 API 표는 방식·경로·동작 설명·파일 순서다. 동작 설명은 경로별 코드 발췌를 받은 AI가 작성하고, `applyRepoAi`에서 방식·경로·파일이 일치하고 해당 파일 근거가 확인된 설명만 병합한다. 원문 경로·파일과 다른 자료 블록은 보존한다. 같은 원문 블록(`sourceBlocks` id)은 페이지마다 처음 고른 절에만 싣고 근거도 그 절에만 붙인다. 저장된 예전 레이어는 `compose`에서 `dropRepeatedBlocks`로 같은 그림·표·코드를 한 번만 남긴다(문장 블록은 지우지 않는다).

### 레포 위키의 코드 근거와 파일 보기
- 파일 읽기는 `repo/source.ts`를 사용한다. 계정 권한을 검사한 프로젝트 아래의 허용된 텍스트만 읽고 숨김 설정·키·심볼릭 링크·특수 파일을 거절한다. 환경 변수 예제는 이름만, 코드의 비밀값은 가려서 반환한다. 응답은 `Cache-Control: no-store`.
- 코드 발췌와 파일 연결은 `repo/code.ts`의 TypeScript 구문 분석으로 모으며 코드·명령을 실행하지 않는다. 파일 근거의 줄·내용 지문을 보존하고, 없는 줄 인용은 버린다. AI는 `flow`의 파일·연결을 바꾸지 못한다. Python은 `from` 줄만 읽고(`pythonImportNames` 가 괄호·`\` 여러 줄 목록을 따라감), `from . import a`·`from .pkg import a` 의 이름은 실제 하위 모듈 파일이 있을 때만 잇는다. `from . import` 로 자기 패키지 `__init__.py` 를 잇지 않는다.
- `flow`의 파일 ID·원문 경로·열·연결·근거는 보존하고, 파일별 동작 설명과 프론트엔드·백엔드·공통 등의 영역 정보만 AI가 작성해 `applyRepoAi`에서 출처 검사 후 입힌다. 이름만으로 영역을 규칙 분류하지 않는다. 상자와 화살표 위치는 설명 줄바꿈·글자 크기를 반영한다. 열은 시작 파일에서의 깊이이고 0열이 곧 시작 파일이다(화면 라벨 `시작 파일 - 이름`, 나머지는 파일 이름만). 시작 파일에서 닿지 않는 파일만 모인 폴더는 `codeFlow`가 그 폴더의 `FOLDER_ENTRY`(`__main__.py`·`__init__.py`·`index.ts` 등)를 0열 시작 파일로 삼아 바깥 폴더부터 층을 나누고, 그래도 남은 파일은 마지막 열에 몰지 않고 1열부터 따로 층을 나눈다. 화면(`flowLayout`)은 영역마다 쓰는 깊이만 왼쪽부터 채우고, 깊이가 하나뿐인 영역만 여러 열로 나눈다(깊이가 다른 열을 쪼개면 화살표가 다른 상자에서 나오는 것처럼 보이므로 나누지 않는다).
- 줄 인용은 제공된 발췌 전체 또는 그 안에 포함된 더 좁은 범위를 허용하고 원래 지문을 보존한다. 같은 파일·같은 지문의 발췌가 겹치거나 맞닿아 빈 줄 없이 이어지면 합친 범위도 허용한다(`coveredRange`, 예: L1-L32 와 L30-L61 → L1-L61). 읽지 않은 줄, 역순·0·안전한 정수 범위를 벗어난 줄은 거절한다. 여러 발췌 사이의 읽지 않은 구간을 합쳐 인용할 수는 없다.
- 확인하지 못한 근거 표시는 버리기 전에 `repo/ref-fix.ts`로 한 번 다시 묻는다(`repo_wiki_refs`, `task=repo-inspect`). `unverifiedRepoRefs`가 `applyRepoAi`와 같은 검사(`refResolver`)로 통과하지 못한 표시만 모으고, 후보는 서버가 실제로 보낸 표시만 준다: 경로 모양의 표시에는 같은 파일의 발췌와 F:경로만(다른 파일로 바꿔 끼우지 않게), 경로가 아닌 표시에는 추가 확인 발췌. `F:` 없이 제공된 파일 경로를 그대로 쓴 표시는 같은 파일 표시로 읽는다(줄 범위 검사는 같다). AI는 후보 중에서 고르기만 하고 후보 밖의 답은 버린다. 고른 표시도 `applyRepoAi`의 검사를 그대로 거치며 같은 표시는 두 번 묻지 않는다. 후보가 없거나 고치지 못한 표시가 남은 항목은 예전처럼 거른다. 문장을 쓰지 않는 호출이라 withReader 를 붙이지 않는다.
- 원본 그래프의 모든 노드에 검증된 동작 설명과 유효한 영역이 있어야 레포 위키를 완료로 저장한다. 누락 시 `repo_wiki_flow` 작업으로 한 번 보완하고 다시 검사한다. 여전히 누락되면 생성 실패로 저장하며 설명 없는 성공 캐시를 만들지 않는다. 보완은 `repo-inspect` 프로필을 쓰고 빠진 노드와 그 파일의 코드 발췌, 이미 통과한 영역만 전달한다(`repoFlowRepairUser`). 통과한 노드·영역은 보완 응답으로 바꾸지 않는다(`mergeRepoFlowRepair`).
- `repo/inspect.ts`는 AI가 최대 6곳의 확인 위치·질문을 고른 뒤 `readRepoText`로 합계 24,000자 이내의 마스킹된 발췌를 읽고 짧은 답을 받는다. 저장소 밖·숨김 설정·키·심볼릭 링크는 읽지 않으며 알려진 지문과 다른 파일도 추가 확인에서 제외한다. 추가 답의 출처는 실제 제공한 줄 범위와 대조한다. GET 미리 보기는 AI를 호출하지 않고 기본 입력과 추가 확인 상한을 알린다.
- `LlmRequest.task=repo-inspect`만 Claude CLI의 `haiku`·`--effort low`로 실행한다 (레포 위키 추가 확인·연결 그림 보완·확인하지 못한 근거 표시 다시 고르기·표와 주요 기능 관계 질문, 주요 기능 분석의 질문 단계). CLI 도구는 계속 비활성화하고 서버가 파일을 읽는다. CLI 실패는 기존 OpenRouter 경로를 쓰며 취소는 전파한다. 보조 확인 실패는 경고를 남기고 원래 코드 근거로 작성할 수 있다.
- 실제 파일 내용의 지문이 위키 근거와 달라지면 현재 파일임을 알리고 예전 줄 강조를 끈다. 글꼴을 적용해도 줄 번호가 변하지 않도록 비밀값 마스킹은 줄바꿈을 보존한다.

### AI 호출 추가
- 새 기능에서 `provider.complete()`를 부르면 작업 함수를 `withAiRun(this.opts.storage, { feature, projectId, sessionKey, readerLevel }, signal, async (run) => …)`로 감싸고 모든 요청에 `trace: run.trace`를 넘긴다. 결과를 저장한 직후 `run.result(file, value)`를 부른다(저장하지 않는 결과는 `run.result(undefined, value)`).
- 새 기능 종류는 `AiFeature`에 추가하고 `docs/ai.md`의 "AI 호출 기록"에 있는 `feature` 목록을 고친다. 서비스는 `deps.storage`를 받아야 회원 모드에서 기록된다.
- 검사: 가짜 `AiLog`를 가진 저장소(`StorageBackend.aiLog`)로 실행 기록·결과물을 확인한다 (`server/test/llm/ai-log.test.ts`, `server/test/cloud-ai-log.test.ts` 참고).

### Supabase 표 추가
- 새 마이그레이션 파일을 `supabase/migrations/`에 추가하고 `scripts/setup-accounts.ts`의 `MIGRATIONS`에 표 목록과 함께 등록한다. 기존 마이그레이션 파일은 고치지 않는다.
- RLS를 켜고 `anon`·`authenticated` 권한을 회수한 뒤 필요한 것만 허용한다. `supabase/tests/rls.sql`에 허용·거절 검사를 추가한다.

### AI 제공자 추가
- 요청 하나마다 `AiLog.call`로 기록한다(성공·실패·취소, 키 제외). `select.ts`의 `providers()`에서 `deps.log`를 넘긴다.
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
- `server/test/memory/postgres.test.ts`는 `VIBE_TEACHER_TEST_DATABASE_URL`을 명시할 때만 실제 PostgreSQL에 접속합니다. 합성 AI 응답을 쓰고 검사에서 만든 임시 테이블만 정리합니다. 미지정 시 해당 통합 검사만 건너뜁니다.
- `server/test/cloud.test.ts`는 합성 Supabase HTTP로 기기 간 저장·인증·권한·장애를 검사합니다. 실제 RLS는 `supabase/tests/rls.sql`을 마이그레이션을 적용한 폐기용 DB에서 실행합니다. 합성 회원을 만들며 마지막에 전체를 롤백합니다. 운영 DB에서 실행하지 않습니다.

## 9. 구현 상태

`plan.md`는 초기 설계이며 현재의 AI 전용 생성 정책과 다른 고정 카탈로그·규칙 대체 제안이 들어 있다. 현재 사용자 지시와 이 문서의 AI 생성 정책을 우선한다. 남은 확장은 Markdown 내보내기, revision 간 프로젝트 사실 갱신, 브라우저 E2E 자동화다.

## 10. 커밋 메시지

사용자가 커밋을 요청하면 기존 이력의 형식을 따릅니다: 한국어 제목 한 줄, 빈 줄, `- ` 불릿으로 주요 변경점. 커밋 전에 typecheck 와 test 를 통과시킵니다.

## 11. 하지 말 것

- 스캔 대상 홈에 파일 쓰기, 권한 변경, 잠금 파일 만들기
- root 로 실행해야만 동작하는 기능 (다중 계정은 ACL 로 해결합니다 — `docs/deployment.md`의 "다중 계정 운영")
- 원본 기록이나 도구 출력을 LLM·로그·외부 서비스로 보내기
- 보안 기본값 완화 (바인딩, 토큰, 404 숨김, 로그인 실패 잠금)
- `web/dist/`, `node_modules/`, `.env*`, `*.local.json` 커밋
- README와 관련 상세 문서를 확인하지 않고 작업 끝내기
