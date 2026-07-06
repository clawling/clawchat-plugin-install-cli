# Architecture

This document describes how `@clawling/clawchat-plugin-install-cli` is organized
and how it installs the two ClawChat plugins. Source paths are repo-relative.

## Workspace topology

The repository is a pnpm-workspaces monorepo. The root `package.json` is
private and only orchestrates the workspace; the published artifact lives in
`packages/cli`.

```
.                                  package: @clawling/clawchat-plugin-install (private)
├── package.json                   workspace root; scripts: build, test, typecheck, clean, release:dry
├── pnpm-workspace.yaml            packages: ["packages/*"]
├── tsconfig.base.json             shared strict TS settings
├── packages/
│   ├── cli/                       package: @clawling/clawchat-plugin-install-cli (published)
│   │   ├── package.json           bin: { "clawchat": "dist/index.cjs" }
│   │   ├── tsdown.config.ts       bundles `core` into the CLI via alias
│   │   └── src/{index.ts, cli.ts, io.ts}
│   └── core/                      package: @clawling/clawchat-plugin-install-core (workspace-internal)
│       ├── package.json           no publishConfig; consumed only by `cli`
│       └── src/...
└── scripts/                       bootstrap + R2 upload helpers (not part of the npm package)
```

Only `packages/cli` is published to npm. `packages/core` is consumed via the
workspace protocol during development and inlined into the CLI bundle at build
time — see the alias in `packages/cli/tsdown.config.ts` and the
`alwaysBundle: ["@clawling/clawchat-plugin-install-core"]` entry. The CLI tarball
therefore ships a single `dist/index.cjs` with no runtime dependency on
`core`. Vitest mirrors the same alias in `packages/cli/vitest.config.ts`.

