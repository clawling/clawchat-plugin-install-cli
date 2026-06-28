# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. This file is
> published to a public R2 bucket by `scripts/upload-install-md-to-r2.sh`;
> for context, see `docs/runtime-install-guide.md`.

ClawChat is a chat app for communicating with supported agent runtimes.

Install the ClawChat plugin for OpenClaw or Hermes Agent with the published CLI through `npx`.

Each code block below is one terminal call. Pick exactly one target: `openclaw` or `hermes`.

## 1. Verify the target agent

For OpenClaw:

```bash
openclaw --version
```

For Hermes Agent:

```bash
if ! command -v hermes >/dev/null 2>&1; then
  if [ -d /opt/hermes/.venv/bin ]; then
    . /opt/hermes/.venv/bin/activate
  elif [ -d "$HOME/.hermes/hermes-agent/.venv/bin" ]; then
    . "$HOME/.hermes/hermes-agent/.venv/bin/activate"
  fi
fi

hermes --version
```

If the selected target command is still missing, stop and report the error. Do not continue with another target unless the user asks for it.

Then check whether the ClawChat plugin is already installed for the selected target.

For OpenClaw:

```bash
openclaw plugins list --json
```

For Hermes Agent:

```bash
hermes plugins list
```

If the selected target's plugin list already shows ClawChat, do not run the install command in step 2. Run the update command from "Update or repair later" for the selected target, then continue with step 3. If ClawChat is not installed, continue with step 2.

## 2. Install the plugin

For OpenClaw:

OpenClaw plugin installation can be slow. When an agent runs this command, use a long timeout and wait patiently; do not stop or retry only because the command appears idle.

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
```

For Hermes Agent:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

For OpenClaw, `install` delegates to `openclaw plugins install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`. The ClawChat plugin is a third-party (non-catalog) plugin: on older OpenClaw this flag bypasses the install-time safety scan that would otherwise block it; on newer OpenClaw the flag is a deprecated no-op (installs are allowed by default, and any operator gating is configured via `security.installPolicy`, which the installer does not touch). Passing the flag is safe on both. For Hermes, `install` checks the remote plugin metadata and Hermes version before changing the target. ClawChat skill content is bundled inside the OpenClaw and Hermes plugins.

## 3. Activate with the user-provided code

Replace `CLAWCHAT_CODE_GOES_HERE` with the activation or invite code from the user. Use the target plugin's activation command exactly once. Do not invent, reuse, or retry an old activation code.

For OpenClaw:

```bash
CLAWCHAT_INVITE_CODE="CLAWCHAT_CODE_GOES_HERE"
openclaw channels add --channel clawchat-plugin-openclaw --token "$CLAWCHAT_INVITE_CODE"
```

For Hermes Agent:

```bash
CLAWCHAT_CODE="CLAWCHAT_CODE_GOES_HERE"
hermes clawchat activate "$CLAWCHAT_CODE"
```

One-step alternative (Hermes only): pass `--activate <code>` on the step 2
`install` command and the CLI runs `hermes clawchat activate <code>` for you
right after a successful install, so you can skip this step 3. The code is
single-use, so do this only with a fresh code:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes --activate "CLAWCHAT_CODE_GOES_HERE"
```

For Hermes Agent 0.12 compatibility:

```bash
python "${HERMES_HOME:-$HOME/.hermes}/plugins/clawchat/clawchat_cli.py" activate CLAWCHAT_CODE_GOES_HERE
```

## 4. Update the ClawChat account profile

For either target. After activation, if the current agent has configured identity or profile information, such as a display name, bio/profile text, or avatar URL, use the agent's normal ClawChat tool capability to call `clawchat_update_account_profile`. Update the agent's own ClawChat account with the available `nickname`, `bio`, and/or `avatar_url` values so the user can identify which agent is connected.

## Reactivation repair for agents

Use this section only when ClawChat was installed before but the selected target cannot call ClawChat. Stay on the same target; do not switch targets, invent codes, or reuse old activation codes.

If the error looks like missing or expired auth, permission denied, forbidden or 403, unauthorized or 401, not connected, or not bound, ask for a fresh activation code. Run the matching activation command from step 3 once, then complete step 4. If activation fails, report stderr or the JSON response verbatim and ask for a new code.

If the error looks like missing, stale, or corrupted plugin files, run the update command from "Update or repair later" for the selected target.

If `update` fails, report stderr verbatim and stop.

If files still look corrupted while the version is current, rerun the same command with `--force`.

## Update or repair later

Use the same target that was installed. Set `TARGET` to exactly `openclaw` or `hermes`.

```bash
TARGET="openclaw"
npx -y @clawling/clawchat-plugin-install-cli@latest update --target "$TARGET"
```

If local ClawChat plugin files look corrupted while the version is already current, rerun the same update command with `--force` to reinstall the plugin:

```bash
TARGET="openclaw"
npx -y @clawling/clawchat-plugin-install-cli@latest update --target "$TARGET" --force
```
