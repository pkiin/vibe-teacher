# vibe-teacher

바이브 코딩 프로젝트. AI 코딩 도구(Claude Code, Codex CLI, GitHub Copilot)의 로컬 채팅 기록을 읽어

- **내가 쓴 메시지만** 뽑아 보여 주고 (도구 결과·시스템 주입 메시지 제외)
- **무엇이 만들어졌는지** 정리하고 (생성/수정/삭제 파일, 실행 명령, 설치 패키지, 커밋, 기술 스택)
- **알아야 할 개념**을 골라 설명하고 (규칙 기반 사전 + 선택적 AI 보강)
- **프로젝트 위키**로 확인된 사실·아직 확인되지 않은 것·먼저 볼 위험을 근거와 함께 정리하는 (실험 기능, 아래 참고)

로컬 웹 앱입니다. 계정(홈 디렉터리) › 프로젝트(작업 폴더) › 세션 계층으로 정리합니다.

## 빠른 시작

Node.js 20 이상이 필요합니다 (`node --version` 으로 확인).

```bash
npm install
npm run dev        # API http://127.0.0.1:8787 + 웹 http://127.0.0.1:5173
```

배포용:

```bash
npm run build && npm start   # http://127.0.0.1:8787 에서 UI 와 API 를 함께 서빙
```

### 포트와 주소 지정

우선순위는 **CLI 인자 > 환경변수 > `.env` > 설정 파일(`server.port`/`server.host`) > 기본값** 입니다. 환경변수는 저장소 루트의 `.env` 에 적어 둘 수도 있습니다 (`cp .env.example .env`, 아래 "AI 분석" 참고).

```bash
npm run dev -- --port 3050 --api-port 3060          # 웹 3050, API 3060 (프록시도 3060 을 따라감)
npm run dev -- --host 0.0.0.0 --api-host 0.0.0.0    # 외부에서 접속 (VIBE_TEACHER_TOKEN 필요)
npm run dev -- --home /srv/vibe-teacher             # 설정·캐시 디렉터리
npm run dev -- --help

npm start -- --port 3060 --host 127.0.0.1           # 배포용 서버 (API + UI 한 포트)
npm run dev:server -- --port 3060                   # API 만
npm run dev:web -- --port 3050                      # 웹만 (vite 옵션 그대로)
```

| 환경변수 | 뜻 | 기본값 |
|---|---|---|
| `VIBE_TEACHER_PORT` | API(Hono) 포트. 웹 개발 서버의 `/api` 프록시 대상도 이 값을 따름 | 8787 |
| `VIBE_TEACHER_HOST` | API 바인딩 주소 (loopback 이 아니면 `VIBE_TEACHER_TOKEN` 필수) | 127.0.0.1 |
| `VIBE_TEACHER_WEB_PORT` | 웹(Vite) 개발 서버 포트 | 5173 |
| `VIBE_TEACHER_WEB_HOST` | 웹 개발 서버 바인딩 주소 | 127.0.0.1 |
| `VIBE_TEACHER_API_URL` | 웹 개발 서버가 프록시할 API 주소를 통째로 지정 (원격 API 등) | `http://127.0.0.1:$VIBE_TEACHER_PORT` |
| `VIBE_TEACHER_HOME` | 설정 파일과 캐시 위치 | `~/.vibe-teacher` |
| `VIBE_TEACHER_TOKEN` | 비-loopback 바인딩 시 요구되는 Bearer 토큰 | 없음 |
| `ANTHROPIC_API_KEY` | AI 분석을 Anthropic API 로 실행할 때의 키 (없으면 로그인된 Claude Code CLI 사용) | 없음 |
| `OPENROUTER_API_KEY` | AI 를 OpenRouter 로 실행할 때의 키 (무료 모델도 필요) | 없음 |
| `OPENAI_API_KEY` | AI 를 OpenAI 로 실행할 때의 키 | 없음 |
| `VIBE_TEACHER_LLM_PROVIDER` | AI 제공자 강제 (`auto` · `claude-cli` · `anthropic-sdk` · `openrouter` · `openai` · `none`), 화면에서 고른 값보다 우선 | 설정값 (`auto`) |

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

## 설정 파일

`~/.vibe-teacher/config.json` (`VIBE_TEACHER_HOME` 으로 위치 변경). UI 의 소스 설정 페이지에서 편집합니다.

