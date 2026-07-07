# ClawChat agent skills — canonical source

This directory is the **single source of truth** for the ClawChat agent skill
markdown (`SKILL.md`) shipped to the two agent adapters. The dynamic skill-update
flow fetches these files at runtime; for the end-to-end design see
`skill-dynamic-update-plan.md` in the workspace ops tree
(`ops/agent-plugin/skill-dynamic-update-plan.md`).

## Layout

```
skills/
  manifest.json                  # generated — the cross-language contract
  shared/<id>/SKILL.md           # skills identical across hosts
  openclaw/<id>/SKILL.md         # OpenClaw-specific variant
  hermes/<id>/SKILL.md           # Hermes-specific variant
```

The `clawchat-core` skill is **host-specific** (it teaches each host's own CLI:
`openclaw channels …` / `SOUL.md` sync vs `hermes clawchat activate` /
`/clawchat-activate`), so it lives once per host. `clawchat-liveware` is identical
across hosts and lives once under `shared/`.

> The plugin repos (`clawchat-plugin-openclaw`, `clawchat-plugin-hermes-agent`)
> keep a **bundled snapshot** of their own host's files for offline / first-run
> fallback. That snapshot must be kept in sync with this directory — this tree
> wins on any divergence. Bundled snapshots now include **every** skill for that
> target plus `manifest.json`; each plugin repo has a consistency test that fails
> CI on drift.

## `manifest.json` (generated — do not hand-edit)

Keyed `skills.<target>.<skillId>`; each entry carries the skill `version` (read
from the file's frontmatter), the `sha256` and `bytes` of the raw file, and its
repo-relative `path`. Adapters read it to decide whether their local copy is
stale, and verify a download against `sha256` before writing.

Regenerate / verify:

```bash
pnpm skills:manifest    # rewrite skills/manifest.json from the SKILL.md tree
pnpm skills:check       # CI: fail if the manifest is stale
```

## Releasing a skill change

1. Edit the relevant `SKILL.md` and **bump its frontmatter `version:`**
   (semver `X.Y.Z`, optional `-<build>`).
2. `pnpm skills:manifest` to refresh `manifest.json`.
3. `pnpm skills:sync` to copy the tree + manifest into the sibling plugin
   repos (flags `--hermes/--openclaw` override the default sibling paths),
   then commit the synced files in each plugin repo.
4. Tag the repo `skills-vX.Y.Z` (decoupled from the CLI's npm release) so an
   update trigger can pin an immutable `ref`. Tracking `main` is for dev only.

2026-07-06: skills were renamed to `clawchat-*` ids; the old ids (`clawchat`,
`liveware-app`, `set-greeting`) are permanent tombstones in `REMOVED`.

Tombstoned skill ids are permanently retired and must never be reused for a
new skill: old installs apply the shipped tombstones at every load, so a
revived id would have its managed copy deleted on next sync.
