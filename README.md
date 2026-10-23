# vibe-teacher

바이브 코딩 프로젝트. AI 코딩 도구(Claude Code, Codex CLI, GitHub Copilot)의 로컬 채팅 기록을 읽어

- **내가 쓴 메시지만** 뽑아 보여 주고 (도구 결과·시스템 주입 메시지 제외)
- **무엇이 만들어졌는지** 정리하고 (생성/수정/삭제 파일, 실행 명령, 설치 패키지, 커밋, 기술 스택)
- **알아야 할 개념**을 골라 설명하고 (AI가 작업 맥락에서 직접 선정·작성)
- **이번 세션에서 확인할 것**을 근거와 함께 정리하고, 옆의 **도움 패널**에서 설명·질문·퀴즈로 이어 보고
- 프로젝트마다 **레포 위키**(이 레포가 무엇이고 어떻게 동작하는지)를, 사용자마다 **내 지식 위키**(어떤 개념을 어디서 만났고 무엇으로 확인했는지)를 계속 갱신하고 (실험 기능, 아래 참고)
- **보안 및 취약점 점검**에서 근거가 있는 주의사항과 추가 확인 방법을 따로 살펴보고
- 오른쪽 위 **설정(톱니바퀴)**에서 글씨·화면 밀도·테마·설명 난이도를 고르고
- 근거 파일을 **코드 팝업**에서 읽고, **코드 연결 흐름도**에서 실제 파일을 따라가며 이해하고
- 이 모든 설명 문장을 **읽는 사람 수준**(비개발자 · 입문 · 주니어 · 숙련, 기본은 비개발자)에 맞춰 AI 가 쓰는

로컬 웹 앱입니다. 계정(홈 디렉터리) › 프로젝트(작업 폴더) › 세션 계층으로 정리합니다.

같은 계정에서 여러 도구가 **같은 실제 폴더**를 가리키면 하나의 프로젝트로 모읍니다. 심볼릭 링크 때문에 기록된 경로가 달라도 실제 경로를 확인해 세션을 합칩니다. 이름이 같아도 다른 폴더이거나 다른 계정이면 별개로 유지하며, 없거나 읽을 수 없는 폴더는 기록된 경로를 사용합니다. Git 원격 주소가 같아도 별도로 복제한 폴더나 worktree는 자동으로 합치지 않습니다.

업데이트 후 서버를 다시 시작하고 브라우저를 새로고침하면 통합된 목록을 볼 수 있습니다. 예전 프로젝트 링크도 대표 프로젝트로 연결됩니다. 양쪽에 저장한 세션 위키·AI 설명·질문 기록·레포 위키 갱신 이력을 함께 읽으며, 레포 위키는 가장 최근 판을 보여 줍니다. 예전 저장 파일은 보존하고 새 기록은 대표 프로젝트에 저장합니다. 통합 후 레포 위키에 새 세션 안내가 뜨면 **업데이트**를 눌러 합쳐진 세션을 반영합니다.

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

