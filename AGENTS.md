# Repository Guidelines

Short orientation for coding agents working in this repository. For
anything not covered here, follow the documentation map below.

## Documentation map

- Workspace topology, install flows per target, library API, security
  notes — [`docs/architecture.md`](docs/architecture.md).
- pnpm setup, build, test, filters, local plugin testing —
  [`docs/development.md`](docs/development.md).
- How to publish the CLI and refresh the R2-hosted install guide —
  [`docs/release.md`](docs/release.md).
- Pre-release builds on the `dev` channel —
  [`docs/dev-release.md`](docs/dev-release.md).
- Skill authoring, frontmatter rules, and release steps —
  [`skills/README.md`](skills/README.md).
- Agent wire protocol — [`docs/agent-protocol.md`](docs/agent-protocol.md).
  This is an exported copy: fix its source and re-export; do not edit it here.
- The runtime install guide consumed by end-users / AI agents —
  [`install.md`](install.md) and the context page
  [`docs/runtime-install-guide.md`](docs/runtime-install-guide.md).

Before changing a feature, read the relevant `docs/` page. After changing
behavior, update the matching `docs/` page in the same change set.

## Project shape

- pnpm-workspaces monorepo. Two packages: `packages/cli` (published as
  `@clawling/clawchat-plugin-install-cli`) and `packages/core` (workspace-private,
  inlined into the CLI bundle). Source in each package's `src/`, tests in
  `tests/`.

## Coding style

- Modern TypeScript targeting Node 18+, strict mode (`tsconfig.base.json`).
- Match the surrounding file: double quotes, trailing commas, 2-space
  indentation. Functions and variables in `camelCase`; constants in
  `UPPER_SNAKE_CASE`; filenames in kebab-case.
- There is no dedicated linter; consistency with neighbouring files is the
  bar.

## Changing a skill

Follow the release checklist in [`skills/README.md`](skills/README.md):

1. Edit `skills/{shared,openclaw,hermes}/<id>/SKILL.md` and bump its frontmatter
   `version`. Plain frontmatter values must not contain `: ` or ` #`; use a
   folded YAML value (`description: >-`) for prose containing either sequence.
2. Run `pnpm skills:manifest` to regenerate `skills/manifest.json`.
3. Run `pnpm skills:sync` to refresh the bundled snapshots in both plugin repos.
4. Release under a `skills-vX.Y.Z` tag, independently of the CLI npm package.
5. Move `DEFAULT_SKILLS_REF` in all three consumers: this repo's
   `packages/core/src/config.ts`, the Hermes plugin's
   `clawchat_gateway/skill_update.py`, and the OpenClaw plugin's
   `src/skill-update.ts`. Release both plugins; this alone needs no CLI npm release.

## Testing

- Vitest is configured per package. Add or update tests in the affected
  package whenever a command, installer, parser, or auth helper changes.
- Test names describe behavior, not implementation details (see existing
  examples in `packages/core/tests/installers/hermes.test.ts`).
- Run `pnpm test` and `pnpm typecheck` before submitting changes. The
  bootstrap-script integration tests in
  `packages/cli/tests/install-script.test.ts` run as part of `pnpm test`.
- When changing `skills/` or `livewares/`, also run `pnpm skills:check` and
  `pnpm livewares:check` manually before release; `pnpm test` does not run them.

## Commits and pull requests

- Conventional Commits with a package scope, for example
  `feat(cli): add force install option` or
  `fix(core): align Hermes update command semantics`.
- PRs should include a short problem statement, a summary of the
  behavioural change, test evidence, and any user-visible install/update
  output when the install flow changes.

## Code Review Rules

This section describes how pull requests in this repository are reviewed, including by automated PR review. Each rule names the priority a violation receives; cases it does not cover are left to the reviewer's judgment. Findings cite the rule number (for example "Review rule G3"). A finding the author shows to be wrong is closed with a reply, not silently dropped.

### General rules

