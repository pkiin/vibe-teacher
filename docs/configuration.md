# 환경변수와 설정

[README로 돌아가기](../README.md)

모든 실행 방식의 설정을 모은 참고 문서입니다. 개인 노트북 사용은 [README](../README.md#빠른-시작), 코드 수정은 [개발자 가이드](development.md), 여러 사용자 접속은 [공용 서버 가이드](deployment.md)의 순서를 먼저 따르세요.

- [환경파일 구성](#환경파일-구성)
- [포트와 주소 지정](#포트와-주소-지정)
- [고급 환경변수](#고급-환경변수)
- [읽는 위치](#읽는-위치-기본값)
- [설정 파일](#설정-파일)

## 환경파일 구성

| 대상 | 실행 명령 | `.env` | `.env.admin` |
|---|---|---|---|
| 개인 노트북에서 사용 | 최초 `npm run build && npm start`, 이후 `npm start` | 예제를 복사하고 Supabase 연결 정보·사용할 AI 키 입력. `local` 유지 | 필요 없음 |
| 개인 환경에서 코드 개발 | `npm run dev` | 같은 예제 사용. `local` 유지, 개발 웹 포트·인증 복귀 주소 확인 | 관리자 키·DB 관리가 필요할 때만 |
| HTTPS 공용 서버 운영 | `npm run build && npm start` | `shared`, HTTPS 주소, 내부 포트 설정 | 회원별 AI 키, 선택적 관리자 키·DB 주소 |
| SSH 터널 서버 운영 | `npm run build && npm start` | `ssh`, loopback 주소, 서버 쪽 포트 설정 | 회원별 AI 키, 선택적 관리자 키·DB 주소 |
| 공용 서버·SSH 터널 접속 사용자 | 브라우저 접속 또는 SSH 터널 | 필요 없음 | 필요 없음 |
| [Windows 설치 묶음](windows.md) 참가자 | `start.bat` | 필요 없음. 포트를 바꿀 때만 묶음 폴더에 만듦 | 읽지 않음 |
| Windows 설치 묶음 만들기 (관리자) | `npm run package` | 대신 `.env.release`에 Supabase 주소·publishable 키만 | 필요 없음 |

예제는 **개인 노트북에서 빌드한 앱을 실행**하는 기본값입니다. 일반 로컬 사용자·개발자는 [`.env.example`](../.env.example)을 `.env`로 복사해 실행 설정과 사용할 OpenRouter 키를 넣습니다. 관리자가 키를 제공했다면 그 키를 사용하고, 제공받지 못했다면 본인이 발급한 키를 사용합니다. 운영자는 실행 방식에 맞춰 값을 바꾸고, [`.env.admin.example`](../.env.admin.example)도 복사합니다. API 키가 들어 있는 실제 `.env`와 `.env.admin`은 모두 공유하지 않습니다.

관리자는 다음 파일을 추가로 준비합니다.

```bash
cp .env.admin.example .env.admin
chmod 600 .env.admin
```

관리자 본인의 개발용 키는 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`, 공용 서버 사용자별 키는 `VIBE_TEACHER_USER_OPENROUTER_KEYS`입니다. 일반 `.env`의 `OPENROUTER_API_KEY`가 빈 값이어도 관리자용 변수와 이름이 달라 값을 가리지 않습니다. 기존 `.env.admin`에 `OPENROUTER_API_KEY`로 넣어 두었던 관리자 키는 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`로 변수 이름을 바꿉니다.

API 서버는 저장소 루트의 `.env` → `.env.admin` 순서로 읽고, 이미 셸에 있는 변수가 가장 우선합니다. Windows 설치 묶음은 묶음 폴더의 `.env` → `app/release.env` 순서로 읽고 `.env.admin`은 읽지 않습니다. 같은 변수는 먼저 읽은 값이 우선하므로, 두 파일에 같은 변수를 중복하지 마세요. 먼저 설정한 빈 문자열도 나중 값을 가릴 수 있습니다. `npm run dev`는 `.env`를 먼저 읽어 웹·API에 전달하고, `.env.admin`은 API에서만 읽습니다. `npm run dev:web`만 실행할 때는 이 실행기를 거치지 않으므로 필요한 포트·프록시 값을 직접 전달합니다.

환경파일을 바꾸면 서버를 재시작합니다. 포트·키 등 서버 환경변수 변경만으로 웹을 다시 빌드할 필요는 없습니다. 나머지 옵션은 [고급 환경변수](#고급-환경변수)를 참고하세요.

## 포트와 주소 지정

우선순위는 **CLI 인자 > 셸 환경변수 > `.env` > 서버 전용 `.env.admin` > 설정 파일 > 기본값**입니다. 로컬 사용자가 사용할 키와 실행 설정은 `.env`, 관리자 전용 설정은 `.env.admin`에 둡니다. 기본 주소는 로컬 전용이며, 공용 서버는 [공용 서버 설치 방법](deployment.md#공용-서버에-설치)을 따릅니다.

`3318`·`3317`은 예제와 코드에 지정된 **기본값**이며 다른 포트를 사용할 수 있습니다. 평소 쓰는 값은 저장소 루트의 `.env`에서 바꾸고, 이번 실행만 바꾸려면 CLI 인자를 사용합니다.

| 대상 | `.env`에서 바꿀 값 | 이번 실행만 바꾸는 명령 | 기본값 |
|---|---|---|---|
| `npm start`의 화면·API | `VIBE_TEACHER_PORT` | `npm start -- --port 3338` | `3318` |
| `npm run dev`의 웹 | `VIBE_TEACHER_WEB_PORT` | `npm run dev -- --port 3337` | `3317` |
| `npm run dev`의 API | `VIBE_TEACHER_PORT` | `npm run dev -- --api-port 3338` | `3318` |
| `npm start`·개발 API의 바인딩 주소 | `VIBE_TEACHER_HOST` | `npm start -- --host 127.0.0.1` / `npm run dev -- --api-host 127.0.0.1` | `127.0.0.1` |
| 개발 웹의 바인딩 주소 | `VIBE_TEACHER_WEB_HOST` | `npm run dev -- --host 127.0.0.1` | `127.0.0.1` |

개발 웹의 `/api` 프록시는 기본적으로 `http://127.0.0.1:<VIBE_TEACHER_PORT>`를 사용합니다. `VIBE_TEACHER_API_URL`을 직접 설정했다면 그 값이 우선하므로 API 포트를 바꿀 때 함께 바꾸거나 해제합니다. 웹·API 개별 실행 예시는 [개발자 가이드](development.md#포트와-주소-변경)를 참고하세요.

셸에서 `VIBE_TEACHER_PORT=3338 npm start`처럼 지정할 수도 있습니다. 셸에 남아 있는 예전 값은 `.env`보다 우선하므로, `.env` 수정이 반영되지 않으면 셸 설정도 확인하세요.

API 주소·포트는 `~/.vibe-teacher/config.json`의 `server.host`·`server.port`에서도 정할 수 있습니다. 다만 예제 `.env`의 `VIBE_TEACHER_HOST`·`VIBE_TEACHER_PORT`가 우선하므로, **설정 파일 값을 사용하려면 해당 환경변수와 CLI 인자를 제거**합니다. 개발에서는 웹 프록시까지 맞추기 위해 `.env` 또는 `npm run dev` 인자로 지정하는 방식을 권장합니다.

코드의 기본값은 API의 [`server/src/config/schema.ts`](../server/src/config/schema.ts), 개발 웹·프록시의 [`web/vite.config.ts`](../web/vite.config.ts), 실행 안내의 [`scripts/dev.mjs`](../scripts/dev.mjs)에 있습니다. 자기 설치의 포트를 바꿀 때는 소스를 수정할 필요 없이 `.env`나 CLI를 사용합니다. `VIBE_TEACHER_WEB_PORT`는 개발 서버 전용이며 `npm run build && npm start`의 접속 포트에 영향을 주지 않습니다.

두 예제 파일의 설정은 다음과 같습니다. 주석 처리된 선택값은 필요할 때만 사용합니다.

| 변수 | 파일 | 입력 기준 |
|---|---|---|
| `VIBE_TEACHER_AUTH_MODE` | `.env` | 예제는 `supabase`. 비우면 기존 `config.auth.mode` 사용 |
| `SUPABASE_URL` | `.env` | 연결할 프로젝트의 HTTPS URL, 회원 모드 필수 |
| `SUPABASE_PUBLISHABLE_KEY` | `.env` | 같은 프로젝트의 `sb_publishable_...` 공개 키, 회원 모드 필수 |
| `VIBE_TEACHER_DEPLOYMENT` | `.env` | 예제 기본 `local`. 공용 서버는 `shared`, SSH 터널로 접속하는 개발 서버는 `ssh` (리눅스·loopback 전용) |
| `VIBE_TEACHER_PUBLIC_URL` | `.env` | 선택. 인증 후 돌아올 앱 주소. 생략하면 가입 요청의 웹 주소 사용 |
| `VIBE_TEACHER_HOST` | `.env` | 예제·기본값 `127.0.0.1`. `local`·`ssh`는 loopback만 허용 |
| `VIBE_TEACHER_PORT` | `.env` | API·빌드 실행 포트, 예제·기본값 `3318` |
| `VIBE_TEACHER_WEB_HOST` | `.env` | 개발 웹 바인딩 주소, 예제·기본값 `127.0.0.1` |
| `VIBE_TEACHER_WEB_PORT` | `.env` | 개발 웹 포트, 예제·기본값 `3317` |
| `VIBE_TEACHER_API_URL` | `.env` | 선택·주석 유지. 개발 웹의 API 프록시 대상. 생략하면 `VIBE_TEACHER_PORT`를 사용 |
| `OPENROUTER_API_KEY` | `.env` | 관리자가 제공한 OpenRouter 키. 제공받지 못했다면 본인이 발급한 키. 노트북 설치는 비워 두고 [화면에서 저장](#화면에서-저장한-openrouter-키)해도 됨 |
| `VIBE_TEACHER_LLM_PROVIDER` | `.env` | 예제는 `openrouter`. 로컬 Claude CLI 로그인은 `auto`, AI 중지는 `none` |
| `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY` | `.env.admin` | 관리자 본인의 개발용 키. 일반 로컬 사용자에게 필요하지 않음 |
| `VIBE_TEACHER_USER_OPENROUTER_KEYS` | `.env.admin` | 공용 서버의 Supabase 사용자 UUID → OpenRouter 키 JSON 객체 |
| `VIBE_TEACHER_SUPABASE_DATABASE_URL` | `.env.admin` | 선택. `accounts:setup` 또는 기존 mem0 SQL 접속용 Session pooler URI |

인증 후 복귀 주소는 `VIBE_TEACHER_PUBLIC_URL`을 지정했다면 그 주소, 미설정이면 가입한 웹 주소를 사용합니다. 주소·포트를 바꾸면 **실제 브라우저 접속 주소**를 Supabase Redirect URLs에 등록하고, 고정한 `VIBE_TEACHER_PUBLIC_URL`도 맞춥니다. 로컬 사용은 기본 `3318`, 개발은 웹 포트 `3317`, SSH는 PC 쪽 터널 포트, 공용 서버는 외부 HTTPS 주소입니다. `local`·`ssh`는 loopback, `shared`는 HTTPS 주소를 사용합니다. 공개 키는 기존 `anon` JWT도 지원합니다. `sb_secret_...`·`service_role` 키는 현재 회원 모드 설정에 필요하지 않습니다.

### 화면에서 저장한 OpenRouter 키

Supabase 노트북 설치(`local`)에서는 로그인한 설치 소유자가 시작 화면이나 **소스 설정 → 설명을 작성할 AI**에서 OpenRouter 키를 저장할 수 있습니다. 키는 `<VIBE_TEACHER_HOME>/secrets/openrouter.json`(기본 `~/.vibe-teacher/secrets/openrouter.json`)에 본인만 읽는 권한(`0600`)으로 저장하고, 화면·API 응답에는 키의 출처만 보여 줍니다. Windows는 사용자 폴더 권한을 따릅니다.

셸 환경변수나 `.env`의 `OPENROUTER_API_KEY`가 있으면 그 값이 우선하며, 화면에서는 바꿀 수 없다고 안내합니다. 저장·삭제는 서버를 다시 시작하지 않아도 다음 요청부터 적용됩니다. 공용 서버(`shared`·`ssh`)는 회원별 키를 운영자가 관리하므로 화면 저장을 받지 않습니다.

### 고급 환경변수

아래 값은 예제에 기본으로 넣지 않습니다. 필요한 항목만 지정한 파일에 추가하세요. 기존 mem0·Supermemory 옵션은 Supabase 회원 모드에 적용되지 않습니다.

| 변수 | 파일 | 용도·기본값 |
|---|---|---|
| `VIBE_TEACHER_HOME` | `.env` | 설정·캐시 위치, 기본 `~/.vibe-teacher` |
| `VIBE_TEACHER_COOKIE_SECURE` | `.env` | `1`이면 HTTPS 전용 쿠키. 회원 모드 `shared`는 항상 적용 |
| `VIBE_TEACHER_TOKEN` | `.env.admin` | 기존 인증 방식의 관리자 Bearer 토큰. Supabase 회원 모드에서는 사용하지 않음 |
| `VIBE_TEACHER_MEMORY_BACKEND` | `.env` | 기존 기억 검색: `mem0`(기본) · `local` · `supermemory` |
| `VIBE_TEACHER_MEMORY_MODEL` | `.env` | mem0 기억 정리 모델. 생략하면 앱의 OpenRouter 모델 사용 |
| `VIBE_TEACHER_MEMORY_DATABASE_URL` | `.env` | 본인의 기존 mem0용 PostgreSQL URI. Supabase 전용 DB 주소가 있으면 그 주소가 우선 |
| `VIBE_TEACHER_POSTGRES_PORT` | `.env` | `memory:db`가 준비하는 로컬 PostgreSQL 포트, 기본 `55432` |
| `VIBE_TEACHER_POSTGRES_PASSWORD` | `.env` | 본인의 로컬 DB 암호. 미지정 시 `memory:db`가 생성 |
| `SUPERMEMORY_API_KEY` | `.env` | 본인의 기존 `supermemory` 검색 어댑터 API 키 |

`memory:db`의 자동 생성 DB 주소·암호는 기존 동작대로 스크립트와 Docker Compose가 함께 읽는 `.env`에서 관리합니다. 관리자 프로젝트의 DB 접속 주소는 `.env.admin`에 보관합니다.

지정한 포트가 이미 사용 중이면 다른 포트로 조용히 옮기지 않고 바로 실패합니다(`strictPort`).

## 읽는 위치 (기본값)

| 도구 | 기본 경로 | 환경변수 |
|---|---|---|
| Claude Code | `~/.claude/projects/<cwd 인코딩>/<sessionId>.jsonl` (+ `<sessionId>/subagents/`) | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, `~/.codex/archived_sessions/` | `CODEX_HOME` |
| Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl` | `COPILOT_HOME` |
| VS Code Copilot Chat | `~/.config/Code/User/workspaceStorage/<hash>/chatSessions/*.json` (Insiders/VSCodium/Cursor, macOS/Windows 경로, `~/.vscode-server/...` 포함) | `XDG_CONFIG_HOME` |

원격(SSH) VS Code 에서는 Copilot Chat 세션이 클라이언트 PC 에 저장되므로, 그 PC 의 경로를 "소스 설정 › 경로 추가"로 등록하거나 파일을 복사해 두세요.

### 내가 쓴 메시지를 구분하는 기준

도구마다 기록 형식에 맞춰 직접 입력한 요청을 구분합니다. Codex는 내부 검토·위임용 하위 세션을 대화 목록에서 제외하고, IDE의 열린 파일 목록·환경 정보·저장소 지침 등 자동으로 붙은 문맥을 걷어낸 요청 본문만 보여 줍니다. 실제 입력 이벤트가 없는 예전 기록은 메시지 본문을 같은 기준으로 구분합니다. 코드 블록에 직접 붙인 예시는 보존합니다.

업데이트 후 서버를 다시 시작하면 기존 세션 목록 캐시를 새 기준으로 갱신합니다. 브라우저에서 새로고침하면 수정된 목록과 메시지를 볼 수 있습니다.

## 설정 파일

`~/.vibe-teacher/config.json` (`VIBE_TEACHER_HOME` 으로 위치 변경). UI 의 소스 설정 페이지에서 편집합니다.

```json
{
  "version": 1,
  "scan": { "mode": "current", "homes": [], "homeRoots": ["/home"] },
  "sources": [{ "id": "…", "provider": "claude-code", "path": "/mnt/backup/.claude/projects", "label": "백업", "enabled": true }],
  "disabledDefaultSourceIds": [],
  "llm": { "provider": "auto", "claudeCliPath": null, "model": null, "maxBudgetUsd": 0.5, "timeoutMs": 180000, "effort": "medium", "openrouterModel": "openai/gpt-6.1-terra", "openaiModel": "openai/gpt-6.1-terra", "autoText": true },
  "server": { "host": "127.0.0.1", "port": 3318 },
  "wiki": { "briefTokenBudget": 900, "maxPrerequisiteDepth": 2, "maxPrerequisitesPerBundle": 4, "maxOptionalQuestions": 2, "suggestQuestions": true }
}
```

- `scan.mode`: `current`(현재 계정만) · `list`(`homes` 에 적은 홈 디렉터리) · `all`(`homeRoots` 아래 모든 홈 + `/etc/passwd` 의 uid ≥ 1000)
- `llm.autoText`: 사람이 읽는 문장(레포 위키, 내 지식 설명, 세션 위키 설명)을 AI 가 자동으로 쓸지. 끄면 자동 생성을 멈추고 버튼으로 생성할 수 있습니다. AI가 없는 경우 설명을 만들어 표시하지 않습니다.
- `wiki`: 프로젝트 위키 설명 계획의 개발용 초기값입니다 (검증된 적정값이 아님). 첫 화면 분량(근사 토큰), 선행 개념 경로 깊이와 개수 상한, 세션당 제안할 이해 확인 문제 수, 문제 제안 여부.
- 인덱스 캐시는 `~/.vibe-teacher/cache/index/`에 기록합니다. 비회원/홈 토큰 모드의 AI 분석 결과는 `cache/enrich/`, 위키와 내 이해 정보는 `wiki/`에 기록합니다. Supabase 회원 모드는 개인·위키·분석 데이터를 사용자 토큰으로 Supabase에 저장합니다. 스캔 대상 홈에는 아무것도 쓰지 않습니다.
