# vibe-teacher

바이브 코딩 프로젝트. AI 코딩 도구(Claude Code, Codex CLI, GitHub Copilot)의 로컬 채팅 기록을 읽어

- **내가 쓴 메시지만** 뽑아 보여 주고 (도구 결과·시스템 주입 메시지 제외)
- **무엇이 만들어졌는지** 정리하고 (생성/수정/삭제 파일, 실행 명령, 설치 패키지, 커밋, 기술 스택)
- **알아야 할 개념**을 골라 설명하고 (AI가 작업 맥락에서 직접 선정·작성)
- **세션 (대화 기록) 분석**에서 이번 작업·알아둘 개념·보안 주의사항을 문서로 정리하고, 레포 위키와 **내 지식 위키**에서 해당 문서와 개념으로 이동하고
- 프로젝트마다 **레포 위키**(이 레포가 무엇이고 어떻게 동작하는지)를, 사용자마다 **내 지식 위키**(어떤 개념을 어디서 만났고 무엇으로 확인했는지)를 계속 갱신하고 (실험 기능, 아래 참고)
- 레포 위키의 **주요 기능**마다 별도 페이지를 만들어 관련 파일·사용자가 쓰는 흐름·AI를 부른다면 모델과 시스템/사용자 프롬프트(저장소 원문)를 보여 주고, **이 기능 자세히 분석받기**를 누르면 AI가 질문을 스스로 만들어 가며 코드를 더 읽고
- **보안 및 취약점 점검**에서 근거가 있는 주의사항과 추가 확인 방법을 따로 살펴보고
- 오른쪽 위 **설정(톱니바퀴)**에서 글씨·화면 밀도·테마·설명 난이도를 고르고
- **데이터 읽기·AI 작성·저장**의 진행 단계와 예상 진행률을 확인하고, 설정의 **내 저장소 활동**에서 테이블별 요청·실패 수를 보고
- **시작하기**에서 아이디어 탐색·방향 정리·기능 구체화·기존 저장소 중 준비 단계를 골라 다음 할 일과 AI에게 보낼 첫 요청을 받고
- **Supabase 이메일 회원가입·로그인**으로 공용 서버와 로컬 설치에서 같은 개인 설정과 학습 원장을 사용하고 (아래 설치 설정 필요)
- 근거 파일을 **코드 팝업**에서 읽고, **코드 연결 흐름도**에서 실제 파일을 따라가며 이해하고
- 이 모든 설명 문장을 **읽는 사람 수준**(비개발자 · 입문 · 주니어 · 숙련, 기본은 비개발자)에 맞춰 AI 가 쓰는

웹 앱입니다. 공용 서버, 각자의 노트북, 또는 여러 사람이 SSH 터널로 접속하는 개발 서버에서 실행하며 (개발 서버에서는 터널을 연 OS 계정의 기록만 보입니다), 계정(홈 디렉터리) › 프로젝트(작업 폴더) › 세션 계층으로 정리합니다.

같은 계정에서 여러 도구가 **같은 실제 폴더**를 가리키면 하나의 프로젝트로 모읍니다. 심볼릭 링크 때문에 기록된 경로가 달라도 실제 경로를 확인해 세션을 합칩니다. 이름이 같아도 다른 폴더이거나 다른 계정이면 별개로 유지하며, 없거나 읽을 수 없는 폴더는 기록된 경로를 사용합니다. Git 원격 주소가 같아도 별도로 복제한 폴더나 worktree는 자동으로 합치지 않습니다.

업데이트 후 서버를 다시 시작하고 브라우저를 새로고침하면 통합된 목록을 볼 수 있습니다. 예전 프로젝트 링크도 대표 프로젝트로 연결됩니다. 양쪽에 저장한 세션 위키·AI 설명·질문 기록·레포 위키 갱신 이력을 함께 읽으며, 레포 위키는 가장 최근 판을 보여 줍니다. 예전 저장 파일은 보존하고 새 기록은 대표 프로젝트에 저장합니다. 통합 후 레포 위키에 새 세션 안내가 뜨면 **업데이트**를 눌러 합쳐진 세션을 반영합니다.

## 빠른 시작

