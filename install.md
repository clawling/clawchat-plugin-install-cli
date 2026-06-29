# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. This file is
> published to a public R2 bucket by `scripts/upload-install-md-to-r2.sh`;
> for context, see `docs/runtime-install-guide.md`.

ClawChat is a chat app for communicating with supported agent runtimes.

Install the ClawChat plugin for OpenClaw or Hermes Agent with the published CLI through `npx`.

Each code block below is one terminal call. Pick exactly one target: `openclaw` or `hermes`.

## Final goal

The whole point of these steps is a **live, paired ClawChat connection**: once
install + activation succeed, the agent connects to the user's ClawChat account
and **sends the user a first message inside ClawChat** (a short greeting that
introduces the agent). When that message appears in the user's ClawChat app, the
flow is done — that arriving message, not just an "activation complete" line in
the terminal, is the real success signal.

Every step below works toward that outcome. **Start at step 0** to verify the
connect code is pairable before installing anything. If any step fails, do not
stop at the failure: jump to "Handling install or connection failures" and keep
going until the user has a connected agent that has greeted them in ClawChat.

## 0. Verify the connect code is pairable (before installing)

Before installing anything, confirm the user's connect code is valid and
pairable. This check is **safe** — it does not consume the single-use code.
Replace the placeholders (`<openclaw|hermes>` and the code):

```bash
curl -sS -X POST "${CLAWCHAT_BASE_URL:-https://app.clawling.com}/v1/agents/connect/check" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: clawchat-plugin-<target>" \
  -d '{"code":"CLAWCHAT_CODE_GOES_HERE","platform":"<openclaw|hermes>"}'
```

Read `data.pairable` in the response:

- `"pairable": true` → continue with step 1 and install.
- `"pairable": false` → do **not** install yet. Use `data.status`
  (`expired` / `paired` / `invalid`) and go to "Handling install or connection
  failures" — for any of these, ask the user for a fresh connect code and
  re-run this check before installing.

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

## 5. Greet the user and confirm the connection

This is the final goal. Once activation reports success and the profile is set,
use the agent's normal ClawChat messaging capability to **send the user one
short greeting message in ClawChat** — for example, introduce the agent by name
and say it is now connected and ready. That message is how the user confirms the
pairing actually works end to end.

Then **remind the user**: if that greeting does not arrive in their ClawChat app,
or the agent still shows as not connected after a short wait (roughly a minute or
two), the current agent likely needs a restart to pick up the new ClawChat
credentials. Tell the user to **restart the current agent** (the OpenClaw or
Hermes process that was just activated) and then check ClawChat again. Most
"activated but nothing showed up" cases clear after one restart.

## Handling install or connection failures

Use this section whenever a step above did not succeed. Stay on the **same
target** the user picked; never silently switch targets, invent codes, or reuse
a spent activation code. Match the symptom, take the action, then resume the
flow and finish at step 5 (the user greeted in ClawChat).

- **Pre-check says not pairable (step 0: `pairable:false`).** Don't install
  against a dead code. `expired` / `invalid` → ask the user for a fresh connect
  code and re-run step 0. `paired` → the code was already used; ask whether they
  want to re-pair (a fresh code) or repair an existing agent via "Reactivation
  repair for agents".

- **Target command missing (`openclaw` / `hermes` not found, step 1).** The
  agent runtime itself is not on `PATH`. For Hermes, source its venv first
  (e.g. `source /opt/hermes/.venv/bin/activate`) or call the absolute binary
  (`/opt/hermes/.venv/bin/hermes`), then retry step 1. If the target genuinely
  is not installed, stop and report that — do not install the other target
  instead.

- **Install command fails (step 2: `npx` / network / plugin manager error).**
  Re-read the stderr. OpenClaw installs can be slow — wait, do not retry just
  because it looks idle. For a real error (network, registry, permissions),
  report stderr verbatim and retry the same `install` command once. If it still
  fails, fall back to "Update or repair later" with `--force` for the same
  target.

- **Plugin already installed but step 2 reports it.** Skip the install and run
  the matching `update` command from "Update or repair later", then continue to
  step 3.

- **Activation fails (step 3: `validation` / `auth` / `401` / `403`, or a
  non-zero exit).** Activation codes are **single-use** — do not retry the same
  code. Report the stderr or JSON response verbatim and ask the user for a fresh
  activation code, then run the matching activation command from step 3 once and
  continue to step 4–5.

- **Activated, but no greeting / no connection in ClawChat (the final-goal
  failure).** Activation exited 0 but the user sees nothing in their ClawChat
  app. First, **restart the current agent** (per step 5) and wait briefly — this
  resolves most cases, since the running process must reload the new ClawChat
  credentials. If it is still not connected after the restart, treat it as a
  reactivation problem: ask for a fresh code and follow "Reactivation repair for
  agents" below. Only after the agent is connected again, redo step 5 so the
  user actually receives the greeting.

- **Plugin files look missing / stale / corrupted (any step).** Run the matching
  `update` command from "Update or repair later" for the same target; if the
  version is already current, rerun it with `--force` to reinstall.

The goal is unchanged through every branch: a connected agent that has sent the
user a greeting in ClawChat. Keep working the matching case until you get there
or have a concrete error to hand back to the user.

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
