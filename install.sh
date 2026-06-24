#!/usr/bin/env bash
# bdev-saju — install the skill into Claude Code (and Codex if present).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
MODE="${1:-copy}"   # copy (default) | symlink

install_one() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  [ -e "$dest" ] && mv "$dest" "$dest.bak.$(date +%s)"
  case "$MODE" in
    symlink) ln -s "$src" "$dest" ;;
    *)       cp -RL "$src" "$dest" ;;
  esac
  echo "installed: $dest"
}

if command -v claude >/dev/null 2>&1 || [ -d "$CLAUDE_HOME" ]; then
  install_one "$REPO/.claude/skills/bdev-saju" "$CLAUDE_HOME/skills/bdev-saju"
fi

# 만세력 엔진은 node + 동봉된 lunar-javascript(vendored)만 있으면 됩니다. npm 설치 불필요.
if ! command -v node >/dev/null 2>&1; then
  echo "⚠ node가 없습니다. 사주 계산 엔진을 쓰려면 Node.js를 설치하세요: https://nodejs.org"
fi

echo "done. New Claude session: /bdev-saju  (또는: \"사주 봐줘\")"
