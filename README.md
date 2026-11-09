# vibe-teacher

AI 코딩 도구의 로컬 대화 기록을 읽고, 내가 요청한 작업과 만들어진 결과를 학습 자료로 정리하는 웹 앱입니다.
Claude Code, Codex CLI, Copilot CLI, VS Code Copilot Chat을 지원합니다.

- **대화와 작업 기록**: 내가 쓴 메시지, 변경 파일, 실행 명령, 패키지와 커밋을 확인합니다.
- **세션 분석과 레포 위키**: 작업 요약, 알아둘 개념, 코드 흐름과 주요 기능, 그 프로젝트를 쓰는 사람을 위한 사용 방법을 AI로 설명합니다.
- **내 지식 위키**: 개념별 질문·퀴즈·학습 기록을 모으고 설명 난이도를 조절합니다.

원본 대화와 소스는 실행 기기에서 읽습니다. 기본 회원 모드에서는 개인 설정·학습 기록·생성 결과를 Supabase에 저장하고, AI에는 비밀값을 가린 요약·발췌를 전송합니다. 앱을 실행한 뒤 위쪽 메뉴의 **사용 방법** 탭에서 화면별 버튼이 하는 일과 쓰면 좋은 때를 볼 수 있습니다. 자세한 사용법은 [주요 기능](docs/features.md), 전송·저장 범위는 [AI와 데이터 저장](docs/ai.md)을 참고하세요.

## 빠른 시작

**이 저장소를 클론해 자기 노트북에서 사용하려는 사람**을 위한 안내입니다. Node.js 22.12 이상과 npm을 준비하세요. Windows 노트북에서 Node.js 설치 없이 쓰려면 관리자에게 받은 [Windows 설치 묶음](docs/windows.md)을 사용합니다. 코드를 수정하려면 [개발자 가이드](docs/development.md), 여러 사람이 사용하는 서버에 접속하거나 설치하려면 [공용 서버 가이드](docs/deployment.md)를 참고하세요.

