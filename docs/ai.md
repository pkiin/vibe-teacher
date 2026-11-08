# AI와 데이터 저장

[README로 돌아가기](../README.md)

AI 제공자와 전송 범위, 생성 결과의 저장 위치, 회원 모드의 호출 기록을 설명합니다. 기존 비회원·홈 토큰 사용자를 위한 장기 기억 설정도 이 문서에서 다룹니다.

- [AI 제공자와 외부 문서 검색](#ai-제공자와-외부-문서-검색)
- [저장과 기존 결과](#저장과-기존-결과)
- [AI 호출 기록](#ai-호출-기록-supabase-회원-모드)
- [장기 기억: mem0 + PostgreSQL + OpenRouter](#장기-기억-mem0--postgresql--openrouter)

## AI 제공자와 외부 문서 검색

다음 표는 로컬 실행 기준입니다. 설정 파일의 기본값은 `auto`이고, `.env.example`은 `openrouter`를 지정합니다. 공용 서버의 `shared`와 SSH 터널 서버의 `ssh` 모드는 사용자별 키 추적을 위해 OpenRouter로 실행하며, `none`은 모든 실행 방식에서 AI 생성을 중지합니다.

| 설정 | 실행 방식 |
|---|---|
| `auto` (기본) | 로그인된 Claude CLI 우선. CLI를 사용할 수 없거나 작업에 실패하면 OpenRouter로 실행 |
| `claude-cli` | Claude CLI 우선. 처리 실패와 외부 문서 검색은 OpenRouter로 실행 |
| `openrouter` | 모든 생성을 OpenRouter API로 실행 |
| `none` | 새 AI 생성을 중지. 저장된 AI 결과와 원본 기록은 열람 가능 |

AI 문장 생성·외부 문서 검색 API는 **OpenRouter**를 사용하며 기본 모델은 **`openai/gpt-5-mini`**입니다. 기존 `openai`·`anthropic-sdk` 제공자 설정은 OpenRouter로 이관됩니다. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`로 직접 API를 호출하지 않습니다. 예전 기본값 `openrouter/free`는 `openai/gpt-5-mini`로 바뀝니다. mem0 기억 정리·임베딩도 같은 OpenRouter 키를 사용합니다. 기억 API 호출은 설명 제공자와 별도로 `VIBE_TEACHER_MEMORY_BACKEND=local`로 끌 수 있습니다.

로컬 사용자는 `.env`에 API 키와 제공자를 설정합니다. 관리자가 OpenRouter 키를 제공했다면 그 키를 사용하고, 제공받지 못했다면 본인이 발급한 키를 사용합니다.

```dotenv
# .env
OPENROUTER_API_KEY=사용할_OpenRouter_키
VIBE_TEACHER_LLM_PROVIDER=openrouter
```

관리자는 본인 개발용 키를 `.env.admin`의 `VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY`에 넣습니다. 공용 서버는 [사용자별 API 키](deployment.md#공용-서버의-사용자별-api-키) 설정을 따릅니다. 환경파일을 바꾸면 서버를 다시 시작하세요.

모델은 소스 설정의 OpenRouter 모델 선택에서 바꿀 수 있습니다. 모델 목록 조회도 OpenRouter만 사용합니다.

세션 개념을 생성한 뒤에는 **OpenRouter 웹 검색**으로 공식 문서를 찾아 정의와 설명을 확인합니다. 검색에는 개념 이름만 전달하고 세션 원문·프로젝트 경로를 넣지 않습니다. 모델이 임의로 적은 주소는 새 참고 링크로 채택하지 않으며, API 검색 응답의 실제 출처 URL과 대조합니다. 검색이 실패하면 AI 설명은 보존하고 문서 조회 실패를 표시합니다. 검색과 API 생성에는 OpenRouter 크레딧이 사용됩니다.

AI 미설정·권한 부족·취소·오류 상태에서는 새 설명을 생성하지 않습니다. 이미 저장된 AI 결과는 계속 볼 수 있습니다. 자동 생성은 `llm.autoText`로 조절합니다. 생성 권한은 Supabase 회원 모드의 관리자 승인(`vt_members.approved` 또는 `is_admin`), 기존 방식의 `auth.enrichFor`를 따릅니다. 전송 내용은 화면의 미리 보기에서 확인할 수 있으며, 비밀값을 마스킹하고 길이를 제한한 발췌만 전달합니다.

## 저장과 기존 결과

아래 파일 경로는 기존 비회원/홈 토큰 모드 기준입니다. Supabase 회원 모드는 같은 상대 키를 `vt_documents`와 추가 전용 `vt_events`에 사용자 ID별로 저장하며, 로컬 파일로 대체 저장하지 않습니다.

- 대화 기록 분석 문서: `~/.vibe-teacher/wiki/projects/<프로젝트>/snapshots/`, 수준별 AI 설명은 `ai/`
- 레포 위키: 같은 프로젝트의 `repo/`, 수준별 문장과 주요 기능 목록은 `repo/text/`, 기능별 페이지는 `repo/features/<기능>.<수준>.json`
- 개인 이해 정보: `~/.vibe-teacher/wiki/learners/<ID>/events.jsonl`
- 개인 설명: 같은 사용자 폴더의 `knowledge-text.json`
- 문제 은행: 같은 사용자 폴더의 `question-bank.jsonl` (정답이 공개된 연습 문제만, 회원 모드는 `vt_events`).
- 내 지식의 마지막 목록: 같은 사용자 폴더의 `knowledge-views/<범위 지문>.json` (회원·수준·현재 계정 권한·프로젝트·세션별, 회원 모드는 `vt_documents`). 학습 상태는 캐시 대신 현재 원장에서 다시 확인합니다.
- 개인 개념 기록: 같은 사용자 폴더의 `concepts.json`, 질문 원장은 `projects/<프로젝트>/help.jsonl`
- mem0 검색 벡터·짧은 기록·검색 단서: `VIBE_TEACHER_MEMORY_DATABASE_URL`의 PostgreSQL, 원기록 매핑은 같은 사용자 폴더의 `memory/mem0-pg-<접속·모델 지문>.json`
- AI 요청·응답·결과물·토큰·요금: Supabase 회원 모드에서만 `vt_ai_calls`·`vt_ai_runs` ([AI 호출 기록](#ai-호출-기록-supabase-회원-모드))

이전 규칙 기반 위키·설명 캐시는 현재 결과로 사용하지 않습니다. 기존 기록 파일은 보존하며, 화면에서 위키를 다시 생성하면 새 AI 흐름을 사용합니다.

## AI 호출 기록 (Supabase 회원 모드)

회원 모드에서 AI를 사용하는 모든 기능(세션 분석, 세션 위키와 개념 문서 검색, 레포 위키와 추가 코드 확인·주요 기능 질문·근거 표시 다시 고르기·연결 그림 보완·데이터베이스 표 설명 보완·표와 주요 기능 관계 질문, 주요 기능 자세한 분석, 내 지식 설명, 도움 패널 답변, 연습 문항)은 실제 API 요청마다 한 행을 `vt_ai_calls`에 추가합니다. 출력 형식을 바꿔 다시 보낸 요청, Claude CLI 실패 뒤 OpenRouter로 다시 보낸 요청, 실패·취소한 요청도 각각 남깁니다.

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

기록은 자동으로 지우지 않습니다. 오래된 행은 관리자가 SQL로 정리합니다. 아래 SQL은 Supabase 대시보드에서 실행합니다.

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

## 장기 기억: mem0 + PostgreSQL + OpenRouter

**Supabase 회원 모드는 공유 원장의 키워드 검색을 사용하므로 이 설정이 필요하지 않습니다.** 아래는 기존 비회원·홈 토큰 방식에서 mem0 의미 검색을 사용할 때의 설정입니다.

기존 방식으로 실행하려면 `.env`의 `VIBE_TEACHER_AUTH_MODE`를 비워 둡니다. 인증 방식은 `config.auth.mode`를 따릅니다. `.env`에는 관리자가 제공한 OpenRouter 키를 넣고, 제공받지 못했다면 본인이 발급한 키를 넣습니다.

OSS 기능을 제공하는 `mem0ai` SDK `3.3.1`을 사용합니다. 저장소의 `npm install`로 설치하며 별도의 mem0 서비스 키는 필요하지 않습니다.

```dotenv
# .env
VIBE_TEACHER_AUTH_MODE=
```

**내 지식 → 내 기억 검색**에서 예전에 한 질문(받은 답)과 풀어 본 문제(정답·해설)를 키워드로 다시 찾을 수 있습니다. 맞힌 문제만 표시하고 틀린 문제는 따로 표시하지 않습니다. 퀴즈 응답·자기보고·설명 열람 같은 내부 학습 기록은 계속 저장해 도움 패널 답변에 쓰지만 이 목록에는 보이지 않습니다. 기억 저장소 설정과 **기억 인덱스 업데이트**는 관리자와 읽는 사람 수준을 junior·senior로 고른 사용자에게 **기술 정보**로 보입니다. 회원 모드는 저장된 기록을 바로 키워드로 검색하므로 갱신할 인덱스가 없습니다. **mem0 OSS 하네스는 앱 안에서 실행하고 기억 검색 DB는 PostgreSQL + pgvector를 사용**합니다. 기억 정리와 임베딩은 OpenRouter API로 처리하며 로컬 모델 설치나 별도 메모리 서비스 구독이 필요 없습니다. OpenRouter API 사용량에 따른 비용은 발생합니다.

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

**기존 PostgreSQL도 연결할 수 있습니다.** 해당 DB에서 `CREATE EXTENSION IF NOT EXISTS vector;`를 실행하고, 앱 계정에 이 전용 DB의 테이블·인덱스 생성 권한을 부여합니다. 기존 DB를 쓰면 `memory:db`를 실행할 필요가 없습니다. 본인의 `.env`에 검색 옵션·사용할 OpenRouter 키·DB 접속 주소를 추가합니다.

```dotenv
# .env
OPENROUTER_API_KEY=사용할_OpenRouter_키
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

`내 기억 검색`의 기술 정보에는 기억 저장소 설정(Supabase 또는 PostgreSQL)을 표시합니다. 이 표시는 접속 성공 여부가 아니라 현재 선택된 설정입니다.

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
