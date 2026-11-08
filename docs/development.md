# 개발자 가이드

[README로 돌아가기](../README.md)

이 프로젝트를 개발 중이거나 클론한 코드를 수정하려는 사람을 위한 안내입니다. 개발할 때는 **`npm run dev`**로 변경을 자동 반영하고, 사용자가 실행하는 결과는 **`npm run build && npm start`**로 확인합니다. 개인 노트북에서 사용만 하려면 [README](../README.md), 여러 사용자를 받는 서버를 운영하려면 [공용 서버 가이드](deployment.md)를 따릅니다.

- [개발 환경 준비](#개발-환경-준비)
- [개발용 환경변수](#개발용-환경변수)
- [실행·종료·재시작](#실행종료재시작)
- [포트와 주소 변경](#포트와-주소-변경)
- [빌드한 웹 실행](#빌드한-웹-실행)
- [검사와 테스트](#검사와-테스트)
- [프로젝트 구조](#프로젝트-구조)

## 개발 환경 준비

Node.js 22.12 이상과 npm을 준비하고, 저장소 루트에서 실행합니다.

```bash
npm install
cp .env.example .env
chmod 600 .env
```

이미 `.env`가 있다면 덮어쓰지 말고 예제와 비교해 필요한 항목만 반영하세요. `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`에 관리자가 안내한 프로젝트 값을 넣습니다. `OPENROUTER_API_KEY`에는 관리자가 제공한 키가 있으면 그 키를, 제공받지 못했다면 본인이 발급한 키를 넣습니다. 직접 Supabase를 준비한다면 [최초 설정](authentication.md#supabase-최초-설정-관리자-1회)을 진행합니다.

일반 개발자도 `.env` 하나로 실행할 수 있습니다. **코드를 개발하는 권한과 Supabase 회원 관리 권한은 별개**입니다. 관리자 본인의 AI 키나 DB 관리 명령이 필요할 때만 [`.env.admin.example`](../.env.admin.example)을 `.env.admin`으로 복사하고, [관리자 설정](deployment.md#환경파일과-실행-방식)을 적용합니다.

## 개발용 환경변수

개인 개발 환경에서는 `.env.example`의 `local`을 유지합니다. `shared`·`ssh`는 여러 사용자가 접속하는 서버의 기록 접근 방식입니다.

| 변수 | 개인 개발 설정 | 관리할 내용 |
|---|---|---|
| `VIBE_TEACHER_AUTH_MODE` | `supabase` 유지 | 개발도 이메일 로그인·회원별 저장을 사용 |
| `SUPABASE_URL` · `SUPABASE_PUBLISHABLE_KEY` | 사용할 프로젝트의 URL·공개 키 | 그 프로젝트에 개발 웹 주소를 Redirect URLs로 등록 |
| `OPENROUTER_API_KEY` | 관리자 제공 키, 없으면 본인이 발급한 키 | OpenRouter로 AI를 사용할 때 필요 |
| `VIBE_TEACHER_LLM_PROVIDER` | 예제는 `openrouter` | 로그인된 Claude CLI를 우선하려면 `auto`, AI를 끄려면 `none` |
| `VIBE_TEACHER_DEPLOYMENT` | `local` 유지 | 내 기기의 기록을 조회. 회원 데이터는 Supabase에 저장 |
| `VIBE_TEACHER_HOST` · `VIBE_TEACHER_PORT` | `127.0.0.1` · `3318` | 개발 중 API 주소·포트 |
| `VIBE_TEACHER_WEB_HOST` · `VIBE_TEACHER_WEB_PORT` | `127.0.0.1` · `3317` | 브라우저로 접속할 웹 개발 서버 주소·포트 |
| `VIBE_TEACHER_API_URL` | 주석 유지 | API 프록시는 기본적으로 `VIBE_TEACHER_PORT`를 따라감. 별도 API에 연결할 때만 지정 |
| `VIBE_TEACHER_PUBLIC_URL` | 주석 유지 | 접속한 웹 주소로 복귀. 고정하려면 `http://127.0.0.1:3317/` |

Supabase Redirect URLs에 **`http://127.0.0.1:3317/`**를 등록합니다. 빌드 결과도 확인한다면 `http://127.0.0.1:3318/`도 등록합니다. 로컬 사용을 위해 `VIBE_TEACHER_PUBLIC_URL`을 `3318`로 고정해 두었다면, 개발할 때는 주석 처리하거나 실제 개발 웹 주소로 바꾸세요.

개발용 설정·디스크 캐시는 `--home`으로 분리할 수 있지만 같은 Supabase 회원으로 저장한 데이터는 그대로 이어집니다. 독립된 회원 데이터로 개발하려면 별도의 테스트 회원 또는 최초 설정을 마친 테스트 프로젝트의 URL·공개 키를 사용합니다.

## 실행·종료·재시작

Node.js 22.12 이상을 사용합니다. `npm run dev`는 웹(Vite)과 API(Hono)를 함께 실행하고 웹의 `/api` 요청을 API로 전달합니다.

```bash
npm run dev
```

| 대상 | 기본 주소 | 변경 감지 |
|---|---|---|
| 웹 | `http://127.0.0.1:3317` | Vite가 화면 변경을 반영 |
| API | `http://127.0.0.1:3318` | `tsx watch`가 서버 코드를 다시 실행 |

실행한 터미널에서 `Ctrl+C`를 누르면 두 서버를 종료합니다. `.env`·`.env.admin`을 변경했다면 종료 후 같은 명령으로 다시 시작하세요. 업데이트 후에는 서버를 다시 시작하고 브라우저를 새로고침합니다.

개발용 설정·디스크 캐시를 별도 위치에 두려면 다음과 같이 실행합니다. 원본 기록의 스캔 범위와 Supabase 회원 데이터는 별도 설정을 따릅니다.

```bash
npm run dev -- --home /tmp/vt-dev
```

## 포트와 주소 변경

`3317`·`3318`은 기본값입니다. 계속 사용할 포트는 `.env`에서 바꿉니다.

```dotenv
VIBE_TEACHER_WEB_PORT=3337
VIBE_TEACHER_PORT=3338
```

서버를 재시작한 뒤 `http://127.0.0.1:3337`에 접속합니다. 이번 실행에만 바꾸려면 다음 명령을 사용합니다.

```bash
npm run dev -- --port 3337 --api-port 3338  # 웹 3337, API 3338
npm run dev -- --help
```

`npm run dev`의 `--port`는 **웹**, `--api-port`는 **API** 포트입니다. `npm start -- --port`는 화면·API를 함께 제공하는 포트를 바꿉니다. `VIBE_TEACHER_API_URL`을 따로 지정하지 않았다면 웹의 프록시도 API 포트를 따라갑니다. 지정한 포트가 사용 중이면 자동으로 옮기지 않고 실패합니다. 셸 환경변수·설정 파일까지 포함한 우선순위는 [포트와 주소 지정](configuration.md#포트와-주소-지정)을 참고하세요.

Supabase 회원 모드는 실제 웹 주소를 Redirect URLs에 등록해야 합니다. `local`·`ssh`는 loopback 주소만 허용하며, 외부 바인딩은 [공용 서버 설치](deployment.md#공용-서버에-설치)를 따릅니다.

웹과 API를 별도 터미널에서 실행할 수도 있습니다. `npm run dev`는 루트 `.env`를 먼저 읽어 양쪽에 전달하지만, `npm run dev:web`만 실행할 때는 이 실행기를 거치지 않습니다. 아래처럼 웹에도 API 프록시 포트를 직접 지정합니다. 기존 셸에 `VIBE_TEACHER_API_URL`을 설정했다면 새 대상에 맞춰 바꾸거나 해제하세요.

```bash
npm run dev:server -- --port 3338
VIBE_TEACHER_PORT=3338 npm run dev:web -- --port 3337
```

## 빌드한 웹 실행

```bash
npm run build
npm start
```

`web/dist`를 만든 뒤 API가 웹까지 한 포트에서 제공합니다. 기본 주소는 `http://127.0.0.1:3318`입니다. 배포 실행은 변경을 자동 반영하지 않으므로 웹 코드를 수정하면 다시 빌드하고 서버를 재시작하세요.

```bash
npm start -- --port 3338 --host 127.0.0.1
```

## 검사와 테스트

```bash
npm run typecheck
npm test
```

타입 검사는 shared → server → web 순서로 실행하며, Vitest는 `server/test/`, `shared/test/`, `web/test/`를 검사합니다. 테스트는 합성 기록과 가짜 AI 제공자를 사용합니다.

```bash
npx vitest run server/test/lib/shell.test.ts  # 파일 하나
npx vitest run -t "codex adapter"           # 이름으로 선택
npm run test:watch                          # 변경 감지
```

실제 PostgreSQL 통합 검사는 검사용 DB 주소를 별도로 지정할 때만 실행합니다. [장기 기억 설정](ai.md#장기-기억-mem0--postgresql--openrouter)과 [Supabase RLS 검사](authentication.md#supabase-최초-설정-관리자-1회)를 참고하세요.

## 프로젝트 구조

npm workspaces 기반의 TypeScript 모노레포입니다.

```text
shared/    도메인 타입, API DTO, LLM 출력 스키마 (zod)
server/    Hono API: 도구별 기록 파서, 세션 인덱스, AI 분석·위키·학습·인증·저장소
web/       Vite + React 19 UI (한국어), 화면 렌더링 테스트
scripts/   개발 서버 실행, DB 준비, 관리자 통계 조회, 다중 계정 ACL
docs/      설정·개발·로그인·서버 운영·기능·AI·Supabase 저장 문서
supabase/  migrations(회원·승인·RLS·AI 호출 기록), tests(RLS 검증 SQL)
```

세부 모듈 구조와 변경 시 지켜야 할 규칙은 [AGENT.md](../AGENT.md)에 있습니다. `plan.md`는 초기 설계이며 현재 동작은 코드와 사용자 문서를 기준으로 확인합니다.
