# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. Published to a
> public R2 bucket by `scripts/upload-install-md-to-r2.sh` (see
> `docs/runtime-install-guide.md`).

ClawChat is a chat app for talking to supported agent runtimes. These steps
install and pair the ClawChat plugin for **one** target - `openclaw` **or**
`hermes`. Each code block is one terminal call; use your target's block.

**On Windows, use PowerShell** - not `cmd.exe`. The `npx`, `openclaw`, and
`hermes` commands below are identical there; only three blocks differ and each
has a *(Windows)* twin right next to the bash one: the step 0 pre-check, the
Hermes venv activation in step 1, and the Hermes 0.12 fallback in step 3. Never
use PowerShell's `curl` - it is an alias for `Invoke-WebRequest` and takes
entirely different flags. If you would rather not run steps 1-2 by hand, the
one-shot script `install-clawchat.ps1` published alongside this guide does them
for you (bash equivalent: `install-clawchat.sh`); run it as
`powershell -ExecutionPolicy Bypass -File .\install-clawchat.ps1 <openclaw|hermes>`,
then pick up at step 3.

**Goal:** a live, paired connection where the agent **sends the user a first
greeting inside ClawChat**. That arriving message - not an "activation complete"
line in the terminal - is the success signal. If a step fails, don't stop: go to
[Troubleshooting](#troubleshooting) and work the matching case until the user has
a connected agent that has greeted them.

## 0. Check the code is pairable

Safe pre-check - does **not** consume the single-use code. Replace the target and code:

```bash
curl -sS -X POST "${CLAWCHAT_BASE_URL:-https://app.clawling.com}/v1/agents/connect/check" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: clawchat-plugin-<openclaw|hermes>" \
  -d '{"code":"CLAWCHAT_CODE_GOES_HERE","platform":"<openclaw|hermes>"}'
```

*(Windows)*

```powershell
$base = if ($env:CLAWCHAT_BASE_URL) { $env:CLAWCHAT_BASE_URL } else { 'https://app.clawling.com' }
$body = @{ code = 'CLAWCHAT_CODE_GOES_HERE'; platform = '<openclaw|hermes>' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$base/v1/agents/connect/check" `
  -ContentType 'application/json' `
  -Headers @{ 'X-Device-Id' = 'clawchat-plugin-<openclaw|hermes>' } `
  -Body $body | ConvertTo-Json -Depth 5
```

`data.pairable: true` -> continue. `false` -> don't install; read `data.status`
(`expired` / `invalid` -> ask for a fresh code and re-check; `paired` -> see
[Troubleshooting](#troubleshooting)). If the request errors or returns HTTP 404
(no `data.pairable` field), the backend likely predates this endpoint - skip the
pre-check and continue to step 1; it's an optimization, not a gate. On Windows
note that `Invoke-RestMethod` **throws** on a 404 instead of printing a body -
that throw is the same "skip the pre-check" signal, not a reason to stop.

**Re-pairing an agent that was already connected before?** Add its stored
`user_id` to the body (`"user_id":"usr_..."`) - Hermes keeps it at
`platforms.clawchat.extra.user_id` in `config.yaml`, OpenClaw at
`channels.clawchat-plugin-openclaw.userId`. The response then also carries
`data.user_id_status`:

| `user_id_status` | Meaning | Action |
|---|---|---|
| `live` / `deleted` | The stored identity is real; activation re-pairs (or revives) it | continue |
| `unknown` | The identity no longer exists on this server | continue - activation just creates a fresh agent |
| `owner_mismatch` | It belongs to a **different** ClawChat account | don't activate with this code; see [Troubleshooting](#troubleshooting) |
| `invalid` | Malformed id in the config | clear the field, then continue |

Omitting `user_id` checks the code alone and leaves `user_id_status` absent.

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

*(Windows)* - the venv lives in `.venv\Scripts\`, not `.venv/bin/`:

```powershell
if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
  # Native Windows keeps the Hermes home at %LOCALAPPDATA%\hermes, NOT
  # %USERPROFILE%\.hermes (that is the POSIX / WSL2 layout).
  $root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
  $scripts = Join-Path $root 'hermes-agent\.venv\Scripts'
  if (-not (Test-Path $scripts)) {
    $scripts = Join-Path $env:USERPROFILE '.hermes\hermes-agent\.venv\Scripts'
  }
  if (Test-Path $scripts) { $env:PATH = "$scripts;$env:PATH" }
}
hermes --version
```

If the chosen command is still missing, stop and report it - don't switch
targets. Then check whether ClawChat is already installed (`openclaw plugins
list --json` or `hermes plugins list`). If it already shows ClawChat, skip step 2
and run the [update](#update-or-repair-later) command instead, then go to step 3.

**Hermes with more than one profile** - confirm which profile you are on before
installing or activating. Every ClawChat identity is keyed on the active
`HERMES_HOME`, so a mis-targeted command pairs a *different* agent with no error
and burns the single-use code:

```bash
echo "HERMES_HOME=${HERMES_HOME:-<unset>}"
cat "$HOME/.hermes/active_profile" 2>/dev/null || echo "active_profile=default"
hermes profile list
```

*(Windows)* - the Hermes root is `%LOCALAPPDATA%\hermes`, not
`%USERPROFILE%\.hermes`:

```powershell
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
"HERMES_HOME=$(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { '<unset>' })"
$active = Join-Path $root 'active_profile'
if (Test-Path $active) { Get-Content $active } else { 'active_profile=default' }
hermes profile list
```

`hermes` follows `-p <name>` -> a profile-scoped `HERMES_HOME` -> the sticky
`active_profile` file -> default, but `clawchat_cli.py` (the Hermes 0.12 fallback
in step 3) follows **`HERMES_HOME` only** and silently falls back to the default
profile - `%LOCALAPPDATA%\hermes` on native Windows, `~/.hermes` on POSIX.
`hermes profile create <name>` does *not* switch you into `<name>`. To target a
specific profile, pin it on every command below - pass `--profile <name>` to
this CLI (with `HERMES_HOME` unset or pointing at the Hermes root, never at the
profile itself), and `-p <name>` plus an explicit `HERMES_HOME` to `hermes` /
`python` calls:

```bash
export HERMES_HOME="$HOME/.hermes/profiles/<name>"                  # POSIX
```

```powershell
$env:HERMES_HOME = Join-Path $env:LOCALAPPDATA 'hermes\profiles\<name>'   # Windows
```

## 2. Install

OpenClaw (installs can be slow - wait patiently, don't retry just because it
looks idle):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
```