우선순위는 **CLI 인자 > 환경변수 > `.env` > 설정 파일(`server.port`/`server.host`) > 기본값** 입니다. 환경변수는 저장소 루트의 `.env` 에 적어 둘 수도 있습니다 (`cp .env.example .env`, 아래 "AI 문장과 제공자" 참고).

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
| `OPENROUTER_API_KEY` | API 생성·Claude CLI 실패 재시도·외부 문서 검색에 사용하는 키 | 없음 |
| `VIBE_TEACHER_LLM_PROVIDER` | AI 제공자 강제 (`auto` · `claude-cli` · `openrouter` · `none`), 화면에서 고른 값보다 우선 | 설정값 (`auto`) |

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
  "server": { "host": "127.0.0.1", "port": 8787 },
  "wiki": { "briefTokenBudget": 900, "maxPrerequisiteDepth": 2, "maxPrerequisitesPerBundle": 4, "maxOptionalQuestions": 2, "suggestQuestions": true }
}
```

- `scan.mode`: `current`(현재 계정만) · `list`(`homes` 에 적은 홈 디렉터리) · `all`(`homeRoots` 아래 모든 홈 + `/etc/passwd` 의 uid ≥ 1000)
- `llm.autoText`: 사람이 읽는 문장(레포 위키, 내 지식 설명, 세션 위키 설명)을 AI 가 자동으로 쓸지. 끄면 자동 생성을 멈추고 버튼으로 생성할 수 있습니다. AI가 없는 경우 설명을 만들어 표시하지 않습니다.
- `wiki`: 프로젝트 위키 설명 계획의 개발용 초기값입니다 (검증된 적정값이 아님). 첫 화면 분량(근사 토큰), 선행 개념 경로 깊이와 개수 상한, 세션당 제안할 이해 확인 문제 수, 문제 제안 여부.
- 인덱스 캐시는 `~/.vibe-teacher/cache/index/`, AI 분석 결과는 `~/.vibe-teacher/cache/enrich/`, 위키와 내 이해 정보는 `~/.vibe-teacher/wiki/` 에만 기록됩니다. 스캔 대상 홈에는 아무것도 쓰지 않습니다.

## AI로 만드는 위키와 개념 카드

개념 사전·키워드 점수·고정 문항 은행을 사용하지 않습니다. AI가 세션의 요청·변경 코드·도구 결과를 읽고 지금 이해하거나 판단하는 데 필요한 개념과 설명 순서를 선정합니다. 처음 보는 프레임워크나 라이브러리도 새 개념 카드로 만들 수 있습니다.

코드는 원본 파일·명령·코드 연결을 수집하고 출처 참조와 데이터 형식을 검사합니다. 프로젝트 사실, 에이전트의 완료 보고, AI의 해석을 구분합니다. 출처가 연결됐다는 사실만으로 내용이 옳다고 검증된 것은 아닙니다.

### 이번 세션 이해하기

세션에서 **위키 만들기**를 누르면 AI 생성 작업이 시작됩니다. AI가 프로젝트 주장·주의사항·개념·학습 카드·선행관계를 함께 작성합니다. 개념 카드에는 정의와 이번 작업에서 필요한 이유, 실제 기록의 근거가 표시됩니다. 고정 사전의 개념으로 범위를 제한하지 않습니다.

세션 위키의 개념은 **알아야 할 개념**과 **내 지식**에도 연결됩니다. 별도 세션 분석은 작업 요약과 개념을 AI로 선정하며, 규칙 기반 카드를 덧붙이지 않습니다. 화면의 AI 버튼으로 다시 생성하거나 진행 중 작업을 취소할 수 있습니다.

**보안·데이터 주의사항**도 AI가 기록의 근거를 보고 선정합니다. 공통 체크리스트를 모든 프로젝트에 붙이지 않습니다. 실제 서비스 환경이나 전체 저장소의 취약점을 검사했다는 뜻은 아닙니다. AI가 제시한 확인 사항과 읽지 못한 범위를 함께 확인하세요.

### 레포 위키

프로젝트의 **레포 위키 만들기**를 누르면 README, 의존성, 실행 스크립트, 주요 코드 발췌와 세션 요약을 AI에 전달합니다. AI가 사용자 중심 페이지와 동작 중심 페이지의 절 구성·제목·설명·주의사항을 작성합니다.

스크립트·API 경로 표와 코드 연결 그림은 저장소에서 수집한 원문 자료입니다. AI가 이를 인용할 수 있지만 값을 바꾸거나 연결을 만들어낼 수는 없습니다. 근거를 펼쳐 파일 원문과 줄 번호를 확인할 수 있습니다. 스캔은 읽기 전용이며 코드를 실행하지 않습니다.

API 표는 **방식 → 경로 → 동작 설명 → 파일** 순서로 표시합니다. AI가 경로별 코드 발췌를 읽고 무엇을 조회·저장·응답하는지, 확인된 접근 검사는 무엇인지 설명합니다. 발췌만으로 알 수 없는 동작은 확인 범위를 함께 적습니다. 기존 위키는 **업데이트**하면 새 설명 열이 반영됩니다.

코드 연결 그림의 각 상자에는 파일명과 함께 **이 파일이 실제로 하는 일**을 표시합니다. AI가 코드 근거로 프론트엔드·백엔드의 분리를 확인하면 큰 영역을 나눠 그리고, 함께 쓰는 코드는 공통 영역에 둡니다. 화살표는 실제 코드의 파일 참조 관계이며 실행 순서나 통신을 추측해 추가하지 않습니다.

파일 설명이나 영역이 빠지면 해당 정보를 AI에 한 번 더 요청합니다. 모든 상자의 설명과 출처가 연결된 경우에만 생성 완료로 저장하며, 보완에 실패하면 원인을 표시합니다. 이미 설명 없이 생성된 이전 결과는 재사용하지 않으므로 **다시 쓰기**로 새 설명을 받을 수 있습니다.

위키를 작성할 때 AI가 먼저 확인할 질문과 파일 위치를 고르고, 서버가 필요한 코드 일부를 읽어 추가 답변을 받습니다. Claude CLI에서는 이 확인 단계만 **Haiku·low effort**로 실행하며, CLI 실패나 API 제공자 선택 시에는 OpenRouter의 설정 모델(기본 `openai/gpt-5-mini`)을 사용합니다. 추가 확인은 최대 6곳·코드 합계 24,000자이며, 비밀값을 가리고 출처가 확인된 답만 위키 작성에 활용합니다. **AI에 보내는 내용 보기**에서 기본 입력과 추가 확인 범위를 볼 수 있습니다.

새 세션이나 파일 변경이 생기면 **업데이트**로 반영합니다. 문장은 읽는 사람 수준별로 저장하고, 같은 입력으로 이미 생성한 결과는 재사용합니다. 생성에 실패하면 사유와 재시도 동작을 표시하며 고정 설명으로 대체하지 않습니다.

### 내 지식과 이해 확인

**내 지식**은 접근 가능한 세션의 AI 개념을 모으고 개념별로 근거 세션·자기보고·문항 응답을 연결합니다. 설명 문장은 AI가 작성합니다. 이해 상태는 명시적인 자기보고·응답·정정으로만 정하며, 개념의 등장·설명 열람·질문을 이해 증거로 취급하지 않습니다.

**간단히 확인하기**를 누르면 해당 개념의 AI 설명을 바탕으로 객관식 또는 OX 문항을 생성합니다. 정답과 해설은 제출 전 브라우저로 보내지 않고 서버에서 채점합니다. AI 생성 문항은 검토 전 연습으로 기록하며 숙련 확정 근거로 사용하지 않습니다. 건너뛰기와 모르겠어요는 오답이 아닙니다.

도움 패널의 질문 답변도 AI가 작성합니다. AI를 사용할 수 없으면 생성 실패 사유를 표시하며 고정 답변을 반환하지 않습니다. 질문 기록은 개인별로 보관합니다.

## AI 제공자와 외부 문서 검색

| 설정 | 실행 방식 |
|---|---|
| `auto` (기본) | 로그인된 Claude CLI 우선. CLI를 사용할 수 없거나 작업에 실패하면 OpenRouter로 실행 |
| `claude-cli` | Claude CLI 우선. 처리 실패와 외부 문서 검색은 OpenRouter로 실행 |
| `openrouter` | 모든 생성을 OpenRouter API로 실행 |
| `none` | 새 AI 생성을 중지. 저장된 AI 결과와 원본 기록은 열람 가능 |

모든 API 호출은 **OpenRouter**를 사용하며 기본 모델은 **`openai/gpt-5-mini`**입니다. 기존 `openai`·`anthropic-sdk` 제공자 설정은 OpenRouter로 이관됩니다. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`로 직접 API를 호출하지 않습니다. 예전 기본값 `openrouter/free`는 `openai/gpt-5-mini`로 바뀝니다.

