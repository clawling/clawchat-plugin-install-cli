# @clawling/clawchat-plugin-install-core

Internal library for `@clawling/clawchat-plugin-install-cli`. Not published to npm.

## Status

- Consumed only by the workspace sibling `packages/cli`.
- Inlined into the published CLI bundle via the `tsdown` alias in
  `packages/cli/tsdown.config.ts` (`alwaysBundle: ["@clawling/clawchat-plugin-install-core"]`).
- No `publishConfig`; treat the package as workspace-only.

## What lives here

- `src/installers/openclaw.ts`, `src/installers/hermes.ts` — the install and
  update flows the CLI delegates to. The CLI's two commands (`install`,
  `update`) each call exactly one of these four functions.
- `src/installers/metadata.ts` — YAML/JSON parsers for the Hermes
  `plugin.yaml` artifact, the OpenClaw `plugins list --json` output, and
  the version-comparison helpers (`isVersionOlder`,
  `assertVersionSatisfiesRange`).
- `src/installers/run.ts` — `runCommand` / `captureCommand` wrappers around
  `child_process.spawnSync` with shell-metacharacter rejection.
- `src/installers/archive.ts` — `tar`-based helpers used by tests.
- `src/auth/*` — readers for OpenClaw `openclaw.json` and Hermes `.env`.
  Exposed for downstream code; not invoked by the published CLI commands.
- `src/methods/*` and `src/http/*` — programmatic ClawChat API surface
  (`callClawchatMethod`). Same status as the auth helpers: covered by
  tests, not used by the CLI.
- `src/config.ts`, `src/errors.ts` — shared constants and the
  `ClawchatError` class.

## How to develop against it

See [`../../docs/development.md`](../../docs/development.md) for the
pnpm-workspace setup. Local edits to `core` are picked up by the CLI
without a rebuild because the alias points at `src/`.

Run only this package's tests with:

```bash
pnpm --filter @clawling/clawchat-plugin-install-core test
```
