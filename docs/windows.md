# Windows 설치 묶음

[README로 돌아가기](../README.md)

Node.js나 Git을 설치하지 않고 Windows 노트북(x64)에서 실행하는 묶음입니다. 관리자가 만들어 참가자에게 직접 전달합니다. macOS·Linux에서는 [README 빠른 시작](../README.md#빠른-시작)의 `npm run build && npm start`를 사용합니다.

- [참가자: 받은 zip으로 시작하기](#참가자-받은-zip으로-시작하기)
- [관리자: 묶음 만들기](#관리자-묶음-만들기)
- [묶음에 들어 있는 것](#묶음에-들어-있는-것)

## 참가자: 받은 zip으로 시작하기

1. 관리자에게 받은 `vibe-teacher-<버전>-windows-x64.zip`을 오른쪽 클릭해 **압축 풀기**로 원하는 폴더에 풉니다. zip 안에서 바로 실행하면 동작하지 않습니다.
2. 풀린 `vibe-teacher` 폴더의 `start.bat`을 두 번 누릅니다. 처음 실행할 때 Windows 보안 경고가 나올 수 있습니다. 관리자에게 직접 받은 파일이면 **추가 정보 → 실행** 또는 **실행**을 누릅니다.
3. 검은 창이 열리고 잠시 뒤 브라우저가 열립니다. 열리지 않으면 주소창에 `http://127.0.0.1:3318/`을 입력합니다.
4. 회원가입하고 로그인합니다. 시작 화면의 **OpenRouter 키** 칸에 키를 붙여 넣고 **키 저장**을 누릅니다. 관리자가 키를 제공했다면 그 키를, 제공받지 못했다면 본인이 발급한 키를 넣습니다. 키는 나중에 **소스 설정 → 설명을 작성할 AI**에서 바꾸거나 지울 수 있습니다.
5. AI 설명 생성은 관리자 승인 후 사용할 수 있습니다. 승인 전에도 기록 조회는 됩니다.

쓰는 동안 검은 창을 열어 두세요. 창을 닫으면 종료됩니다. `start.bat`을 다시 누르면 새로 실행하지 않고 이미 실행 중인 화면을 엽니다.

| 상황 | 해결 |
|---|---|
| "압축을 먼저 풀어 주세요" | zip을 폴더에 푼 뒤 그 폴더의 `start.bat`을 실행합니다 |
| "3318 포트를 다른 프로그램이 쓰고 있습니다" | `vibe-teacher` 폴더에 `.env` 파일을 만들고 `VIBE_TEACHER_PORT=3328` 한 줄을 적은 뒤 다시 실행합니다. 메모장에서는 파일 형식을 **모든 파일**로 바꿔 저장해야 `.env.txt`가 되지 않습니다 |
| 대화 기록이 보이지 않음 | 이 노트북의 지금 Windows 계정으로 쓴 기록만 보입니다. 도구별 기록 위치는 [읽는 위치](configuration.md#읽는-위치-기본값)에 있습니다 |

새 버전을 받으면 기존 `vibe-teacher` 폴더를 지우고 새 zip을 풉니다. 설정과 저장한 키(`C:\Users\<사용자>\.vibe-teacher`), 계정의 학습 기록은 그대로 남습니다.

## 관리자: 묶음 만들기

저장소를 클론한 macOS·Linux에서 실행합니다. 공식 Node.js Windows 배포본을 인터넷에서 내려받아 SHASUMS256으로 확인합니다.

```bash
npm install
cp .env.release.example .env.release
# .env.release 에 SUPABASE_URL 과 SUPABASE_PUBLISHABLE_KEY 를 적습니다
npm run package
```

결과는 `release/vibe-teacher-<버전>-windows-x64.zip`(약 35MB)입니다. 마지막에 출력되는 SHA256 값을 함께 알려 주면 참가자가 받은 파일이 같은지 확인할 수 있습니다. 다른 공개 설정 파일을 쓰려면 `npm run package -- --config <경로>`로 지정합니다.

- `.env.release`에는 **공개해도 되는 두 값만** 적습니다. 그 밖의 이름이 있거나 secret·service_role 키를 적으면 묶음을 만들지 않습니다. OpenRouter 키, DB 주소도 여기에 해당합니다.
- 공개 키라도 이 저장소는 공개되어 있으므로 `.env.release`와 zip은 커밋하거나 공개 게시판에 올리지 말고 참가자에게 직접 전달합니다. 받은 사람은 zip 안의 `app/release.env`에서 이 값을 볼 수 있습니다. 회원 데이터는 RLS와 관리자 승인으로 보호됩니다.
- 여러 명이 한꺼번에 가입한다면 먼저 [많은 인원이 한꺼번에 가입할 때](authentication.md#많은-인원이-한꺼번에-가입할-때)의 Supabase 설정을 바꿉니다.
- 서명하지 않은 묶음입니다. 공식 서명된 `node.exe`는 그대로 넣지만 `start.bat`은 처음 실행할 때 Windows 보안 경고가 나올 수 있습니다.

나눠 주기 전에 Windows 노트북 한 대에서 위 참가자 순서대로 가입 → 키 저장 → 세션 분석까지 시험해 보세요.

## 묶음에 들어 있는 것

| 경로 | 내용 |
|---|---|
| `start.bat` | 실행 파일. 묶음 폴더의 Node로 `app/server.mjs`를 실행합니다 |
| `README.txt` | 참가자용 짧은 안내 |
| `runtime/node.exe`, `runtime/LICENSE` | 공식 Node.js 22 배포본 |
| `app/server.mjs` | 서버를 파일 하나로 묶은 것. `app/server.mjs.LEGAL.txt`에 포함한 라이브러리의 라이선스 주석이 있습니다 |
| `app/release.env` | 공개 설정: Supabase 주소·publishable 키, 노트북 설치(`local`), `127.0.0.1:3318`, OpenRouter |
| `app/web/` | 빌드한 화면 |

묶음은 노트북 설치(`local`)와 똑같이 동작합니다. 이 노트북 사용자의 기록만 읽고, 설정은 `C:\Users\<사용자>\.vibe-teacher`에, 학습 기록은 Supabase 계정에 저장합니다. 장기 기억의 mem0 의미 검색은 넣지 않았습니다. 회원 모드는 원래 키워드 검색을 씁니다. 묶음 폴더에 둔 `.env`가 `app/release.env`보다 우선하며, 관리자용 `.env.admin`은 읽지 않습니다.