```json
{
  "version": 1,
  "scan": { "mode": "current", "homes": [], "homeRoots": ["/home"] },
  "sources": [{ "id": "…", "provider": "claude-code", "path": "/mnt/backup/.claude/projects", "label": "백업", "enabled": true }],
  "disabledDefaultSourceIds": [],
  "llm": { "provider": "auto", "claudeCliPath": null, "model": null, "maxBudgetUsd": 0.5, "timeoutMs": 180000, "effort": "medium", "openrouterModel": "openrouter/free", "openaiModel": "gpt-5-mini" },
  "server": { "host": "127.0.0.1", "port": 8787 },
  "wiki": { "briefTokenBudget": 900, "maxPrerequisiteDepth": 2, "maxPrerequisitesPerBundle": 4, "maxOptionalQuestions": 2, "suggestQuestions": true }
}
```

- `scan.mode`: `current`(현재 계정만) · `list`(`homes` 에 적은 홈 디렉터리) · `all`(`homeRoots` 아래 모든 홈 + `/etc/passwd` 의 uid ≥ 1000)
- `wiki`: 프로젝트 위키 설명 계획의 개발용 초기값입니다 (검증된 적정값이 아님). 첫 화면 분량(근사 토큰), 선행 개념 경로 깊이와 개수 상한, 세션당 제안할 이해 확인 문제 수, 문제 제안 여부.
- 인덱스 캐시는 `~/.vibe-teacher/cache/index/`, AI 분석 결과는 `~/.vibe-teacher/cache/enrich/`, 위키와 내 이해 정보는 `~/.vibe-teacher/wiki/` 에만 기록됩니다. 스캔 대상 홈에는 아무것도 쓰지 않습니다.

## 프로젝트 위키 (실험 기능)

세션 화면의 **프로젝트 위키** 탭에서 "위키 만들기"를 누르면, 그 세션 기록을 규칙으로 분석해 다음을 정리합니다. 이 단계에서는 AI 로 보내는 데이터가 없고 명령도 다시 실행하지 않습니다. (원하면 "AI로 보강"을 따로 실행할 수 있습니다 — 아래 참고)

- **먼저 확인할 것**: 기록에 남은 비밀값 의심, 접근 권한 검사 위치 미확인, 되돌리기 어려운 명령, 외부에 열린 개발 서버, AI API 비용 상한 미확인 같은 항목. 내 이해 정보와 관계없이 모든 사용자에게 똑같이 보입니다.
- **지금 알아 두면 좋은 것**: "로그인만 하면 누구나 이 기능을 써도 될까요?"처럼 지금 판단과 연결된 항목마다 관련 개념 설명, 먼저 이해하면 좋은 개념, 기록에서 나온 근거(발췌는 비밀값을 가림), 아직 확인되지 않은 것을 보여 줍니다. `이게 뭐예요?` `더 쉽게` `더 자세히` `예시 보기`로 설명 깊이를 바로 바꿀 수 있습니다.
- **확인한 범위와 확인하지 못한 범위**: 저장소 전체 코드와 배포 설정은 읽지 않으므로, "보이지 않음"은 이 세션 기록 안에서 찾지 못했다는 뜻으로만 씁니다. 에이전트가 "완료했습니다"라고 한 것과 실제 테스트 실행 기록도 구분합니다.

**내 이해 정보**는 본인만 볼 수 있고(관리자도 다른 사람 것은 못 봄) 프로젝트마다 따로 저장됩니다. `알고 있어요` / `잘 모르겠어요`는 설명 길이에만 반영되고 이해가 확인된 것으로 치지 않습니다. `문제로 확인하기`의 객관식·OX 문제는 선택 사항이며, 건너뛰기와 "모르겠어요"는 오답이 아닙니다. 정답은 제출한 뒤에만 서버가 알려 줍니다.

> 기본 문항 은행(`server/data/questions.json`)은 코딩 에이전트가 작성한 **검토 전(candidate)** 문항이라 연습으로만 기록되고 이해 상태 추정에는 반영되지 않습니다. 문항을 직접 검토한 뒤 `"reviewStatus": "reviewed"` 로 바꾸면 반영됩니다.

데이터 파일 (코드 수정 없이 고칠 수 있음):

| 파일 | 내용 |
|---|---|
| `server/data/concepts.ko.json` | 개념 설명. 위키용 `summary`(한 줄) · `example` · `confusions`(흔한 혼동) · `deep`(구현 원리). `wikiOnly: true` 는 개념 탭에는 나오지 않고 위키에서만 쓰는 개념 |
| `server/data/prerequisites.json` | 선행 개념 관계(`from` 을 `minDepth` 이상으로 설명할 때 `to` 가 먼저 필요). `status: proposed` 는 설명 묶음에 쓰지 않음. 순환은 자동으로 격리 |
| `server/data/questions.json` | 객관식(정답 1개)·OX 문항. 검사에 걸린 문항은 시작할 때 경고와 함께 제외 |

저장 위치: `~/.vibe-teacher/wiki/projects/<프로젝트>/` (위키 원장과 세션별 이력), `~/.vibe-teacher/wiki/learners/<불투명 ID>/projects/<프로젝트>/events.jsonl` (내 이해 정보 원장, 추가만 함).

