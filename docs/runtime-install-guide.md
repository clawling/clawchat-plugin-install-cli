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

`install.md` is uploaded to a public R2 bucket by
[`../scripts/upload-install-md-to-r2.sh`](../scripts/upload-install-md-to-r2.sh).
The script copies the local file to the key `clawchat/install.md` under the
configured bucket, alongside the two one-shot installer scripts —
`clawchat/install-clawchat.sh` and `clawchat/install-clawchat.ps1`. All three
are published together; adding a step to the guide that a script also performs
means updating both scripts. The release procedure in [`release.md`](release.md)
describes when to run this upload.

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
   with a documented fallback to installing directly via the host when the
   GitHub-raw fetch is blocked.
3. **Activate (single-use code)** — invoke the target plugin's activation command
   exactly once, including the Hermes 0.12 `clawchat_cli.py` fallback and the
   `--new-account` vs `--repair` decision.
4. **Restart the agent — the user must do this** — the plugin's tools and live
   connection only exist after the host process restarts.
5. **Confirm the greeting arrived** — optionally call
   `clawchat_update_account_profile`, then have the user confirm the plugin's
   own greeting reached their ClawChat app.

Then:

- **Troubleshooting** — symptom-matched cases (code not pairable, missing target
  command, install failure, activation/auth failure, `code: 16001` /
  `agent not found`, `owner_mismatch`, wrong Hermes profile, no greeting,
  corrupted plugin files), each resuming the numbered flow.
- **Update or repair later** — the `update --target <target>` command, plus
  `--force` as the documented reinstall/repair path.

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
