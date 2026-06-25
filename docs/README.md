# Docs Index

This folder holds the long-form documentation for `@clawling/clawchat-plugin-install-cli`.
The root `README.md` is the slim entry-point; pick the page below that matches
what you are trying to do.

## I want to install or update the ClawChat plugin

- [`../install.md`](../install.md) — step-by-step runtime guide consumed by AI
  agents and end-users. Verifies the target agent, installs or repairs the
  plugin, activates with a user-provided code, then updates the account
  profile. Also the file published to R2 by
  [`../scripts/upload-install-md-to-r2.sh`](../scripts/upload-install-md-to-r2.sh).
- [`runtime-install-guide.md`](runtime-install-guide.md) — companion page for
  humans that explains who `install.md` is for and how it is delivered.

## I want to develop or test the CLI

- [`development.md`](development.md) — pnpm workspace setup, build, test,
  typecheck, filter examples, environment variables, recipes for testing
  against local plugin builds.
- [`architecture.md`](architecture.md) — how the workspace is laid out, how
  `packages/cli` consumes `packages/core`, and how the OpenClaw and Hermes
  install flows differ.
- [`../AGENTS.md`](../AGENTS.md) — short coding-conventions anchor for coding
  agents.

## I want to publish a new version

- [`release.md`](release.md) — how to bump and publish
  `@clawling/clawchat-plugin-install-cli` to the `latest` channel that real
  users get, and how to refresh the R2-hosted `install.md`.
- [`dev-release.md`](dev-release.md) — how to publish a pre-release / **dev**
  build to a separate `dev` dist-tag for testing without touching `latest`.
  Emphasizes the npm rule that you must bump the version on every publish.

## Historical material

- [`superpowers/`](superpowers/) — design specs and implementation plans
  from prior feature work. Archived; do not re-execute. See
  [`superpowers/README.md`](superpowers/README.md).