Hermes:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

The CLI delegates to the host's plugin manager (OpenClaw -> `openclaw plugins
install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`,
safe on all versions; Hermes -> checks remote metadata + Hermes version, then
`hermes plugins install clawling/clawchat-plugin-hermes-agent`). Skill content is
bundled in the plugin.

**If the install fails on a network / GitHub error** - e.g.
`raw.githubusercontent.com` times out while npm and `git` to github.com still
work (common in locked-down environments) - do **not** just rerun with `--force`,
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

Use the code **once** - never invent, reuse, or retry a spent code.

OpenClaw:

```bash
openclaw channels add --channel clawchat-plugin-openclaw --token "CLAWCHAT_CODE_GOES_HERE"
```

Hermes:

```bash
hermes clawchat activate "CLAWCHAT_CODE_GOES_HERE"
```

Hermes one-step alternative (does activation as part of install, so you skip this
step - only with a fresh code): add `--activate "CLAWCHAT_CODE_GOES_HERE"` to the
step 2 `install` command. Hermes 0.12 fallback:
`python "${HERMES_HOME:-$HOME/.hermes}/plugins/clawchat/clawchat_cli.py" activate CLAWCHAT_CODE_GOES_HERE`.

*(Windows)* same 0.12 fallback:

```powershell
# Native Windows: %LOCALAPPDATA%\hermes. %USERPROFILE%\.hermes is the POSIX /
# WSL2 layout - activating there writes credentials Hermes never reads.
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
python (Join-Path $root 'plugins\clawchat\clawchat_cli.py') activate CLAWCHAT_CODE_GOES_HERE
```

**Hermes: if activation refuses with "this Hermes profile is already paired".**
The code is **not** spent. Pick the flag by intent, not by which sentence in the
error looks closest:

- The profile should get **its own new agent** - including when a freshly
  created profile already shows an identity, which it inherited from a cloned
  `config.yaml`: re-run with `--new-account`.
- Only when the user confirms this profile already paired that exact agent and
  just lost its token: re-run with `--repair`.

`--repair` keeps the stored `user_id`, so the server re-pairs **that** agent and
spends the code on it - it never creates an agent. A fresh install has no token,
so "lost its token" always looks true; that is not evidence. Newer plugin
versions refuse `--repair` outright when the identity has no local provenance -
that refusal means `--new-account`, not a fresh code.

## 4. Restart the agent - the user must do this

**Required.** ClawChat's tools and live connection only become usable after the
agent process **restarts** to load the newly installed plugin and activation
credentials. Until then, the profile and greeting calls in step 5 will fail
because the ClawChat tools aren't registered yet.

Hermes activation schedules this restart automatically, but in many environments
the running agent **cannot restart itself** (the restart needs the user's
approval). Do **not** block or loop trying to self-restart.

Instead, **ask the user to restart the agent themselves** - the OpenClaw or
Hermes process that was just activated - and wait for it to come back. Once it's
back up, the ClawChat tools are available; continue to step 5.

## 5. Set the profile and greet the user (the success signal)

After the restart, using the agent's normal ClawChat tools:

1. If the agent has identity info, call `clawchat_update_account_profile` with
   any available `nickname`, `bio`, and/or `avatar_url` so the user can tell
   which agent connected.
2. **Send one short greeting** in ClawChat - introduce the agent and say it's
   connected and ready. When that message appears in the user's ClawChat app, the
   pairing is confirmed end to end. **Done.**

If nothing arrives after a minute or two, the step 4 restart most likely hasn't
taken effect - ask the user to restart again and wait, then redo step 5. If it
still won't connect, see [Troubleshooting](#troubleshooting).

## Troubleshooting

Stay on the **same target** the user picked; never switch targets, invent codes,
or reuse a spent activation code. Match the symptom, act, then resume and finish
at step 5 (the user greeted in ClawChat).

- **Code not pairable (step 0).** `expired` / `invalid` -> ask for a fresh code
  and re-run step 0. `paired` -> already used; ask whether to re-pair with a fresh
  code or repair the existing agent (handle as the activation/auth case below).

- **Target command missing (step 1).** Source the Hermes venv
  (`source /opt/hermes/.venv/bin/activate`; on Windows use the step 1 *(Windows)*
  block, which puts `.venv\Scripts` on `PATH`) or call the absolute binary, then
  retry. If the runtime genuinely isn't installed, stop and report it - don't
  install the other target instead.

- **Install fails (step 2).** Re-read stderr. OpenClaw is slow - wait, don't
  retry on idle. On a **network / GitHub-raw error**, use the **direct host
  install** from step 2 (not `--force`, which repeats the failing path).
  Otherwise retry the same `install` once, then fall back to
  [update `--force`](#update-or-repair-later).

- **Activation fails (step 3: validation / auth / 401 / 403 / non-zero exit).**
  Codes are single-use - don't retry the same one. Report the error verbatim, ask
  for a fresh code, run the step 3 command once, continue.

- **`code: 16001` / `agent not found` on activation, while step 0 said
  `pairable: true`.** The stored `user_id` in the local config names an agent
  that no longer exists on this server (the account that owned it was deleted,
  or the config came from another deployment). The code itself is fine and is
  **not** spent - every fresh code fails the same way until the id is cleared,
  so asking for more codes will not help. Delete `user_id` (Hermes:
  `platforms.clawchat.extra.user_id`, plus `agent_id` / `owner_user_id` in the
  same `extra` block; OpenClaw: `channels.clawchat-plugin-openclaw.userId`),
  keep `base_url` and the rest, then re-run step 3. Current plugin and backend
  versions recover from this automatically, so an [update](#update-or-repair-later)
  also fixes it.

- **Step 0 returned `user_id_status: owner_mismatch`.** The local config belongs
  to a different ClawChat account than the one that issued the code. Confirm
  with the user which account the agent should live in; either get a code from
  the original account, or clear the stored `user_id` (as above) to pair as a
  brand-new agent under the new account. Don't activate before deciding - the
  server rejects it and the code stays unspent.

- **Hermes: the new agent turns out to be an existing one** (the profile
  connects as an agent the user already had). Two causes: the command landed on
  the wrong profile - almost always the default - or `--repair` replayed an
  identity the profile had inherited from a cloned config. Don't ask for a fresh
  code yet: re-run the profile checks in step 1, compare `extra.user_id` against
  the other profile's, then re-issue with `-p <profile>` **and** `HERMES_HOME`
  set to that profile (`%LOCALAPPDATA%\hermes\profiles\<name>` on native
  Windows), adding `--new-account` if this profile still needs its own agent. A
  `[HERMES_HOME fallback] HERMES_HOME is unset but active profile is …` line on
  stderr is the same problem. Verify with that profile's own files:
  `grep -A6 'clawchat:' "$HOME/.hermes/profiles/<name>/config.yaml"` -
  `extra.profile` must be `<name>`, and two profiles must never share
  `extra.user_id`.

- **Activated but no greeting / not connected (step 5).** Almost always the
  step 4 restart hasn't taken effect - **ask the user to restart the agent** and
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