- **G1 Baseline (P1).** A PR targets the integration branch named in this repository's baseline rule (R1), or one of the exceptions R1 allows, and contains only changes for its stated purpose. Unrelated files and leftovers from a wrong base are violations, and so is a revert of a commit already on the base branch unless reverting it is the PR's stated purpose.
- **G2 Concurrency and consistency (P1).** A read-modify-write of the same state is atomic. Accepted forms: one lock; a database transaction whose isolation level or row lock actually serializes the competing writers (for example `SELECT … FOR UPDATE`, SQLite `BEGIN IMMEDIATE`, or `SERIALIZABLE`), or a single atomic statement — a transaction at a weaker default level is not enough on its own; compare-and-swap or a single server-side script; or code that runs to completion on one single-threaded event loop without yielding, for state owned by that loop alone (state shared through files, shared memory, other workers or other processes needs cross-context synchronization). When a write the operation depends on fails, the code does not acknowledge the message, advance a cursor / offset / watermark, mark the work done, or report success to the caller, and none of these happens before the write is known to have succeeded. Auxiliary writes (audit rows, telemetry, metrics) and writes this repository documents as best-effort are not violations when their failure is logged and nothing acknowledges, advances or reports success based on them; turning a durable write into a best-effort one, or adding a new undocumented best-effort path for state the operation depends on, is.
- **G3 Safe defaults (P1; P0 when it exposes data or bypasses authentication / authorization).** On error the code fails closed: authentication, permission and validation failures, and failures to load required or authority-bearing configuration, deny or stop rather than continue. An unreadable optional setting that grants nothing may fall back to a conservative default. A fail-open result (for example "allowed" returned because a check errored) is never cached. A change does not widen a permission check or move an error into a less strict class — such as an auth failure into success, a permanent error into a silent drop, or a client error into a retry that hides it. Retries, credential refreshes or fallbacks that the protocol or this repository's documentation prescribes are not a widening. An availability fallback that does not touch a security check and that this repository's documentation explicitly approves is not a violation; adding or widening one without documenting it is. Documentation never waives authentication, authorization or other security checks: prescribed retries and credential refreshes may lead to access only after those checks succeed.
- **G4 Documentation (P1).** A change to an interface, config key, persisted field or invariant updates the matching documentation in the same PR, and the docs do not contradict each other or the code.
- **G5 Test scope (P1 when behavior changes without a test; P2 for thin coverage).** A behavior change comes with a test at the level that would catch a regression. Deleting, skipping or weakening an existing test to make a change pass is P1 unless the PR explains why the test was wrong. Documentation-only PRs need no tests, unless the changed text is executed, extracted by tests, copied byte-for-byte into another product, or hash-pinned — then it is behavior.
- **G6 Secrets (P0).** No credential of any kind — API key, token, password, private key, database DSN with a password, signed URL — appears in code, tests, fixtures, docs, scripts or commit messages. Real values come from the environment or an ignored local file; examples use obvious placeholders.
- **G7 Public repository hygiene (P0).** This repository, its full git history, its PRs and its published packages are public. Violations, in code, tests, fixtures, docs, comments, PR title / body or commit messages: internal or staging hostnames and private IP addresses; cluster, namespace, container-registry, storage-bucket or jump-host names that are not part of a documented public endpoint; names or paths of private repositories, including relative links that escape this repository; internal ticket or task IDs (a `T` followed by a number, in the form `T<n>` or `T<n>.<m>`); real production identifiers (user, conversation, agent or device IDs, routing keys); personal e-mail addresses or real user nicknames; internal planning or incident material. A default endpoint is a public HTTPS / WSS domain, a loopback address (`127.0.0.1`, `localhost`) used on purpose for local development, tests or same-machine IPC, or absent — the code then fails closed and requires explicit configuration. Loopback addresses are not internal hosts; private-network addresses are. Secret- and redaction-scanner rules, the test fixtures that need such shapes to prove detection, and lines carrying this repository's documented inline allow marker (such as `redact-allow:<id>`) are exempt; real credentials and production values in them are still P0.

