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
