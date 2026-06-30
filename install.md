# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. Published to a
> public R2 bucket by `scripts/upload-install-md-to-r2.sh` (see
> `docs/runtime-install-guide.md`).

ClawChat is a chat app for talking to supported agent runtimes. These steps
install and pair the ClawChat plugin for **one** target — `openclaw` **or**
`hermes`. Each code block is one terminal call; use your target's block.

**Goal:** a live, paired connection where the agent **sends the user a first
greeting inside ClawChat**. That arriving message — not an "activation complete"
line in the terminal — is the success signal. If a step fails, don't stop: go to
[Troubleshooting](#troubleshooting) and work the matching case until the user has
a connected agent that has greeted them.

## 0. Check the code is pairable

Safe pre-check — does **not** consume the single-use code. Replace the target and code:

```bash
curl -sS -X POST "${CLAWCHAT_BASE_URL:-https://app.clawling.com}/v1/agents/connect/check" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: clawchat-plugin-<openclaw|hermes>" \
  -d '{"code":"CLAWCHAT_CODE_GOES_HERE","platform":"<openclaw|hermes>"}'
```

`data.pairable: true` → continue. `false` → don't install; read `data.status`
(`expired` / `invalid` → ask for a fresh code and re-check; `paired` → see
[Troubleshooting](#troubleshooting)). If the `curl` errors or returns HTTP 404
(no `data.pairable` field), the backend likely predates this endpoint — skip the
pre-check and continue to step 1; it's an optimization, not a gate.

## 1. Verify the target and check for an existing install

OpenClaw:

```bash
openclaw --version
```

Hermes (source its venv first if `hermes` isn't on `PATH`):

```bash
if ! command -v hermes >/dev/null 2>&1; then
  if [ -d /opt/hermes/.venv/bin ]; then . /opt/hermes/.venv/bin/activate
  elif [ -d "$HOME/.hermes/hermes-agent/.venv/bin" ]; then . "$HOME/.hermes/hermes-agent/.venv/bin/activate"
  fi
fi
hermes --version
```

If the chosen command is still missing, stop and report it — don't switch
targets. Then check whether ClawChat is already installed (`openclaw plugins
list --json` or `hermes plugins list`). If it already shows ClawChat, skip step 2
and run the [update](#update-or-repair-later) command instead, then go to step 3.

## 2. Install

OpenClaw (installs can be slow — wait patiently, don't retry just because it
looks idle):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
```

Hermes:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

The CLI delegates to the host's plugin manager (OpenClaw → `openclaw plugins
install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`,
safe on all versions; Hermes → checks remote metadata + Hermes version, then
`hermes plugins install clawling/clawchat-plugin-hermes-agent`). Skill content is
bundled in the plugin.

**If the install fails on a network / GitHub error** — e.g.
`raw.githubusercontent.com` times out while npm and `git` to github.com still
work (common in locked-down environments) — do **not** just rerun with `--force`,
which takes the same path. Install **directly via the host**, which bypasses the
CLI's GitHub-raw fetch:

```bash
# Hermes
hermes plugins install clawling/clawchat-plugin-hermes-agent
# OpenClaw
openclaw plugins install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install
```

Then continue to step 3.

## 3. Activate (single-use code)

Use the code **once** — never invent, reuse, or retry a spent code.

OpenClaw:

```bash
openclaw channels add --channel clawchat-plugin-openclaw --token "CLAWCHAT_CODE_GOES_HERE"
```

Hermes:

```bash
hermes clawchat activate "CLAWCHAT_CODE_GOES_HERE"
```

Hermes one-step alternative (does activation as part of install, so you skip this
step — only with a fresh code): add `--activate "CLAWCHAT_CODE_GOES_HERE"` to the
step 2 `install` command. Hermes 0.12 fallback:
`python "${HERMES_HOME:-$HOME/.hermes}/plugins/clawchat/clawchat_cli.py" activate CLAWCHAT_CODE_GOES_HERE`.

## 4. Restart the agent — the user must do this

**Required.** ClawChat's tools and live connection only become usable after the
agent process **restarts** to load the newly installed plugin and activation
credentials. Until then, the profile and greeting calls in step 5 will fail
because the ClawChat tools aren't registered yet.

Hermes activation schedules this restart automatically, but in many environments
the running agent **cannot restart itself** (the restart needs the user's
approval). Do **not** block or loop trying to self-restart.

Instead, **ask the user to restart the agent themselves** — the OpenClaw or
Hermes process that was just activated — and wait for it to come back. Once it's
back up, the ClawChat tools are available; continue to step 5.

## 5. Set the profile and greet the user (the success signal)

After the restart, using the agent's normal ClawChat tools:

1. If the agent has identity info, call `clawchat_update_account_profile` with
   any available `nickname`, `bio`, and/or `avatar_url` so the user can tell
   which agent connected.
2. **Send one short greeting** in ClawChat — introduce the agent and say it's
   connected and ready. When that message appears in the user's ClawChat app, the
   pairing is confirmed end to end. **Done.**

If nothing arrives after a minute or two, the step 4 restart most likely hasn't
taken effect — ask the user to restart again and wait, then redo step 5. If it
still won't connect, see [Troubleshooting](#troubleshooting).

## Troubleshooting

Stay on the **same target** the user picked; never switch targets, invent codes,
or reuse a spent activation code. Match the symptom, act, then resume and finish
at step 5 (the user greeted in ClawChat).

- **Code not pairable (step 0).** `expired` / `invalid` → ask for a fresh code
  and re-run step 0. `paired` → already used; ask whether to re-pair with a fresh
  code or repair the existing agent (handle as the activation/auth case below).

- **Target command missing (step 1).** Source the Hermes venv
  (`source /opt/hermes/.venv/bin/activate`) or call the absolute binary, then
  retry. If the runtime genuinely isn't installed, stop and report it — don't
  install the other target instead.

- **Install fails (step 2).** Re-read stderr. OpenClaw is slow — wait, don't
  retry on idle. On a **network / GitHub-raw error**, use the **direct host
  install** from step 2 (not `--force`, which repeats the failing path).
  Otherwise retry the same `install` once, then fall back to
  [update `--force`](#update-or-repair-later).

- **Activation fails (step 3: validation / auth / 401 / 403 / non-zero exit).**
  Codes are single-use — don't retry the same one. Report the error verbatim, ask
  for a fresh code, run the step 3 command once, continue.

- **Activated but no greeting / not connected (step 5).** Almost always the
  step 4 restart hasn't taken effect — **ask the user to restart the agent** and
  wait. If still disconnected after a restart, ask for a fresh code, run step 3
  once, restart again, then redo step 5.

- **Plugin files missing / stale / corrupted (any step).** Run
  [update](#update-or-repair-later); if the version is already current, rerun
  with `--force` to reinstall.

## Update or repair later

Use the same target that was installed (`openclaw` or `hermes`):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target <openclaw|hermes>
```

If local plugin files look corrupted while the version is already current, add
`--force` to reinstall:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target <openclaw|hermes> --force
```
