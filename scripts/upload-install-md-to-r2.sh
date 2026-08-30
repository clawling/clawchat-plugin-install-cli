#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
R2_ENV_FILE="${R2_ENV_FILE:-$SCRIPT_DIR/.env.r2}"
NO_UPLOAD=false

usage() {
  cat >&2 <<'EOF'
Usage: scripts/upload-install-md-to-r2.sh [--no-upload]

Uploads install.md and both one-shot install scripts to the ClawChat R2 public prefix:
  clawchat/install.md
  clawchat/install-clawchat.sh
  clawchat/install-clawchat.ps1
  clawchat/agent-protocol.md

Environment:
  AWS_ACCESS_KEY_ID      required, or set in scripts/.env.r2
  AWS_SECRET_ACCESS_KEY  required, or set in scripts/.env.r2
  AWS_DEFAULT_REGION     defaults to auto
  R2_ENDPOINT            required, or set in scripts/.env.r2
  R2_BUCKET              required, or set in scripts/.env.r2
  R2_PREFIX              defaults to clawchat
  R2_PUBLIC_BASE_URL     optional, printed after upload when set
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-upload)
      NO_UPLOAD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -f "$R2_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$R2_ENV_FILE"; set +a
fi

: "${AWS_DEFAULT_REGION:=auto}"
: "${R2_ENDPOINT:=}"
: "${R2_BUCKET:=}"
: "${R2_PREFIX:=clawchat}"
: "${R2_PUBLIC_BASE_URL:=}"

SOURCE_PATH="$REPO_ROOT/install.md"
SCRIPT_SOURCE_PATH="$REPO_ROOT/scripts/install-clawchat.sh"
PS_SCRIPT_SOURCE_PATH="$REPO_ROOT/scripts/install-clawchat.ps1"
PROTOCOL_SOURCE_PATH="$REPO_ROOT/docs/agent-protocol.md"
OBJECT_KEY="${R2_PREFIX%/}/install.md"
SCRIPT_OBJECT_KEY="${R2_PREFIX%/}/install-clawchat.sh"
PS_SCRIPT_OBJECT_KEY="${R2_PREFIX%/}/install-clawchat.ps1"
PROTOCOL_OBJECT_KEY="${R2_PREFIX%/}/agent-protocol.md"

if [[ ! -f "$SOURCE_PATH" ]]; then
  echo "install.md not found at $SOURCE_PATH" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT_SOURCE_PATH" ]]; then
  echo "install-clawchat.sh not found at $SCRIPT_SOURCE_PATH" >&2
  exit 1
fi
if [[ ! -f "$PS_SCRIPT_SOURCE_PATH" ]]; then
  echo "install-clawchat.ps1 not found at $PS_SCRIPT_SOURCE_PATH" >&2
  exit 1
fi
if [[ ! -f "$PROTOCOL_SOURCE_PATH" ]]; then
  echo "agent-protocol.md not found at $PROTOCOL_SOURCE_PATH" >&2
  exit 1
fi

SIZE_BYTES="$(wc -c < "$SOURCE_PATH" | tr -d ' ')"
SCRIPT_SIZE_BYTES="$(wc -c < "$SCRIPT_SOURCE_PATH" | tr -d ' ')"
PS_SCRIPT_SIZE_BYTES="$(wc -c < "$PS_SCRIPT_SOURCE_PATH" | tr -d ' ')"
PROTOCOL_SIZE_BYTES="$(wc -c < "$PROTOCOL_SOURCE_PATH" | tr -d ' ')"
echo "==> Prepared install.md (${SIZE_BYTES} bytes)" >&2
echo "==> Prepared install-clawchat.sh (${SCRIPT_SIZE_BYTES} bytes)" >&2
echo "==> Prepared install-clawchat.ps1 (${PS_SCRIPT_SIZE_BYTES} bytes)" >&2
echo "==> Prepared agent-protocol.md (${PROTOCOL_SIZE_BYTES} bytes)" >&2
echo "==> R2 object: s3://${R2_BUCKET:-<R2_BUCKET>}/${OBJECT_KEY}" >&2
echo "==> R2 object: s3://${R2_BUCKET:-<R2_BUCKET>}/${SCRIPT_OBJECT_KEY}" >&2
echo "==> R2 object: s3://${R2_BUCKET:-<R2_BUCKET>}/${PS_SCRIPT_OBJECT_KEY}" >&2
echo "==> R2 object: s3://${R2_BUCKET:-<R2_BUCKET>}/${PROTOCOL_OBJECT_KEY}" >&2

if [[ "$NO_UPLOAD" == "true" ]]; then
  echo "==> Skipping R2 upload (--no-upload)" >&2
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "R2 upload failed: aws CLI not found in PATH" >&2
  echo "Install with: brew install awscli" >&2
  exit 1
fi

: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID; export it or create scripts/.env.r2}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY; export it or create scripts/.env.r2}"
: "${R2_ENDPOINT:?missing R2_ENDPOINT; export it or create scripts/.env.r2}"
: "${R2_BUCKET:?missing R2_BUCKET; export it or create scripts/.env.r2}"

aws s3 cp \
  "$SOURCE_PATH" \
  "s3://${R2_BUCKET}/${OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type text/markdown >&2

echo "==> R2 upload OK: ${OBJECT_KEY}" >&2
aws s3 cp \
  "$SCRIPT_SOURCE_PATH" \
  "s3://${R2_BUCKET}/${SCRIPT_OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type text/x-shellscript >&2

echo "==> R2 upload OK: ${SCRIPT_OBJECT_KEY}" >&2
aws s3 cp \
  "$PS_SCRIPT_SOURCE_PATH" \
  "s3://${R2_BUCKET}/${PS_SCRIPT_OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type text/plain >&2

echo "==> R2 upload OK: ${PS_SCRIPT_OBJECT_KEY}" >&2
aws s3 cp \
  "$PROTOCOL_SOURCE_PATH" \
  "s3://${R2_BUCKET}/${PROTOCOL_OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type text/markdown >&2

echo "==> R2 upload OK: ${PROTOCOL_OBJECT_KEY}" >&2
if [[ -n "${R2_PUBLIC_BASE_URL:-}" ]]; then
  echo "==> Public URL: ${R2_PUBLIC_BASE_URL%/}/${OBJECT_KEY}" >&2
  echo "==> Public URL: ${R2_PUBLIC_BASE_URL%/}/${SCRIPT_OBJECT_KEY}" >&2
  echo "==> Public URL: ${R2_PUBLIC_BASE_URL%/}/${PS_SCRIPT_OBJECT_KEY}" >&2
  echo "==> Public URL: ${R2_PUBLIC_BASE_URL%/}/${PROTOCOL_OBJECT_KEY}" >&2
fi