## AI 분석 (선택)

**만들어진 것 / 알아야 할 개념** 탭의 "AI로 자세히 분석" 버튼을 눌렀을 때만 세션 다이제스트(내 메시지, 파일 목록, 명령 요약, 타임라인)가 AI 제공자에게 전송됩니다. 프로젝트 위키는 "AI로 보강"을 누를 때만 AI 를 씁니다 (아래 "프로젝트 위키 AI 보강"). 이해 확인 문제는 AI 를 쓰지 않습니다. 도구 출력 전문과 원본 기록은 보내지 않으며, 키처럼 보이는 값은 마스킹합니다.

| 제공자 | 조건 | 비고 |
|---|---|---|
| `claude-cli` | 로그인된 Claude Code. `claude` 를 설정 `claudeCliPath` → PATH → `CLAUDE_CODE_EXECPATH` → `~/.local/bin`·`~/.claude/local` → VS Code·Cursor 의 Claude Code 확장 폴더(가장 새 버전) 순으로 찾음 | `claude -p --output-format json --json-schema … --no-session-persistence --tools "" --restricted` 로 실행. 별도 API 키 불필요 |
| `anthropic-sdk` | `ANTHROPIC_API_KEY` | 기본 모델 `claude-opus-5-5` (입력 $4 / 출력 $20 per 1M 토큰), `effort` 기본 `medium`. 안전 분류기가 거절하면 서버가 권장 모델로 다시 실행합니다(`fallbacks: "default"`) |
| `openrouter` | `OPENROUTER_API_KEY` | 기본 모델 `openrouter/free`(무료 모델 라우터). 소스 설정에서 OpenRouter 모델 목록 중 고를 수 있음 |
| `openai` | `OPENAI_API_KEY` | 기본 모델 `gpt-5-mini`. 키가 있으면 OpenAI 모델 목록 중 고를 수 있음 |
| `auto` (기본) | Anthropic API 키 → Claude Code 로그인 → OpenRouter 키 → OpenAI 키 순 | 모두 없으면 규칙 기반 결과만 표시 |

**AI 키 넣는 곳**: 이 서버에 Claude Code 가 로그인되어 있으면 키 없이 `claude-cli` 로 동작합니다. Anthropic API 를 쓰려면 저장소 루트에서

```bash
cp .env.example .env && chmod 600 .env   # 그다음 .env 의 ANTHROPIC_API_KEY= 뒤에 키를 붙여넣기
npm start                                # 또는 npm run dev — 시작 로그에 ".env 를 읽었습니다 (ANTHROPIC_API_KEY)" 가 보이면 됨
```

`.env` 는 `.gitignore` 에 들어 있어 커밋되지 않습니다. 셸에서 `export ANTHROPIC_API_KEY=…` 로 넣어도 되고, 그쪽이 `.env` 보다 우선합니다. 키를 바꾼 뒤에는 서버를 다시 시작하세요.

**AI 제공자 고르기** (관리자): 소스 설정 페이지의 "AI 분석 제공자", 또는 AI 버튼 아래의 "지금 쓰는 AI · 바꾸기"에서 **Claude Code 로그인 / Anthropic API 키 / OpenRouter / OpenAI / 자동 / 사용 안 함** 중 하나를 고릅니다. 선택지마다 지금 실제로 쓸 수 있는지(CLI 버전, 키 유무)가 함께 보입니다. 환경변수 `VIBE_TEACHER_LLM_PROVIDER` 가 있으면 화면의 선택보다 우선합니다.

OpenRouter 를 고르면 모델 선택이 나타납니다. 목록은 OpenRouter 의 공개 모델 목록(`https://openrouter.ai/api/v1/models`)에서 가져오며(1시간 캐시, "목록 새로고침"으로 다시 받기), 기본으로 **무료 모델만** 보여 줍니다. 모델마다 가격, 컨텍스트 크기, JSON 스키마 강제 지원 여부가 표시됩니다. 지원하지 않는 모델은 JSON 모드나 프롬프트 지시로 대신하므로 형식이 틀려 실패할 수 있습니다. 무료 모델은 공급자가 입력을 기록하거나 학습에 쓸 수 있고 요청 한도가 낮으니, 민감한 기록에는 유료 모델이나 Claude 를 쓰세요. 무료 모델이 "data policy" 오류를 내면 OpenRouter 계정 Settings › Privacy 에서 무료 모델 사용을 허용해야 합니다. OpenAI 를 고르면 키가 있을 때 계정의 모델 목록에서 고를 수 있습니다.

