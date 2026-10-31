# Runtime install guide (`install.md`)

The file [`../install.md`](../install.md) at the repo root is not a
contributor doc. It is the **runtime** install guide that ClawChat's plugin
delivery pipeline ships to its consumers.

## Audience

- An AI agent that has been asked to set up ClawChat support on an OpenClaw
  or Hermes runtime. The guide is written in short, terminal-by-terminal
  steps so the agent can execute it deterministically.
- A human end-user following the same steps by hand.

## How it is delivered

`install.md` reaches readers by two routes:

1. **The connection wiki** (`https://agent-connection.clawling.com`) inlines a
   committed, `sha256`-stamped mirror of this file into its official install
   pages. The wiki does **not** follow this repository automatically: its build
   never touches the network, so a wiki maintainer runs the wiki's separate
   pull step against this repository's public `main`, reviews and commits the
   refreshed mirror, then builds and deploys the wiki. Merging the change
   into `main` (via PR) is a prerequisite for that, not the publication itself — until the wiki is
   re-pulled and redeployed it keeps serving the previous copy. The mirror is
   never hand-edited on the wiki side (its build rejects a hand edit).
2. **R2** — [`../scripts/upload-install-md-to-r2.sh`](../scripts/upload-install-md-to-r2.sh)
   copies the file from a clean checkout of a release tag on `main` to the key
   `clawchat/install.md`, alongside
   `clawchat/install-clawchat.sh`, `clawchat/install-clawchat.ps1` and
   `clawchat/agent-protocol.md` (four objects, always published together). This
   copy serves older app builds that still point at it directly. The release
   procedure in [`release.md`](release.md) describes when to run this upload.

The bucket configuration lives in `scripts/.env.r2` (template:
`scripts/.env.r2.example`).

## What the guide covers

`install.md` runs from step 0 to step 5, then closes with two reference
sections. The stated goal throughout is a paired agent that **greets the user by
itself** inside ClawChat — that arriving message, not a terminal line, is the
success signal.

0. **Check the code is pairable** — a `POST /v1/agents/connect/check` pre-check
   that does *not* consume the single-use code, optionally carrying a stored
   `user_id` to get a `user_id_status` verdict.
1. **Verify the target and check for an existing install** — is `openclaw` /
   `hermes` on `PATH` (auto-activating a Hermes virtualenv if needed), is
   ClawChat already installed, and — for Hermes — which profile is active.
2. **Install** — run
   `npx -y @clawling/clawchat-plugin-install-cli@latest install --target <target>`,
   with automatic Hermes fallback to host cloning when metadata transport
   fails on a fresh/forced install, plus a manual host path if the CLI still
   fails. Hermes enablement prepares dependencies non-interactively; the guide
   gives command timeout, index, TLS and network recovery instructions. The CLI
   requires Node.js 18+ with npx; Hermes without Node uses direct host installation,
   then the enable check and activation, which need no Node.
3. **Activate (single-use code)** — invoke the target plugin's activation command
   exactly once (Hermes v0.12.0, which has no `hermes clawchat` command, is
   sent to the Hermes plugin's activation guide), including the
   `--new-account` vs `--repair` decision. Both targets document that decision:
   OpenClaw carries the intents on its `/clawchat-activate` runtime slash
   command, since `channels add` takes no flags of its own. On a real terminal
   OpenClaw asks the operator instead of refusing; an agent or CI driving the
   install gets the refusal, so the guide tells the agent to state the intent
   up front.
4. **Restart the agent — the user must do this** — OpenClaw probes first
   (`openclaw channels status --probe`): activation hot-reloads the channel, so
   when the probe shows it running and connected the guide skips the restart.
   Hermes first waits for readiness (including multiplexed profile pickup);
   otherwise the host process must restart to load the plugin and credentials.
   The Hermes "restart scheduled" line is not proof (the restart runs detached, unchecked), so the
   step ends by verifying the gateway came back after activation, with branches
   for a multiplexed gateway, a profile with no gateway service, a second
   Windows gateway, and a restart waiting on open sessions. In containers without
   systemd, restart can run in the foreground indefinitely; the owner restarts
   the container or the process running `hermes gateway run` instead.
5. **Confirm the greeting arrived** — optionally call
   `clawchat_update_account_profile`, then have the user confirm the plugin's
   own greeting reached their ClawChat app.

Then:

- **Troubleshooting** — symptom-matched cases (code not pairable, missing target
  command, install failure, a Hermes security-scan refusal, a Windows plugin
  folder locked by a shell, activation/auth failure, `code: 16001` /
  `agent not found`, `owner_mismatch`, a deleted agent revived instead of
  replaced, wrong Hermes profile, no greeting, model/provider timeouts, a pinned
  Hermes plugin that `update` refuses, corrupted plugin files), each resuming the
  numbered flow. A scan refusal is an owner decision: the guide never tells the
  agent to override it. Current ClawChat is safe on Hermes v0.21.6+; older hosts
  may give *caution*
  (with a `[y/N]` prompt on a terminal). The agent relays the actual finding
  categories/counts, Hermes version, verdict and official `Scan:` source to the
  owner for caution approval; dangerous is refused. It uses the host's `--force`
  only on the owner's explicit instruction. Unattended
  installs stop and report.
- **Update or repair later** — the `update --target <target>` command, plus
  `--force` as the documented reinstall/repair path for an already-installed
  plugin. It only reinstalls and never gets past the host's scan (for Hermes
  the CLI never hands the host's `--force` a scan decision), which is why the
  guide never offers it for a failed install.

`install.md` asks wiki-routed agents holding a pairing code to forward fixed progress reasons to `/hello` once per reason, best-effort.

Hermes support follows the plugin's minimum (currently v0.12.0), excluding
v0.20.3–v0.20.6: their install scan refuses ClawChat. The CLI checks this before
install/update, including metadata fallback and before GitHub ref cloning, and
reports `host_too_old` with advice to ask the owner for v0.21.6+ (`hermes update`).

## Editing rules

- `install.md` is the canonical wording for everything end-users see at
  install time. Keep it short, imperative, and target-symmetric (OpenClaw
  block + Hermes block per step).
- Windows readers use PowerShell. Do **not** add a *(Windows)* twin for a
  block that runs verbatim there — `npx`, `openclaw`, and `hermes` calls all
  do. Only shell-specific constructs need one: POSIX parameter expansion
  (`${VAR:-default}`), `command -v`, `source`, `.venv/bin` paths, and `curl`
  (a `Invoke-WebRequest` alias in PowerShell, with different flags). The
  intro lists which blocks have a twin — keep that list in sync when adding
  or removing one.
- Any factual change (commands, flags, environment variables, activation
  syntax) must match the actual CLI behavior in `packages/cli/src/cli.ts`
  and the installers in `packages/core/src/installers/`. The CLI-facing
  details are also mirrored in [`architecture.md`](architecture.md).
- Do not rename or move the file at the repo root — the upload script reads
  it from `$REPO_ROOT/install.md`.
