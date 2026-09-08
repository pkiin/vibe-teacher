#!/usr/bin/env bash
# vibe-teacher 서비스 계정에 다른 사용자 홈의 AI 코딩 기록 읽기 권한(ACL)을 준다.
#
#   sudo scripts/grant-read-acl.sh <서비스계정> [사용자 ...]
#   예) sudo scripts/grant-read-acl.sh user99              # /home/* 전체
#       sudo scripts/grant-read-acl.sh user99 user01 user02
#
# - 홈 디렉터리: rx (진입/목록)          - 기록 디렉터리와 파일: 재귀 rX + 새 폴더 상속(default ACL)
# - 0600 으로 새로 생기는 세션 파일은 default ACL 로는 읽히지 않으므로(마스크 규칙) 주기적으로 다시 실행한다.
#   root crontab 예:  */10 * * * * /경로/vibe-teacher/scripts/grant-read-acl.sh user99 >/dev/null 2>&1
set -euo pipefail

SVC=${1:-}
if [ -z "$SVC" ]; then
  echo "사용법: sudo $0 <서비스계정> [사용자 ...]" >&2
  exit 2
fi
shift || true
if ! command -v setfacl >/dev/null 2>&1; then
  echo "setfacl 이 없습니다. 먼저 설치하세요:  sudo apt update && sudo apt install -y acl" >&2
  exit 1
fi
if ! getent passwd "$SVC" >/dev/null; then
  echo "서비스 계정 '$SVC' 이(가) 없습니다" >&2
  exit 1
fi

# 읽어야 하는 경로 (홈 기준 상대 경로). 없는 것은 건너뛴다.
TARGETS=(
  ".claude"
  ".claude.json"
  ".codex"
  ".copilot"
  ".vibe-teacher"
  ".config/Code/User/workspaceStorage"
  ".config/Code - Insiders/User/workspaceStorage"
  ".config/VSCodium/User/workspaceStorage"
  ".config/Cursor/User/workspaceStorage"
  ".vscode-server/data/User/workspaceStorage"
)

users=("$@")
if [ ${#users[@]} -eq 0 ]; then
  for d in /home/*; do
    [ -d "$d" ] && users+=("$(basename "$d")")
  done
fi

for u in "${users[@]}"; do
  [ "$u" = "$SVC" ] && continue
  home=$(getent passwd "$u" | cut -d: -f6 || true)
  [ -z "$home" ] && home="/home/$u"
  if [ ! -d "$home" ]; then
    echo "skip: $u (홈 없음: $home)"
    continue
  fi
  setfacl -m "u:$SVC:rx" "$home"
  granted=()
  for rel in "${TARGETS[@]}"; do
    p="$home/$rel"
    [ -e "$p" ] || continue
    setfacl -R -m "u:$SVC:rX" "$p"
    if [ -d "$p" ]; then
      setfacl -R -d -m "u:$SVC:rX" "$p"
    fi
    granted+=("$rel")
  done
  echo "ok: $u ($home) -> ${granted[*]:-(기록 없음, 홈 진입만)}"
done
