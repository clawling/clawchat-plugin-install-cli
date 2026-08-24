# Docs Index

This folder holds the long-form documentation for `@clawling/clawchat-plugin-install-cli`.
The root `README.md` is the slim entry-point; pick the page below that matches
what you are trying to do.

## I want to install or update the ClawChat plugin

- [`../install.md`](../install.md) — step-by-step runtime guide consumed by AI
  agents and end-users. Steps 0–5: pre-check the connect code, verify the target
  agent, install or repair the plugin, activate with a user-provided code, have
  the user restart the agent, and confirm the plugin's own greeting arrived —
  followed by Troubleshooting and "Update or repair later" sections. Also the
  file published to R2 by
  [`../scripts/upload-install-md-to-r2.sh`](../scripts/upload-install-md-to-r2.sh),
  together with both one-shot installer scripts.
- [`runtime-install-guide.md`](runtime-install-guide.md) — companion page for
  humans that explains who `install.md` is for and how it is delivered.

## I want to develop or test the CLI

- [`development.md`](development.md) — pnpm workspace setup, build, test,
  typecheck, filter examples, environment variables, recipes for testing
  against local plugin builds.
- [`architecture.md`](architecture.md) — how the workspace is laid out, how
  `packages/cli` consumes `packages/core`, how the OpenClaw and Hermes install
  flows differ, and the two runtime hosting subsystems this repo serves to the
  agent adapters (`skills/` and `livewares/`).
- [`../AGENTS.md`](../AGENTS.md) — short coding-conventions anchor for coding
  agents.

## I want to change a skill or the Liveware Sample

- [`../skills/README.md`](../skills/README.md) — the canonical `SKILL.md` tree,
  its generated `manifest.json`, and the `skills-vX.Y.Z` release/versioning
  workflow the two adapters pin to.
- The `livewares/` tree (the Liveware Sample app plus its own generated
  manifest) is documented in the "Livewares hosting subsystem" section of
  [`architecture.md`](architecture.md); it ships on the same tag.

## I want to publish a new version

- [`release.md`](release.md) — how to bump and publish
  `@clawling/clawchat-plugin-install-cli` to the `latest` channel that real
  users get, and how to refresh the R2-hosted `install.md`.
- [`dev-release.md`](dev-release.md) — how to publish a pre-release / **dev**
  build to a separate `dev` dist-tag for testing without touching `latest`.
  Emphasizes the npm rule that you must bump the version on every publish.
