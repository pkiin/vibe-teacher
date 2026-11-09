# 공용 서버 가이드

[README로 돌아가기](../README.md)

여러 사람이 같은 서버에서 쓰는 경우를 위한 안내입니다. **접속 사용자**는 앱 설치 없이 브라우저 또는 SSH 터널로 접속하고, **운영자**가 서버의 실행·환경파일·회원 승인·회원별 AI 키를 관리합니다. 개인 노트북 설치는 [README](../README.md), 코드를 수정하는 개발은 [개발자 가이드](development.md)를 따릅니다.

- [공용 서버에 접속해서 쓰기](#공용-서버에-접속해서-쓰기)
- [환경파일과 실행 방식](#환경파일과-실행-방식)
- [공용 서버에 설치](#공용-서버에-설치)
- [공용 서버의 사용자별 API 키](#공용-서버의-사용자별-api-키)
- [개발 서버에서 SSH 터널로 함께 쓰기](#개발-서버에서-ssh-터널로-함께-쓰기)
- [다중 계정 운영](#다중-계정-운영-서버-전체-조회)
- [원격 접근](#원격-접근)
- [Supabase 저장소 확인](#supabase-저장소-확인)

## 공용 서버에 접속해서 쓰기

| 접속 방식 | 사용자가 할 일 | 사용자의 환경파일 |
|---|---|---|
| HTTPS 공용 서버 (`shared`) | 운영자가 안내한 HTTPS 주소에서 회원가입 → 이메일 인증 → 로그인 | 필요 없음 |
| SSH 터널 서버 (`ssh`) | 본인 OS 계정으로 SSH 터널을 연 뒤 로컬 주소에서 회원가입·로그인 | 필요 없음 |

운영자에게 **AI 사용 승인**과 **본인 Supabase UUID에 연결할 OpenRouter 키 등록**을 요청합니다. 관리자가 제공하는 키가 있으면 그 키를 연결하고, 제공하지 않는 경우 본인이 발급한 키의 등록을 요청합니다. `ssh`에서는 터널을 연 OS 계정이 확인되면 AI 사용 승인이 자동이고, 운영자가 본인 OS 계정 이름으로 키를 [미리 등록](#os-계정-이름으로-미리-등록하기-ssh)해 두었다면 따로 요청할 것이 없습니다. `shared`에서는 조회할 서버 OS 계정도 운영자가 연결합니다. `ssh`에서는 터널을 연 OS 계정으로 조회 범위가 정해집니다. 키는 운영자가 서버의 비공개 환경파일로 관리하며, 사용자에게 `.env.admin`이나 DB 주소를 배포하지 않습니다.

이 방식에서는 **서버가 읽을 수 있는 기록과 저장소**를 봅니다. 내 노트북의 대화 기록을 보고 싶다면 [로컬 설치](../README.md#빠른-시작)를 사용하세요. 회원 설정·학습 기록과 실행 기기의 관계는 [로컬 설치와 기기 간 데이터](authentication.md#로컬-설치-소유자와-기기-간-데이터)를 참고하세요.

## 환경파일과 실행 방식

운영자는 Node.js 22.12 이상과 npm을 준비하고, 먼저 [Supabase 최초 설정](authentication.md#supabase-최초-설정-관리자-1회)을 완료합니다. 같은 회원으로 사용하는 로컬 설치와 서버에는 같은 Supabase URL·공개 키를 설정합니다.

서버의 저장소 루트에서 한 번 준비합니다. 이미 환경파일이 있다면 복사로 덮어쓰지 말고 아래 차이만 반영하세요.

```bash
npm install
cp .env.example .env
cp .env.admin.example .env.admin
chmod 600 .env .env.admin
```

두 예제의 기본값은 **개인 노트북 사용**입니다. `.env`는 연결 정보·실행 주소·방식, `.env.admin`은 운영자만 접근할 관리자 키·회원별 키·선택적 DB 주소를 관리합니다.

| 항목 | 개인 노트북 예제 | HTTPS 공용 서버 | SSH 터널 서버 |
|---|---|---|---|
| `VIBE_TEACHER_AUTH_MODE` | `supabase` | 유지 | 유지 |
| `VIBE_TEACHER_DEPLOYMENT` | `local` | `shared`로 변경 | `ssh`로 변경 |
| `VIBE_TEACHER_HOST` | `127.0.0.1` | 같은 서버의 HTTPS 프록시 뒤라면 유지 | `127.0.0.1` 유지 필수 |
| `VIBE_TEACHER_PORT` | `3318` | 내부 화면·API 포트. 충돌 시 변경 | 서버 쪽 터널 대상 포트. 충돌 시 변경 |
| `VIBE_TEACHER_PUBLIC_URL` | 미설정 | 실제 HTTPS 주소로 설정 | 미설정 또는 PC 쪽 터널의 loopback 주소 |
| `OPENROUTER_API_KEY` | 관리자 제공 키, 없으면 본인이 발급한 키 | 비워 두고 `.env.admin`에서 회원별 키 관리 | 비워 두고 `.env.admin`에서 회원별 키 관리 |
| `VIBE_TEACHER_LLM_PROVIDER` | `openrouter` | 유지. 사용자별 키로 API 호출 | 유지. 사용자별 키로 API 호출 |
| `VIBE_TEACHER_WEB_HOST` · `VIBE_TEACHER_WEB_PORT` | `127.0.0.1` · `3317` | `npm start`에서는 사용하지 않음 | `npm start`에서는 사용하지 않음 |
| `.env.admin`의 관리자 AI 키 | 빈 값 | 관리자 본인 AI 사용 시 선택 | 관리자 본인 AI 사용 시 선택 |
| `.env.admin`의 회원별 키 목록 | `{}` | AI를 사용할 회원별 UUID → 키 등록 | AI를 사용할 회원별 UUID → 키 등록 |
| `.env.admin`의 DB 주소 | 미설정 | 최초 설정 명령·통계 조회가 필요할 때만 설정 | 동일 |

파일의 같은 변수는 **셸 > `.env` > `.env.admin`** 순서로 우선합니다. `.env`에 빈 문자열을 넣어도 같은 이름의 `.env.admin` 값을 가릴 수 있으므로 중복 배치하지 않습니다. 실제 키가 든 파일은 공유·커밋하지 않고, 변경 후 앱을 재시작합니다.

## 공용 서버에 설치

위 준비 후 `.env`의 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`를 채우고 다음처럼 바꿉니다. 예시는 **같은 서버에서 HTTPS 리버스 프록시를 실행**하는 경우입니다.

```dotenv
VIBE_TEACHER_AUTH_MODE=supabase
VIBE_TEACHER_DEPLOYMENT=shared
VIBE_TEACHER_HOST=127.0.0.1
VIBE_TEACHER_PORT=3318
VIBE_TEACHER_PUBLIC_URL=https://app.example.com/
OPENROUTER_API_KEY=
VIBE_TEACHER_LLM_PROVIDER=openrouter
```

프록시는 외부 `https://app.example.com/` 요청을 내부 `http://127.0.0.1:3318`로 전달하도록 구성합니다. Supabase Site URL·Redirect URLs에도 실제 HTTPS 주소를 등록합니다. 프록시가 다른 호스트·컨테이너에서 접근해야 한다면 서버의 바인딩·네트워크에 맞춰 `VIBE_TEACHER_HOST` 또는 `npm start -- --host ...`를 지정합니다.

```bash
npm run build && npm start
```

`npm start`가 화면과 API를 한 포트에서 제공합니다. 공용 서버는 항상 `Secure` 쿠키를 사용하므로 브라우저는 HTTPS 주소로 접속해야 합니다. `VIBE_TEACHER_WEB_PORT=3317`을 바꿔도 이 실행에는 영향이 없습니다.

관리자는 **회원 관리**에서 AI 사용을 승인하고 각 회원이 볼 OS 계정을 연결합니다. 연결 전에는 서버의 채팅 기록이 보이지 않습니다. 같은 OS 계정을 두 회원에게 중복 배정할 수 없습니다. Supabase 관리자도 작업 기록은 연결된 본인 계정 범위만 조회합니다. 서버의 다른 홈을 읽으려면 [다중 계정 운영](#다중-계정-운영-서버-전체-조회)의 ACL과 스캔 범위를 준비합니다.

내부 포트를 `3338`로 바꾸려면 `.env`의 `VIBE_TEACHER_PORT=3338`과 **프록시의 전달 대상 포트**를 함께 바꾸고 앱을 재시작합니다. 외부 HTTPS 주소가 그대로라면 인증 복귀 주소는 유지합니다. 이번 실행만 바꾸려면 `npm start -- --port 3338`을 쓸 수 있습니다.

실행한 터미널의 `Ctrl+C`로 종료하고 `npm start`로 다시 실행합니다. 서버 프로세스를 systemd·컨테이너 등으로 관리한다면 실행 계정과 작업 디렉터리를 이 저장소로 지정하고, 종료 후 다시 시작하는 절차도 해당 관리 도구에서 수행합니다. 코드 업데이트 후에는 앱을 종료하고 `npm install`, `npm run build`를 실행한 뒤 다시 시작합니다.

## 공용 서버의 사용자별 API 키

공용 서버 방문자는 링크로 접속해 로그인하면 됩니다. 아래 SSH 터널 개발 서버(`ssh`)도 같은 방식으로 회원별 키를 등록하며, `ssh`에서는 가입 전에 [OS 계정 이름으로 미리 등록](#os-계정-이름으로-미리-등록하기-ssh)할 수도 있습니다. 서버 관리자가 **회원 관리**에서 AI 사용을 승인하고(`ssh`는 [승인이 자동](#개발-서버에서-ssh-터널로-함께-쓰기)), 카드에 표시되는 "API 키 연결용 사용자 ID"를 복사합니다. Supabase Authentication → Users의 사용자 UUID도 같은 값입니다.

`.env.admin`의 `VIBE_TEACHER_USER_OPENROUTER_KEYS`를 다음처럼 작성합니다. UUID와 키는 해당 회원의 실제 값으로 바꿉니다. 아래 두 UUID는 합성 예시입니다.

```dotenv
VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY=관리자_본인의_개발용키
VIBE_TEACHER_USER_OPENROUTER_KEYS='{
  "11111111-1111-4111-8111-111111111111": "첫_사용자의_OpenRouter_키",
  "22222222-2222-4222-8222-222222222222": "두번째_사용자의_OpenRouter_키"
}'
```

공용 서버는 검증된 로그인 UUID에 연결한 키로 OpenRouter를 호출합니다. 서로 다른 키를 등록하면 요청도 각 사용자의 키로 나뉩니다. 사용자별 추적을 유지하기 위해 `shared`에서는 Claude CLI를 사용하지 않습니다. `VIBE_TEACHER_LLM_PROVIDER=none`으로 AI를 끌 수 있습니다.

**회원 승인과 키 등록은 각각 필요합니다.** `ssh`는 승인이 자동이라 키 등록만 필요합니다. 일반 회원의 키가 없으면 키 등록 안내를 표시하며, 관리자 개발용 키나 다른 회원의 키를 사용하지 않습니다. 관리자 계정은 본인 UUID에 연결된 키를 우선하고, 미등록 시 관리자 개발용 키를 사용합니다. 키 목록과 키 값은 브라우저 응답에 포함하지 않습니다. 환경파일을 수정한 뒤 서버를 다시 시작하세요. 관리자가 제공할 키를 준비하거나, 제공하지 않는 경우 회원이 직접 발급한 키를 해당 UUID에 등록합니다.

회원이 추가되면 승인과 키 등록을 각각 확인하고, 키를 교체하면 해당 UUID의 값만 바꾼 뒤 앱을 재시작합니다. 사용을 중지할 때는 회원 승인 상태와 키 목록을 함께 관리합니다. `ssh`에서는 키 목록에서 빼야 멈춥니다. `OPENROUTER_API_KEY`는 로컬 설치용이고 일반 회원의 공통 키로 사용되지 않습니다.

## 개발 서버에서 SSH 터널로 함께 쓰기

서버 한 대에서 앱을 띄우고, 사용자는 각자 **본인 OS 계정과 SSH 키로** 터널을 엽니다. 기록 범위는 연결을 연 OS 계정으로 정하므로, 이 방식에서는 회원 관리의 OS 계정 연결을 사용하지 않습니다. **리눅스 서버와 loopback 바인딩**이 필요합니다. Supabase 회원 로그인·회원별 키 등록은 `shared`와 같습니다. 터널은 서버 OS 계정과 SSH 키가 있어야 열 수 있으므로, 접속한 OS 계정이 확인된 회원은 **AI 사용 승인 없이** AI를 쓸 수 있습니다.

운영자는 [환경파일 준비](#환경파일과-실행-방식) 후 `.env`를 다음처럼 바꿉니다. `shared`에서 전환했다면 `VIBE_TEACHER_PUBLIC_URL`의 HTTPS 주소는 삭제·주석 처리하거나 실제 터널의 로컬 주소로 바꿉니다.

```dotenv
VIBE_TEACHER_AUTH_MODE=supabase
VIBE_TEACHER_DEPLOYMENT=ssh
VIBE_TEACHER_HOST=127.0.0.1
VIBE_TEACHER_PORT=3318
OPENROUTER_API_KEY=
VIBE_TEACHER_LLM_PROVIDER=openrouter
# VIBE_TEACHER_PUBLIC_URL=http://127.0.0.1:3318/
```

`.env.admin`의 `VIBE_TEACHER_USER_OPENROUTER_KEYS`에는 **Supabase 회원 UUID**를 넣거나, 참가자가 아직 가입하지 않았다면 [OS 계정 이름으로 미리 등록](#os-계정-이름으로-미리-등록하기-ssh)합니다. 이메일은 넣지 않습니다. [다중 계정 운영](#다중-계정-운영-서버-전체-조회)의 ACL을 앱 실행 계정(예: `ubuntu`)에 부여한 뒤 앱을 실행합니다.

```bash
npm run build && npm start
```

운영자는 **앱을 실행하는 OS 계정으로 터널을 열고 Supabase 관리자 회원으로 로그인**해, 소스 설정의 스캔 범위를 `/home 전체`로 바꿉니다. 설치 설정(스캔 범위·기록 위치·AI 설정·다시 읽기)은 앱 실행 계정으로 접속한 설치 관리자만 변경할 수 있습니다. 다른 OS 계정으로 접속한 Supabase 관리자는 회원 관리만 할 수 있습니다.

사용자는 각자의 PC에서 **본인 계정**으로 터널을 엽니다.

```bash
ssh -N -L 3318:127.0.0.1:3318 user99@개발서버주소
```

`http://127.0.0.1:3318`에서 회원가입·로그인합니다. 시작 화면의 `접속한 SSH 계정: user99`를 확인하세요. 앱을 사용하는 동안 터널을 열어 두고, 인증 메일도 터널이 열린 상태에서 누릅니다. Supabase Redirect URLs에는 이 **PC 쪽 주소**를 등록합니다.

포트가 겹치면 서버의 앱 포트와 PC 쪽 터널 포트를 각각 바꿀 수 있습니다. 예를 들어 서버 `.env`에서 `VIBE_TEACHER_PORT=3338`로 바꾸고 재시작했다면 다음 명령으로 PC의 `4000` 포트에 연결합니다.

```bash
ssh -N -L 4000:127.0.0.1:3338 user99@개발서버주소
```

이때 접속 주소와 Supabase Redirect URLs는 **`http://127.0.0.1:4000/`**입니다. `VIBE_TEACHER_PUBLIC_URL`을 고정했다면 이 주소로 맞추거나 미설정 상태로 둡니다.

- 리눅스의 `/proc/net/tcp`에서 연결을 연 계정을 확인합니다. 해당 계정을 확인하지 못하면 서버 기록을 보여 주지 않습니다. 서버 안에서 직접 접속한 경우도 그 연결을 연 계정으로 처리합니다.
- Supabase 관리자를 포함해 모두 터널을 연 OS 계정의 기록만 봅니다. 학습 기록·설정은 로그인한 Supabase 회원 기준으로 저장합니다.
- 접속한 OS 계정이 확인되면 회원 관리의 AI 사용 승인 없이 AI를 쓸 수 있습니다. 회원 표의 승인 값은 바꾸지 않으므로, 같은 회원이 노트북 설치나 `shared` 서버에서 쓸 때는 지금처럼 승인이 필요합니다. 계정을 확인하지 못한 연결은 회원 표의 승인을 따릅니다.
- AI는 회원의 UUID, 또는 터널을 연 OS 계정 이름에 등록된 키로 OpenRouter를 호출합니다. 일반 회원은 키가 없으면 AI를 쓰지 못하므로, 이 서버에서 사용을 멈추려면 키 목록에서 그 회원의 UUID나 OS 계정 이름을 빼고 앱을 재시작합니다. 일반 회원이 서버의 개인 키·관리자 키·Claude CLI를 함께 사용하지 않습니다.
- 코드를 수정하며 공동으로 확인할 때만 `npm run dev`를 사용합니다. 기본 웹 터널은 `ssh -N -L 3317:127.0.0.1:3317 user99@개발서버주소`이며, 접속·인증 복귀 주소도 `3317`로 맞춥니다. 웹의 `/api` 프록시가 원래 접속자 정보를 전달합니다.

### OS 계정 이름으로 미리 등록하기 (ssh)

참가자가 아직 가입하지 않아 UUID를 모를 때는 **서버의 OS 계정 이름**으로 키를 미리 등록해 둘 수 있습니다. 참가자가 그 계정으로 터널을 열고 회원가입·로그인하면, UUID를 따로 옮겨 적지 않아도 그 키로 AI를 사용합니다. 아래 키 값은 예시이므로 실제 키로 바꿉니다.

```dotenv
VIBE_TEACHER_USER_OPENROUTER_KEYS='{
  "user01": "user01에게_줄_OpenRouter_키",
  "user02": "user02에게_줄_OpenRouter_키",
  "user99": "user99에게_줄_OpenRouter_키"
}'
```

UUID와 계정 이름을 한 목록에 섞어 써도 됩니다. 수정한 뒤에는 앱을 다시 시작합니다.

- 키는 로그인한 회원이 아니라 **터널을 연 OS 계정**으로 정해집니다. 서버가 연결을 연 계정을 직접 확인하므로(`/proc/net/tcp`) 화면이나 요청에서 다른 계정 이름을 대서 바꿀 수 없습니다.
- 같은 회원의 UUID도 등록되어 있으면 UUID 쪽 키를 먼저 씁니다. 등록되지 않은 OS 계정, 또는 계정을 확인하지 못한 연결에는 키를 주지 않습니다.
- 한 OS 계정으로 여러 회원이 가입하면 모두 그 계정의 키를 씁니다(승인도 자동). 누가 썼는지는 AI 호출 기록(`vt_ai_calls`)에 회원 UUID로 남습니다.
- 서버는 `.env.admin`을 고치거나 등록을 UUID로 바꿔 쓰지 않습니다. 계정 이름 그대로 두고 연결할 때마다 찾습니다.
- 계정 이름은 대소문자를 구분하며 시작 화면의 `접속한 SSH 계정: user99`에 보이는 이름과 똑같이 씁니다.
- 이 등록 방식은 `ssh`에서만 씁니다. `shared`에 계정 이름 항목이 있으면 서버가 시작하지 않으므로 UUID로 바꿔 등록합니다. 형식 오류 문구에는 키 값을 싣지 않습니다.

## 다중 계정 운영 (서버 전체 조회)

다른 계정의 홈은 보통 `drwxr-x---` 이고 Claude 세션 파일은 `0600` 이라 일반 계정으로는 읽을 수 없습니다. 앱을 돌리는 계정(서비스 계정, 예: `user99`)에 **읽기 전용 ACL** 을 주면 root 로 실행하지 않고도 전체를 읽을 수 있습니다. `/home` 이 ext4/xfs 라면 ACL 은 바로 쓸 수 있습니다. 아래 예의 `user99` 는 **앱을 실행하는 계정**입니다. [SSH 터널 개발 서버](#개발-서버에서-ssh-터널로-함께-쓰기)라면 `ubuntu` 처럼 `npm start` 를 실행하는 계정 이름으로 바꿉니다.

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

## 원격 접근

기본은 `127.0.0.1` 에만 바인딩합니다. 다른 PC 에서 보려면 SSH 터널을 권장합니다. 여러 사람이 각자 계정으로 터널을 열어 자기 기록만 보게 하려면 [개발 서버에서 SSH 터널로 함께 쓰기](#개발-서버에서-ssh-터널로-함께-쓰기)를 사용하세요.

```bash
ssh -L 3318:127.0.0.1:3318 <server>
```

아래는 [기존 로그인 없음 방식](authentication.md#로그인-방식)의 외부 바인딩 예제입니다. `.env`의 `VIBE_TEACHER_AUTH_MODE`를 비운 상태에서 사용하며, 토큰이 없으면 부팅을 거부합니다. 회원 모드의 `local`·`ssh`는 토큰 유무와 관계없이 loopback만 허용하므로, 공용 회원 서비스에는 위의 `shared` 설치를 사용하세요.

```bash
VIBE_TEACHER_HOST=0.0.0.0 VIBE_TEACHER_TOKEN='긴-무작위-문자열' npm start
```

UI 에서 처음 한 번 토큰을 입력하면 브라우저에 저장됩니다.

## Supabase 저장소 확인

오른쪽 위 **설정 → 내 저장소 활동**을 열면 현재 서버에서 본인의 저장소가 만든 테이블별 읽기·쓰기 요청 수, 실패 수, 요청에 걸린 시간의 합계, 캐시 재사용 횟수를 볼 수 있습니다. 서버 재시작 시 초기화되며 다른 회원의 내역은 포함하지 않습니다. 인증 요청·회원 관리 RPC는 이 저장소 통계에 포함하지 않습니다. 시간 합계는 병렬 요청의 시간도 더하므로 화면에서 기다린 시간과 다릅니다.

관리자는 `.env.admin`의 DB 연결 설정으로 현재 행 수, RLS 여부, DB 누적 조회·변경 통계를 읽기 전용으로 확인할 수 있습니다. 개인 UUID·이메일·원문·키·접속 주소는 출력하지 않습니다.

```bash
npm run cloud:inspect
```

`seq_scan`·`idx_scan`은 DB가 실행한 테이블·인덱스 스캔 수이며 API 요청 수가 아닙니다. `n_tup_ins`·`n_tup_upd`·`n_tup_del`도 통계 초기화 이후의 누적 변경 행 수입니다. 관리자 조회와 다른 기기에서 발생한 작업도 포함될 수 있습니다. 실제 조사 수치와 저장 경로는 [Supabase 저장 분석](supabase-storage.md)에 있습니다.

문서와 원장 조회 결과는 사용자별로 5초간 메모리에 재사용합니다. 다른 기기의 변경은 캐시가 만료된 뒤 다시 조회할 때 반영됩니다. 서버·브라우저 캐시를 모두 거치면 응답이 최대 약 10초 오래될 수 있으며 열린 화면이 저절로 갱신되지는 않습니다. 저장 잠금 안에서는 문서를 새로 읽고 원장에 추가된 행도 확인합니다. 읽기 캐시는 서버·브라우저별 크기를 제한하고 디스크에는 저장하지 않습니다. 브라우저는 쓰기·로그인 변경·작업 완료 시 캐시를 비우고, 인증·작업 상태·근거 파일·전송 미리보기는 응답을 캐시하지 않습니다.

화면의 작업 단계와 진행률은 [주요 기능](features.md#작업-진행-상태), AI 요청 내역과 관리용 SQL은 [AI 호출 기록](ai.md#ai-호출-기록-supabase-회원-모드)을 참고하세요.
