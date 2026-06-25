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
configured bucket. The release procedure in [`release.md`](release.md)
describes when to run this upload.

The bucket configuration lives in `scripts/.env.r2` (template:
`scripts/.env.r2.example`).

## What the guide covers

The four sections of `install.md`:

1. **Verify the target agent** — sanity-check that `openclaw` or `hermes` is
   reachable on `PATH`, including auto-activating a Hermes virtualenv if
   present.
2. **Install the plugin** — run
   `npx -y @clawling/clawchat-plugin-install-cli@latest install --target <target>`.
3. **Activate with the user-provided code** — invoke the target plugin's
   activation command exactly once with a fresh code.
4. **Update the ClawChat account profile** — call the agent's
   `clawchat_update_account_profile` tool so the connected account is
   identifiable to the user.

It also includes a *Reactivation repair* section that distinguishes auth
errors (re-run step 3 with a new code) from corrupted-files errors (run
`update` and, if needed, `update --force`), plus an *Update or repair later*
section that documents the same `update` command with `--force` as a
documented repair path.

## Editing rules

- `install.md` is the canonical wording for everything end-users see at
  install time. Keep it short, imperative, and target-symmetric (OpenClaw
  block + Hermes block per step).
- Any factual change (commands, flags, environment variables, activation
  syntax) must match the actual CLI behavior in `packages/cli/src/cli.ts`
  and the installers in `packages/core/src/installers/`. The CLI-facing
  details are also mirrored in [`architecture.md`](architecture.md).
- Do not rename or move the file at the repo root — the upload script reads
  it from `$REPO_ROOT/install.md`.