The only runtime dependency declared in `packages/cli/package.json` is
[`cac`](https://www.npmjs.com/package/cac), which is intentionally not
bundled.

## Command surface

The CLI exposes exactly two commands, both defined in
`packages/cli/src/cli.ts`:

| Command | Flags |
|---------|-------|
| `clawchat install` | `--target <openclaw\|hermes>`, `--force`, `--apibaseurl <url>`, `--wsbaseurl <url>`, `--mediabaseurl <url>`, `--activate <code>` |
| `clawchat update`  | `--target <openclaw\|hermes>`, `--force`, `--apibaseurl <url>`, `--wsbaseurl <url>`, `--mediabaseurl <url>` |

Both commands require `--target`. The allowed values are defined in
`packages/core/src/config.ts` (`TARGETS = ["openclaw", "hermes"]`); any other
value exits non-zero with `--target must be one of: openclaw, hermes`.

Flag semantics:

- `--force` — reinstall/repair even when the installed version is already current.
- `--apibaseurl` / `--wsbaseurl` / `--mediabaseurl` — override the backend
  endpoints written for the plugin **before** install/update. A bare `host:port`
  is normalized assuming TLS (`--wsbaseurl` → `wss://host:port/ws`, the two HTTP
  ones → `https://host:port`) via `normalizeWsUrl` / `normalizeHttpUrl`; pass a
  full `ws://`/`http://` URL to opt out. Both commands accept all three.
- `--activate <code>` — **`install` only, Hermes only.** After a successful
  Hermes install the CLI runs `hermes clawchat activate <code>` once
  (`activateHermesAfterInstall` in `packages/core/src/installers/hermes.ts`,
  bounded by `HERMES_ACTIVATE_TIMEOUT_MS`), so install + activation is a single
  deterministic call. The code is single-use; the result reports `+ activated`.
- The optional `host@ref` suffix on `--target` (e.g. `openclaw@dev`,
  `hermes@<giturl#branch>`) is parsed by `parseTarget`; `ref` selects the npm
  dist-tag/version or the git ref to install. Works on both commands.

## Install flow per target

### OpenClaw

`installOpenClawPlugin` and `updateOpenClawPlugin` in
`packages/core/src/installers/openclaw.ts` prepare the local OpenClaw
workspace before delegating to the OpenClaw CLI. They do **no** remote
pre-check, no host-version check, and no installed-version detection.

Before install or update, the CLI reads
`openclaw config get agents.defaults.workspace`. If a host process has
inherited the container default `/home/node/.openclaw/workspace`, it resets
`agents.defaults.workspace` to `~/.openclaw/workspace`, so non-container
installs do not fail on the missing container path. The CLI does not run
`openclaw setup`; if the target OpenClaw install is not initialized, the
OpenClaw plugin manager remains responsible for reporting that state.

| CLI call | Subprocess |
|----------|------------|
| `install --target openclaw` | `openclaw plugins install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install` |
| `install --target openclaw --force` | `openclaw plugins install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install` |
| `update --target openclaw` | `openclaw plugins update @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install` |
| `update --target openclaw --force` | `openclaw plugins install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install` |

The npm package name `@clawling/clawchat-plugin-openclaw` is the constant
`OPENCLAW_PLUGIN_SPEC` in `packages/core/src/config.ts`. Every delegated
`openclaw plugins install`/`openclaw plugins update` passes
`--dangerously-force-unsafe-install` (constant `OPENCLAW_UNSAFE_INSTALL_FLAG`).
The flag is a registered option on both the `install` and `update` subcommands,
so passing it never errors with "unknown flag".

#### Why the flag, and how it behaves per OpenClaw version

`@clawling/clawchat-plugin-openclaw` is not in OpenClaw's official trusted
plugin catalog, so it is treated as a third-party ("unsafe") install. The flag's
effect depends on the host OpenClaw version:

- **Older OpenClaw** (with built-in install-time dangerous-code scanning):
  `--dangerously-force-unsafe-install` bypasses that scan so the install is not
  blocked. This is the case the flag exists for here.
- **Newer OpenClaw** (scanning removed): the flag is a **deprecated no-op** — it
  still parses (prints a deprecation warning) but does nothing, because installs
  are allowed by default. Operator-owned gating moved to the
  `security.installPolicy` config (an opt-in exec hook the operator configures to
  allow/block installs; see OpenClaw's own docs). The install CLI cannot and does
  not touch that operator policy.

Net effect: passing the flag is **safe on both** — it unblocks older hosts and is
a harmless warning on newer ones. We do not switch to `security.installPolicy`
because that is a global operator-owned security control, not something a plugin
installer should set on the user's behalf.

### Hermes

`installHermesPlugin` and `updateHermesPlugin` in
`packages/core/src/installers/hermes.ts` are stateful:

1. Fetch `plugin.yaml` from
   `https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml`
   (constant `HERMES_PLUGIN_YAML_URL`) via `curl -fsL`.
2. Parse the artifact `version` and the optional `requires.hermes` range
   (only `>=X.Y[.Z[.W]]` is supported — see `assertVersionSatisfiesRange` in
   `packages/core/src/installers/metadata.ts`).
3. Run `hermes --version` and assert it satisfies the range.
4. Parse `hermes plugins list` for an existing `clawchat` row.

`install` then branches on `force` and on whether the plugin is already
installed. The four result statuses are:

| Status | Meaning |
|--------|---------|
| `installed` | plugin was missing; freshly installed and enabled |
| `updated`   | plugin was present and a newer version (or `--force` reinstall) was applied |
| `updated` (`detail: "enabled existing plugin"`) | plugin was installed but disabled; we only re-enabled |
| `skipped`   | installed version is equal to or newer than remote; nothing changed |

`update` is *not* symmetric with `install`. Specifically:

- `update` with no existing plugin throws a `PRECONDITION` error pointing
  the user to `install`, unless `--force` is set.
- `update` against a current installed plugin still delegates to
  `hermes plugins update clawchat` followed by `hermes plugins enable clawchat`
  every time; it does **not** return `skipped`. See the test
  `updates and enables during update even when installed plugin is current`
  in `packages/core/tests/installers/hermes.test.ts`.
- `update --force` runs
  `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`.
  The package spec used here is `HERMES_PLUGIN_SPEC` (the GitHub source), not
  the bare plugin name `clawchat` (`HERMES_PLUGIN_NAME`).
- If the non-force update fails because of dirty checkout / fast-forward /
  untracked files, the error is rewritten with the hint to retry with
  `--force` (`appendHermesForceRepairHint` in
  `packages/core/src/installers/hermes.ts`).

## Skills hosting subsystem

Beyond installing plugins, this repository is the **canonical host for the
ClawChat agent skill markdown** that the two adapters fetch at runtime. The npm
package does not ship these files; they are served straight from the GitHub raw
endpoint.

```
skills/
  manifest.json                  generated cross-language contract (do not hand-edit)
  shared/<id>/SKILL.md           skills identical across hosts (e.g. clawchat-liveware)
  openclaw/<id>/SKILL.md         OpenClaw-specific variant (e.g. clawchat-core)
  hermes/<id>/SKILL.md           Hermes-specific variant (e.g. clawchat-core)
```

- **`skills/manifest.json`** is keyed `skills.<target>.<skillId>` and records each
  skill's `version` (read from the `SKILL.md` frontmatter), the raw file's
  `sha256` and `bytes`, and its repo-relative `path`. Adapters read it to decide
  whether a local copy is stale and verify a download's integrity before writing.
- **`scripts/build-skills-manifest.mjs`** generates (or, with `--check`, verifies)
  the manifest from the `SKILL.md` tree. It enforces that every file has a
  frontmatter `version: X.Y[.Z][-build]`. Run it via the npm scripts below; never
  hand-edit `manifest.json`.
- **`packages/core/src/skills/check-update.ts`** is the TypeScript reference
  implementation of the runtime contract: it builds the fetch URLs from
  `OFFICIAL_SKILLS_BASE` + a git `ref` (default `DEFAULT_SKILLS_REF = "main"`;
  production callers SHOULD pin an immutable `skills-vX.Y.Z` tag), parses/validates
  the manifest (`parseSkillsManifest`), compares offered vs locally installed
  versions (`checkSkillUpdate`), and downloads+integrity-checks a single file
  (`fetchSkillMarkdown`, capped at `MAX_SKILL_BYTES`, exact `sha256` match
  required). It applies nothing itself — the consuming adapter owns the consent
  flow and the atomic overwrite. The Hermes (Python) adapter re-implements the
  same manifest read + semver compare. The end-to-end design lives in the
  workspace ops tree (`ops/agent-plugin/skill-dynamic-update-plan.md`).

The relevant constants are all in `packages/core/src/config.ts`:
`OFFICIAL_SKILLS_BASE` (the GitHub raw base — `clawling` is public, so fetches
are unauthed), `DEFAULT_SKILLS_REF`, and `MAX_SKILL_BYTES`.

| npm script | Command | Purpose |
|------------|---------|---------|
| `pnpm skills:manifest` | `node scripts/build-skills-manifest.mjs` | rewrite `skills/manifest.json` from the `SKILL.md` tree |
| `pnpm skills:check` | `node scripts/build-skills-manifest.mjs --check` | CI guard: fail if the committed manifest is stale |

See [`../skills/README.md`](../skills/README.md) for the release/versioning workflow.

## Library API (currently unused by the CLI)

`packages/core/src/index.ts` re-exports an HTTP/auth/methods surface
(`callClawchatMethod`, `resolveTargetAuth`, `readHermesAuth`,
`readOpenClawAuth`, etc.) that the published CLI does not call. These
modules exist as a programmatic API for tests and potential downstream
consumers. They are covered by tests under `packages/core/tests/auth/` and
`packages/core/tests/methods/`. If you are touching them, treat the
exported names as a stable surface even though the CLI itself does not
depend on them.

## Security note: subprocess argument validation

`packages/core/src/installers/run.ts` defines `runCommand` and
`captureCommand`, the only paths that spawn subprocesses. Both reject any
argument matching `[\s&|;<>()` + "\`" + `$\\"'%^]` before spawning. This is
why the bootstrap script and `--target` values can safely contain only
plain identifiers — anything user-supplied that reaches the installers is
rejected before it touches a shell.

## Relationship to the sibling plugins

This CLI installs two plugins that live as sibling submodules of the
`clawchat-agent-plugin` aggregator repo:

- `clawchat-plugin-openclaw/` — the TypeScript OpenClaw plugin published as
  `@clawling/clawchat-plugin-openclaw`. See its `AGENTS.md` for the plugin
  surface.
- `clawchat-plugin-hermes-agent/` — the Python Hermes plugin installed via
  `clawling/clawchat-plugin-hermes-agent`. See its `README.md` for the plugin surface
  and supported activation flows.

The CLI does not depend on the source of those plugins; it only invokes the
host agent's plugin manager (`openclaw plugins …` or `hermes plugins …`)
with the right package spec.
