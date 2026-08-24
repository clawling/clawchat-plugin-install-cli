# Architecture

This document describes how `@clawling/clawchat-plugin-install-cli` is organized
and how it installs the two ClawChat plugins. Source paths are repo-relative.

## Workspace topology

The repository is a pnpm-workspaces monorepo. The root `package.json` is
private and only orchestrates the workspace; the published artifact lives in
`packages/cli`.

```
.                                  package: @clawling/clawchat-plugin-install (private)
├── package.json                   workspace root; scripts: build, test, typecheck, clean,
│                                  skills:manifest/check/sync, livewares:manifest/check,
│                                  test:scripts, release:dry
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
├── skills/                        canonical agent skill markdown + generated manifest
├── livewares/                     canonical Liveware Sample app + generated manifest
└── scripts/                       bootstrap, R2 upload, and manifest/sync helpers
                                   (none of them part of the npm package)
```

Only `packages/cli` is published to npm. `packages/core` is consumed via the
workspace protocol during development and inlined into the CLI bundle at build
time — see the alias in `packages/cli/tsdown.config.ts` and the
`alwaysBundle: ["@clawling/clawchat-plugin-install-core"]` entry. The CLI tarball
therefore ships a single `dist/index.cjs` with no runtime dependency on
`core`. Vitest mirrors the same alias in `packages/cli/vitest.config.ts`.

The published CLI has **zero runtime dependencies**: `packages/cli/package.json`
declares no `dependencies` at all, and its only `devDependency`,
[`cac`](https://www.npmjs.com/package/cac), is bundled into `dist/index.cjs`
along with `core` (both are listed in `deps.alwaysBundle` in
`packages/cli/tsdown.config.ts`). `npx` therefore fetches a single tarball and
resolves nothing else.

## Command surface

The CLI exposes exactly two commands, both defined in
`packages/cli/src/cli.ts`:

| Command | Flags |
|---------|-------|
| `clawchat install` | `--target <openclaw\|hermes>`, `--force`, `--apibaseurl <url>`, `--wsbaseurl <url>`, `--mediabaseurl <url>`, `--activate <code>`, `--profile <name>` |
| `clawchat update`  | `--target <openclaw\|hermes>`, `--force`, `--apibaseurl <url>`, `--wsbaseurl <url>`, `--mediabaseurl <url>`, `--profile <name>` |

Both commands require `--target`. The allowed values are defined in
`packages/core/src/config.ts` (`TARGETS = ["openclaw", "hermes"]`); any other
value exits non-zero with `--target must be one of: openclaw, hermes`.

Flag semantics:

- `--force` — reinstall/repair even when the installed version is already current.
- `--apibaseurl` / `--wsbaseurl` / `--mediabaseurl` — override the backend
  endpoints written for the plugin. A bare `host:port` is normalized assuming TLS
  (`--wsbaseurl` → `wss://host:port/ws`, the two HTTP ones → `https://host:port`)
  via `normalizeWsUrl` / `normalizeHttpUrl`; pass a full `ws://`/`http://` URL to
  opt out. Both commands accept all three. **The write order differs per target**
  (see the flows below): Hermes writes the `.env` values *before* touching the
  host, OpenClaw writes them *after* the plugin is installed.
- `--activate <code>` — **`install` only, Hermes only.** After a successful
  Hermes install the CLI runs `hermes clawchat activate <code>` once
  (`activateHermesAfterInstall` in `packages/core/src/installers/hermes.ts`,
  bounded by `HERMES_ACTIVATE_TIMEOUT_MS`), so install + activation is a single
  deterministic call. The code is single-use; the result reports `+ activated`.
- `--profile <name>` — **Hermes only.** Prefixes every delegated `hermes` call
  with `-p <name>` (`withHermesProfileArgs`) and points the base-URL write at
  that profile's home, `<HERMES_HOME-or-platform-default>/profiles/<name>`
  (`resolveHermesProfileHome` in
  `packages/core/src/installers/hermes-profile.ts`). Registered on both commands.
  Omit it — or pass `default` — to target the Hermes root itself.
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

#### Files this flow writes

Both `install` and `update` may rewrite the user's OpenClaw config
(`~/.openclaw/openclaw.json`, resolved by `getOpenClawConfigPath`):

- **Legacy-id migration.** After the delegated `openclaw plugins …` call, the CLI
  runs `applyLegacyOpenClawConfigMigration`
  (`packages/core/src/installers/openclaw-config-migration.ts`), which rewrites
  the config when it still references the pre-rename `openclaw-clawchat` id —
  moving the channel block, `plugins.allow` gate, entries, and tools onto
  `clawchat-plugin-openclaw` so an upgrade from the old plugin is
  non-destructive. It is a no-op write-wise when no legacy id is present (zero
  changes ⇒ no file write), and a failure is non-fatal: it is reported as a
  warning and the install continues.
- **Base URLs.** When any of `--apibaseurl` / `--wsbaseurl` / `--mediabaseurl` is
  passed, `writeOpenClawBaseUrls` upserts them under
  `channels.clawchat-plugin-openclaw.*`.

Both happen **after** the plugin install, and in that order: the channel id is
not registered until install completes, so writing `channels.<id>.*` earlier
makes `openclaw plugins install`'s own config validation fail with "unknown
channel id" on hosts that validate strictly. The migration runs first so the
base URLs land on the migrated key. Also note `repairStaleOpenClawWorkspace` may
run `openclaw config set agents.defaults.workspace` before the install, as
described above.

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
`packages/core/src/installers/hermes.ts` are stateful. Before anything else,
both write the base-URL overrides (when passed) into
`<profile home>/.env` via `writeHermesBaseUrls` — **before** the host is
touched, the opposite of the OpenClaw order. The remaining steps are:

1. Fetch `plugin.yaml` from
   `https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml`
   (constant `HERMES_PLUGIN_YAML_URL`) with Node's own `fetch` (15s per-attempt
   cap, one retry; 4xx is not retried). Injectable via `InstallerOptions.fetchFn`.
   Preferred over `curl`, which is absent on Windows builds older than 10/1803 —
   **except** when a proxy env var (`HTTPS_PROXY`, `http_proxy`, `ALL_PROXY`, …)
   is set, which falls back to `curl -fsL`. undici does not read those vars and
   `NODE_USE_ENV_PROXY` needs Node 24+, so on a locked-down network `fetch`
   would lose egress entirely rather than merely skip the proxy.
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
- An EBUSY / read-only failure while Hermes rewrites `$HERMES_HOME/config.yaml`
  is rewritten with a deployment-level hint
  (`appendHermesConfigBusyHint`) — that file must be writable, not a read-only
  bind mount.

