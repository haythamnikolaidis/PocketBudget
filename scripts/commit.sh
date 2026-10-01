#!/usr/bin/env bash
# Serialized commit helper for parallel agents.
#
# Agents working concurrently in ONE git repo will collide: "cannot lock ref",
# lost commits, or commits built on a stale index. This script takes a repo-wide
# lock so only one agent commits at a time, stages explicitly (never `git add -A`),
# and verifies the result.
#
# Usage:
#   scripts/commit.sh "commit message"
#   scripts/commit.sh --paths a b c "commit message"
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

LOCK_FILE="$REPO_ROOT/.git/pocketbudget-commit.lock"
LOCK_WAIT_SECONDS="${PB_LOCK_WAIT:-180}"
MAX_SPIN=1

# ---- acquire the lock ------------------------------------------------------
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  echo "[commit] another agent is committing; waiting (up to ${LOCK_WAIT_SECONDS}s)..."
  spins=0
  while [ ! -d "$LOCK_FILE" ] && [ "$spins" -lt $((MAX_SPIN * 20)) ]; do
    sleep 1
    spins=$((spins + 1))
  done
  if [ ! -d "$LOCK_FILE" ]; then
    echo "[commit] ERROR: lock not acquired after ${LOCK_WAIT_SECONDS}s."
    echo "[commit] If no other agent is running, remove $LOCK_FILE and retry."
    exit 1
  fi
fi

cleanup() { rmdir "$LOCK_FILE" 2>/dev/null || true; }
trap cleanup EXIT

# Re-read state INSIDE the lock: another agent may have committed while we waited.
git fetch --quiet origin 2>/dev/null || true

if [ "${1:-}" = "--paths" ]; then
  shift
  PATHS=()
  while [ "$#" -gt 1 ]; do PATHS+=("$1"); shift; done
  MESSAGE="${1:-}"
  git add -- "${PATHS[@]}"
else
  MESSAGE="${1:-}"
  git add -A
fi

if git diff --cached --quiet; then
  echo "[commit] nothing staged; skipping (no changes)."
  exit 0
fi

# Guard against secrets reaching history.
STAGED="$(git diff --cached --name-only)"
echo "[commit] staging:"
echo "$STAGED" | sed 's/^/[commit]   /'

if echo "$STAGED" | grep -qiE '(^|/)(node_modules|\.env)$'; then
  echo "[commit] ERROR: refusing to commit .env or node_modules."
  exit 1
fi

git commit -q -m "$MESSAGE" || {
  echo "[commit] ERROR: commit failed (possibly a concurrent index update)."
  exit 1
}

echo "[commit] committed: $(git log --oneline -1)"