Node.js 20.12 이상이 필요합니다. 관리자가 Supabase 최초 설정을 마친 프로젝트에 연결하는 순서입니다. 직접 운영한다면 아래 [Supabase 최초 설정](#supabase-최초-설정-관리자-1회)도 진행하세요.

```bash
npm install
cp .env.example .env
chmod 600 .env
```

`.env`에서 **`SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`·`OPENROUTER_API_KEY`**를 채운 뒤 실행합니다. Supabase 두 값은 관리자에게 받은 공통 연결 정보, OpenRouter 키는 본인에게 발급된 개인 키입니다. 예제는 `local` 실행과 `openrouter` 제공자로 준비되어 있습니다.

```bash
npm run dev  # 웹 http://127.0.0.1:3317 / API http://127.0.0.1:3318
```

회원가입 → 이메일 인증 → 인증 완료 안내 → 로그인 → 준비 단계 선택 순서로 시작합니다. 인증 결과 화면의 **로그인하러 가기**를 누르면 로그인 화면으로 이동합니다. 회원 모드의 AI 사용에는 관리자 승인도 필요합니다. Claude CLI 로그인을 쓰려면 `.env`의 `VIBE_TEACHER_LLM_PROVIDER`를 `auto`로 바꿉니다. 키나 CLI 로그인이 없어도 기본 기록 조회·저장은 사용할 수 있습니다.

## 환경파일 구성

| 사용하는 방식 | 필요한 설정 |
|---|---|
| GitHub에서 내려받아 본인 노트북에서 실행 | [`.env.example`](.env.example)을 `.env`로 복사하고 본인의 `OPENROUTER_API_KEY` 입력 |
| 공용 서버 링크에 브라우저로 접속 | 방문자는 환경파일을 만들지 않음. 관리자가 서버에서 사용자별 키를 연결 |
| 관리자의 개발·공용 서버 운영 | 공통 실행 설정은 `.env`, 관리자 개발용 키·사용자별 키 목록·DB 접속 정보는 [`.env.admin.example`](.env.admin.example)을 복사한 `.env.admin`에 입력 |
| 개발 서버에 각자 SSH 로 접속해 사용 | 사용자는 환경파일 없이 SSH 터널만 엶. 관리자는 위와 같이 준비하고 `.env`에 `VIBE_TEACHER_DEPLOYMENT=ssh` ([3. 개발 서버에서 SSH 터널로 함께 쓰기](#3-개발-서버에서-ssh-터널로-함께-쓰기)) |

일반 로컬 사용자는 `.env.admin`을 만들 필요가 없습니다. `.env` 하나에 본인 실행 설정과 개인 API 키를 넣으면 됩니다. API 키가 들어 있는 실제 `.env`와 `.env.admin`은 모두 공유하지 않습니다.

관리자는 다음 파일을 추가로 준비합니다.

```bash
cp .env.admin.example .env.admin
chmod 600 .env.admin
```

관리자 본인의 개발용 키는 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`, 공용 서버 사용자별 키는 `VIBE_TEACHER_USER_OPENROUTER_KEYS`입니다. 일반 `.env`의 `OPENROUTER_API_KEY`가 빈 값이어도 관리자용 변수와 이름이 달라 값을 가리지 않습니다. 기존 `.env.admin`에 `OPENROUTER_API_KEY`로 넣어 두었던 관리자 키는 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`로 변수 이름을 바꿉니다.

파일은 `.env` → `.env.admin` 순서로 읽고, 같은 변수는 먼저 읽은 값이 우선합니다. 두 파일에 같은 변수를 중복하지 마세요. 환경파일을 바꾸면 서버를 다시 시작합니다. 나머지 옵션은 [고급 환경변수](#고급-환경변수)를 참고하세요.

## 회원가입을 사용하는 실행 방법

관리자는 먼저 아래 "Supabase 최초 설정"을 완료합니다. 공용 서버와 모든 로컬 설치에 **같은 `SUPABASE_URL`·공개 키**를 사용하고, 사용자는 같은 이메일 계정으로 로그인합니다.

### 1. 공용 서버에 설치

```bash
npm install
cp .env.example .env
cp .env.admin.example .env.admin
chmod 600 .env .env.admin
```

`.env`의 Supabase URL·공개 키를 채우고 다음 두 설정을 바꿉니다. `VIBE_TEACHER_PUBLIC_URL`에는 브라우저에서 접속할 실제 HTTPS 주소를 넣습니다. 관리자 본인 키와 회원별 키는 아래 방식으로 `.env.admin`에 등록합니다.

```dotenv
VIBE_TEACHER_DEPLOYMENT=shared
VIBE_TEACHER_PUBLIC_URL=https://app.example.com/
```

```bash
npm run build
npm start -- --host 0.0.0.0
```

HTTPS 리버스 프록시 뒤에서 운영하세요. 공용 서버는 항상 `Secure` 쿠키를 사용하므로 일반 HTTP 주소에서는 로그인 세션이 유지되지 않습니다. 사용자는 브라우저에서 **회원가입 → 이메일 인증 → 로그인 → 준비 단계 선택**으로 시작합니다. Supabase에서 이메일 인증을 끈 경우 회원가입 후 바로 로그인됩니다.

관리자는 **회원 관리**에서 AI 사용을 승인하고 해당 회원이 볼 OS 계정을 연결합니다. 연결 전에는 서버의 채팅 기록이 보이지 않습니다. 같은 OS 계정은 두 회원에게 중복 배정할 수 없습니다. 서버의 다른 홈도 읽으려면 아래 "다중 계정 운영"의 스캔 설정과 ACL 준비가 필요합니다. Supabase 관리자도 작업 기록은 연결된 본인 계정 범위만 조회합니다. 회원 관리에서 보는 목록은 이메일·승인·계정 연결 정보입니다.

### 공용 서버의 사용자별 API 키

공용 서버 방문자는 링크로 접속해 로그인하면 됩니다. 아래 SSH 터널 개발 서버(`ssh`)도 같은 방식으로 회원별 키를 등록합니다. 서버 관리자가 **회원 관리**에서 AI 사용을 승인하고, 카드에 표시되는 "API 키 연결용 사용자 ID"를 복사합니다. Supabase Authentication → Users의 사용자 UUID도 같은 값입니다.

`.env.admin`의 `VIBE_TEACHER_USER_OPENROUTER_KEYS`를 다음처럼 작성합니다. UUID와 키는 해당 회원의 실제 값으로 바꿉니다. 아래 두 UUID는 합성 예시입니다.

```dotenv
VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY=관리자_본인의_개발용키
VIBE_TEACHER_USER_OPENROUTER_KEYS='{
  "11111111-1111-4111-8111-111111111111": "첫_사용자의_OpenRouter_키",
  "22222222-2222-4222-8222-222222222222": "두번째_사용자의_OpenRouter_키"
}'
```

공용 서버는 검증된 로그인 UUID에 연결한 키로 OpenRouter를 호출합니다. 서로 다른 키를 등록하면 요청도 각 사용자의 키로 나뉩니다. 사용자별 추적을 유지하기 위해 `shared`에서는 Claude CLI를 사용하지 않습니다. `VIBE_TEACHER_LLM_PROVIDER=none`으로 AI를 끌 수 있습니다.

**회원 승인과 키 등록은 각각 필요합니다.** 일반 회원의 키가 없으면 키 등록 안내를 표시하며, 관리자 개발용 키나 다른 회원의 키를 사용하지 않습니다. 관리자 계정은 본인 UUID에 연결된 키를 우선하고, 미등록 시 관리자 개발용 키를 사용합니다. 키 목록과 키 값은 브라우저 응답에 포함하지 않습니다. 환경파일을 수정한 뒤 서버를 다시 시작하세요. 실제 OpenRouter 키 발급은 관리자가 별도로 진행합니다.

### 2. 각자의 노트북에서 실행

```bash
npm install
cp .env.example .env
chmod 600 .env
```

예제의 `VIBE_TEACHER_DEPLOYMENT=local`을 그대로 두고, 관리자에게 받은 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`와 본인의 `OPENROUTER_API_KEY`를 `.env`에 채웁니다. `.env.admin`과 관리자 DB 주소는 필요하지 않습니다.

```bash
npm run dev  # http://127.0.0.1:3317
# 또는 npm run build && npm start  # http://127.0.0.1:3318
```

처음 로그인한 계정이 이 설치의 소유자가 됩니다. `<VIBE_TEACHER_HOME>/local-owner`에 Supabase 사용자 ID만 보관합니다. 소유자는 해당 기기의 소스·모델을 설정할 수 있지만 회원 승인 권한은 얻지 않습니다. 이후 다른 계정으로 로그인해도 이 노트북의 기록은 볼 수 없습니다. 계정을 잘못 연결했다면 앱을 종료하고 해당 파일을 삭제한 뒤 본인의 계정으로 다시 로그인하세요. 로컬 설치는 loopback 바인딩만 허용합니다.

두 방식 모두 온보딩 답변·설명 수준·학습 활동·질문 원장·세션 위키·레포 위키·AI 분석 결과를 Supabase의 사용자별 저장소에 기록합니다. 장애가 나면 저장 오류를 표시하며 로컬에만 저장하고 성공한 것처럼 처리하지 않습니다. 다른 기기의 동시 쓰기는 사용자별 잠금으로 조정합니다. 잠금 충돌이 표시되면 잠시 뒤 다시 저장하세요. 비정상 종료한 잠금은 5분 뒤 만료됩니다. 모든 AI 요청·응답·결과물·토큰·모델·요금은 별도의 [AI 호출 기록](#ai-호출-기록-supabase-회원-모드)에 남깁니다 (기록 실패는 AI 작업을 막지 않습니다).

**원본 채팅 파일과 저장소 자체는 자동으로 업로드·복제하지 않습니다.** 프로젝트·세션 목록과 코드 보기는 현재 실행 기기에서 읽을 수 있는 파일을 기준으로 합니다. 같은 Git 원격 주소여도 다른 기기의 복제 폴더를 자동으로 같은 프로젝트로 묶지 않습니다. 개인 학습 상태와 설정은 같은 사용자 ID로 이어집니다. 기존 비회원/홈 토큰 모드의 로컬 학습 파일은 그대로 보존하며 회원 데이터로 자동 이전하지 않습니다.

AI 사용 승인은 공용 서버의 AI 호출 권한이며 API 키를 배포하는 기능이 아닙니다. 로컬 AI 생성에는 그 노트북의 Claude CLI 로그인 또는 본인의 OpenRouter 키가 필요합니다. 관리자 서버의 AI를 로컬에서 대신 호출하는 중계와 키 자동 배포는 아직 구현하지 않았습니다. 공용 키를 내려주는 대신 승인 검사·사용량 제한을 갖춘 서버 중계를 추가하는 방향을 권장합니다. Supabase 회원 모드의 기억 검색은 공유 원장의 키워드 검색을 사용하고 mem0 직접 DB 연결은 사용하지 않습니다.

### 3. 개발 서버에서 SSH 터널로 함께 쓰기

서버 한 대에서 관리자 계정(예: `ubuntu`)이 앱을 실행하고, 사용자는 각자 **자기 OS 계정과 SSH 키로** 서버에 로그인해 터널로 접속하는 방식입니다. 서버가 **연결을 연 OS 계정**을 직접 확인해 그 계정의 대화 기록만 보여 주므로, 관리자가 회원 관리에서 OS 계정을 연결할 필요가 없습니다.

관리자(앱을 실행할 계정)가 준비합니다.

```bash
npm install
cp .env.example .env
cp .env.admin.example .env.admin
chmod 600 .env .env.admin
```

`.env`에 Supabase URL·공개 키를 채우고 실행 방식을 바꿉니다. 회원별 OpenRouter 키는 [공용 서버의 사용자별 API 키](#공용-서버의-사용자별-api-키)와 같이 `.env.admin`의 `VIBE_TEACHER_USER_OPENROUTER_KEYS`에 등록합니다. 키 이름은 OS 계정(`user99`)이 아니라 **회원의 Supabase 사용자 UUID**(회원 관리 카드의 "API 키 연결용 사용자 ID", `vt_members.user_id`)입니다.

```dotenv
VIBE_TEACHER_DEPLOYMENT=ssh
```

다른 사용자의 홈을 읽을 수 있도록 [다중 계정 운영](#다중-계정-운영-서버-전체-조회)의 ACL을 **앱을 실행하는 계정**(예: `ubuntu`)에 부여합니다. 그다음 **앱을 실행하는 계정(`ubuntu`)으로 터널을 열고** Supabase 관리자 계정으로 로그인해 소스 설정의 스캔 범위를 `/home 전체`로 바꿉니다.

```bash
npm run build
npm start          # 127.0.0.1:3318 에서만 받습니다
```

각 사용자는 자기 PC에서 **본인 계정으로** 터널을 엽니다.

```bash
ssh -N -L 3318:127.0.0.1:3318 user99@개발서버주소
```

브라우저에서 `http://127.0.0.1:3318`을 열고 회원가입·로그인합니다. 시작 화면에 `접속한 SSH 계정: user99`가 표시되고 그 OS 계정의 기록만 보입니다.

- **원리**: SSH 터널의 연결은 로그인한 사용자 권한으로 도는 sshd가 엽니다. 리눅스는 연결마다 그 연결을 연 계정을 `/proc/net/tcp`에 기록하고, 서버는 이 값을 읽습니다. 다른 사람의 계정으로 위장할 수 없습니다. 리눅스에서만 실행되며 loopback 주소에만 바인딩합니다.
- **소스 설정** 탭은 앱을 실행하는 계정으로 접속한 Supabase 관리자에게만 보입니다. `user99`처럼 다른 계정으로 접속하면 관리자여도 탭이 보이지 않고, 설치 설정(스캔 범위·기록 위치·AI 설정·다시 읽기) 변경 요청도 거절합니다. 회원 관리는 어느 계정으로 접속해도 할 수 있습니다.
- Supabase 관리자를 포함해 모두 **터널을 연 OS 계정**의 기록만 봅니다. 회원 관리의 OS 계정 연결은 이 방식에서 쓰지 않습니다. 학습 기록·설정은 로그인한 회원(이메일) 기준으로 저장합니다.
- 접속한 계정을 확인하지 못하면(다른 기기에서 직접 연결하는 등) 서버의 기록을 보여 주지 않습니다. 서버 안에서 다른 사용자가 직접 `127.0.0.1:3318`에 접속해도 그 사람 계정으로 처리됩니다.
- 인증 메일은 `http://127.0.0.1:3318/`로 돌아오므로 Supabase Redirect URLs에 등록하고, 터널을 연 상태에서 메일 링크를 엽니다. 터널의 PC 쪽 포트를 바꾸면(`-L 4000:…`) 그 주소도 등록해야 하므로 모두 3318을 쓰기를 권장합니다.
- AI는 회원별 키로 OpenRouter를 호출합니다. 서버 계정의 `.env` 키나 Claude CLI를 다른 회원이 쓰지 않습니다.
- 관리자가 `npm run dev`로 띄우면 사용자는 `-L 3317:127.0.0.1:3317`로 접속합니다. 웹의 `/api` 프록시가 원래 접속자 정보를 넘기므로 똑같이 동작합니다.

### Supabase 최초 설정 (관리자 1회)

1. Supabase 프로젝트의 SQL Editor에서 [`supabase/migrations/202611030001_accounts_and_storage.sql`](supabase/migrations/202611030001_accounts_and_storage.sql)과 [`supabase/migrations/202611030002_ai_call_log.sql`](supabase/migrations/202611030002_ai_call_log.sql)을 순서대로 한 번씩 실행합니다. 또는 관리자 `.env.admin`에 해당 프로젝트의 `VIBE_TEACHER_SUPABASE_DATABASE_URL`(Session pooler, 5432)을 넣고 `npm run accounts:setup`을 실행합니다. 준비 명령은 두 파일을 순서대로 적용하며, 이미 존재하는 표는 덮어쓰지 않고 없는 것만 만듭니다. 이미 회원 표를 만든 설치도 같은 명령(또는 두 번째 SQL 실행)으로 AI 호출 기록 표만 추가합니다. 기존 Auth 사용자는 회원 표에 추가되고, 이후 가입자는 자동 등록됩니다.
2. Authentication에서 이메일/비밀번호 로그인을 활성화합니다. **Authentication → URL Configuration**의 Site URL을 현재 앱 주소(개발 기본 `http://127.0.0.1:3317/`, 배포 후에는 공용 서버의 HTTPS 주소)로 설정하고, Redirect URLs에는 각 설치에서 사용하는 주소를 추가합니다. 예: `http://127.0.0.1:3317/`, `http://localhost:3317/`, 빌드 실행용 `http://127.0.0.1:3318/`, 공용 서버의 `https://앱주소/`. 커스텀 포트는 실제 웹 포트를 등록하세요. 가입 요청은 브라우저의 웹 주소를 인증 후 복귀 주소로 전달합니다. 주소를 고정하려면 `.env`에 `VIBE_TEACHER_PUBLIC_URL`을 설정하고 같은 주소를 Redirect URLs에 등록합니다. 이메일 인증 링크로 인증을 마친 뒤 각 설치에서 이메일/비밀번호로 로그인합니다.
3. 프로젝트의 publishable 키(기존 `anon` JWT도 지원)를 설치에 배포합니다. `service_role`, `sb_secret_`, PostgreSQL 암호는 사용자 설치에 넣지 않습니다.
4. 관리자 본인도 회원가입한 뒤 SQL Editor에서 아래 SQL을 실행합니다. 다른 회원의 가입 정보로 관리자 권한을 지정하지 않도록 이메일을 확인하세요.

```sql
update public.vt_members
set is_admin = true, approved = true
where user_id = (select id from auth.users where email = 'admin@example.com');
```

관리자는 이 앱에서 회원가입한 본인 계정에 위 SQL로 권한을 지정합니다. Supabase 대시보드에 별도의 관리자 로그인 계정을 만들거나 Auth 사용자의 `role`·`is_super_admin`을 변경하지 않습니다. 로그인한 상태라면 앱의 "승인 상태 확인"을 누르거나 다시 로그인하면 회원 관리 메뉴가 표시됩니다.

`vt_members`는 본인만 읽을 수 있고, 승인·관리자 여부·OS 계정 연결은 회원이 직접 고칠 수 없습니다. 회원 관리는 관리자 여부를 다시 검사하는 SQL 함수만 사용합니다. `vt_documents`·`vt_events`에는 인증한 사용자 ID와 일치하는 행만 허용하는 [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)가 적용되며, 관리자도 다른 회원의 학습 행을 읽는 우회 정책은 없습니다. 서버는 Supabase의 `/auth/v1/user`로 사용자를 확인하고 HttpOnly 쿠키로 로그인·갱신 토큰을 관리합니다.

RLS·승인·잠금·AI 호출 기록 권한의 SQL 검증은 두 마이그레이션을 적용한 **폐기 가능한 테스트 DB**에서만 실행합니다. 합성 회원의 삽입과 갱신은 마지막에 롤백합니다.

```bash
psql -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" -f supabase/tests/rls.sql
```

### AI 호출 기록 (Supabase 회원 모드)

회원 모드에서 AI를 사용하는 모든 기능(세션 분석, 세션 위키와 개념 문서 검색, 레포 위키와 추가 코드 확인·연결 그림 보완, 주요 기능 자세한 분석, 내 지식 설명, 도움 패널 답변, 연습 문항)은 실제 API 요청마다 한 행을 `vt_ai_calls`에 추가합니다. 출력 형식을 바꿔 다시 보낸 요청, Claude CLI 실패 뒤 OpenRouter로 다시 보낸 요청, 실패·취소한 요청도 각각 남깁니다.

| 표 | 내용 |
|---|---|
| `vt_ai_calls` | `request`(실제로 보낸 본문 전체: 시스템·사용자 프롬프트, 모델, `max_tokens`, 출력 스키마, 웹 검색 설정 / Claude CLI는 실행 인자와 표준 입력), `response`(받은 응답 원문), `output`(스키마 검사를 통과한 결과), `requested_model`·`model`(요청한 모델과 실제 응답 모델), `input_tokens`·`output_tokens`·`total_tokens`·`cached_tokens`·`reasoning_tokens`, `usage`(사용량 원문), `cost_usd`, `generation_id`(OpenRouter 생성 ID), `status`·`error`·`http_status`, `duration_ms` |
| `vt_ai_runs` | 사용자 작업 하나(예: 레포 위키 생성 1회)의 최종 결과물 `result`(검사·필터를 거쳐 저장한 결과), 저장 위치 `artifact_key`(`vt_documents`·`vt_events`의 키), `status`·`error`, 시작·종료 시각 |
| `vt_ai_run_usage` (보기) | 작업별 호출 수·토큰 합계·요금 합계·사용한 모델 |

두 표는 `run_id`로 연결하며 `feature`(`session_enrich`, `session_wiki`, `repo_wiki`, `repo_feature`, `knowledge_text`, `help_answer`, `practice_question`), `project_id`, `session_key`, `reader_level`로 기능과 대상을 구분합니다. 요금은 OpenRouter가 응답에 담아 준 `usage.cost`, Claude CLI의 `total_cost_usd`(USD)입니다.

- API 키·인증 헤더·실행 파일 경로·환경변수는 저장하지 않습니다. 저장 전에 비밀값을 다시 마스킹합니다. 대신 프롬프트에 들어간 세션 요약·코드 발췌가 그대로 남으므로 Supabase 대시보드 접근 권한을 관리자에게만 주세요.
- 앱은 회원 본인 토큰으로 **행 추가만** 합니다. 회원은 자기 기록도 Data API로 조회·수정·삭제할 수 없습니다 (연습 문항 정답이 결과물에 들어 있기 때문). 관리자는 Supabase 대시보드의 SQL Editor·Table Editor에서 조회합니다.
- 행은 각 회원의 토큰으로 앱이 기록하는 사용 내역입니다. 청구 기준은 OpenRouter 대시보드이며, `generation_id`로 대조할 수 있습니다.
- 기록 저장에 실패해도(마이그레이션 미적용·장애) AI 작업과 결과 저장은 계속하고 서버 로그에 `[ai-log]` 경고만 남깁니다. 경고가 보이면 두 번째 마이그레이션을 적용했는지 확인하세요.
- 비회원/홈 토큰 모드와 로컬 mem0 기억 정리·임베딩, 모델 목록 조회는 기록하지 않습니다.

### Supabase 저장소 확인과 대기 표시

오른쪽 위 **설정 → 내 저장소 활동**을 열면 현재 서버에서 본인의 저장소가 만든 테이블별 읽기·쓰기 요청 수, 실패 수, 요청에 걸린 시간의 합계, 캐시 재사용 횟수를 볼 수 있습니다. 서버 재시작 시 초기화되며 다른 회원의 내역은 포함하지 않습니다. 인증 요청·회원 관리 RPC는 이 저장소 통계에 포함하지 않습니다. 시간 합계는 병렬 요청의 시간도 더하므로 화면에서 기다린 시간과 다릅니다.

관리자는 `.env.admin`의 DB 연결 설정으로 현재 행 수, RLS 여부, DB 누적 조회·변경 통계를 읽기 전용으로 확인할 수 있습니다. 개인 UUID·이메일·원문·키·접속 주소는 출력하지 않습니다.

```bash
npm run cloud:inspect
```

`seq_scan`·`idx_scan`은 DB가 실행한 테이블·인덱스 스캔 수이며 API 요청 수가 아닙니다. `n_tup_ins`·`n_tup_upd`·`n_tup_del`도 통계 초기화 이후의 누적 변경 행 수입니다. 관리자 조회와 다른 기기에서 발생한 작업도 포함될 수 있습니다. 실제 조사 수치와 저장 경로는 [Supabase 저장 분석](docs/supabase-storage.md)에 있습니다.

문서와 원장 조회 결과는 사용자별로 5초간 메모리에 재사용합니다. 다른 기기의 변경은 캐시가 만료된 뒤 다시 조회할 때 반영됩니다. 서버·브라우저 캐시를 모두 거치면 응답이 최대 약 10초 오래될 수 있으며 열린 화면이 저절로 갱신되지는 않습니다. 저장 잠금 안에서는 문서를 새로 읽고 원장에 추가된 행도 확인합니다. 읽기 캐시는 서버·브라우저별 크기를 제한하고 디스크에는 저장하지 않습니다. 브라우저는 쓰기·로그인 변경·작업 완료 시 캐시를 비우고, 인증·작업 상태·근거 파일·전송 미리보기는 응답을 캐시하지 않습니다.

레포 위키, 주요 기능 분석, 세션 AI 분석·위키 보강, 내 지식 설명, 도움 답변은 **자료 확인 → AI 작성 → 저장 → 완료** 단계와 진행률을 보여 줍니다. AI 호출과 Supabase 읽기·쓰기를 구분하고, 단계에 따라 예상치를 갱신합니다. 시간으로 퍼센트를 늘리지 않으며 결과 저장을 마친 작업만 100%가 됩니다. 실패·취소는 완료와 구분합니다. 여러 AI 호출이 필요한 작업은 같은 단계에 오래 머무를 수 있습니다. 일반 화면 요청이 길어지면 화면 아래에도 데이터 요청 상태를 표시합니다.

새 마이그레이션은 필요하지 않습니다. 업데이트 후 서버를 다시 시작하고 브라우저를 새로고침하세요.
- 기록은 자동으로 지우지 않습니다. 오래된 행은 관리자가 SQL로 정리합니다.

```sql
-- 최근 AI 작업 20개와 토큰·요금 합계
select run_id, feature, status, calls, input_tokens, output_tokens, cost_usd, models, finished_at
from public.vt_ai_run_usage order by finished_at desc limit 20;

-- 이번 달 회원별 호출 수·토큰·요금
select m.email, count(*) as calls, sum(c.total_tokens) as tokens, sum(c.cost_usd) as cost_usd
from public.vt_ai_calls c join public.vt_members m using (user_id)
where c.created_at >= date_trunc('month', now())
group by m.email order by cost_usd desc nulls last;

-- 작업 하나의 실제 요청·응답·결과물 ('<run_id>'를 위 결과의 값으로 바꿉니다)
select attempt, provider, schema_name, model, status, request, response, output, cost_usd
from public.vt_ai_calls where run_id = '<run_id>' order by started_at;
select artifact_key, result from public.vt_ai_runs where id = '<run_id>';

-- 90일보다 오래된 기록 정리
delete from public.vt_ai_calls where created_at < now() - interval '90 days';
delete from public.vt_ai_runs where created_at < now() - interval '90 days';
```

### 이메일 인증 결과 확인

인증 메일의 링크를 누르면 가입했던 앱 주소로 돌아옵니다. 앱이 Supabase에서 이메일 인증 여부를 확인한 뒤 **메일 인증이 완료되었습니다**와 **로그인하러 가기** 버튼을 표시합니다. 버튼을 눌러 가입한 이메일과 비밀번호로 로그인하세요. 이 확인만으로 자동 로그인하거나 로컬 설치의 소유자를 연결하지 않습니다.

링크가 만료되었거나 유효하지 않으면 오류 안내를 표시합니다. 메일함의 가장 최근 인증 링크를 확인하고, 이미 인증을 마쳤다면 로그인해 보세요. 서버에 연결하지 못한 경우에는 완료로 표시하지 않고 확인할 수 없다는 안내를 보여줍니다. 인증 토큰은 앱이 열리는 즉시 주소에서 제거하며 브라우저 저장소에 보관하지 않습니다. 기존 Redirect URLs의 앱 주소를 그대로 사용하므로 결과 화면을 위해 주소를 추가할 필요는 없습니다.

### 인증 메일이 오지 않을 때

로그인 화면에서 **인증 메일이 안 왔어요 → 인증 메일 다시 받기**를 눌러 가입한 이메일을 입력합니다. 인증 실패·만료 화면에서도 바로 재발송을 요청할 수 있습니다. 비밀번호는 필요하지 않으며 재발송한 링크도 같은 앱 주소로 돌아옵니다. 가입·재발송 요청 직후에는 60초 대기 시간을 표시합니다. Supabase의 실제 발송 한도는 별도로 적용됩니다.

재발송은 **가입한 계정이 아직 미인증일 때** 메일을 보냅니다. 요청 접수 안내가 실제 메일 전달을 보장하지는 않습니다. 스팸함과 이메일 주소를 확인하고, 이미 인증을 마친 계정이라면 다시 가입하지 않고 로그인하세요. 앱은 계정 존재 여부나 인증 여부를 재발송 응답으로 공개하지 않습니다.

관리자는 Supabase **Authentication → Users**에서 계정의 이메일 인증 여부를 확인하고, Auth 로그에서 `over_email_send_rate_limit`(발송 제한)·`email_address_not_authorized`(허용되지 않은 수신 주소) 등 오류 코드를 확인합니다. 앱도 발송 한도·메일 발송 설정·미인증 오류를 구분해 안내합니다. Supabase 기본 발송 서비스는 프로젝트 전체에서 시간당 2통이며 조직 팀원의 이메일 주소로만 보낼 수 있습니다. 다른 주소의 회원가입을 지원하려면 Supabase의 [Custom SMTP 설정](https://supabase.com/docs/guides/auth/auth-smtp)이 필요합니다. SMTP 비밀값은 Supabase 대시보드에서 관리하며 일반 사용자 `.env`에는 넣지 않습니다. 한도는 [공식 문서](https://supabase.com/docs/guides/auth/rate-limits)를 확인하세요.

### 테스트 중 회원 행을 삭제했을 때

Table Editor의 `public.vt_members`는 앱 회원 정보이고, 로그인 계정은 `auth.users`에 있습니다. **회원 행만 삭제해도 Auth 계정의 가입·인증 상태는 초기화되지 않습니다.** 이미 인증한 이메일로 재가입하거나 재발송을 요청해도 새 인증 메일이 오지 않을 수 있습니다. 회원 정보가 누락되었다는 오류가 나오면 관리자가 SQL Editor에서 해당 계정의 회원 행만 복원합니다. 아래 이메일을 실제 테스트 계정으로 바꾸세요.

```sql
insert into public.vt_members (user_id, email)
select id, coalesce(email, '') from auth.users
where email = 'test-user@example.com'
on conflict (user_id) do nothing;
```

복원한 행은 일반 회원·승인 대기·OS 계정 미연결 상태입니다. 기존 관리자 권한·승인·계정 연결은 관리자가 따로 확인해 지정합니다. `accounts:setup`은 이미 준비한 회원 표를 변경하지 않으므로 삭제한 행의 복원 명령으로 사용하지 않습니다. 앱도 삭제된 회원 행을 자동 생성하지 않습니다. 새 가입부터 다시 시험하려고 **Authentication → Users**에서 테스트 계정을 삭제하면 연결된 학습 데이터도 삭제되므로 보존할 데이터가 없는 계정에만 적용하세요.

### 이메일 인증 후 localhost:3000 연결 오류가 날 때

`localhost:3000`은 Supabase의 기본 Site URL입니다. 그 포트에서 앱을 실행하지 않으면 메일 인증 후 연결을 거부했다는 화면이 나옵니다. 위 URL Configuration의 Site URL·Redirect URLs를 실제 앱 주소로 바꾸세요. 앱의 환경변수만 바꾸어서는 Supabase 대시보드 설정이 바뀌지 않습니다.

이미 인증 링크를 눌렀다면 기존에 앱을 열었던 주소로 돌아가 로그인해 보세요. Supabase Authentication → Users에서 해당 계정의 이메일 인증 완료 여부도 확인할 수 있습니다. 기존 이메일의 링크에는 예전 복귀 주소가 남을 수 있으므로 새 설정은 이후 보내는 인증 메일부터 확인하세요. 메일 인증 후 주소의 `#access_token=...`·`refresh_token=...`은 로그인 비밀값입니다. 전체 URL을 공유하지 말고, 공유했다면 해당 세션을 종료한 뒤 다시 로그인하세요.

## 포트와 주소 지정

우선순위는 **CLI 인자 > 셸 환경변수 > `.env` > 서버 전용 `.env.admin` > 설정 파일 > 기본값**입니다. 일반 사용자의 개인 키와 실행 설정은 `.env`, 관리자 전용 설정은 `.env.admin`에 둡니다. 기본 주소는 로컬 전용이며, 공용 서버는 위의 `shared` 설치 방법을 따릅니다.

`npm run dev`는 프론트 `http://127.0.0.1:3317`과 백엔드 `http://127.0.0.1:3318`을 함께 실행합니다. `.env.example`의 두 포트 값을 기존 `.env`에도 넣으면 이전 설정 파일에 저장된 포트보다 우선합니다. 포트를 바꾼 뒤에는 서버를 재시작하고 Supabase Redirect URLs에도 새 프론트 주소를 등록하세요. 다른 앱과 충돌하면 아래처럼 두 포트를 함께 지정할 수 있습니다.

```bash
npm run dev -- --port 3337 --api-port 3338          # 웹 3337, API 3338 (프록시도 3338 을 따라감)
npm run dev -- --host 0.0.0.0 --api-host 0.0.0.0    # shared 설치 + HTTPS 앞단을 준비한 경우
npm run dev -- --home /srv/vibe-teacher             # 설정·캐시 디렉터리
npm run dev -- --help

npm start -- --port 3338 --host 127.0.0.1           # 배포용 서버 (API + UI 한 포트)
npm run dev:server -- --port 3338                   # API 만
npm run dev:web -- --port 3337                      # 웹만 (vite 옵션 그대로)
```

두 예제 파일의 설정은 다음과 같습니다. 주석 처리된 선택값은 필요할 때만 사용합니다.

| 변수 | 파일 | 입력 기준 |
|---|---|---|
| `VIBE_TEACHER_AUTH_MODE` | `.env` | 예제는 `supabase`. 비우면 기존 `config.auth.mode` 사용 |
| `SUPABASE_URL` | `.env` | 연결할 프로젝트의 HTTPS URL, 회원 모드 필수 |
| `SUPABASE_PUBLISHABLE_KEY` | `.env` | 같은 프로젝트의 `sb_publishable_...` 공개 키, 회원 모드 필수 |
| `VIBE_TEACHER_DEPLOYMENT` | `.env` | 예제 기본 `local`. 공용 서버는 `shared`, SSH 터널로 접속하는 개발 서버는 `ssh` (리눅스·loopback 전용) |
| `VIBE_TEACHER_PUBLIC_URL` | `.env` | 선택. 인증 후 돌아올 앱 주소. 생략하면 가입 요청의 웹 주소 사용 |
| `VIBE_TEACHER_PORT` | `.env` | API·빌드 실행 포트, 예제·기본값 `3318` |
| `VIBE_TEACHER_WEB_PORT` | `.env` | 개발 웹 포트, 예제·기본값 `3317` |
| `OPENROUTER_API_KEY` | `.env` | 로컬 사용자의 개인 OpenRouter 키 |
| `VIBE_TEACHER_LLM_PROVIDER` | `.env` | 예제는 `openrouter`. 로컬 Claude CLI 로그인은 `auto`, AI 중지는 `none` |
| `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY` | `.env.admin` | 관리자 본인의 개발용 키. 일반 로컬 사용자에게 필요하지 않음 |
| `VIBE_TEACHER_USER_OPENROUTER_KEYS` | `.env.admin` | 공용 서버의 Supabase 사용자 UUID → OpenRouter 키 JSON 객체 |
| `VIBE_TEACHER_SUPABASE_DATABASE_URL` | `.env.admin` | 선택. `accounts:setup` 또는 기존 mem0 SQL 접속용 Session pooler URI |

`VIBE_TEACHER_PUBLIC_URL`은 Supabase의 Redirect URLs에도 등록합니다. `local`·`ssh`는 loopback, `shared`는 HTTPS 주소를 사용합니다. 공개 키는 기존 `anon` JWT도 지원합니다. `sb_secret_...`·`service_role` 키는 현재 회원 모드 설정에 필요하지 않습니다.

### 고급 환경변수

<details>
<summary>서버 주소·AI 제공자·기존 기억 검색 옵션 펼치기</summary>

아래 값은 예제에 기본으로 넣지 않습니다. 필요한 항목만 지정한 파일에 추가하세요. 기존 mem0·Supermemory 옵션은 Supabase 회원 모드에 적용되지 않습니다.

| 변수 | 파일 | 용도·기본값 |
|---|---|---|
| `VIBE_TEACHER_HOST` | `.env` | API 바인딩 주소, 기본 `127.0.0.1`. 외부 접근은 인증 필요, 회원 모드 `local`·`ssh`는 loopback만 허용 |
| `VIBE_TEACHER_WEB_HOST` | `.env` | 개발 웹 바인딩 주소, 기본 `127.0.0.1` |
| `VIBE_TEACHER_API_URL` | `.env` | 개발 웹의 `/api` 프록시 대상, 기본 `http://127.0.0.1:$VIBE_TEACHER_PORT` |
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

</details>

지정한 포트가 이미 사용 중이면 다른 포트로 조용히 옮기지 않고 바로 실패합니다(`strictPort`).

검사와 테스트:

```bash
npm run typecheck
npm test
```

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
  "llm": { "provider": "auto", "claudeCliPath": null, "model": null, "maxBudgetUsd": 0.5, "timeoutMs": 180000, "effort": "medium", "openrouterModel": "openrouter/free", "openaiModel": "gpt-5-mini", "autoText": true },
  "server": { "host": "127.0.0.1", "port": 3318 },
  "wiki": { "briefTokenBudget": 900, "maxPrerequisiteDepth": 2, "maxPrerequisitesPerBundle": 4, "maxOptionalQuestions": 2, "suggestQuestions": true }
}
```

- `scan.mode`: `current`(현재 계정만) · `list`(`homes` 에 적은 홈 디렉터리) · `all`(`homeRoots` 아래 모든 홈 + `/etc/passwd` 의 uid ≥ 1000)
- `llm.autoText`: 사람이 읽는 문장(레포 위키, 내 지식 설명, 세션 위키 설명)을 AI 가 자동으로 쓸지. 끄면 자동 생성을 멈추고 버튼으로 생성할 수 있습니다. AI가 없는 경우 설명을 만들어 표시하지 않습니다.
- `wiki`: 프로젝트 위키 설명 계획의 개발용 초기값입니다 (검증된 적정값이 아님). 첫 화면 분량(근사 토큰), 선행 개념 경로 깊이와 개수 상한, 세션당 제안할 이해 확인 문제 수, 문제 제안 여부.
- 인덱스 캐시는 `~/.vibe-teacher/cache/index/`에 기록합니다. 비회원/홈 토큰 모드의 AI 분석 결과는 `cache/enrich/`, 위키와 내 이해 정보는 `wiki/`에 기록합니다. Supabase 회원 모드는 개인·위키·분석 데이터를 사용자 토큰으로 Supabase에 저장합니다. 스캔 대상 홈에는 아무것도 쓰지 않습니다.

## AI로 만드는 위키와 개념 카드

개념 사전·키워드 점수·고정 문항 은행을 사용하지 않습니다. AI가 세션의 요청·변경 코드·도구 결과를 읽고 지금 이해하거나 판단하는 데 필요한 개념과 설명 순서를 선정합니다. 처음 보는 프레임워크나 라이브러리도 새 개념 카드로 만들 수 있습니다.

코드는 원본 파일·명령·코드 연결을 수집하고 출처 참조와 데이터 형식을 검사합니다. 프로젝트 사실, 에이전트의 완료 보고, AI의 해석을 구분합니다. 출처가 연결됐다는 사실만으로 내용이 옳다고 검증된 것은 아닙니다.

### 세션 (대화 기록) 분석

코딩 에이전트와 내가 한 대화 기록을 분석하여 이번 대화에서 한 작업, 내가 알면 좋은 개념, 보안 및 취약점 관련 주의사항을 설명 문서로 만듭니다. 세션 화면의 탭은 **세션 (대화 기록) 분석 → 내가 쓴 메시지 → 만들어진 것** 순서입니다. 분석 문서는 **작업 요약 → 작업 설명과 확인할 사항 → 알아둘 개념 → 내 지식 → 보안 점검** 순서로 읽고, 맨 위 목차에서 각 절로 바로 이동합니다.

**분석 시작**을 누르면 작업 요약과 작업·개념·보안 분석을 함께 시작합니다. AI가 기록에서 확인한 사실·주의사항·개념·학습 카드·선행관계를 작성합니다. 개념 카드에는 정의와 이번 작업에서 필요한 이유, 실제 기록의 근거가 표시됩니다. 고정 사전의 개념으로 범위를 제한하지 않습니다. 기반 문서가 없거나 기록이 바뀌었으면 함께 갱신합니다.

분석 문서는 `/sessions/<세션 키>/analysis` 주소로 다시 열 수 있습니다. 기존 세션·탭 주소도 유지합니다. 프로젝트의 레포 위키에는 **대화 기록 분석 문서** 트리가 표시되며, 문서 제목과 하위 절(작업 요약·작업 설명·알아둘 개념·보안 주의사항)을 눌러 이동합니다. 저장된 결과가 생기면 레포 위키를 다시 생성하지 않아도 목록에 연결됩니다. 요약만 있으면 **일부 분석 결과**로 표시하고, 생성 중인 빈 문서는 완료 문서로 표시하지 않습니다. 목록을 읽는 것만으로 AI를 호출하거나 원본 대화를 다시 읽지 않습니다.

분석에서 나온 개념은 **내 지식 위키**에도 연결됩니다. 각 개념의 **이 개념이 나온 대화 분석**에서 원래 분석 문서의 해당 개념으로 이동하고, 관련 프로젝트 위키도 열 수 있습니다. 네 번째 이후 출처는 **관련 분석 문서 더 보기**를 펼쳐 모두 확인합니다. 분석 문서에서도 프로젝트 위키와 해당 프로젝트의 내 지식으로 돌아갈 수 있습니다.

이미 저장된 같은 기록·설명 난이도의 결과는 재사용합니다. **다시 분석하기**로 새로 작성하거나 진행 중 작업을 취소할 수 있습니다. 현재 AI 제공자, 전송 내용·미리 보기, 모델·소요 시간·요금 등의 기술 정보는 **관리자**, 또는 설명 난이도를 **개발 용어에 익숙해요 / 핵심만 자세하게**로 선택한 사용자에게 표시합니다. 첫 분석 전에도 요약과 작업·개념·보안 분석 양쪽의 전송 내용을 미리 볼 수 있으며, 미리 보기는 문서를 저장하거나 AI를 호출하지 않습니다. AI 설정 변경은 기존 관리자·설치 소유자 권한을 따릅니다.

**만들어진 것** 탭은 **에이전트가 정리한 작업 결과**를 먼저 보여 줍니다. 요청마다 내가 요청한 내용과 에이전트가 작업 뒤에 남긴 답변 원문을 함께 읽습니다. 마지막 보고는 펼쳐 두고 이전 요청은 눌러서 확인합니다. 답변은 300자·4,000자 제한 없이 전체를 표시하며 제목·목록·코드·표·문서 링크를 읽기 좋게 보여 줍니다. **텍스트 원문 보기**에서 기록에 남은 문장도 그대로 확인할 수 있습니다. Codex의 진행 알림과 최종 답변은 구분하며, 결과 답변이 없는 요청에는 그 상태를 표시합니다. 파일 변경·명령·패키지·커밋은 아래 **파일·명령 등 작업 기록**을 펼쳐 확인합니다. 화면에서 원문 전체를 읽어도 AI에는 기존처럼 길이를 제한하고 비밀값을 가린 발췌만 보냅니다.

**보안·데이터 주의사항**도 AI가 기록의 근거를 보고 선정합니다. 공통 체크리스트를 모든 프로젝트에 붙이지 않습니다. 실제 서비스 환경이나 전체 저장소의 취약점을 검사했다는 뜻은 아닙니다. AI가 제시한 확인 사항과 읽지 못한 범위를 함께 확인하세요.

### 레포 위키

프로젝트 화면의 큰 탭은 **프로젝트 안내 (레포 위키) → 세션 (대화 기록) → 이 프로젝트와 관련된 내 지식** 순서입니다.

프로젝트의 **레포 위키 만들기**를 누르면 README, 의존성, 실행 스크립트, 주요 코드 발췌와 세션 요약을 AI에 전달합니다. AI가 사용자 중심 페이지와 동작 중심 페이지의 절 구성·제목·설명·주의사항을 작성합니다.

레포 위키 화면 위의 **대화 기록 분석 문서**에서 이 프로젝트의 분석 문서를 트리로 찾아갑니다. 레포 위키 본문이나 주요 기능의 세션 근거도 해당 대화 분석 문서로 이어집니다.

스크립트·API 경로 표와 코드 연결 그림은 저장소에서 수집한 원문 자료입니다. AI가 이를 인용할 수 있지만 값을 바꾸거나 연결을 만들어낼 수는 없습니다. 같은 그림·표·코드는 한 페이지에 한 번만 표시하며, 이미 만들어진 위키에서도 다시 생성하지 않고 중복이 사라집니다. 근거를 펼쳐 파일 원문과 줄 번호를 확인할 수 있습니다. 코드는 언어(JS·TS·Python·JSON·셸)에 맞춰 문자열·주석·키워드 등에 색을 입혀 보여 줍니다. 스캔은 읽기 전용이며 코드를 실행하지 않습니다.

API 표는 **방식 → 경로 → 동작 설명 → 파일** 순서로 표시합니다. AI가 경로별 코드 발췌를 읽고 무엇을 조회·저장·응답하는지, 확인된 접근 검사는 무엇인지 설명합니다. 발췌만으로 알 수 없는 동작은 확인 범위를 함께 적습니다. 기존 위키는 **업데이트**하면 새 설명 열이 반영됩니다.

코드 연결 그림의 각 상자에는 파일명과 함께 **이 파일이 실제로 하는 일**을 표시합니다. AI가 코드 근거로 프론트엔드·백엔드의 분리를 확인하면 큰 영역을 나눠 그리고, 함께 쓰는 코드는 공통 영역에 둡니다. 화살표는 실제 코드의 파일 참조 관계이며 실행 순서나 통신을 추측해 추가하지 않습니다. Python은 `from . import rows`·`from .steps import load`처럼 하위 모듈을 가져오는 형태도 실제 파일이 있으면 연결로 읽습니다. 상자 맨 위에는 시작 파일이면 `시작 파일 - index.html`, 나머지는 `main.js`처럼 파일 이름만 표시합니다. 시작 파일에서 연결을 찾지 못한 파일만 모인 폴더(별칭 import·독립 스크립트 등)는 그 폴더의 `__main__.py`·`__init__.py`·`main.py`·`app.py`·`index.ts`·`main.ts`·`index.html` 같은 파일을 그 폴더의 시작 파일로 보고 거기서부터 연결을 그립니다. 상자는 영역마다 왼쪽부터 채웁니다. 라벨과 배치는 저장된 위키에도 바로 적용되며, 폴더별 시작 파일과 열 나누기는 **업데이트** 후 반영됩니다.

파일 설명이나 영역이 빠지면 해당 정보를 AI에 한 번 더 요청합니다. 모든 상자의 설명과 출처가 연결된 경우에만 생성 완료로 저장하며, 보완에 실패하면 원인을 표시합니다. 이미 설명 없이 생성된 이전 결과는 재사용하지 않으므로 **다시 쓰기**로 새 설명을 받을 수 있습니다.

위키를 작성할 때 AI가 먼저 확인할 질문과 파일 위치를 고르고, 서버가 필요한 코드 일부를 읽어 추가 답변을 받습니다. Claude CLI에서는 이 확인 단계만 **Haiku·low effort**로 실행하며, CLI 실패나 API 제공자 선택 시에는 OpenRouter의 설정 모델(기본 `openai/gpt-5-mini`)을 사용합니다. 추가 확인은 최대 6곳·코드 합계 24,000자이며, 비밀값을 가리고 출처가 확인된 답만 위키 작성에 활용합니다. **AI에 보내는 내용 보기**에서 기본 입력과 추가 확인 범위를 볼 수 있습니다.

새 세션이나 파일 변경이 생기면 **업데이트**로 반영합니다. 문장은 읽는 사람 수준별로 저장하고, 같은 입력으로 이미 생성한 결과는 재사용합니다. 생성에 실패하면 사유와 재시도 동작을 표시하며 고정 설명으로 대체하지 않습니다.

### 주요 기능 페이지

레포 위키를 쓸 때 AI가 사용자가 실제로 쓰는 **주요 기능**(최대 16개)을 고르고, 기능마다 관련 파일과 그 기능을 만들거나 고친 세션을 연결합니다. 제공하지 않은 파일·세션을 인용한 기능은 목록에서 뺍니다. 다시 생성할 때는 이전 기능 id를 알려 같은 기능이 같은 페이지로 이어지게 합니다. 이 목록은 문장 형식이 바뀐 이번 업데이트부터 만들어지므로, 기존 위키는 **다시 쓰기** 또는 **업데이트**를 누르면 생깁니다 (자동 작성이 켜져 있으면 위키를 열 때 다시 씁니다).

- 주요 기능 목록은 하나입니다. **주요 기능** 탭과 **어떤 프로젝트인가요?** 페이지의 주요 기능 블록이 같은 목록을 보여 주며, 기능 카드를 누르면 `/projects/<프로젝트>/features/<기능>` 페이지로 이동합니다. AI는 주요 기능을 사용자 페이지의 별도 절로 다시 나열하지 않고, 목록을 넣을 위치만 고릅니다 (고르지 않으면 첫 절 다음). 세션 화면에도 그 세션과 관련된 기능 페이지 링크가 표시됩니다.
- 탭은 위키를 받을 때 이미 들어 있는 목록으로 바로 그리고, 자세한 분석 여부만 나중에 받아 표시합니다.
- 처음에는 레포 위키가 고른 관련 파일과 세션만 보여 줍니다. **이 기능 자세히 분석받기**를 누르면 아래 순서로 분석합니다 (GET으로 화면을 여는 것만으로는 AI를 부르지 않습니다).
  1. 서버가 기능 파일, 그 파일이 불러오는 파일, 그 파일을 불러오는 파일의 선언·연결과 AI 호출 단서 줄(`openai`, `chat.completions`, `model:` 등)을 모읍니다.
  2. AI가 이 자료를 보고 **확인할 질문과 파일 위치를 직접 만듭니다**. 서버가 그 부분의 코드만 읽어 줍니다.
  3. AI가 읽은 코드로 답하고, 아직 모르는 것(호출하는 곳, 모델 설정, 프롬프트를 조립하는 함수 등)을 **다음 질문으로 다시 만듭니다**. 최대 3단계, 단계마다 6곳, 코드 발췌는 합계 48,000자이며 비밀값은 가립니다. 새로 읽을 코드가 없으면 일찍 멈춥니다.
  4. AI가 페이지를 씁니다: 한눈에 보기, **사용자는 이렇게 씁니다**(단계별 흐름), 관련 파일과 역할, **AI 호출**, AI가 확인한 질문과 답(단계별), 확인하지 못한 것.
- **AI 호출**에는 제공자·SDK, 모델, 응답 처리와 함께 **실제로 AI에 가는 시스템 프롬프트·사용자 프롬프트 문장만** 보여 줍니다. AI는 코드 위치만 가리키고, 서버가 코드를 구문 분석해 요청의 `system`·`user`·`prompt` 값이나 `{ role: 'system', content: … }` 메시지를 찾습니다. 그 값이 가리키는 상수, 불러온 파일, 감싸는 함수(예: `withReader(PROMPT, level)`는 실제 인자를 넣어 펼침)를 따라가 원문을 그대로 이어 붙입니다. 색이 다른 `{…}`는 실행할 때 채워지는 값이고, 문장이 적힌 곳은 링크로 열 수 있습니다. 가리킨 범위에 요청이 여러 개면 줄·호출 이름(`schemaName` 등)과 함께 모두 보여 줍니다. 전체 코드는 접힌 **코드 보기**에서 확인합니다. JS·TS·Python을 지원하며, 프롬프트를 특정하지 못하면 코드를 펼쳐 보여 줍니다. 이 정리는 페이지를 열 때 계산하므로 이미 분석한 기능도 다시 분석할 필요가 없습니다.
- 모델 값은 가리킨 줄에 실제로 적혀 있을 때만 싣고, 확인하지 못하면 "코드에서 확인하지 못함"으로 표시합니다. 근거를 확인하지 못한 단계·파일·답은 거르고 경고로 남깁니다.
- 질문 단계는 로컬 `auto`·`claude-cli` 설정에서 Claude CLI **Haiku·low effort**, 페이지 작성은 Claude CLI의 기본 모델로 실행합니다. CLI 실패나 `openrouter` 설정, 공용 서버에서는 OpenRouter의 설정 모델(기본 `openai/gpt-5-mini`)을 사용합니다. 작은 저장소 기준 AI 호출 5번, 1~2분 정도 걸립니다.
- **AI에 처음 보내는 내용 보기**에서 첫 질문 계획 요청의 시스템·사용자 프롬프트를 볼 수 있습니다. 이후 단계의 질문은 AI가 답을 보고 만들며, 회원 모드에서는 모든 요청·응답이 [AI 호출 기록](#ai-호출-기록-supabase-회원-모드)에 `feature=repo_feature`로 남습니다.
- 분석한 뒤 읽은 파일이 바뀌면 "분석한 뒤 바뀐 것이 있습니다"를 표시합니다. **다시 분석하기**로 갱신하세요. 페이지는 읽는 사람 수준별로 따로 저장합니다.

### 내 지식과 이해 확인

**내 지식**은 세션의 AI 개념에 자기보고·문항 응답·질문·설명 방식 선택을 연결합니다. 개념 카드에서 연습 정답·오답, 질문 횟수, 최근 활동과 원래 세션을 확인할 수 있습니다. 프로젝트·세션 화면에는 그 범위의 활동을 따로 표시하고, 일반 개념 상태와 설명 선호는 다음 세션에도 이어집니다. 상호작용한 개념은 개인 개념 기록에도 보존하므로 최근 40개 세션 조회에서 빠져도 다시 연결할 수 있습니다. 설명 문장은 AI가 작성합니다.

다시 방문하면 **저장된 목록과 설명을 먼저 표시**하고 새 세션·활동은 뒤에서 확인합니다. 처음 저장된 목록이 없는 범위는 한 번 목록을 모아야 합니다. AI 작성 중에도 기존 카드와 설명은 유지하며, 이전 설명을 임시로 보여 줄 때는 표시를 붙입니다. 학습 상태가 바뀌면 예전 상태 설명을 재사용하지 않고 현재 활동 내역과 개념 요약을 먼저 보여 줍니다. 같은 사실·설명 난이도이면 AI를 다시 호출하지 않으며, **알고 있어요** 선택·퀴즈 응답·근거 변경 등이 있으면 필요한 설명만 갱신합니다. 단순 재방문이나 목록 캐시 저장은 `vt_events`를 추가하지 않습니다.

**간단히 확인하기**를 누르면 개념 설명과 최근 응답을 참고해 객관식 또는 OX 문항을 생성합니다. 정답과 해설은 제출 전 브라우저로 보내지 않고 서버에서 채점합니다. AI 생성 문항의 정답·오답도 연습 성과로 저장하며, 다음 설명과 문항에 활용합니다. 이전 어려움 이후 정답을 고르면 학습 과정에 표시하지만 숙련을 확정하지는 않습니다. 건너뛰기와 모르겠어요는 오답이 아닙니다.

도움 패널은 **이렇게 물어보세요**에 현재 개념·파일에 맞는 질문 예시를 표시합니다. 예시나 AI의 후속 질문을 누르면 바로 질문합니다. 같은 대상의 대화를 이어서 저장하며, 답변은 이전 대화·관련 장기 기억·개념별 설명 방침을 참고해 AI가 작성합니다. 답변의 **이번 답변에 참고한 내 학습 기록**에서 실제 제공한 기록을 확인할 수 있습니다. AI를 사용할 수 없으면 실패 사유를 표시하며 고정 답변을 반환하지 않습니다.

반복 질문은 예시를 보강하는 신호로, 최근 어려운 응답은 다시 설명할 신호로 사용합니다. **알고 있어요**는 짧은 상기로, **잘 모르겠어요**는 자세한 설명으로 이어집니다. 설명 깊이·예시를 직접 선택하면 그 선택을 우선해 기억합니다. 질문·열람을 모른다는 증거로 바꾸거나, 연습 정답을 숙련 인증으로 바꾸지는 않습니다. 개념 카드에는 설명을 조정한 이유를 표시하며, 프로젝트 사실과 위험 알림은 개인 상태로 바꾸지 않습니다.

### 장기 기억: mem0 + PostgreSQL + OpenRouter

**Supabase 회원 모드는 공유 원장의 키워드 검색을 사용하므로 이 설정이 필요하지 않습니다.** 아래는 기존 비회원·홈 토큰 방식에서 mem0 의미 검색을 사용할 때의 설정입니다.

<details>
<summary>기존 방식의 mem0·PostgreSQL 설정 펼치기</summary>

기존 방식으로 실행하려면 `.env`의 `VIBE_TEACHER_AUTH_MODE`를 비워 둡니다. 인증 방식은 `config.auth.mode`를 따릅니다. 본인의 OpenRouter 키는 `.env`에 입력합니다.

OSS 기능을 제공하는 `mem0ai` SDK `3.3.1`을 사용합니다. 저장소의 `npm install`로 설치하며 별도의 mem0 서비스 키는 필요하지 않습니다.

```dotenv
# .env
VIBE_TEACHER_AUTH_MODE=
```

**내 지식 → 내 기억 검색**에서 예전 질문·연습 결과·설명 선호를 검색할 수 있습니다. **mem0 OSS 하네스는 앱 안에서 실행하고 기억 검색 DB는 PostgreSQL + pgvector를 사용**합니다. 기억 정리와 임베딩은 OpenRouter API로 처리하며 로컬 모델 설치나 별도 메모리 서비스 구독이 필요 없습니다. OpenRouter API 사용량에 따른 비용은 발생합니다.

로컬 DB는 Docker와 Docker Compose를 설치한 뒤 다음 명령으로 준비합니다.

```bash
npm install
npm run memory:db
npm run dev
```

`memory:db`는 임의 암호와 PostgreSQL 연결 주소를 `.env`에 저장하고 프로젝트 전용 DB를 `127.0.0.1:55432`에서 실행합니다. 포트가 사용 중이면 `.env`의 `VIBE_TEACHER_POSTGRES_PORT`를 바꾼 뒤 처음 실행하세요. 실행한 DB의 데이터는 Docker 이름 있는 볼륨에 보관하므로 컨테이너를 다시 실행해도 유지됩니다. 이미 준비한 DB의 암호를 `.env`에서 바꾸면 DB 계정 암호도 별도로 바꿔야 합니다.

DB를 다시 시작하거나 중지할 때:

```bash
docker compose up -d --wait memory-db
docker compose stop memory-db
```

**기존 PostgreSQL도 연결할 수 있습니다.** 해당 DB에서 `CREATE EXTENSION IF NOT EXISTS vector;`를 실행하고, 앱 계정에 이 전용 DB의 테이블·인덱스 생성 권한을 부여합니다. 기존 DB를 쓰면 `memory:db`를 실행할 필요가 없습니다. 본인의 `.env`에 검색 옵션·개인 키·DB 접속 주소를 추가합니다.

```dotenv
# .env
OPENROUTER_API_KEY=발급받은_개인_OpenRouter_키
VIBE_TEACHER_MEMORY_BACKEND=mem0
VIBE_TEACHER_MEMORY_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
# VIBE_TEACHER_MEMORY_MODEL=openai/gpt-5-mini
```

**Supabase PostgreSQL에 SQL로 연결**하려면 `.env.admin`에 다음 설정을 사용합니다. 프로젝트의 **Connect → Connection string → Session pooler**에서 포트 5432 URI를 복사하고, `[YOUR-PASSWORD]` 부분에 프로젝트의 **DB 비밀번호**를 넣습니다. 암호의 특수문자는 URL 인코딩하세요.

```dotenv
VIBE_TEACHER_SUPABASE_DATABASE_URL=postgresql://postgres.PROJECT_REF:DB_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

Supabase Database → Extensions에서 `vector`를 활성화하거나 SQL Editor에서 다음을 실행합니다.

```sql
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
```

```bash
npm run memory:check
npm run dev
```

`내 기억 검색`에는 기억 저장소 설정(Supabase 또는 PostgreSQL)을 표시합니다. 이 표시는 접속 성공 여부가 아니라 현재 선택된 설정입니다.

`memory:check`는 접속·TLS·벡터 검색·쓰기 권한을 합성 데이터로 검사하고 검사 테이블을 롤백합니다. AI를 호출하거나 원기록을 전송하지 않습니다. 앱에 필요한 전용 스키마는 만들 수 있습니다. 출력에는 접속 문자열과 키를 포함하지 않습니다.

Supabase 설정은 `VIBE_TEACHER_MEMORY_DATABASE_URL`의 기존 로컬 주소보다 우선합니다. `memory:db`도 Supabase 설정이 있으면 로컬 DB를 실행하거나 주소를 덮어쓰지 않습니다. Supabase 접속 실패 시 실패 이유와 원장의 키워드 검색을 표시합니다.

Supabase 모드에서는 기억 테이블을 `vibe_teacher` 비공개 스키마에 만들고, `extensions.vector`와 관련 연산자를 찾도록 세션을 설정합니다. 공개 API 역할의 스키마 접근이 열려 있으면 저장을 중단하며 기존 권한을 자동으로 바꾸지 않습니다. 이 스키마는 Supabase의 Exposed schemas에 추가하지 마세요. 앱 사용자별 접근 권한은 기존 서버 인증에서 검사합니다.

TLS는 호스트와 인증서를 검증합니다. 기본 [Supabase 공개 CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)를 앱에 포함했으며, 별도 CA가 필요하면 DB URI의 `sslrootcert=/absolute/path/to/ca.crt`로 지정할 수 있습니다. 현재 환경에서 Direct connection이 IPv6 문제로 실패하면 IPv4를 지원하는 Session pooler를 사용하세요. Transaction pooler(6543)는 세션 설정을 유지하는 이 경로에서 사용하지 않습니다. [Supabase 연결 문서](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS 문서](https://supabase.com/docs/guides/platform/ssl-enforcement)

회원 모드의 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`는 로그인과 RLS Data API 연결에 사용합니다. 이 절의 mem0 SQL 연결은 DB 접속 주소를 사용하며 공개 키로 대신할 수 없습니다. 앱은 `SUPABASE_SECRET_KEY`·`SUPABASE_JWKS_URL`을 읽지 않습니다.

일반 PostgreSQL URL에는 사용자명·암호·호스트·DB 이름을 채웁니다. 암호의 특수문자는 URL 인코딩하고, TLS가 필요한 서버는 제공자의 인증서·연결 설정을 따릅니다. 위의 로컬 준비 명령을 사용했다면 생성된 URL을 그대로 쓰세요.

서버를 다시 시작하면 새 자기보고·퀴즈 응답·완료된 질문 뒤에 최신 미반영 기록을 최대 2개씩 백그라운드에서 색인합니다. 저장과 채점은 먼저 완료됩니다. 기존 기록은 **기억 인덱스 업데이트**를 눌러 한 번에 최대 10개씩 반영합니다. 남은 개수와 실패 사유를 표시합니다. 화면 열기(GET)만으로는 AI를 호출하지 않습니다. 검색 시 해당 시점에 완료된 색인을 사용하고 미반영 기록은 키워드 검색으로 보완하므로, 처음 색인한 뒤에는 다시 검색하세요.

OpenRouter에 보내는 대상은 비밀값을 가린 질문·짧은 AI 답변·학습 활동이며, 원본 세션 JSONL이나 도구 출력 전문은 보내지 않습니다. 추출한 검색 단서는 짧은 기록·벡터와 함께 PostgreSQL에 저장합니다. 질문·학습 원장과 원기록 매핑은 `VIBE_TEACHER_HOME` 아래의 JSONL·JSON 파일로 보관합니다. 검색 결과는 현재 접근 가능한 원기록 ID와 대조하며, AI가 만든 숙련 추정을 학습 원장에 넣지 않습니다. DB 안에서는 사용자·앱·모델별 테이블과 검색 필터로 범위를 나누며 Supabase pooler의 프로젝트도 구분합니다. 재시작·재시도 시 같은 기록을 다시 추출하지 않습니다. SDK의 외부 텔레메트리도 끕니다. 기억 정리 모델이나 접속 DB·앱 저장 위치를 바꾸면 별도 색인을 사용하므로 기존 기록을 다시 반영하세요.

키·DB 주소가 없거나 API·PostgreSQL 연결에 문제가 있으면 사유를 표시하고 원장의 키워드 검색을 유지합니다. API 없는 검색만 쓰려면 `VIBE_TEACHER_MEMORY_BACKEND=local`을 설정합니다. 키워드 검색은 원장에서 복원하고 최근 40개 세션 제한을 적용하지 않습니다. 프로젝트 선택 시 그 프로젝트와 범위 없는 개인 활동을 검색합니다. 다른 프로젝트와 계정의 기록은 검색 범위에 넣지 않습니다.

기존 Supermemory 클라우드 어댑터도 `VIBE_TEACHER_MEMORY_BACKEND=supermemory`와 `SUPERMEMORY_API_KEY`로 선택할 수 있습니다. 이 경우 색인 갱신은 수동이며 해당 서비스 요금제가 적용됩니다.

이전 SQLite 색인은 자동으로 복사하거나 삭제하지 않습니다. 기존 질문·응답·선호 원장은 보존되어 있으므로 **기억 인덱스 업데이트**로 PostgreSQL 색인을 다시 만들 수 있습니다. 이 재색인에도 OpenRouter 사용료가 발생합니다. PostgreSQL을 쓰는 현재 경로에서는 SQLite DB 파일을 생성하지 않습니다.

PostgreSQL 연동 검사는 **검사용 DB**의 연결 주소를 지정해 실행합니다. 실제 AI 호출은 합성 응답으로 대체하며 검사에서 만든 임시 테이블만 정리합니다. 지정하지 않으면 일반 `npm test`에서 DB 검사는 건너뜁니다.

```bash
VIBE_TEACHER_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/TEST_DB' npx vitest run server/test/memory/postgres.test.ts
```

</details>

## AI 제공자와 외부 문서 검색

다음 표는 로컬 실행 기준입니다. 공용 서버의 `shared` 모드는 사용자별 키 추적을 위해 OpenRouter로 실행하며, `none`은 두 방식 모두에서 AI 생성을 중지합니다.

| 설정 | 실행 방식 |
|---|---|
| `auto` (기본) | 로그인된 Claude CLI 우선. CLI를 사용할 수 없거나 작업에 실패하면 OpenRouter로 실행 |
| `claude-cli` | Claude CLI 우선. 처리 실패와 외부 문서 검색은 OpenRouter로 실행 |
| `openrouter` | 모든 생성을 OpenRouter API로 실행 |
| `none` | 새 AI 생성을 중지. 저장된 AI 결과와 원본 기록은 열람 가능 |

AI 문장 생성·외부 문서 검색 API는 **OpenRouter**를 사용하며 기본 모델은 **`openai/gpt-5-mini`**입니다. 기존 `openai`·`anthropic-sdk` 제공자 설정은 OpenRouter로 이관됩니다. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`로 직접 API를 호출하지 않습니다. 예전 기본값 `openrouter/free`는 `openai/gpt-5-mini`로 바뀝니다. mem0 기억 정리·임베딩도 같은 OpenRouter 키를 사용합니다. 기억 API 호출은 설명 제공자와 별도로 `VIBE_TEACHER_MEMORY_BACKEND=local`로 끌 수 있습니다.

로컬 사용자는 본인의 `.env`에 API 키와 제공자를 설정합니다.

```dotenv
# .env
OPENROUTER_API_KEY=발급받은_개인_OpenRouter_키
VIBE_TEACHER_LLM_PROVIDER=openrouter
```

관리자는 본인 개발용 키를 `.env.admin`의 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`에 넣습니다. 공용 서버는 위 [사용자별 API 키](#공용-서버의-사용자별-api-키) 설정을 따릅니다. 환경파일을 바꾸면 서버를 다시 시작하세요.

모델은 소스 설정의 OpenRouter 모델 선택에서 바꿀 수 있습니다. 모델 목록 조회도 OpenRouter만 사용합니다.

세션 개념을 생성한 뒤에는 **OpenRouter 웹 검색**으로 공식 문서를 찾아 정의와 설명을 확인합니다. 검색에는 개념 이름만 전달하고 세션 원문·프로젝트 경로를 넣지 않습니다. 모델이 임의로 적은 주소는 새 참고 링크로 채택하지 않으며, API 검색 응답의 실제 출처 URL과 대조합니다. 검색이 실패하면 AI 설명은 보존하고 문서 조회 실패를 표시합니다. 검색과 API 생성에는 OpenRouter 크레딧이 사용됩니다.

AI 미설정·권한 부족·취소·오류 상태에서는 새 설명을 생성하지 않습니다. 이미 저장된 AI 결과는 계속 볼 수 있습니다. 자동 생성은 `llm.autoText`로 조절합니다. 생성 권한은 Supabase 회원 모드의 관리자 승인(`vt_members.approved` 또는 `is_admin`), 기존 방식의 `auth.enrichFor`를 따릅니다. 전송 내용은 화면의 미리 보기에서 확인할 수 있으며, 비밀값을 마스킹하고 길이를 제한한 발췌만 전달합니다.

### 읽는 사람 수준과 화면 설정

처음 사용할 때 **비개발자·입문·주니어·숙련** 중 설명 수준을 선택합니다. AI 문장은 수준별로 저장하며 이 선택을 이해 증거로 사용하지 않습니다. 글씨 크기·글꼴·밀도·라이트/다크 테마는 오른쪽 위 톱니바퀴에서 별도로 설정합니다.

### 저장과 기존 결과

아래 파일 경로는 기존 비회원/홈 토큰 모드 기준입니다. Supabase 회원 모드는 같은 상대 키를 `vt_documents`와 추가 전용 `vt_events`에 사용자 ID별로 저장하며, 로컬 파일로 대체 저장하지 않습니다.

- 대화 기록 분석 문서: `~/.vibe-teacher/wiki/projects/<프로젝트>/snapshots/`, 수준별 AI 설명은 `ai/`
- 레포 위키: 같은 프로젝트의 `repo/`, 수준별 문장과 주요 기능 목록은 `repo/text/`, 기능별 페이지는 `repo/features/<기능>.<수준>.json`
- 개인 이해 정보: `~/.vibe-teacher/wiki/learners/<ID>/events.jsonl`
- 개인 설명: 같은 사용자 폴더의 `knowledge-text.json`
- 내 지식의 마지막 목록: 같은 사용자 폴더의 `knowledge-views/<범위 지문>.json` (회원·수준·현재 계정 권한·프로젝트·세션별, 회원 모드는 `vt_documents`). 학습 상태는 캐시 대신 현재 원장에서 다시 확인합니다.
- 개인 개념 기록: 같은 사용자 폴더의 `concepts.json`, 질문 원장은 `projects/<프로젝트>/help.jsonl`
- mem0 검색 벡터·짧은 기록·검색 단서: `VIBE_TEACHER_MEMORY_DATABASE_URL`의 PostgreSQL, 원기록 매핑은 같은 사용자 폴더의 `memory/mem0-pg-<접속·모델 지문>.json`
- AI 요청·응답·결과물·토큰·요금: Supabase 회원 모드에서만 `vt_ai_calls`·`vt_ai_runs` ([AI 호출 기록](#ai-호출-기록-supabase-회원-모드))

이전 규칙 기반 위키·설명 캐시는 현재 결과로 사용하지 않습니다. 기존 기록 파일은 보존하며, 화면에서 위키를 다시 생성하면 새 AI 흐름을 사용합니다.

## 다중 계정 운영 (서버 전체 조회)

다른 계정의 홈은 보통 `drwxr-x---` 이고 Claude 세션 파일은 `0600` 이라 일반 계정으로는 읽을 수 없습니다. 앱을 돌리는 계정(서비스 계정, 예: `user99`)에 **읽기 전용 ACL** 을 주면 root 로 실행하지 않고도 전체를 읽을 수 있습니다. `/home` 이 ext4/xfs 라면 ACL 은 바로 쓸 수 있습니다. 아래 예의 `user99` 는 **앱을 실행하는 계정**입니다. [SSH 터널 개발 서버](#3-개발-서버에서-ssh-터널로-함께-쓰기)라면 `ubuntu` 처럼 `npm start` 를 실행하는 계정 이름으로 바꿉니다.

```bash
# 1) 도구 설치 (Ubuntu)
sudo apt update && sudo apt install -y acl

# 2) 서비스 계정에 읽기 ACL 부여 — 홈 진입(rx) + 기록 디렉터리 재귀(rX) + 새 폴더 상속
#    (다른 계정으로 실행하면 user99 홈을 못 읽으므로 sudo bash + 절대 경로로)
sudo bash /home/user99/vibe-teacher/scripts/grant-read-acl.sh user99                 # /home/* 전체
sudo bash /home/user99/vibe-teacher/scripts/grant-read-acl.sh user99 user01 user02   # 특정 사용자만

# 3) 확인 (getfacl 도 남의 홈이므로 sudo)
sudo getfacl /home/user01/.claude | head               # user:user99:r-x 가 보이면 됨
sudo -u user99 ls /home/user01/.claude/projects        # 목록이 나오면 성공

# 4) 주기적 재적용 — 시스템 경로에 복사해 두고 root crontab(sudo crontab -e)에 등록
sudo install -m 755 /home/user99/vibe-teacher/scripts/grant-read-acl.sh /usr/local/sbin/vibe-acl
*/10 * * * * /usr/local/sbin/vibe-acl user99 >/dev/null 2>&1

# 되돌리기
sudo setfacl -R -x u:user99 /home/user01               # 해당 사용자 홈에서 user99 항목만 제거
sudo setfacl -R -b /home/user01                        # 그 홈의 ACL 전부 제거
```

스크립트가 하는 일을 손으로 하면 다음과 같습니다.

```bash
sudo setfacl -m u:user99:rx /home/user01
sudo setfacl -R -m u:user99:rX /home/user01/.claude /home/user01/.claude.json /home/user01/.codex /home/user01/.copilot
sudo setfacl -R -d -m u:user99:rX /home/user01/.claude /home/user01/.codex /home/user01/.copilot   # 새로 생기는 폴더 상속
```

4번(주기적 재적용)이 필요한 이유: default ACL 은 새 파일에도 상속되지만, Claude Code 가 세션 파일을 `0600` 으로 만들면 ACL 마스크가 0 이 되어 **상속된 항목의 실효 권한이 없어집니다**. 재귀 `setfacl -R -m` 을 다시 돌리면 마스크가 열립니다. 10분 주기면 충분합니다.

그 계정으로 앱을 실행하고 소스 설정에서 스캔 범위를 `/home 전체` 로 바꾸면 계정 › 프로젝트 › 세션 계층으로 볼 수 있습니다. 권한이 없는 계정은 "권한 없음"으로 표시되고 나머지는 정상 동작합니다.

## 로그인 (사용자별 접근 제한)

누구나 회원가입하는 공용 서비스와 노트북 설치, SSH 터널로 접속하는 개발 서버는 위 "회원가입을 사용하는 실행 방법"의 Supabase 모드를 사용하세요. 개발 서버의 `ssh` 방식은 토큰 파일 없이 SSH 로그인한 계정으로 기록을 구분합니다. 다음은 서버 OS 사용자용 기존 홈 토큰 모드입니다. `VIBE_TEACHER_AUTH_MODE=supabase`가 지정되면 이 설정과 기존 관리자 Bearer 토큰보다 Supabase 인증이 우선합니다.

서비스 계정이 전체를 읽되, 각 사용자는 **자기 계정 기록만** 보게 하려면 홈 디렉터리 토큰 로그인을 켭니다. 원리: 사용자의 홈 안에 `~/.vibe-teacher/login-token` 파일을 만들면 그 파일을 읽을 수 있는 사람은 그 계정(과 서비스 계정)뿐이므로, 그 문자열을 아는 것이 본인 증명이 됩니다. 비밀번호도, 개인 키 업로드도 필요 없습니다.

```json
"auth": { "mode": "home-token", "admins": ["user99"], "sessionTtlHours": 168, "enrichFor": "admins" }
```

- `mode`: `none`(기본, 로그인 없음) 또는 `home-token`
- `admins`: 모든 계정을 볼 수 있는 사용자. 앱을 실행한 OS 계정은 항상 관리자입니다.
- `enrichFor`: AI 분석을 누구에게 허용할지 (`admins` 또는 `everyone`). 서비스 계정의 Claude 계정으로 비용이 나가므로 기본은 관리자만입니다.

각 사용자는 서버에 SSH 로 들어가 한 번만 다음을 실행하고, 출력된 문자열을 로그인 화면에 붙여넣습니다 (로그인 화면에도 같은 안내가 나옵니다. `user99` 자리는 서비스 계정 이름).

```bash
( umask 077; mkdir -p ~/.vibe-teacher; head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > ~/.vibe-teacher/login-token; setfacl -m u:user99:rx ~ ~/.vibe-teacher; setfacl -m u:user99:r ~/.vibe-teacher/login-token; cat ~/.vibe-teacher/login-token )
```

토큰 파일을 지우거나 다시 만들면 그 사용자의 기존 로그인 세션은 모두 무효화됩니다. 로그인 5회 실패 시 1분간 잠깁니다. 로그인 모드에서는 비-loopback 바인딩에 `VIBE_TEACHER_TOKEN` 이 필수는 아니지만, 토큰이 네트워크를 타므로 HTTPS 앞단(nginx 등)이나 SSH 터널을 권장합니다. `VIBE_TEACHER_TOKEN` 을 설정하면 그 값은 관리자용 API 토큰(`Authorization: Bearer`)으로 계속 쓸 수 있습니다.

### 원격 접근

기본은 `127.0.0.1` 에만 바인딩합니다. 다른 PC 에서 보려면 SSH 터널을 권장합니다. 여러 사람이 각자 계정으로 터널을 열어 자기 기록만 보게 하려면 [3. 개발 서버에서 SSH 터널로 함께 쓰기](#3-개발-서버에서-ssh-터널로-함께-쓰기)를 사용하세요.

```bash
ssh -L 3318:127.0.0.1:3318 <server>
```

로그인 모드를 사용하지 않고 외부 주소로 열어야 하면 토큰이 필수입니다 (없으면 부팅을 거부합니다).

```bash
VIBE_TEACHER_HOST=0.0.0.0 VIBE_TEACHER_TOKEN='긴-무작위-문자열' npm start
```

UI 에서 처음 한 번 토큰을 입력하면 브라우저에 저장됩니다.

## 구조

```
shared/   도메인 타입, API DTO, LLM 출력 스키마 (zod)
server/   Hono API — adapters(도구별 파서) · index(계정/소스/세션 인덱스) · analyzers(원본 작업 수집) · llm(AI 생성·제공자 라우팅)
          wiki(세션 위키 원장·검사·설명 계획) · repo(레포 위키: 읽기 전용 스캔·AI 추가 코드 확인·조립·주요 기능 페이지) · learner(내 이해 정보·내 지식 위키)
          assessment(문항·채점) · help(도움 패널 질문) · memory(로컬 mem0·기억 검색·색인) · storage(위키 저장소)
          cloud(Supabase 사용자 토큰·RLS 저장소·사용자별 서비스), auth(홈 토큰·Supabase 이메일 인증)
web/      Vite + React UI (한국어), test(화면 렌더링 검사)
scripts/  실행·DB 준비·cloud:inspect(관리자 읽기 전용 통계 확인)
docs/     Supabase 테이블별 연결·저장 조건·실측 통계 분석
supabase/ migrations(회원·승인·RLS·원장·기기 간 쓰기 잠금·AI 호출 기록 SQL), tests(RLS 검증 SQL)
```

개념은 AI가 세션 맥락에서 생성하며 고정 사전 파일을 사용하지 않습니다.

AI 코딩 에이전트로 이 저장소를 고칠 때의 규칙(불변 조건, 작업 레시피, README 갱신 기준)은 [AGENT.md](AGENT.md) 에 있습니다. `CLAUDE.md` 는 AGENT.md 를 불러오기만 합니다.
