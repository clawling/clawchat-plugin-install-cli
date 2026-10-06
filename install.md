# Install ClawChat Plugin

> Runtime guide for end-users and AI agents at install time. This file is the
> source of truth; the connection wiki (https://agent-connection.clawling.com/start.md)
> serves a versioned mirror of it, and a copy is published to R2 by
> `scripts/upload-install-md-to-r2.sh` (see `docs/runtime-install-guide.md`).
>
> **Something here was wrong, missing, or cost you time?** File a field report the
> way https://agent-connection.clawling.com/start.md Appendix B describes — that is
> what the next agent on this path reads. Do not leave it in a terminal transcript.

ClawChat is a chat app for talking to supported agent runtimes. These steps
install and pair the ClawChat plugin for **one** target - `openclaw` **or**
`hermes`. Each code block is one terminal call; use your target's block.

**On Windows, use PowerShell** - not `cmd.exe`. The `npx`, `openclaw`, and
`hermes` commands below are identical there; only five blocks differ and each
has a PowerShell twin right next to the bash one: the step 0 pre-check, and in
step 1 the Hermes venv activation, the Hermes profile check and the `HERMES_HOME`
export, plus the Hermes 0.12 fallback in step 3. Never
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
If that update fails only because it cannot fetch plugin metadata from GitHub,
the installed copy still works: go on to step 3 and update later.

**Hermes with more than one profile** - confirm which profile you are on before
installing or activating. Every ClawChat identity is keyed on the active
`HERMES_HOME`, so a mis-targeted command pairs a *different* agent with no error
and burns the single-use code:

```bash
root="${HERMES_HOME:-$HOME/.hermes}"
echo "HERMES_HOME=${HERMES_HOME:-<unset>}"
cat "$root/active_profile" 2>/dev/null || echo "active_profile=default"
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
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}/profiles/<name>"  # POSIX
```

```powershell
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$env:HERMES_HOME = Join-Path $root 'profiles\<name>'                # Windows
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

Each block is a separate terminal call, so a venv you activated in step 1 is
gone here. If `npx` fails with `spawn hermes ENOENT`, put the venv on `PATH`
in the same call: `PATH="/opt/hermes/.venv/bin:$PATH" npx -y
@clawling/clawchat-plugin-install-cli@latest install --target hermes`
(PowerShell: prepend the venv's `Scripts` folder to `$env:PATH` first, as in
the step 1 *(Windows)* block, in the same call).

The CLI delegates to the host's plugin manager (OpenClaw -> `openclaw plugins
install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install`,
plus `--accept-capabilities` when the host advertises it, which OpenClaw 2026.8+
requires; Hermes -> checks remote metadata + Hermes version, then
`hermes plugins install clawling/clawchat-plugin-hermes-agent`). Skill content is
bundled in the plugin.

**If the install fails on a network / GitHub error** - e.g.
`raw.githubusercontent.com` times out while npm and `git` to github.com still
work (common in locked-down environments) - do **not** just rerun with `--force`,
which takes the same path. Install **directly via the host**, which bypasses the
CLI's GitHub-raw fetch:

```bash
# Hermes
hermes plugins install clawling/clawchat-plugin-hermes-agent --enable
# OpenClaw 2026.8 and newer
openclaw plugins install @clawling/clawchat-plugin-openclaw --force --accept-capabilities
# OpenClaw older than 2026.8 (it rejects --accept-capabilities as an unknown option)
openclaw plugins install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install
```

On OpenClaw 2026.8+ both flags are required: `--force` confirms the npm (non-ClawHub)
source, and `--accept-capabilities` consents to the plugin's declared capabilities.
Without them the install is cancelled or rejected and the plugin never lands. Run
`openclaw plugins install --help` if you are unsure which line your host wants.

The direct Hermes install also clones from GitHub, so it does not help when
GitHub is unreachable altogether (DNS failures, connection resets, certificate
revocation-check errors). Never turn off certificate verification to get past
that; stop and ask the owner for a source this machine can reach.

Then continue to step 3.

**Hermes stops on its security scan - expected for this plugin.** Hermes 0.20.3
and newer scan every third-party plugin before installing it, and for ClawChat
the scan reports a couple of dozen findings (matches in comments and docs) with
a *caution* verdict and a `Decision: BLOCKED` line. Through the `npx` command
the install then fails with `SCAN_BLOCKED`; a direct `hermes plugins install` in
a real terminal instead **waits** at `Install anyway? ... [y/N]`. Either way it
is the **owner's** decision, not yours: don't answer the prompt, don't add
`--force`, and don't sit on it silently - see
[Troubleshooting](#troubleshooting) before doing anything else.

**Hermes: check the plugin is enabled before you activate.** `hermes plugins
list` (with `-p <name>` for a profile) must show `clawchat` as **enabled**. If
it shows disabled, or `hermes clawchat` is an unknown command, the host could
not rebuild its plugin environment: run `hermes plugins enable clawchat` and
read its error, which may name an unrelated dependency. If the plugin was
disabled by the security scan, that is the owner's call (see above), not
something to undo. Don't activate a disabled plugin - the step 4 restart would
load no ClawChat.

## 3. Activate (single-use code)

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
step 2 `install` command. Hermes 0.12 fallback:
`python "${HERMES_HOME:-$HOME/.hermes}/plugins/clawchat/clawchat_cli.py" activate CLAWCHAT_CODE_GOES_HERE`.
Run it with the **Hermes venv's** Python (e.g. `/opt/hermes/.venv/bin/python`;
on Windows the venv's `Scripts\python.exe`), not the shell's own `python`:
activation needs `hermes_cli` and PyYAML, which only the Hermes venv has.

*(Windows)* same 0.12 fallback:

```powershell
# Native Windows: %LOCALAPPDATA%\hermes. %USERPROFILE%\.hermes is the POSIX /
# WSL2 layout - activating there writes credentials Hermes never reads.
$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
python (Join-Path $root 'plugins\clawchat\clawchat_cli.py') activate CLAWCHAT_CODE_GOES_HERE
```

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
4. Restart the **default** gateway: `hermes gateway restart`, with no `-p` and
   `HERMES_HOME` unset (or pointing at the Hermes root). The multiplexer only
   picks up profiles when it starts, so a profile added or activated afterwards
   stays offline until this restart - which also restarts every other profile
   it serves, so ask the owner first.

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

**Required.** ClawChat's tools and live connection only become usable after the
agent process **restarts** to load the newly installed plugin and activation
credentials. Until then the agent cannot connect, so the plugin's automatic
greeting never fires and the profile call in step 5 would fail - the ClawChat
tools aren't registered yet.

Hermes activation schedules this restart automatically, but the `Hermes restart
scheduled` line proves nothing: the restart runs detached and nobody checks its
result. In many environments the running agent also **cannot restart itself**
(the restart needs the user's approval). Do **not** block or loop trying to
self-restart.

Instead, **ask the user to restart the agent themselves** - the OpenClaw or
Hermes process that was just activated - and wait for it to come back.

**Then verify the gateway actually restarted after the activation.** OpenClaw:
`openclaw channels status --probe` shows the ClawChat channel running and
connected. Hermes: `hermes gateway status` (with `-p <name>` for a profile)
shows a gateway started *after* the activation, or the Hermes log has a
`clawchat state -> ready` line from after it. If it did not restart:

- **Hermes: "the default gateway is running as a profile multiplexer"** - one
  gateway, owned by the default profile, serves several profiles and refuses a
  per-profile restart. Restarting it (`hermes gateway restart`, no `-p`) also
  restarts every other profile it serves - ask the owner first.
- **Hermes: the profile has no gateway service yet** - for a named profile,
  prefer serving it from the default profile's multiplexed gateway and
  restarting that one (see the end of step 3); without multiplexing, install
  and start one for the profile: `hermes -p <name> gateway install`, then
  `hermes -p <name> gateway start`. Plugin `0.14.0-100` and newer print both,
  preferred first; older ones print only the per-profile pair.
  On a single-profile host, install and start the default gateway:
  `hermes gateway install`, then `hermes gateway start`.
- **Windows: refused because another gateway is already running** - a second,
  separately installed Hermes gateway holds it. Tell the owner which one is
  running and let them decide; don't stop it yourself.
- **Linux / WSL2: the agent goes offline again after the machine reboots** -
  the gateway's systemd user service only starts at boot when lingering is on
  for the user. Ask the owner to run `loginctl enable-linger "$USER"`. On WSL2,
  systemd itself must be on as well (`[boot]` `systemd=true` in
  `/etc/wsl.conf`, then `wsl --shutdown` from Windows) - that restarts the
  whole WSL VM, so it is the owner's call.
- **The restart waits for open sessions to finish** - ask the owner before
  restarting the service directly; that ends those sessions.

A restart notice from the host itself ("gateway restarted", "back online") is
not the plugin's greeting. Once the gateway is verified up, continue to step 5.

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

- **Target command missing (step 1).** Source the Hermes venv
  (`source /opt/hermes/.venv/bin/activate`; on Windows use the step 1 *(Windows)*
  block, which puts `.venv\Scripts` on `PATH`) or call the absolute binary, then
  retry. If the runtime genuinely isn't installed, stop and report it - don't
  install the other target instead.

- **Install fails (step 2).** Re-read stderr. OpenClaw is slow - wait, don't
  retry on idle. On a **network / GitHub-raw error**, use the **direct host
  install** from step 2. A **security-scan refusal or prompt** is the next case.
  Otherwise retry the same `install` once and report stderr. Don't reach for
  `--force` here: it only reinstalls a plugin that is already installed, and it
  does not get past the host's scan either.

- **The host's scanner blocked the install (Hermes).** Hermes 0.20.3+ scans
  every third-party plugin before installing it. For ClawChat a *caution*
  verdict is **expected**: a couple of dozen findings, all matches in comments
  and docs, ending in `Decision: BLOCKED ... Use --force to override.` That
  line is the scanner's generic wording, not an instruction to you. What
  follows depends on how Hermes ran:
  - **Through the `npx` CLI** (it never hands Hermes a terminal): the CLI exits
    with `SCAN_BLOCKED` and nothing is installed or replaced. The CLI never
    passes `--force` on the owner's behalf, and its own `--force` does not
    change that.
  - **`hermes plugins install` in a real terminal:** Hermes prints the report
    and waits at `Install anyway? Only continue if you trust the source. [y/N]`
    with no timeout. An agent that just waits there stalls the install
    indefinitely.

  This is a review gate, not a network error, so retrying or switching paths is
  wrong. Stop and **relay it to the owner**: the verdict, a short summary of the
  findings, and the source on the report's `Scan:` line, which must be
  `clawling/clawchat-plugin-hermes-agent` (anything else: stop, don't install).
  Then wait for the owner. Continue only if the owner explicitly approves
  installing past it: at the prompt the **owner** answers `y`; if the prompt is
  in a terminal only you can reach, or the CLI already stopped, run
  `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`
  only when the owner explicitly tells you to (`--force` accepts a caution
  verdict; a *dangerous* one is refused with no prompt and `--force` does not
  override it - report the findings instead). Never override it on your own:
  don't type `y` yourself, don't add `--force` unasked, and never switch to a
  mirror or another unreviewed source to get around it. **Unattended install**
  (no owner reachable, CI, a scheduled job): stop and report to the owner
  rather than forcing; the install stays undone until they decide.

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