#### Network and filesystem access in the Hermes flow

Beyond the `plugin.yaml` GET, a **`--target hermes@<ref>` install reaches the
network itself**: `installViaLocalClone` creates a temporary directory under the
OS temp dir (`fs.mkdtempSync(os.tmpdir(), "clawchat-hermes-")`), runs
`git clone --depth 1 --single-branch --branch <branch> <cloneUrl>` into it
(bounded by `GIT_CLONE_TIMEOUT_MS` with two retries, `GIT_TERMINAL_PROMPT=0` so
git can never block on a credential prompt), reads `plugin.yaml` straight out of
the checkout for the host-compat guard, hands the checkout to
`hermes plugins install file://<dest> --force --enable`, and removes the temp
tree in a `finally`. The CLI owns the clone precisely so the branch in a
`#branch` fragment is honoured and the network step stays under its own
timeout/retry budget instead of the host's fixed, no-retry clone. The canonical
(non-ref) install has no CLI-owned clone — the host clones the repo itself
during `hermes plugins install clawling/clawchat-plugin-hermes-agent`.

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
  `OFFICIAL_SKILLS_BASE` + a git `ref` (defaulting to `DEFAULT_SKILLS_REF`, which
  is pinned to an immutable `skills-vX.Y.Z` tag rather than the moving `main` —
  `skills-v1.6.0` as of this writing; `packages/core/src/config.ts` is the
  authoritative value and every skills release moves it, see
  [`release.md`](release.md)), parses/validates
  the manifest (`parseSkillsManifest`), compares offered vs locally installed
  versions (`checkSkillUpdate`), and downloads+integrity-checks a single file
  (`fetchSkillMarkdown`, capped at `MAX_SKILL_BYTES`, exact `sha256` match
  required). It applies nothing itself — the consuming adapter owns the consent
  flow and the atomic overwrite. The Hermes (Python) adapter re-implements the
  same manifest read + semver compare. Each adapter documents its own end of the
  flow — the Hermes plugin repo's `docs/skill-updates.md` and the OpenClaw plugin
  repo's `docs/clawchat-plugin-openclaw.md` §"Conversational skill hot-update".

The relevant constants are all in `packages/core/src/config.ts`:
`OFFICIAL_SKILLS_BASE` (the GitHub raw base — `clawling` is public, so fetches
are unauthed), `DEFAULT_SKILLS_REF` (the pinned skills tag; both agent adapters
keep their own copy of this constant and all three move together), and
`MAX_SKILL_BYTES`.

| npm script | Command | Purpose |
|------------|---------|---------|
| `pnpm skills:manifest` | `node scripts/build-skills-manifest.mjs` | rewrite `skills/manifest.json` from the `SKILL.md` tree |
| `pnpm skills:check` | `node scripts/build-skills-manifest.mjs --check` | CI guard: fail if the committed manifest is stale |
| `pnpm skills:sync` | `node scripts/sync-skills.mjs` | copy the tree + manifest into the sibling plugin repos (`--hermes` / `--openclaw` override the default sibling paths) |
| `pnpm test:scripts` | `node --test scripts/sync-skills.test.mjs` | node:test coverage for the sync script (also part of the root `pnpm test`) |

