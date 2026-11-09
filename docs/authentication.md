# 로그인과 회원 관리

[README로 돌아가기](../README.md)

기본 설치는 Supabase 이메일 회원가입·로그인을 사용합니다. 회원가입 → 이메일 인증 → 인증 완료 안내 → 로그인 → 준비 단계 선택 순서로 시작합니다. AI 생성에는 관리자 승인이 필요하며(SSH 터널 서버는 접속한 OS 계정 확인으로 대신합니다), 실행 위치별 기록 접근 범위는 [공용 서버 가이드](deployment.md)을 참고하세요.

- [로그인 방식](#로그인-방식)
- [Supabase 최초 설정](#supabase-최초-설정-관리자-1회)
- [로컬 설치 소유자와 기기 간 데이터](#로컬-설치-소유자와-기기-간-데이터)
- [이메일 인증 결과 확인](#이메일-인증-결과-확인)
- [인증 메일이 오지 않을 때](#인증-메일이-오지-않을-때)
- [많은 인원이 한꺼번에 가입할 때](#많은-인원이-한꺼번에-가입할-때)
- [테스트 중 회원 행을 삭제했을 때](#테스트-중-회원-행을-삭제했을-때)
- [이메일 인증 후 연결 오류](#이메일-인증-후-localhost3000-연결-오류가-날-때)
- [기존 홈 토큰 로그인](#홈-토큰-로그인-기존-방식)

## 로그인 방식

| 방식 | 설정 | 용도 |
|---|---|---|
| Supabase 회원 로그인 | `.env`의 `VIBE_TEACHER_AUTH_MODE=supabase` | 공용 서버·개인 노트북·SSH 터널 개발 서버의 기본 방식 |
| 홈 토큰 로그인 | 위 환경변수를 비우고 `config.auth.mode=home-token` | 서버 OS 사용자별 토큰으로 접근하는 기존 방식 |
| 로그인 없음 | 위 환경변수를 비우고 `config.auth.mode=none` | 기존 로컬 조회 방식. 외부 바인딩에는 별도 인증 필요 |

`VIBE_TEACHER_AUTH_MODE=supabase`를 지정하면 기존 홈 토큰과 관리자 Bearer 토큰보다 Supabase 인증이 우선합니다.

## Supabase 최초 설정 (관리자 1회)

1. Supabase 프로젝트의 SQL Editor에서 [`supabase/migrations/202611030001_accounts_and_storage.sql`](../supabase/migrations/202611030001_accounts_and_storage.sql)과 [`supabase/migrations/202611030002_ai_call_log.sql`](../supabase/migrations/202611030002_ai_call_log.sql)을 순서대로 한 번씩 실행합니다. 또는 관리자 `.env.admin`에 해당 프로젝트의 `VIBE_TEACHER_SUPABASE_DATABASE_URL`(Session pooler, 5432)을 넣고 `npm run accounts:setup`을 실행합니다. 준비 명령은 두 파일을 순서대로 적용하며, 이미 존재하는 표는 덮어쓰지 않고 없는 것만 만듭니다. 이미 회원 표를 만든 설치도 같은 명령(또는 두 번째 SQL 실행)으로 AI 호출 기록 표만 추가합니다. 기존 Auth 사용자는 회원 표에 추가되고, 이후 가입자는 자동 등록됩니다.
2. Authentication에서 이메일/비밀번호 로그인을 활성화합니다. **Authentication → URL Configuration**의 Site URL을 현재 앱 주소(로컬 사용 기본 `http://127.0.0.1:3318/`, 개발은 `http://127.0.0.1:3317/`, 배포 후에는 공용 서버의 HTTPS 주소)로 설정하고, Redirect URLs에는 각 설치에서 사용하는 주소를 추가합니다. 예: `http://127.0.0.1:3317/`, `http://localhost:3317/`, 빌드 실행용 `http://127.0.0.1:3318/`, 공용 서버의 `https://앱주소/`. 커스텀 포트는 실제 웹 포트를 등록하세요. 가입 요청은 브라우저의 웹 주소를 인증 후 복귀 주소로 전달합니다. 주소를 고정하려면 `.env`에 `VIBE_TEACHER_PUBLIC_URL`을 설정하고 같은 주소를 Redirect URLs에 등록합니다. 이메일 인증 링크로 인증을 마친 뒤 각 설치에서 이메일/비밀번호로 로그인합니다.
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

## 로컬 설치 소유자와 기기 간 데이터

처음 로그인한 계정이 이 설치의 소유자가 됩니다. `<VIBE_TEACHER_HOME>/local-owner`에 Supabase 사용자 ID만 보관합니다. 소유자는 해당 기기의 소스·모델을 설정할 수 있지만 회원 승인 권한은 얻지 않습니다. 이후 다른 계정으로 로그인해도 이 노트북의 기록은 볼 수 없습니다. 계정을 잘못 연결했다면 앱을 종료하고 해당 파일을 삭제한 뒤 본인의 계정으로 다시 로그인하세요. 로컬 설치는 loopback 바인딩만 허용합니다.

모든 회원 모드는 온보딩 답변·설명 수준·학습 활동·질문 원장·세션 위키·레포 위키·AI 분석 결과를 Supabase의 사용자별 저장소에 기록합니다. 장애가 나면 저장 오류를 표시하며 로컬에만 저장하고 성공한 것처럼 처리하지 않습니다. 다른 기기의 동시 쓰기는 사용자별 잠금으로 조정합니다. 잠금 충돌이 표시되면 잠시 뒤 다시 저장하세요. 비정상 종료한 잠금은 5분 뒤 만료됩니다. 모든 AI 요청·응답·결과물·토큰·모델·요금은 별도의 [AI 호출 기록](ai.md#ai-호출-기록-supabase-회원-모드)에 남깁니다 (기록 실패는 AI 작업을 막지 않습니다).

**원본 채팅 파일과 저장소 자체는 자동으로 업로드·복제하지 않습니다.** 프로젝트·세션 목록과 코드 보기는 현재 실행 기기에서 읽을 수 있는 파일을 기준으로 합니다. 같은 Git 원격 주소여도 다른 기기의 복제 폴더를 자동으로 같은 프로젝트로 묶지 않습니다. 개인 학습 상태와 설정은 같은 사용자 ID로 이어집니다. 기존 비회원/홈 토큰 모드의 로컬 학습 파일은 그대로 보존하며 회원 데이터로 자동 이전하지 않습니다.

AI 사용 승인과 OpenRouter 키 제공은 별개입니다. 로컬 AI 생성에는 그 노트북의 Claude CLI 로그인 또는 `.env`에 설정한 OpenRouter 키가 필요합니다. 관리자가 키를 제공했다면 그 키를 사용하고, 제공받지 못했다면 본인이 발급한 키를 사용합니다. 관리자 서버의 AI를 로컬에서 대신 호출하는 중계와 키 자동 배포는 아직 구현하지 않았으므로, 제공받은 키도 사용자가 직접 `.env`에 입력합니다. Supabase 회원 모드의 기억 검색은 공유 원장의 키워드 검색을 사용하고 mem0 직접 DB 연결은 사용하지 않습니다.

## 이메일 인증 결과 확인

인증 메일의 링크를 누르면 가입했던 앱 주소로 돌아옵니다. 앱이 Supabase에서 이메일 인증 여부를 확인한 뒤 **메일 인증이 완료되었습니다**와 **로그인하러 가기** 버튼을 표시합니다. 버튼을 눌러 가입한 이메일과 비밀번호로 로그인하세요. 이 확인만으로 자동 로그인하거나 로컬 설치의 소유자를 연결하지 않습니다.

링크가 만료되었거나 유효하지 않으면 오류 안내를 표시합니다. 메일함의 가장 최근 인증 링크를 확인하고, 이미 인증을 마쳤다면 로그인해 보세요. 서버에 연결하지 못한 경우에는 완료로 표시하지 않고 확인할 수 없다는 안내를 보여줍니다. 인증 토큰은 앱이 열리는 즉시 주소에서 제거하며 브라우저 저장소에 보관하지 않습니다. 기존 Redirect URLs의 앱 주소를 그대로 사용하므로 결과 화면을 위해 주소를 추가할 필요는 없습니다.

## 인증 메일이 오지 않을 때

로그인 화면에서 **인증 메일이 안 왔어요 → 인증 메일 다시 받기**를 눌러 가입한 이메일을 입력합니다. 인증 실패·만료 화면에서도 바로 재발송을 요청할 수 있습니다. 비밀번호는 필요하지 않으며 재발송한 링크도 같은 앱 주소로 돌아옵니다. 가입·재발송 요청 직후에는 60초 대기 시간을 표시합니다. Supabase의 실제 발송 한도는 별도로 적용됩니다.

재발송은 **가입한 계정이 아직 미인증일 때** 메일을 보냅니다. 요청 접수 안내가 실제 메일 전달을 보장하지는 않습니다. 스팸함과 이메일 주소를 확인하고, 이미 인증을 마친 계정이라면 다시 가입하지 않고 로그인하세요. 앱은 계정 존재 여부나 인증 여부를 재발송 응답으로 공개하지 않습니다.

관리자는 Supabase **Authentication → Users**에서 계정의 이메일 인증 여부를 확인하고, Auth 로그에서 `over_email_send_rate_limit`(발송 제한)·`email_address_not_authorized`(허용되지 않은 수신 주소) 등 오류 코드를 확인합니다. 앱도 발송 한도·메일 발송 설정·미인증 오류를 구분해 안내합니다. Supabase 기본 발송 서비스에는 발송량·수신 주소 제한이 있습니다. 다른 주소의 회원가입을 지원하려면 Supabase의 [Custom SMTP 설정](https://supabase.com/docs/guides/auth/auth-smtp)이 필요합니다. 수업·행사처럼 한꺼번에 가입한다면 [많은 인원이 한꺼번에 가입할 때](#많은-인원이-한꺼번에-가입할-때)를 보세요. SMTP 비밀값은 Supabase 대시보드에서 관리하며 일반 사용자 `.env`에는 넣지 않습니다. 한도는 [공식 문서](https://supabase.com/docs/guides/auth/rate-limits)를 확인하세요.

## 많은 인원이 한꺼번에 가입할 때

수업·행사처럼 수십 명이 같은 시간에 가입하면 Supabase의 두 한도에 걸립니다.

| 한도 | 기본값 | 가입자가 보는 증상 | 해결 |
|---|---|---|---|
| 기본 메일 서비스 | 시간당 2통, 프로젝트 팀원 주소에만 발송 | 인증 메일이 오지 않음 | 이메일 확인 끄기 또는 Custom SMTP |
| 가입 요청 | IP 하나당 5분에 30건 | "요청이 많습니다. 잠시 후 다시 시도하세요" | Rate Limits에서 한도 올리기 |

가입 요청은 브라우저가 아니라 앱 서버가 Supabase로 보냅니다. SSH 터널 서버는 모든 가입이 서버 IP 하나에서 나가고, 노트북 설치도 같은 와이파이라면 공인 IP 하나로 모입니다. 한도 값은 [Supabase 공식 문서](https://supabase.com/docs/guides/auth/rate-limits)에서 확인하세요.

### 행사 전 관리자 준비

1. **Authentication → Rate Limits**에서 가입·로그인 요청 한도(sign ups and sign ins)를 인원보다 넉넉하게 올립니다. 예: 60명이면 200.
2. **Authentication → Sign In / Providers → Email**에서 **Confirm email**을 끕니다. 가입하면 인증 메일 없이 바로 로그인됩니다.
3. 시험용 이메일로 한 번 가입해 바로 로그인되는지 확인합니다.

### 이메일 확인을 끈 동안 달라지는 점

- 이메일 주소가 본인 것인지 확인하지 않습니다. 권한은 이메일이 아니라 Supabase 사용자 ID로 정하므로, 가입만으로는 AI를 쓸 수 없고 다른 사람의 기록도 보이지 않습니다. 노트북 설치는 자기 노트북 기록만, SSH 터널 서버는 터널을 연 OS 계정의 기록만 보입니다.
- 회원 관리에서 승인할 때 목록의 이메일만 보고 판단하지 말고 현장에서 본인인지 확인합니다. HTTPS 공용 서버(`shared`)에서 OS 계정을 연결할 때는 반드시 본인 확인 후 연결합니다.
- 오타 난 이메일로도 가입됩니다. 로그인이 안 되면 가입 때 입력한 주소를 확인하고, 관리자는 **Authentication → Users**에서 찾아봅니다.
- 다른 사람이 먼저 내 이메일로 가입했다면 가입할 때 "이메일과 비밀번호를 확인하세요"가 나옵니다. 관리자가 **Authentication → Users**에서 그 계정을 삭제한 뒤 다시 가입합니다.

### 행사가 끝나면

계속 가입을 받는다면 [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)를 연결하고 **Confirm email**을 다시 켭니다. SMTP를 연결하면 메일 한도가 시간당 30통이 되며 Rate Limits에서 조정할 수 있습니다. 다시 켜기 전에 확인을 꺼 둔 동안 가입한 계정 하나로 로그인되는지 확인합니다.

## 테스트 중 회원 행을 삭제했을 때

Table Editor의 `public.vt_members`는 앱 회원 정보이고, 로그인 계정은 `auth.users`에 있습니다. **회원 행만 삭제해도 Auth 계정의 가입·인증 상태는 초기화되지 않습니다.** 이미 인증한 이메일로 재가입하거나 재발송을 요청해도 새 인증 메일이 오지 않을 수 있습니다. 회원 정보가 누락되었다는 오류가 나오면 관리자가 SQL Editor에서 해당 계정의 회원 행만 복원합니다. 아래 이메일을 실제 테스트 계정으로 바꾸세요.

```sql
insert into public.vt_members (user_id, email)
select id, coalesce(email, '') from auth.users
where email = 'test-user@example.com'
on conflict (user_id) do nothing;
```

복원한 행은 일반 회원·승인 대기·OS 계정 미연결 상태입니다. 기존 관리자 권한·승인·계정 연결은 관리자가 따로 확인해 지정합니다. `accounts:setup`은 이미 준비한 회원 표를 변경하지 않으므로 삭제한 행의 복원 명령으로 사용하지 않습니다. 앱도 삭제된 회원 행을 자동 생성하지 않습니다. 새 가입부터 다시 시험하려고 **Authentication → Users**에서 테스트 계정을 삭제하면 연결된 학습 데이터도 삭제되므로 보존할 데이터가 없는 계정에만 적용하세요.

## 이메일 인증 후 localhost:3000 연결 오류가 날 때

Supabase의 Site URL이 `localhost:3000`으로 남아 있으면 인증 후 해당 주소로 돌아갈 수 있습니다. 그 포트에서 앱을 실행하지 않으면 연결을 거부했다는 화면이 나옵니다. [Supabase 최초 설정](#supabase-최초-설정-관리자-1회)을 참고해 URL Configuration에서 Site URL·Redirect URLs를 실제 앱 주소로 바꾸세요. 앱의 환경변수만 바꾸어서는 Supabase 대시보드 설정이 바뀌지 않습니다.

이미 인증 링크를 눌렀다면 기존에 앱을 열었던 주소로 돌아가 로그인해 보세요. Supabase Authentication → Users에서 해당 계정의 이메일 인증 완료 여부도 확인할 수 있습니다. 기존 이메일의 링크에는 예전 복귀 주소가 남을 수 있으므로 새 설정은 이후 보내는 인증 메일부터 확인하세요. 메일 인증 후 주소의 `#access_token=...`·`refresh_token=...`은 로그인 비밀값입니다. 전체 URL을 공유하지 말고, 공유했다면 해당 세션을 종료한 뒤 다시 로그인하세요.

## 홈 토큰 로그인 (기존 방식)

SSH 터널 개발 서버의 `ssh` 방식은 홈 토큰 없이 SSH 로그인한 OS 계정으로 기록을 구분합니다. 아래 방식은 기존 서버 OS 사용자용이며, `.env`의 `VIBE_TEACHER_AUTH_MODE`를 비운 뒤 [설정 파일](configuration.md#설정-파일)의 `auth` 항목을 변경합니다.

서비스 계정이 전체를 읽되, 각 사용자는 **자기 계정 기록만** 보게 하려면 홈 디렉터리 토큰 로그인을 켭니다. 원리: 사용자의 홈 안에 `~/.vibe-teacher/login-token` 파일을 만들면 그 파일을 읽을 수 있는 사람은 그 계정(과 서비스 계정)뿐이므로, 그 문자열을 아는 것이 본인 증명이 됩니다. 비밀번호도, 개인 키 업로드도 필요 없습니다.

```json
{
  "auth": { "mode": "home-token", "admins": ["user99"], "sessionTtlHours": 168, "enrichFor": "admins" }
}
```

- `mode`: `none`(기본, 로그인 없음) 또는 `home-token`
- `admins`: 모든 계정을 볼 수 있는 사용자. 앱을 실행한 OS 계정은 항상 관리자입니다.
- `enrichFor`: AI 분석을 누구에게 허용할지 (`admins` 또는 `everyone`). 서비스 계정의 Claude 계정으로 비용이 나가므로 기본은 관리자만입니다.

각 사용자는 서버에 SSH 로 들어가 한 번만 다음을 실행하고, 출력된 문자열을 로그인 화면에 붙여넣습니다 (로그인 화면에도 같은 안내가 나옵니다. `user99` 자리는 서비스 계정 이름).

```bash
( umask 077; mkdir -p ~/.vibe-teacher; head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > ~/.vibe-teacher/login-token; setfacl -m u:user99:rx ~ ~/.vibe-teacher; setfacl -m u:user99:r ~/.vibe-teacher/login-token; cat ~/.vibe-teacher/login-token )
```

토큰 파일을 지우거나 다시 만들면 그 사용자의 기존 로그인 세션은 모두 무효화됩니다. 로그인 5회 실패 시 1분간 잠깁니다. 로그인 모드에서는 비-loopback 바인딩에 `VIBE_TEACHER_TOKEN` 이 필수는 아니지만, 토큰이 네트워크를 타므로 HTTPS 앞단(nginx 등)이나 SSH 터널을 권장합니다. `VIBE_TEACHER_TOKEN` 을 설정하면 그 값은 관리자용 API 토큰(`Authorization: Bearer`)으로 계속 쓸 수 있습니다.