Claude Code 세션 안에서 이 앱을 띄워도 중첩 실행이 막히지 않도록, 자식 프로세스에서는 `CLAUDE_CONFIG_DIR` 를 제외한 `CLAUDE*` 환경변수를 제거합니다. "Claude Code 로그인"을 고르면 `ANTHROPIC_API_KEY` 가 설정되어 있어도 `claude` 에는 넘기지 않으므로, 키가 아니라 로그인(구독)으로 실행됩니다.

### 프로젝트 위키 AI 보강

위키 탭의 **AI로 보강**을 누르면, 위와 같은 AI 제공자로 규칙 기반 위키를 보강합니다. 버튼을 누를 수 있는 사람은 "AI로 자세히 분석"과 같습니다(`auth.enrichFor`, 기본 관리자만).

- **보내는 내용**: 위키 근거 발췌(비밀값 가림), 내 메시지 요약, 파일·명령 목록, 위키 항목과 개념 목록. "보낼 내용 미리 보기"에서 실제로 보낼 텍스트를 먼저 확인할 수 있습니다. 원본 기록 파일과 도구 출력 전문은 보내지 않습니다.
- **AI 가 하는 일**: 항목마다 이 프로젝트에 맞춘 설명, 기록에서 직접 확인되는 새 사실 후보, 놓친 항목 후보, 카탈로그에 없는 개념 제안.
- **코드가 검사하는 것**: 인용한 근거·주장·항목·개념 ID 가 실제로 있어야 하고, 하나라도 지어낸 ID 가 있으면 그 제안 전체를 버립니다. 프로젝트에 관한 문장은 근거 주장을 하나 이상 인용해야 합니다. 걸러 낸 제안은 이유와 함께 "검사에서 걸러 낸 AI 제안"에 보입니다.
- **AI 가 바꾸지 못하는 것**: 위험 알림(먼저 확인할 것)과 그 상태·영향. AI 가 쓴 설명·사실·항목에는 "AI 작성", "AI 후보", "AI 제안 · 검토 전" 표시가 붙고, AI 가 제안한 항목은 규칙 기반 항목 뒤에 놓입니다.
- **저장**: `~/.vibe-teacher/wiki/projects/<프로젝트>/ai/<snapshot>.json` 에 규칙 기반 원장과 따로 저장됩니다. 같은 snapshot 에서는 저장된 결과를 다시 쓰고, "다시 보강"을 누를 때만 새로 호출합니다. 세션 기록이 바뀌면 위키를 다시 만든 뒤 보강해야 합니다.

claude CLI 로 실행할 때 `llm.maxBudgetUsd`(기본 0.5달러)가 요청 상한입니다. 위키 보강은 세션 분석보다 입력이 커서(큰 세션은 약 4~5만 자) 모델에 따라 상한을 넘을 수 있으니, "예산 초과" 오류가 나면 소스 설정에서 올려 주세요.

## 다중 계정 운영 (서버 전체 조회)

다른 계정의 홈은 보통 `drwxr-x---` 이고 Claude 세션 파일은 `0600` 이라 일반 계정으로는 읽을 수 없습니다. 앱을 돌리는 계정(서비스 계정, 예: `user99`)에 **읽기 전용 ACL** 을 주면 root 로 실행하지 않고도 전체를 읽을 수 있습니다. `/home` 이 ext4/xfs 라면 ACL 은 바로 쓸 수 있습니다.

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

기본은 `127.0.0.1` 에만 바인딩합니다. 다른 PC 에서 보려면 SSH 터널을 권장합니다.

```bash
ssh -L 8787:127.0.0.1:8787 <server>
```

부득이하게 외부 주소로 열어야 하면 토큰이 필수입니다 (없으면 부팅을 거부합니다).

```bash
VIBE_TEACHER_HOST=0.0.0.0 VIBE_TEACHER_TOKEN='긴-무작위-문자열' npm start
```

UI 에서 처음 한 번 토큰을 입력하면 브라우저에 저장됩니다.

## 구조

```
shared/   도메인 타입, API DTO, LLM 출력 스키마 (zod)
server/   Hono API — adapters(도구별 파서) · index(계정/소스/세션 인덱스) · analyzers(내 메시지 / 만들어진 것 / 개념) · llm(보강)
          wiki(위키 원장·검사·설명 계획) · learner(내 이해 정보) · assessment(문항·채점) · storage(위키 저장소)
web/      Vite + React UI (한국어)
```

개념 사전은 `server/data/concepts.ko.json` 에 있으며 코드 수정 없이 항목을 추가할 수 있습니다.

AI 코딩 에이전트로 이 저장소를 고칠 때의 규칙(불변 조건, 작업 레시피, README 갱신 기준)은 [AGENT.md](AGENT.md) 에 있습니다. `CLAUDE.md` 는 AGENT.md 를 불러오기만 합니다.
