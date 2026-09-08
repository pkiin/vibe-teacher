# vibe-teacher

바이브 코딩 프로젝트. AI 코딩 도구(Claude Code, Codex CLI, GitHub Copilot)의 로컬 채팅 기록을 읽어

- **내가 쓴 메시지만** 뽑아 보여 주고 (도구 결과·시스템 주입 메시지 제외)
- **무엇이 만들어졌는지** 정리하고 (생성/수정/삭제 파일, 실행 명령, 설치 패키지, 커밋, 기술 스택)
- **알아야 할 개념**을 골라 설명하는 (규칙 기반 사전 + 선택적 AI 보강)

로컬 웹 앱입니다. 계정(홈 디렉터리) › 프로젝트(작업 폴더) › 세션 계층으로 정리합니다.

## 빠른 시작

```bash
npm install
npm run dev        # API http://127.0.0.1:8787 + 웹 http://127.0.0.1:5173
```

배포용:

```bash
npm run build && npm start   # http://127.0.0.1:8787 에서 UI 와 API 를 함께 서빙
```

### 포트와 주소 지정

우선순위는 **CLI 인자 > 환경변수 > 설정 파일(`server.port`/`server.host`) > 기본값** 입니다.

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
  "llm": { "provider": "auto", "claudeCliPath": null, "model": null, "maxBudgetUsd": 0.5, "timeoutMs": 180000 },
  "server": { "host": "127.0.0.1", "port": 8787 }
}
```

- `scan.mode`: `current`(현재 계정만) · `list`(`homes` 에 적은 홈 디렉터리) · `all`(`homeRoots` 아래 모든 홈 + `/etc/passwd` 의 uid ≥ 1000)
- 인덱스 캐시는 `~/.vibe-teacher/cache/index/`, AI 분석 결과는 `~/.vibe-teacher/cache/enrich/` 에만 기록됩니다. 스캔 대상 홈에는 아무것도 쓰지 않습니다.

## AI 분석 (선택)

"AI로 자세히 분석" 버튼을 눌렀을 때만 세션 다이제스트(내 메시지, 파일 목록, 명령 요약, 타임라인)가 AI 제공자에게 전송됩니다. 도구 출력 전문과 원본 기록은 보내지 않으며, 키처럼 보이는 값은 마스킹합니다.

| 제공자 | 조건 | 비고 |
|---|---|---|
| `claude-cli` | 로그인된 Claude Code (`claude` 가 PATH 에 있거나 `CLAUDE_CODE_EXECPATH`, 또는 설정 `claudeCliPath`) | `claude -p --output-format json --json-schema … --no-session-persistence --tools "" --restricted` 로 실행. 별도 API 키 불필요 |
| `anthropic-sdk` | `ANTHROPIC_API_KEY` | 기본 모델 `claude-opus-5` |
| `auto` (기본) | API 키가 있으면 SDK, 아니면 CLI | 둘 다 없으면 규칙 기반 결과만 표시 |

Claude Code 세션 안에서 이 앱을 띄워도 중첩 실행이 막히지 않도록, 자식 프로세스에서는 `CLAUDE_CONFIG_DIR` 를 제외한 `CLAUDE*` 환경변수를 제거합니다.

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
web/      Vite + React UI (한국어)
```

개념 사전은 `server/data/concepts.ko.json` 에 있으며 코드 수정 없이 항목을 추가할 수 있습니다.