### Repository-specific rules

- **R1 Integration branch (P1).** Use `main` as the PR base and the baseline
  for G1, including its rule on reverts: flag changes unrelated to the stated
  purpose, accidental reversions of work already on `main`, and changes carried
  over from a different base.

- **R2 Skill change checklist (P1).** A PR that changes
  `skills/{shared,openclaw,hermes}/<id>/SKILL.md` must, in the same PR, bump
  that skill's frontmatter `version`, keep plain YAML values free of `: ` and
  ` #` (use a folded value such as `description: >-` for such prose), and
  regenerate `skills/manifest.json` with `pnpm skills:manifest` — never edit
  the manifest by hand. Missing any of these is P1. Shipping happens later and
  is not checked here: skills release under their own `skills-vX.Y.Z` tag, and
  `DEFAULT_SKILLS_REF` (in this repo's `packages/core/src/config.ts` and in both
  plugins) moves to that tag; a PR that moves `DEFAULT_SKILLS_REF` must point
  it at an existing `skills-v*` tag. A CLI npm release alone does not ship
  skills.

- **R3 Exported protocol (P1).** `docs/agent-protocol.md` is an exported
  copy. Flag direct edits to it in a PR; change the server-side Protocol v2
  contract and re-export instead of maintaining a divergent local contract.

- **R4 Subprocess safety (P1; P0 for command injection).** Keep subprocess
  spawning in `packages/core/src/installers/run.ts` through `runCommand`
  and `captureCommand`, with command names checked by `assertSafeCommandName`.
  POSIX must use `shell: false` and preserve argv verbatim. Windows must
  reject double quotes, `%`, and control characters via `prepareArgs`, and
  quote other arguments with `quoteWindowsArg`, preserving spaces and
  backslashes in paths. `CommandOptions.env` may carry only hardcoded constants.

- **R5 Hermes scan gate (P1).** In
  `packages/core/src/installers/hermes.ts`, the first install attempt must
  omit the host's `--force`. A forced replacement is allowed only after
  that attempt reports "already exists", proving the scan passed, and a
  reinstall was requested (`--force` or an `@ref` install). Surface scan
  refusals as `SCAN_BLOCKED`; never automatically force or retry past them.
  If an update reports that the host disabled the plugin after scanning,
  raise `SCAN_BLOCKED` instead of running `hermes plugins enable clawchat`.

- **R6 Self-contained CLI bundle (P1).** Only `packages/cli` is published;
  `packages/core` remains workspace-private. Keep the core-source alias
  and `deps.alwaysBundle` entries for core and `cac` in
  `packages/cli/tsdown.config.ts`, with the matching core alias in
  `packages/cli/vitest.config.ts`. The published CLI must have zero runtime
  dependencies and ship `dist/index.cjs` with core inlined.

- **R7 Runtime install consistency (P1).** Keep root `install.md` commands,
  flags, environment variables, and activation syntax consistent with
  `packages/cli/src/cli.ts`, `packages/core/src/installers/`, and
  `docs/architecture.md`. A changed guide step also performed by
  `scripts/install-clawchat.sh` and `scripts/install-clawchat.ps1` must be
  updated in both scripts. Keep `install.md` at the root; if script paths
  move, update `scripts/upload-install-md-to-r2.sh` to read the new paths.

- **R8 Liveware manifest (P1).** A change to the Liveware Sample under
  `livewares/` must bump its `liveware.json` version and regenerate
  `livewares/manifest.json` with `pnpm livewares:manifest`; never hand-edit
  the generated manifest. Skills and livewares share the pinned
  `skills-vX.Y.Z` tag, so the released tag must contain both trees.
  Run `pnpm skills:check` and `pnpm livewares:check` manually before release
  when changing either tree; `pnpm test` does not run these checks.
