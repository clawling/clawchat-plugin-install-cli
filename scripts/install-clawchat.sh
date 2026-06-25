#!/usr/bin/env bash
set -euo pipefail

PACKAGE_SPEC="@clawling/clawchat-plugin-install-cli@latest"
OPENCLAW_PLUGIN_SPEC="@clawling/clawchat-plugin-openclaw"
HERMES_PLUGIN_NAME="clawchat"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-clawchat.sh <openclaw|hermes>

Installs, updates, or repairs ClawChat plugin support for the selected target.

The script does not install a global clawchat CLI. It runs the latest CLI with npx.
EOF
}

plugin_installed() {
  local plugin_list

  case "$TARGET" in
    openclaw)
      if ! plugin_list=$(openclaw plugins list --json 2>/dev/null); then
        return 1
      fi
      [[ "$plugin_list" == *"$OPENCLAW_PLUGIN_SPEC"* || "$plugin_list" == *"clawchat-plugin-openclaw"* || "$plugin_list" == *'"clawchat"'* ]]
      ;;
    hermes)
      if ! plugin_list=$(hermes plugins list 2>/dev/null); then
        return 1
      fi
      [[ "$plugin_list" == *"$HERMES_PLUGIN_NAME"* ]]
      ;;
  esac
}

run_clawchat() {
  local action="$1"
  shift

  echo "==> Running npx -y ${PACKAGE_SPEC} ${action} --target ${TARGET}${1:+ $*}" >&2
  npx -y "$PACKAGE_SPEC" "$action" --target "$TARGET" "$@"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$#" -ne 1 ]]; then
  usage
  exit 1
fi

TARGET="$1"
case "$TARGET" in
  openclaw|hermes)
    ;;
  *)
    echo "--target must be one of: openclaw, hermes" >&2
    usage
    exit 1
    ;;
esac

if [[ "$TARGET" == "hermes" ]] && ! command -v hermes >/dev/null 2>&1; then
  if [[ -d /opt/hermes/.venv/bin ]]; then
    . /opt/hermes/.venv/bin/activate
  elif [[ -d "$HOME/.hermes/hermes-agent/.venv/bin" ]]; then
    . "$HOME/.hermes/hermes-agent/.venv/bin/activate"
  fi
fi

if ! command -v "$TARGET" >/dev/null 2>&1; then
  echo "$TARGET CLI not found in PATH" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run @clawling/clawchat-plugin-install-cli" >&2
  exit 1
fi

if plugin_installed; then
  if run_clawchat update; then
    echo "Update completed."
  else
    echo "Update failed; retrying with --force." >&2
    run_clawchat update --force
    echo "Forced update completed."
  fi
else
  run_clawchat install
  echo "Install completed."
fi