기본 예제는 Supabase 이메일 로그인을 사용합니다. 관리자가 안내한 Supabase URL·공개 키가 필요하며, 직접 프로젝트를 준비한다면 [Supabase 최초 설정](docs/authentication.md#supabase-최초-설정-관리자-1회)을 먼저 진행합니다. `local`은 내 기기의 기록을 읽는 실행 방식이며, 회원 데이터는 Supabase에 저장합니다.

**1. 의존성을 설치하고 환경파일을 준비합니다.** 저장소를 내려받은 디렉터리에서 실행하세요.

```bash
npm install
cp .env.example .env
chmod 600 .env
```

**2. `.env`에 연결 정보와 OpenRouter API 키를 입력합니다.** 아래 세 값을 채우고, 나머지는 예제 값을 그대로 사용하면 됩니다.

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
OPENROUTER_API_KEY=사용할_OpenRouter_키
```

Supabase URL·공개 키는 관리자에게 받습니다. **OpenRouter 키도 관리자가 제공했다면 그 키를 사용하고, 제공받지 못했다면 본인이 발급한 키를 사용합니다.** `OPENROUTER_API_KEY`를 비워 두고 로그인 후 시작 화면이나 **소스 설정 → 설명을 작성할 AI**에서 입력해도 됩니다(`.env` 값이 있으면 그 값이 우선). 실제 키가 들어 있는 `.env`와 `.env.admin`은 공유하거나 커밋하지 않습니다.

**3. 화면을 빌드하고 앱을 실행합니다.**

```bash
npm run build && npm start
```

[http://127.0.0.1:3318](http://127.0.0.1:3318)에 접속합니다. 이 실행에서는 화면과 API를 **하나의 포트**로 제공합니다. 터미널에서 `Ctrl+C`를 누르면 종료합니다. 다음부터는 `npm start`로 실행하고, 코드를 업데이트했다면 다시 `npm install`과 `npm run build`를 실행합니다.

회원가입 → 이메일 인증 → 로그인 → 준비 단계 선택 순서로 시작합니다. AI 생성에는 관리자 승인도 필요합니다. Claude CLI 로그인을 사용한다면 `VIBE_TEACHER_LLM_PROVIDER=auto`로 바꿀 수 있으며, API 키나 CLI 로그인이 없어도 기본 기록 조회·저장은 사용할 수 있습니다. 인증 문제는 [로그인 안내](docs/authentication.md)를 참고하세요.

## 환경변수

[`.env.example`](.env.example)은 **개인 노트북에서 `npm run build && npm start`로 사용**하는 기본값입니다. 직접 채울 값은 연결 정보와 사용할 OpenRouter 키이며, 나머지 값은 필요할 때 바꿉니다. 일반 로컬 사용자는 `.env` 하나면 됩니다.

| 키 | 입력 기준 | 예제 값·용도 |
|---|---|---|
| `SUPABASE_URL` | 필수 | 관리자가 안내한 Supabase 프로젝트 URL |
| `SUPABASE_PUBLISHABLE_KEY` | 필수 | 같은 프로젝트의 공개 키. 관리자용 secret·service_role 키는 사용하지 않음 |
| `OPENROUTER_API_KEY` | OpenRouter AI 사용 시 | 관리자가 제공한 키. 제공받지 못했다면 본인이 발급한 키. 비워 두면 로그인 후 화면에서 입력 가능 |
| `VIBE_TEACHER_AUTH_MODE` | 예제 유지 | `supabase`: 이메일 회원가입·로그인 |
| `VIBE_TEACHER_LLM_PROVIDER` | 예제 유지 | `openrouter`: API 사용. Claude CLI 로그인은 `auto`, AI 중지는 `none` |
| `VIBE_TEACHER_DEPLOYMENT` | 예제 유지 | `local`: 내 노트북의 기록 조회 |
| `VIBE_TEACHER_HOST` | 선택 | `127.0.0.1`: 내 기기에서만 접속 |
| `VIBE_TEACHER_PORT` | 선택 | `3318`: `npm start`의 화면·API 포트 |
| `VIBE_TEACHER_PUBLIC_URL` | 선택·주석 해제 | 인증 후 돌아올 앱 주소. 생략하면 가입한 웹 주소 사용 |
| `VIBE_TEACHER_WEB_HOST` · `VIBE_TEACHER_WEB_PORT` | 개발 시에만 사용 | `127.0.0.1` · `3317`: `npm run dev`의 웹 서버. `npm start`에는 적용되지 않음 |
| `VIBE_TEACHER_API_URL` | 개발 시 선택 | 웹 개발 서버의 API 프록시 대상. 기본은 `VIBE_TEACHER_PORT`를 따라가므로 주석 유지 |

`.env.admin.example`은 관리자용 선택 예제이며 로컬 사용자는 복사하지 않아도 됩니다. 관리자 AI 키·회원별 키·DB 접속 정보가 필요할 때의 설정은 [공용 서버 가이드](docs/deployment.md#환경파일과-실행-방식)를 참고하세요.

## 포트 변경과 다시 실행

`3318`은 기본값입니다. 다른 앱과 겹치면 **`.env`의 `VIBE_TEACHER_PORT`**를 바꾸고 서버를 재시작하세요.

```dotenv
VIBE_TEACHER_PORT=3338
```

이제 `npm start`로 실행하고 `http://127.0.0.1:3338`에 접속합니다. 이번 실행에만 바꾸려면 `npm start -- --port 3338`도 가능합니다. 포트 변경만으로 화면을 다시 빌드할 필요는 없습니다.

실제 앱 주소는 Supabase Redirect URLs에도 등록해야 합니다. `VIBE_TEACHER_PUBLIC_URL`을 직접 설정했다면 새 주소로 함께 바꿉니다. 환경변수·CLI·설정 파일 중 어디서 값을 바꿀 수 있는지와 우선순위는 [포트와 주소 지정](docs/configuration.md#포트와-주소-지정)에 정리했습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [주요 기능과 사용 방법](docs/features.md) | 앱 안의 사용 방법 탭, 세션 분석, 레포 위키, 주요 기능 페이지, 어떻게 사용하나요?, 내 지식·퀴즈, 화면 설정 |
| [환경변수와 설정](docs/configuration.md) | 환경파일 우선순위, 전체 옵션, 기록 경로, `config.json` |
| [개발자 가이드](docs/development.md) | 개발용 환경 설정, `npm run dev`, 웹·API 포트 변경, 검사·테스트, 프로젝트 구조 |
| [Windows 설치 묶음](docs/windows.md) | Node.js 없이 Windows에서 실행하는 zip: 참가자 실행 순서, 관리자의 `npm run package` |
| [로그인과 회원 관리](docs/authentication.md) | Supabase 최초 설정, 이메일 인증, 많은 인원의 동시 가입, 관리자 권한, 기존 홈 토큰 로그인 |
| [공용 서버 가이드](docs/deployment.md) | 접속 사용자와 운영자 안내, `shared`·`ssh` 환경 설정, 회원별 AI 키, 다중 계정 ACL |
| [AI와 데이터 저장](docs/ai.md) | 제공자·모델, 전송 범위, 결과 저장, AI 호출 기록, 기존 mem0 설정 |
| [Supabase 저장 분석](docs/supabase-storage.md) | 테이블별 저장 경로, 통계와 성능 분석 |

AI 코딩 에이전트의 작업 규칙과 문서 갱신 기준은 [AGENT.md](AGENT.md)에 있습니다.
