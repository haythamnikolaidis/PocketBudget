#!/usr/bin/env bash
# Download the verified Apps Script bundle from the latest CI run.
#
# The artifact is produced by .github/workflows/pages.yml AFTER the bundle has
# been compile-checked and the full test suite has passed — so the file you
# paste into the Apps Script editor is the exact build CI proved loads, not a
# local rebuild that might differ.
#
# Usage:
#   scripts/fetch-bundle.sh              # latest successful run on master
#   scripts/fetch-bundle.sh --run 12345  # a specific run id
#   scripts/fetch-bundle.sh --out /tmp   # different output directory
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RUN_ID=""
OUT_DIR="$REPO_ROOT/backend"
ARTIFACT_MATCH="backend-bundle-"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# gh is installed outside the default PATH on some machines.
if ! command -v gh >/dev/null 2>&1; then
  for candidate in /opt/data/home/.local/bin "$HOME/.local/bin" /usr/local/bin; do
    [ -x "$candidate/gh" ] && PATH="$candidate:$PATH" && break
  done
fi
command -v gh >/dev/null 2>&1 || { echo "error: gh not found; install GitHub CLI" >&2; exit 1; }

# Resolve the run.
if [ -z "$RUN_ID" ]; then
  echo "[fetch] finding the latest run on master that published a bundle..."
  # Deliberately NOT filtering on run conclusion. The artifact is uploaded by the
  # `verify` job, which can succeed while `deploy` fails (e.g. Pages not enabled
  # on the repo yet). Requiring the whole run to be green would make this script
  # useless in exactly that situation. The artifact's existence IS the guarantee:
  # it is uploaded only after every check in `verify` passed.
  for candidate in $(gh run list --workflow pages.yml --branch master --limit 10 \
                      --json databaseId --jq '.[].databaseId'); do
    found="$(gh api "repos/{owner}/{repo}/actions/runs/${candidate}/artifacts" \
             --jq "[.artifacts[] | select(.name | startswith(\"backend-bundle-\"))] | length" 2>/dev/null || echo 0)"
    if [ "${found:-0}" -gt 0 ] 2>/dev/null; then
      RUN_ID="$candidate"
      break
    fi
  done
  [ -n "$RUN_ID" ] || {
    echo "error: no run on master has published a backend-bundle-* artifact yet." >&2
    echo "       Push to master, or trigger the workflow from the Actions tab." >&2
    exit 1
  }
fi

# Find the bundle artifact from that run.
ARTIFACT_ID="$(gh api "repos/{owner}/{repo}/actions/runs/${RUN_ID}/artifacts" \
  --jq ".artifacts[] | select(.name | startswith(\"${ARTIFACT_MATCH}\")) | .id" | head -1)"

if [ -z "$ARTIFACT_ID" ]; then
  echo "error: run ${RUN_ID} has no backend-bundle-* artifact." >&2
  echo "       The run may have failed before the upload step." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[fetch] downloading artifact from run ${RUN_ID}..."
gh api "repos/{owner}/{repo}/actions/artifacts/${ARTIFACT_ID}/zip" > "$TMP/bundle.zip"

# Extract without depending on `unzip`, which is absent on some minimal images.
# Python's stdlib zipfile is always available on the machines this runs on.
python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
  "$TMP/bundle.zip" "$TMP/out"

BUNDLE="$(find "$TMP/out" -name 'Backend.bundle.gs' -print -quit)"
[ -n "$BUNDLE" ] || { echo "error: Backend.bundle.gs missing from the artifact" >&2; exit 1; }

mkdir -p "$OUT_DIR"
cp "$BUNDLE" "$OUT_DIR/Backend.bundle.gs"
[ -f "$TMP/out/appsscript.json" ] && cp "$TMP/out/appsscript.json" "$OUT_DIR/appsscript.json"

LINES="$(wc -l < "$OUT_DIR/Backend.bundle.gs" | tr -d ' ')"
echo "[fetch] wrote $OUT_DIR/Backend.bundle.gs (${LINES} lines)"
echo
echo "Next:"
echo "  1. Open the Apps Script editor (Extensions -> Apps Script from your Sheet)"
echo "  2. Select all of Code.gs, delete, paste this file's contents"
echo "  3. Save, then run setup() once and copy the token from the log"
echo
echo "  \$ cat $OUT_DIR/Backend.bundle.gs"