See [`../skills/README.md`](../skills/README.md) for the release/versioning workflow.

## Livewares hosting subsystem

`livewares/` is the second tree this repository hosts for the adapters, and it
works exactly like `skills/`: static files served from GitHub raw, described by a
generated manifest the adapters verify before writing. It holds the **Liveware
Sample** — the small demo web app the plugins auto-install so a freshly paired
user has something to look at — not markdown.

```
livewares/
  manifest.json                        generated contract (do not hand-edit)
  openclaw/liveware-sample/            the sample app's static files
    liveware.json                      carries the sample's `version`
    index.html, app.js, server.mjs, state.json
```

- **One physical copy, two manifest targets.** The sample is host-agnostic (plain
  Node), so `scripts/build-livewares-manifest.mjs` maps both the `openclaw` and
  the `hermes` target at the same `openclaw/liveware-sample` directory (see its
  `LAYOUT` constant). Each adapter fetches under its own target key; there is no
  second copy to drift.
- **`livewares/manifest.json`** is keyed `livewares.<target>.<sampleId>` and, unlike
  the skills manifest, records a **list of files** per sample — each with its
  repo-relative `path`, `sha256`, and `bytes` — plus the `version` read from the
  sample's `liveware.json`. Adapters compare `version` to decide whether to
  refresh and check each file's `sha256` before writing it.
- **`scripts/build-livewares-manifest.mjs`** generates it, or verifies it with
  `--check`. Never hand-edit `manifest.json`.
- The tree is served from the same `OFFICIAL_SKILLS_BASE` repo and pinned by the
  same `skills-vX.Y.Z` tag as the skills tree — both adapters share the
  `DEFAULT_SKILLS_REF` constant between their skill-update and liveware-sample
  modules, so a new tag must exist in **both** trees. There is no TypeScript
  reference implementation for livewares in `packages/core` (unlike
  `skills/check-update.ts`); the adapters implement the fetch themselves.
- Byte-exactness matters: `.gitattributes` pins LF on checkout so a Windows clone
  cannot invalidate the recorded hashes.

The `clawchat-liveware-sample` skill (per host, under `skills/`) is what teaches
the agent to operate this app; the two subsystems ship together.

| npm script | Command | Purpose |
|------------|---------|---------|
| `pnpm livewares:manifest` | `node scripts/build-livewares-manifest.mjs` | rewrite `livewares/manifest.json` from the `livewares/` tree |
| `pnpm livewares:check` | `node scripts/build-livewares-manifest.mjs --check` | CI guard: fail if the committed manifest is stale |

## Library API (currently unused by the CLI)

`packages/core/src/index.ts` re-exports an HTTP/auth/methods surface
(`callClawchatMethod`, `resolveTargetAuth`, `readHermesAuth`,
`readOpenClawAuth`, etc.) that the published CLI does not call. These
modules exist as a programmatic API for tests and potential downstream
consumers. They are covered by tests under `packages/core/tests/auth/` and
`packages/core/tests/methods/`. If you are touching them, treat the
exported names as a stable surface even though the CLI itself does not
depend on them.

## Security note: subprocess argument handling

`packages/core/src/installers/run.ts` defines `runCommand` and `captureCommand`,
the only paths that spawn subprocesses. What they guarantee is narrower than
"every argument is sanitized", and the difference matters:

- **Command names** are checked on every platform. `assertSafeCommandName`
  rejects anything matching `UNSAFE_COMMAND_NAME` (whitespace, shell
  metacharacters, quotes, `%`, `^`, control characters). Every command name in
  this package is a hardcoded constant (`git`, `hermes`, `openclaw`, `curl`), so
  nothing legitimate trips it.
- **Arguments on POSIX are passed through verbatim.** `spawnOptions` sets
  `shell: false` there, so `execvp` receives the argv array and no shell ever
  re-parses it — there is nothing to escape, and rejecting spaces or backslashes
  would only break legitimate paths. `prepareArgs` returns the array unchanged,
  by design (see its doc comment).
- **Arguments on Windows are quoted, not filtered out.** `shell: true` is
  unavoidable on win32 because `npm`/`npx` and the host CLIs installed through
  them are `.cmd` shims Node refuses to spawn directly. There `prepareArgs`
  rejects only what cannot be made safe inside a `cmd.exe` double-quoted argument
  (`WINDOWS_UNQUOTABLE` — `"`, `%`, control characters) and quotes everything
  else via `quoteWindowsArg`, so ordinary Windows paths (`C:\Users\Zhang San\…`,
  full of backslashes and spaces) keep working.

The property to rely on is therefore **"POSIX never involves a shell; Windows
quotes, and rejects the few characters it cannot quote"** — not "user input is
stripped of metacharacters before it reaches the installers". `CommandOptions.env`
is not validated at all and must only ever carry hardcoded constants.

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
