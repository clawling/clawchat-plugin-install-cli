# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. This file is the
> source of truth; the connection wiki (entry: https://agent-connection.clawling.com/start.md)
> inlines a versioned mirror into its official install pages, and a copy is published to R2 by
> `scripts/upload-install-md-to-r2.sh` (see `docs/runtime-install-guide.md`).
>
> **Something here was wrong, missing, or cost you time?** File a field report the
> way https://agent-connection.clawling.com/start.md Appendix B describes — that is
> what the next agent on this path reads. Do not leave it in a terminal transcript.

ClawChat is a chat app for talking to supported agent runtimes. These steps
install and pair the ClawChat plugin for **one** target - `openclaw` **or**
`hermes`. Each code block is one terminal call; use your target's block.

**On Windows, use PowerShell** - not `cmd.exe`. The `npx`, `openclaw`, and
`hermes` commands below are identical there; shell-specific blocks have
PowerShell examples: the step 0 pre-check, step 1
venv/profile/`HERMES_HOME` setup, and dependency recovery. Never
use PowerShell's `curl` - it is an alias for `Invoke-WebRequest` and takes
entirely different flags. If you would rather not run steps 1-2 by hand, the
one-shot script `install-clawchat.ps1` published alongside this guide does them
for you (bash equivalent: `install-clawchat.sh`); run it as
`powershell -ExecutionPolicy Bypass -File .\install-clawchat.ps1 <openclaw|hermes>`,
then pick up at step 3.

**Goal:** a live, paired connection where the agent **greets the user inside
ClawChat**. The plugin sends that greeting **by itself** on the first connection
after activation - you never send it. That arriving message - not an "activation
complete" line in the terminal - is the success signal. If a step fails, don't
stop: go to [Troubleshooting](#troubleshooting) and work the matching case until
the user has a connected agent that has greeted them.

**Report each stage to the connection wiki (only if it sent you here).**

Only if you came through the connection wiki and hold a pairing code, fetch once
per reason: `GET <wiki origin>/hello?c=<your code>&agent=<openclaw|hermes>&step=progress&reason=<reason>`.
`<wiki origin>` is the site you read `start.md` from (normally
`https://agent-connection.clawling.com`). Add nothing else to the URL.

Copy `CLAWCHAT_REPORT: <reason>` verbatim. With **no `CLAWCHAT_REPORT:` line**
(npx download failed), use `plugin_install_failed:` plus `network` for
download/registry transport errors, `tls` for certificates, otherwise `other`.
Direct host installs: `plugin_installed` or a failure below. Unsure: `other`.
After the Hermes enable check: `plugin_enabled` on success; otherwise
`plugin_enable_failed:` plus `deps_timeout` for timeout, `deps_tls` for certificate
errors, `deps_network` for reset/DNS/download, `deps_failed` for other
dependency errors, `scan_disabled` for scan-disabled plugins, otherwise `other`.
After your step 3 command: `plugin_activated` on success; otherwise
`plugin_activate_failed:` plus `already_paired`, `code_rejected` (invalid/expired/used),
`network`, `no_command` (unknown `hermes clawchat`), `plugin_too_old` ("invite code
is required"), `timeout`, or `other`.

Only these complete reasons are allowed:

```text
plugin_installed
plugin_enabled
plugin_activated
plugin_awaiting_restart
plugin_install_failed:scan_blocked
plugin_install_failed:host_missing
plugin_install_failed:host_too_old
plugin_install_failed:npx_missing
plugin_install_failed:network
plugin_install_failed:tls
plugin_install_failed:metadata
plugin_install_failed:timeout
plugin_install_failed:already_exists
plugin_install_failed:host_error
plugin_install_failed:bad_input
plugin_install_failed:prerelease_refused
plugin_install_failed:legacy_config
plugin_install_failed:other
plugin_enable_failed:deps_failed
plugin_enable_failed:deps_network
plugin_enable_failed:deps_tls
plugin_enable_failed:deps_timeout
plugin_enable_failed:scan_disabled
plugin_enable_failed:other
plugin_activate_failed:already_paired
plugin_activate_failed:code_rejected
plugin_activate_failed:network
plugin_activate_failed:no_command
plugin_activate_failed:plugin_too_old
plugin_activate_failed:timeout
plugin_activate_failed:other
```

Best-effort: never wait on it, never retry it, and never let it block or change
any step. Ignore reporting errors.
Report the failure before working the Troubleshooting case. Never include error
text, paths, tokens or anything other than the listed words.

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
| `live` | The stored identity is real and active; activation re-pairs **that same agent** | continue only if re-pairing is the intent; it will not create a second agent |
| `deleted` | The user deleted this agent, but the record survives | **stop and ask.** Sending the id **revives the old agent**, history and all - it does not create a new one. If the user wants a *new* agent, clear the stored id first (see below) |
| `unknown` | The identity no longer exists on this server | continue - activation just creates a fresh agent |
| `owner_mismatch` | It belongs to a **different** ClawChat account | don't activate with this code; see [Troubleshooting](#troubleshooting) |
| `invalid` | Malformed id in the config | clear the field, then continue |

`deleted` is the status to slow down on, because "I deleted my agent, now make me a
new one" is the common request and replaying the id does the opposite. Deleting an
agent in the app does **not** clear the identity stored on this machine, so the
next activation reattaches to it. To pair as a brand-new agent instead, clear the
stored `user_id` (Hermes: `platforms.clawchat.extra.user_id`; OpenClaw:
`channels.clawchat-plugin-openclaw.userId` **and** `token`, since the id is
recovered from the token) before step 3, or use the `--new-account` intent
described there.

Omitting `user_id` checks the code alone and leaves `user_id_status` absent.

## 1. Verify the target and check for an existing install

OpenClaw:

```bash
openclaw --version
```

Hermes (source its venv first if `hermes` isn't on `PATH`):

```bash
if ! command -v hermes >/dev/null 2>&1; then
  # Official installers name the venv `venv`; the Docker image and some manual
  # installs use `.venv`.
  for venv in /opt/hermes/.venv "$HOME/.hermes/hermes-agent/venv" "$HOME/.hermes/hermes-agent/.venv"; do
    if [ -f "$venv/bin/activate" ]; then . "$venv/bin/activate"; break; fi
  done
fi
hermes --version
```

*(Windows)* - a Windows venv keeps its commands in `Scripts\`, not `bin/`:

```powershell
if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
  # Native Windows keeps the Hermes home at %LOCALAPPDATA%\hermes, NOT
  # %USERPROFILE%\.hermes (that is the POSIX / WSL2 layout). The official
  # installer names the venv `venv`; a manual install may use `.venv`.
  $root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
  $candidates = foreach ($base in $root, (Join-Path $env:USERPROFILE '.hermes')) {
    foreach ($venv in 'venv', '.venv') { Join-Path $base "hermes-agent\$venv\Scripts" }
  }
  $scripts = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($scripts) { $env:PATH = "$scripts;$env:PATH" }
}
hermes --version
```

If the chosen command is still missing, stop and report it - don't switch
targets. Then check whether ClawChat is already installed (`openclaw plugins
list --json` or `hermes plugins list`). If it already shows ClawChat, skip step 2
and run the [update](#update-or-repair-later) command instead, then go to step 3.
If that update fails only because it cannot fetch plugin metadata from GitHub,
the installed copy still works: go on to step 3 and update later.

**Hermes with more than one profile** - confirm which profile you are on before
installing or activating. Every ClawChat identity is keyed on the active
`HERMES_HOME`, so a mis-targeted command pairs a *different* agent with no error
and burns the single-use code:

```bash
root="${HERMES_HOME:-$HOME/.hermes}"; case "$root" in */profiles/*) root="${root%/profiles/*}" ;; esac
echo "HERMES_HOME=${HERMES_HOME:-<unset>}"
cat "$root/active_profile" 2>/dev/null || echo "active_profile=default"
hermes profile list
```

*(Windows)* - the Hermes root is `%LOCALAPPDATA%\hermes`, not
`%USERPROFILE%\.hermes`:

```powershell
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
if ($root -match '[\\/]profiles[\\/][^\\/]+$') { $root = Split-Path (Split-Path $root -Parent) -Parent }
"HERMES_HOME=$(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { '<unset>' })"
$active = Join-Path $root 'active_profile'
if (Test-Path $active) { Get-Content $active } else { 'active_profile=default' }
hermes profile list
```

`hermes` follows `-p <name>` -> a profile-scoped `HERMES_HOME` -> the sticky
`active_profile` file -> default.
`hermes profile create <name>` does *not* switch you into `<name>`. To target a
specific profile, pin it on every command below - pass `--profile <name>` to
this CLI (with `HERMES_HOME` unset or pointing at the Hermes root, never at the
profile itself), and `-p <name>` plus an explicit `HERMES_HOME` to `hermes`
calls:

```bash
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}/profiles/<name>"  # POSIX
```

```powershell
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$env:HERMES_HOME = Join-Path $root 'profiles\<name>'                # Windows
```

## 2. Install

After this step, report its `CLAWCHAT_REPORT:` line and, on Hermes, the enable
check below ([see the top](#install-clawchat-plugin)).

OpenClaw (installs can be slow - wait patiently, don't retry just because it
looks idle):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
```

Hermes:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

Each block is a separate terminal call, so a venv you activated in step 1 is
gone here. If `npx` fails with `spawn hermes ENOENT`, put the venv's `bin`
folder on `PATH` in the same call - the folder step 1 found, e.g.
`PATH="$HOME/.hermes/hermes-agent/venv/bin:$PATH" npx -y
@clawling/clawchat-plugin-install-cli@latest install --target hermes`
(`/opt/hermes/.venv/bin` in the Docker image; PowerShell: prepend the venv's
`Scripts` folder to `$env:PATH` first, as in the step 1 *(Windows)* block, in
the same call).

The CLI first reads `openclaw --version`: hosts from 2026.5.4 up to 2026.8.1 get the last
compatible plugin, `2026.10.9-2`; older hosts stop with upgrade advice before
config writes. If the version is unreadable, it reports that and uses the
unpinned spec. An explicit `--target openclaw@<ref>` skips version selection.

The CLI delegates to the host's plugin manager (OpenClaw -> `openclaw plugins
install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install`,
plus `--accept-capabilities` when advertised; Hermes -> remote metadata and
version checks, then `hermes plugins install clawling/clawchat-plugin-hermes-agent`).
If the metadata read fails in transit on a fresh or forced install, the CLI
automatically uses that host install alone, skipping CLI version / host
compatibility checks; an installed plugin without `--force` still needs
metadata. Invalid metadata stops the CLI. The host's scan gate is unchanged.

**If the CLI still fails on a network / GitHub error**, use the direct host
path below. Do not add `--force` to the CLI to solve a network failure.

```bash
# Hermes
hermes plugins install clawling/clawchat-plugin-hermes-agent --enable
# OpenClaw 2026.8.1 and newer
openclaw plugins install @clawling/clawchat-plugin-openclaw --force --accept-capabilities
# OpenClaw 2026.5.4 up to (not including) 2026.8.1
openclaw plugins install @clawling/clawchat-plugin-openclaw@2026.10.9-2 --force --dangerously-force-unsafe-install
```

On OpenClaw 2026.8+ both flags are required: `--force` confirms the npm (non-ClawHub)
source, and `--accept-capabilities` consents to the plugin's declared capabilities.
Without them the install is cancelled or rejected and the plugin never lands. Run
`openclaw plugins install --help` if you are unsure which line your host wants.

Direct Hermes installs still need GitHub. Never disable certificate verification;
ask the owner for a reachable source if needed.

Then continue to step 3.

**Hermes security scan:** current ClawChat is safe on Hermes v0.21.6+; older
hosts may report *caution*. If blocked or asked `Install anyway?`, don't answer
the prompt or add `--force`; follow the [scanner case](#troubleshooting).

**Hermes: check the plugin is enabled before you activate.** Run `hermes plugins
list` (add `-p <name>` for a profile). Non-interactive **install** can print
`Non-interactive install — skipping dependency install` and leave ClawChat
disabled; this is normal. Run `hermes plugins enable clawchat` in the same
profile: **enable prepares dependencies even non-interactively**, with no
terminal or consent prompt required. Give your command tool at least 15 minutes
or run it in the background and wait; never start another enable while it runs.
For slow or failed preparation, see [dependency recovery](#hermes-dependencies).
Do not activate until enabled; a scan-disabled plugin needs owner review first.

## 3. Activate (single-use code)

After the activation command, report its result ([see the top](#install-clawchat-plugin)).

Use the code **once** - never invent, reuse, or retry a spent code. If this
guide was served to you by the connection wiki, set the environment variable
`CLAWCHAT_WIKI_VERSION` to that page's wiki version before you activate — it is
the `X-Wiki-Version` response header, repeated in the
`<!-- clawchat-wiki <version> -->` comment at the very end of the page (bash: `export CLAWCHAT_WIKI_VERSION=<version>`; PowerShell:
`$env:CLAWCHAT_WIKI_VERSION = '<version>'`). The plugin forwards it with the
activation so the wiki and the backend can be reconciled; it is optional and
changes nothing else.

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
step 2 `install` command.

If this Hermes has no `hermes clawchat` command (Hermes v0.12.0), stop and
follow the Hermes plugin's own activation guide
(<https://github.com/clawling/clawchat-plugin-hermes-agent/blob/main/docs/activation.md>)
instead of improvising a `python` call: activation has to run inside the Hermes
environment, and the shell's own `python` cannot load Hermes' config helpers.

**OpenClaw: if activation refuses with "this OpenClaw instance is already
paired to ClawChat agent ...".** The code is **not** spent - the refusal happens
before the request leaves the machine, so the same code is still redeemable.
This instance holds exactly one ClawChat identity, and reusing the code here
would rebind it to the agent already stored rather than add a second one.

**A human at a terminal does not see that refusal at all.** On `2026.9.8-2` and
newer the step 3 command asks instead, right where it stopped:

```text
This OpenClaw instance already holds ClawChat agent agt_... (shadow user usr_...).
  [1] Pair as a BRAND-NEW agent - this instance stops using that identity.
  [2] RESTORE that identity - re-pairs the same agent; if it was deleted, this
      brings it back with its history.
Enter 1 or 2 (press Enter to submit):
```

Answer and it continues in the same run - no flag, no re-run. Note that `[2]`
is how a deleted agent comes back, so read it to the user before choosing for
them. **You will not get this prompt**, because it only appears on a real
terminal: an agent driving `channels add`, CI, and piped input all get the
refusal instead. That is deliberate. Both outcomes are irreversible in opposite
directions, so an unattended run must not pick one.

So when you are the one running the command, state the intent up front.
`channels add` and `channels login` take no intent flags of their own; the
intents live on the plugin's runtime slash command, which you send on **any
OpenClaw command surface** - the Gateway chat, the TUI, `openclaw chat`. It does
**not** have to be a ClawChat conversation, which matters when the old agent was
deleted and that chat is gone:

- This instance should get **its own new agent**, including after the user
  deleted the previous one: `/clawchat-activate CLAWCHAT_CODE_GOES_HERE --new-account`
- Only when the user confirms this instance already paired that exact agent and
  just lost its token: `/clawchat-activate CLAWCHAT_CODE_GOES_HERE --repair`

`--repair` keeps the stored `user_id`, so the server re-pairs **that** agent and
spends the code on it - it never creates an agent.

**These flags need plugin `2026.9.8-1` or newer.** Earlier versions could not
parse the 8-character codes the backend issues and answered `ClawChat invite
code is required` for every real code, which made `--new-account` unusable. If
you see that message with a code you know is good, the plugin is too old -
[update](#update-or-repair-later) first, then re-send the command.

If the slash command is unavailable on this host, the equivalent is to clear
both `token` and `userId` under `channels.clawchat-plugin-openclaw` in the
OpenClaw config and re-run the step 3 `channels add`. With no stored identity to
replay, that pairs as a brand-new agent. Clearing `userId` alone is not enough -
it is recovered from the token.

To run a **second** agent alongside this one rather than replacing it, activate
it as a named **account** on the same gateway (plugin `2026.9.13-1` or newer;
[update](#update-or-repair-later) first on an older one):

```bash
openclaw channels add --channel clawchat-plugin-openclaw --account <name> --token "CLAWCHAT_CODE_GOES_HERE"
```

or `/clawchat-activate CLAWCHAT_CODE_GOES_HERE --account <name>` from a chat on
an already-active account. Each account is stored under
`channels.clawchat-plugin-openclaw.accounts.<name>` with its own `userId` and
tokens, so it never touches the first agent. The name is lowercased and any
character outside `a-z0-9_-` becomes `-`. Which OpenClaw agent answers it is
the host's routing: `bindings[].match.accountId`. Don't use `channels login` for
this - it only refreshes a channel that already exists.

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

**More than one Hermes profile on a host: prefer one multiplexed gateway.**
With `gateway.multiplex_profiles: true` in the **default** profile's
`config.yaml` (the Hermes root, not `profiles/<name>/`), the default profile's
gateway is the single process that serves every profile; each profile still
keeps its own `.env`, ClawChat identity and state. For each additional profile:

1. Install the plugin and activate with that profile pinned (step 1), using a
   **fresh code of its own** - every profile is a separate ClawChat agent.
2. Make sure the profile has its own model key. A new profile starts without
   one, and the greeting is a model turn.
3. If the multiplex flag is not on yet, it is the **owner's** call to turn it
   on - it changes how every profile on the host is served. If the default
   `config.yaml` also has `gateway.multiplex_profile_allowlist`, the profile
   must be listed there or it is not served.
4. Hermes 0.21.6+ with the multiplexer already running: it serves the newly
   activated profile within about 30 s - no restart; wait for its ready line
   (step 4). If you just turned multiplexing on, or on older Hermes, restart
   the **default** gateway: `hermes gateway restart`, no `-p`, `HERMES_HOME`
   unset or the Hermes root. That restarts every profile it serves - ask first.

**Alternative, if the owner doesn't want multiplexing:** give each profile a
gateway of its own instead of steps 3-4 - `hermes -p <name> gateway install`,
then `hermes -p <name> gateway start`. Pick one shape per host: while a
multiplexer serves a profile, the host refuses a separate gateway for it, and
forcing one with `--force` makes two processes poll the same accounts.

Multiplexing needs plugin `0.14.0-89` or newer (`hermes plugins list` shows the
version); earlier versions shared one state store across the profiles.
[Update](#update-or-repair-later) before activating a second profile on such a
gateway.

## 4. Restart the agent - the user must do this

**OpenClaw: probe first.** Activation asks the running OpenClaw gateway to
hot-reload the channel config, so the channel is often already up. Run
`openclaw channels status --probe`: if it shows the ClawChat channel running
and connected, no restart is needed - skip to step 5. If it does not, the
restart below is required.

**Required for Hermes, and for OpenClaw when that probe did not show the
channel connected.** ClawChat's tools and live connection only become usable after the
agent process **restarts** to load the newly installed plugin and activation
credentials. Until then the agent cannot connect, so the plugin's automatic
greeting never fires and the profile call in step 5 would fail - the ClawChat
tools aren't registered yet.

**Hermes:** a plugin reload does not start the ClawChat connection; only a
gateway restart does - except a multiplexed profile on Hermes 0.21.6+: wait
~30 s for its ready line, restart only if none (step 3). The restart activation schedules is unchecked (`Hermes
restart scheduled` proves nothing). If no ready line yet, report
`plugin_awaiting_restart` once (the CLI prints it after `plugin_activated`).

So **ask the user to restart the agent themselves**. For Hermes, end this reply:
the owner runs `hermes gateway restart` (`-p <name>` for a named profile without
multiplexing) in an **external shell**, not in chat or your terminal tool - it
waits for open sessions, including this turn. Relay the printed
`clawchat: message for the owner` line (`en` or `zh`) verbatim.

**Then verify the gateway actually restarted after the activation.** OpenClaw:
`openclaw channels status --probe` now shows the ClawChat channel running and
connected. Hermes: a `clawchat state -> ready` log line from *after*
activation, then the plugin's greeting (step 5).
If it did not restart:

- **Hermes: "the default gateway is running as a profile multiplexer"** - it
  refuses per-profile restarts. Ask the owner before `hermes gateway restart`
  (no `-p`): it restarts every profile.
- **Hermes: the profile has no gateway service yet** - for a named profile,
  prefer the default profile's multiplexer (step 3); otherwise have the owner run
  `hermes -p <name> gateway install`, then `hermes -p <name> gateway start`.
  Single profile: `hermes gateway install`, then `hermes gateway start`.
- **macOS: two launchd labels** (`ai.hermes.gateway[-<profile>]`) - match the
  PID from `hermes gateway status` in `launchctl list | grep ai.hermes.gateway`,
  then use `hermes gateway restart`; never kickstart the other label (a second
  gateway). Removing the extra one is the owner's call.
- **Windows: refused because another gateway is already running** - a second
  Hermes gateway holds it. Tell the owner which one; don't stop it yourself.
- **Linux / WSL2: the agent goes offline again after the machine reboots** -
  ask the owner to run `loginctl enable-linger "$USER"` for the systemd user
  service. WSL2 also needs `[boot]` `systemd=true` in `/etc/wsl.conf`, then
  `wsl --shutdown` from Windows; the owner decides because this restarts the VM.
- **Restart still waiting for open sessions** - ask the owner before
  restarting the service directly; that ends them.

A host restart notice ("gateway restarted") is not the plugin's greeting.
Once the gateway is verified up, continue to step 5.

## 5. Confirm the greeting arrived (the success signal)

**The plugin greets the user on its own.** On the first connection after
activation it has the agent send one short self-introduction to the owner's
ClawChat conversation. **Do not send a greeting yourself** - a second one is a
bug the user sees, not a stronger success signal.

After the restart:

1. Optional, using the agent's normal ClawChat tools: if the agent has identity
   info, call `clawchat_update_account_profile` with any available `nickname`,
   `bio`, and/or `avatar_url` so the user can tell which agent connected.
2. Ask the user whether the greeting showed up in their ClawChat app. Once they
   confirm it, the pairing is verified end to end. **Done.**

If nothing arrives after a minute or two, the step 4 restart most likely hasn't
taken effect - redo the step 4 check, ask the user to restart again and wait;
the plugin retries the greeting on the next successful connection. If it still
won't connect, see
[Troubleshooting](#troubleshooting).

## Troubleshooting

Stay on the **same target** the user picked; never switch targets, invent codes,
or reuse a spent activation code. Match the symptom, act, then resume and finish
at step 5 (the user confirms the plugin's greeting reached ClawChat).

- **Code not pairable (step 0).** `expired` / `invalid` -> ask for a fresh code
  and re-run step 0. `paired` -> already used; ask whether to re-pair with a fresh
  code or repair the existing agent (handle as the activation/auth case below).

- **Target command missing (step 1).** Source the Hermes venv (re-run the
  step 1 block, which tries `/opt/hermes/.venv`, then
  `~/.hermes/hermes-agent/venv` and `.venv`; on Windows the step 1 *(Windows)*
  block, which puts the venv's `Scripts` folder on `PATH`) or call the absolute
  binary, then retry. If the runtime genuinely isn't installed, stop and report it - don't
  install the other target instead.

- **Install fails (step 2).** Re-read stderr. OpenClaw is slow - wait, don't
  retry on idle. On a **network / GitHub-raw error**, use the **direct host
  install** from step 2. A **security-scan refusal or prompt** is the next case.
  If Hermes' `hermes plugins install` **did not finish within 120s and was
  stopped** on a slow but working network, re-run the same `install` with
  `--install-timeout 300` (or set `CLAWCHAT_INSTALL_TIMEOUT_SECONDS=300`).
  Otherwise retry the same `install` once and report stderr. Don't reach for
  `--force` here: it only reinstalls a plugin that is already installed, and it
  does not get past the host's scan either.

- **OpenClaw: host too old / prerelease refused / legacy config.** For
  `host_too_old` or `prerelease_refused`, ask the owner to upgrade OpenClaw
  (`npm install -g openclaw@latest` or its own updater, e.g. `openclaw update`),
  then rerun the same installer. Upgrading is the owner's decision; don't try
  other plugin versions. For `legacy_config`, show the owner the listed keys
  (or run `openclaw config validate` to list them). The owner backs up the
  config and runs `openclaw doctor --fix`, then reruns the installer. Never
  edit their config yourself.

- **The host's scanner blocked the install (Hermes).** Current ClawChat is
  safe on v0.21.6+; older hosts may give *caution* (often comment/doc matches).
  Report `plugin_install_failed:scan_blocked`: the CLI already prints it;
  report it yourself for direct host installs. A CLI `SCAN_BLOCKED` leaves
  nothing installed/replaced. A terminal host may wait indefinitely at
  `Install anyway? ... [y/N]`. Stop and relay the verdict, finding categories /
  counts and `Scan:` source to the owner; require the source to be
  `clawling/clawchat-plugin-hermes-agent`. Ask:
  "This is the official ClawChat plugin from `clawling/clawchat-plugin-hermes-agent`.
  The scan flagged `<categories/counts>`, mostly matches in comments and docs
  (use the report's actual findings). Do you approve continuing?"
  “这是 ClawChat 官方插件，来源 `clawling/clawchat-plugin-hermes-agent`。
  扫描命中 `<类别/数量>`，多为注释和文档匹配（以报告为准）。您是否同意继续？”

  Continue only if the owner explicitly approves: at the prompt the **owner**
  answers `y`; after the CLI stops or in an agent-only terminal, run
  `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`
  only when the owner explicitly tells you to. This accepts *caution*;
  *dangerous* cannot be overridden — report it to maintainers. Never override it on your own:
  don't type `y` yourself, don't add `--force` unasked, or switch to a mirror /
  unreviewed source. **Unattended install**: stop and report rather than forcing.

- <a id="hermes-dependencies"></a>**Hermes dependency preparation is slow / fails.**
  `enable` resolves the host and all enabled plugins with `uv lock`, then
  `uv sync` into a new environment; it switches only after success. Each stage
  has a 30-minute host limit; a 180-second timeout is your tool's: allow ≥15
  minutes or background it; never run two at once. Failure keeps the old
  environment/config and ClawChat disabled, so retrying is safe.
  `Enable 'clawchat' refused: …` contains the cause; host timeouts say
  `uv lock|sync timed out after 1800s`; other errors
  say `uv <stage> exited <code>: <uv output tail>`.

  Set these only for this command, never global pip/uv/npm config:

  - Slow package index: ask the owner for an approved mirror, then
    `UV_DEFAULT_INDEX=<mirror-url> hermes plugins enable clawchat`; do not pick
    one yourself. `UV_INDEX_URL` is also passed through. Index changes cannot
    fix dependencies fetched from git.
  - Slow link: `UV_HTTP_TIMEOUT=120 hermes plugins enable clawchat`.
  - TLS `unknown issuer` / `unable to get local issuer certificate` (proxy or
    self-signed root): `UV_NATIVE_TLS=1 hermes plugins enable clawchat` uses
    system certificates. Never disable verification. `HTTPS_PROXY` and
    `SSL_CERT_FILE` are inherited too.
  - `ECONNRESET` / `connection reset`: retry the same command once after it
    exits; if it still fails, show the owner the original error.

  PowerShell (one call, restoring the value): `$o = $env:UV_NATIVE_TLS;
  $env:UV_NATIVE_TLS = "1"; hermes plugins enable clawchat; $env:UV_NATIVE_TLS = $o`.
  Report the result with the categories [at the top](#install-clawchat-plugin).

- **Windows: install or update fails because files in the plugin folder are
  in use.** A shell or process whose working directory is inside the plugin
  folder (e.g. `%LOCALAPPDATA%\hermes\plugins\clawchat`) locks it. `cd` out of
  it or close that shell / process, then rerun the same command.

- **Activation fails (step 3: validation / auth / 401 / 403 / non-zero exit).**
  Codes are single-use - don't retry the same one. Report the error verbatim, ask
  for a fresh code, run the step 3 command once, continue. One exception: if the
  failure is a network / TLS timeout rather than an answer from the server, the
  code may still be unspent. Re-run the step 0 check first: `pairable: true`
  means run the same step 3 command once more; `paired` means it was spent, so
  ask for a fresh code.

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

- **The user deleted their agent, asked for a new one, and the old one came
  back** (same name, old chat history, `user_id_status: deleted` at step 0).
  Deleting an agent in the app does not clear the identity stored on this
  machine, and the server keeps the record: replaying that id **revives** the
  deleted agent instead of minting a new one. A fresh code does not help - every
  code behaves the same way while the id is still stored. Clear the stored
  `user_id` (Hermes: `platforms.clawchat.extra.user_id`, plus `agent_id` /
  `owner_user_id` in the same `extra` block; OpenClaw:
  `channels.clawchat-plugin-openclaw.userId` **and** `token`, since the id is
  recovered from the token), or use the `--new-account` intent from step 3, then
  activate with a fresh code. Confirm with the user before doing either - if
  they wanted their old agent back, the revival was the desired outcome.

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
  `grep -A6 'clawchat:' "${HERMES_HOME:-$HOME/.hermes}/profiles/<name>/config.yaml"`
  (PowerShell: the same file under `%LOCALAPPDATA%\hermes` when `HERMES_HOME` is
  unset) -
  `extra.profile` must be `<name>`, and two profiles must never share
  `extra.user_id`. If one gateway serves several profiles, also check the plugin
  is `0.14.0-89` or newer (step 3).

- **Activated but no greeting / not connected (step 5).** Almost always the
  step 4 restart hasn't taken effect - run the step 4 check, **ask the user to
  restart the agent** and wait; the plugin still owes the greeting and re-sends
  it on the next successful connection. Never paper over it by greeting by hand -
  that is how users end up with two greetings. If still disconnected after a
  verified restart, ask for a fresh code, run step 3 once, restart again, then
  redo step 5.

- **Connected, but no greeting and the log shows model / provider timeouts.**
  The greeting is a model turn, so a model provider that times out or fails
  never produces it. Check the agent's model provider (key, quota,
  reachability) with the owner. Restarting will not help until the provider
  answers. A newly created Hermes profile starts with no model key of its own,
  so connected-but-silent on a new profile usually means exactly this.

- **OpenClaw inside QClaw: installed, but the gateway says `plugin not found`.**
  QClaw (a desktop app that bundles OpenClaw) keeps its state in `~/.qclaw/`
  (Windows: `C:\Users\<user>\.qclaw\`) and only loads plugins listed in
  `plugins.load.paths` of `~/.qclaw/openclaw.json`. The step 2 `install` adds the
  plugin there itself and says so (`QClaw detected: ...`). If you installed
  directly via the host, or the entry is missing, add the installed package
  directory to that `plugins.load.paths` list (keep QClaw's own entries):
  `~/.qclaw/npm/projects/clawling-clawchat-plugin-openclaw-<hash>/node_modules/@clawling/clawchat-plugin-openclaw`.
  Then ask the user to restart QClaw (step 4). `openclaw doctor --fix` may remove the entry as
  stale; if the plugin disappears after it, rerun the step 2 `install`.

- **Hermes: `plugins update` refuses because the plugin "is pinned"** (it was
  installed pinned to a revision, e.g. from a catalog). The CLI's `update`,
  with or without `--force`, cannot move that pin. Remove the pinned copy with
  `hermes plugins remove clawchat` (add `-p <name>` for a profile) and rerun the
  step 2 `install`. Activation credentials live outside the plugin folder, so no
  new code is needed - just restart (step 4).

- **Plugin files missing / stale / corrupted (any step).** Run
  [update](#update-or-repair-later); if the plugin is installed and its version
  is already current, rerun with `--force` to reinstall. That is the only job of
  `--force` - never use it to get past a scanner refusal.

## Update or repair later

Use the same target that was installed (`openclaw` or `hermes`):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target <openclaw|hermes>
```

If local plugin files look corrupted while the version is already current, add
`--force` to reinstall (only for a plugin that is already installed; the host
still scans it, so it is not a way past a scanner refusal):

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target <openclaw|hermes> --force
```