저장소 루트의 `.env`에 키를 넣고 서버를 다시 시작하세요.

```dotenv
OPENROUTER_API_KEY=발급받은_OpenRouter_키
VIBE_TEACHER_LLM_PROVIDER=auto
```

모델은 소스 설정의 OpenRouter 모델 선택에서 바꿀 수 있습니다. 모델 목록 조회도 OpenRouter만 사용합니다.

세션 개념을 생성한 뒤에는 **OpenRouter 웹 검색**으로 공식 문서를 찾아 정의와 설명을 확인합니다. 검색에는 개념 이름만 전달하고 세션 원문·프로젝트 경로를 넣지 않습니다. 모델이 임의로 적은 주소는 새 참고 링크로 채택하지 않으며, API 검색 응답의 실제 출처 URL과 대조합니다. 검색이 실패하면 AI 설명은 보존하고 문서 조회 실패를 표시합니다. 검색과 API 생성에는 OpenRouter 크레딧이 사용됩니다.

AI 미설정·권한 부족·취소·오류 상태에서는 새 설명을 생성하지 않습니다. 이미 저장된 AI 결과는 계속 볼 수 있습니다. 자동 생성은 `llm.autoText`로 조절하고, 생성 권한은 `auth.enrichFor`로 정합니다. 전송 내용은 화면의 미리 보기에서 확인할 수 있으며, 비밀값을 마스킹하고 길이를 제한한 발췌만 전달합니다.

### 읽는 사람 수준과 화면 설정

처음 사용할 때 **비개발자·입문·주니어·숙련** 중 설명 수준을 선택합니다. AI 문장은 수준별로 저장하며 이 선택을 이해 증거로 사용하지 않습니다. 글씨 크기·글꼴·밀도·라이트/다크 테마는 오른쪽 위 톱니바퀴에서 별도로 설정합니다.

### 저장과 기존 결과

- 세션 위키: `~/.vibe-teacher/wiki/projects/<프로젝트>/snapshots/`, 수준별 AI 설명은 `ai/`
- 레포 위키: 같은 프로젝트의 `repo/`, 수준별 문장은 `repo/text/`
- 개인 이해 정보: `~/.vibe-teacher/wiki/learners/<ID>/events.jsonl`
- 개인 설명: 같은 사용자 폴더의 `knowledge-text.json`

이전 규칙 기반 위키·설명 캐시는 현재 결과로 사용하지 않습니다. 기존 기록 파일은 보존하며, 화면에서 위키를 다시 생성하면 새 AI 흐름을 사용합니다.

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
server/   Hono API — adapters(도구별 파서) · index(계정/소스/세션 인덱스) · analyzers(원본 작업 수집) · llm(AI 생성·제공자 라우팅)
          wiki(세션 위키 원장·검사·설명 계획) · repo(레포 위키: 읽기 전용 스캔·AI 추가 코드 확인·조립) · learner(내 이해 정보·내 지식 위키)
          assessment(문항·채점) · help(도움 패널 질문) · storage(위키 저장소)
web/      Vite + React UI (한국어), test(화면 렌더링 검사)
```

개념은 AI가 세션 맥락에서 생성하며 고정 사전 파일을 사용하지 않습니다.

AI 코딩 에이전트로 이 저장소를 고칠 때의 규칙(불변 조건, 작업 레시피, README 갱신 기준)은 [AGENT.md](AGENT.md) 에 있습니다. `CLAUDE.md` 는 AGENT.md 를 불러오기만 합니다.
