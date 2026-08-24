# Development

How to set up the workspace, run tests, and iterate locally.

## Prerequisites

- Node.js 18 or newer (`package.json:engines`).
- `pnpm` 9 — declared via `packageManager` in the root `package.json`. The
  easiest way to get it is `corepack enable && corepack prepare pnpm@9.0.0 --activate`.
- For end-to-end test of the bootstrap script: a POSIX shell.
- For exercising the real install flow: a local `openclaw` or `hermes` CLI.

## First-time setup

```bash
pnpm install
```

This installs dependencies for both workspace packages and links
`packages/core` into `packages/cli` via the workspace protocol.

## Common commands

Run these from the repo root unless noted.

| Command | What it does |
|---------|--------------|
| `pnpm build` | `pnpm -r build` — `tsdown` produces `dist/index.cjs` and `dist/index.d.cts` for each package |
| `pnpm typecheck` | `pnpm -r typecheck` — `tsc --noEmit` with the shared strict settings in `tsconfig.base.json` |
| `pnpm test` | `pnpm -r test` — Vitest in each package, once |
| `pnpm clean` | Remove `dist/` from each package |
| `pnpm skills:manifest` | `node scripts/build-skills-manifest.mjs` — regenerate `skills/manifest.json` from the `SKILL.md` tree after editing a skill |
| `pnpm skills:check` | `node scripts/build-skills-manifest.mjs --check` — CI guard that fails when the committed manifest is stale |
| `pnpm skills:sync` | `node scripts/sync-skills.mjs` — copy the skills tree + manifest into the sibling plugin repos (`--hermes` / `--openclaw` override the default sibling paths) |
| `pnpm livewares:manifest` | `node scripts/build-livewares-manifest.mjs` — regenerate `livewares/manifest.json` after editing the Liveware Sample app |
| `pnpm livewares:check` | `node scripts/build-livewares-manifest.mjs --check` — CI guard that fails when that manifest is stale |
| `pnpm test:scripts` | `node --test scripts/sync-skills.test.mjs` — the sync script's own tests; `pnpm test` runs these too, after the per-package Vitest suites |
| `pnpm release:dry` | `pnpm --filter @clawling/clawchat-plugin-install-cli release:dry` — typecheck + test + build + `npm pack --dry-run` |

The `skills:*` and `livewares:*` scripts maintain the two runtime hosting
subsystems — the `skills/` markdown tree and the `livewares/` Liveware Sample app
— that this repo serves to the two agent adapters. Both manifests are generated:
never hand-edit `skills/manifest.json` or `livewares/manifest.json`. See the
"Skills hosting subsystem" and "Livewares hosting subsystem" sections of
[`architecture.md`](architecture.md) and [`../skills/README.md`](../skills/README.md)
for the full workflow.

Filter examples for working on a single package:

```bash
pnpm --filter @clawling/clawchat-plugin-install-cli test
pnpm --filter @clawling/clawchat-plugin-install-core typecheck
```

## How the CLI bundles `core`

`packages/cli/tsdown.config.ts` aliases `@clawling/clawchat-plugin-install-core` to
`../core/src/index.ts` and lists it under `deps.alwaysBundle`. This means:

- During development, the CLI imports `core` source directly (no `core` build
  is required for tests or typecheck).
- During build, `core` is inlined into the CLI bundle — the published tarball
  has no runtime dependency on `core`.

The matching Vitest alias lives in `packages/cli/vitest.config.ts`.

## Testing changes against a local plugin build

The CLI shells out to `openclaw plugins …` or `hermes plugins …` with the
package spec from `packages/core/src/config.ts`:

- `OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw"`
- `HERMES_PLUGIN_SPEC   = "clawling/clawchat-plugin-hermes-agent"`
- `HERMES_PLUGIN_NAME   = "clawchat"` (the installed-plugin identifier)

To iterate against an unreleased sibling plugin:

1. Build or stage the sibling plugin so the host plugin manager can install
   it from a local source (for OpenClaw, this is typically a packed tarball
   or `file:` ref; for Hermes, a local clone path or fork).
2. Build this CLI: `pnpm --filter @clawling/clawchat-plugin-install-cli build`.
3. Invoke directly: `node packages/cli/dist/index.cjs install --target <target>`.
4. If you need the CLI to point at a different package spec, patch
   `packages/core/src/config.ts` temporarily — there is no environment
   variable override today.

The repository contains end-to-end coverage for the bootstrap script in
`packages/cli/tests/install-script.test.ts`. The tests stand up a temporary
`PATH` with mock `openclaw`, `hermes`, and `npx` executables, so they do not
need a real host CLI.

## Environment variables observed at runtime

- `HERMES_HOME` — the Hermes root. `resolveHermesHomeRoot`
  (`packages/core/src/hermes-home.ts`) uses it when set, and otherwise falls back
  to the **platform-native** default: `~/.hermes` on POSIX,
  `%LOCALAPPDATA%\hermes` on Windows (`<home>\AppData\Local\hermes` when
  `LOCALAPPDATA` is unset). Both the Hermes base-URL writer
  (`baseurl/write-hermes.ts`) and the auth reader (`auth/hermes.ts`) resolve
  their `.env` path this way; the auth reader probes `$HERMES_HOME/.env` first
  and then the platform default.
- `LOCALAPPDATA` / `USERPROFILE` / `HOME` — consumed by that same platform
  resolution. `installers/openclaw.ts` additionally reads `HOME` (falling back to
  `USERPROFILE`) to decide whether a configured
  `/home/node/.openclaw/workspace` is a stale container leftover.
- `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` / `ALL_PROXY` /
  `all_proxy` — when any is set, the Hermes flow fetches `plugin.yaml` with
  `curl` instead of Node's `fetch`, which does not honour these on Node 18–23
  (`isProxyConfigured` in `packages/core/src/installers/hermes.ts`).
- `CLAWCHAT_TOKEN`, `CLAWCHAT_REFRESH_TOKEN`, `CLAWCHAT_BASE_URL`,
  `CLAWCHAT_USER_ID` — read out of the Hermes `.env` file by the auth helper (these
  are file keys, not process env vars that the CLI itself reads).
- The installers also *set* one variable on a child process:
  `GIT_TERMINAL_PROMPT=0` for the CLI-owned `git clone` in the Hermes ref flow, so
  git can never block on a credential prompt.

Every path above takes an injectable override (`homeDir`, `env`, `platform`) so
both layouts are testable without touching the real environment.

## Style

- TypeScript ESM, strict mode (`tsconfig.base.json`); no separate linter.
  Match the surrounding file's quoting, trailing-comma, and indentation
  style.
- Tests use Vitest with descriptive `describe`/`it` names that read like
  English sentences (`"updates and enables during update even when installed
  plugin is current"`).
- Conventional Commits with a package scope, for example
  `fix(core): align Hermes update command semantics`.
