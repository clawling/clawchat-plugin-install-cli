# Release

This project ships three artifacts that are released independently:

1. The npm package `@clawling/clawchat-plugin-install-cli`, published from
   `packages/cli`.
2. The runtime install assets — `install.md`, both one-shot installer
   scripts, and `docs/agent-protocol.md` — uploaded to a public R2 prefix by
   `scripts/upload-install-md-to-r2.sh`. Agents and end-users fetch these at
   install time.
3. The `skills/` and `livewares/` trees, released together under a
   `skills-vX.Y.Z` git tag that the two agent adapters pin to.

> Shipping a test/pre-release build instead of a real release? Use the `dev`
> dist-tag flow in [`dev-release.md`](dev-release.md) so you don't push
> unfinished work to `latest`.

## Release order (applies to all three artifacts)

Since 2026-10-23 every release follows the same order:

1. **Merge first.** The release commit — version bump included — reaches `main`
   through a GitHub PR (squash-merged). Nothing is pushed to `main` directly.
2. **Tag the `main` commit that PR produced** and push the tag. Never tag a
   branch head, a local commit, or anything that is not on `origin/main`.
3. **Publish from a clean checkout of that tag** — `npm publish`, the R2
   upload. Never from a dirty tree, an unmerged branch, or `main` plus local
   edits.

Publishing first and merging later is not allowed. Dev-channel builds
([`dev-release.md`](dev-release.md)) are test artifacts and are exempt.

Tag namespaces in this repo:

| Tag | Marks | Published from it |
| --- | --- | --- |
| `cli-vX.Y.Z` | a CLI release; equals `packages/cli/package.json` `version` | npm `latest`, plus the R2 upload when `install.md`, either installer script, or `docs/agent-protocol.md` changed in the same round |
| `skills-vX.Y.Z` | a skills / livewares release | nothing is uploaded; the adapters fetch the tree from GitHub at this tag |
| `install-YYYY.M.D-N` | a change to `install.md`, either installer script, or `docs/agent-protocol.md` shipped without a CLI release | the R2 upload |

Use annotated tags (`git tag -a`); the tag message is public, like every
commit message. Never move or delete a pushed release tag; use a new tag for
corrections.

From the original repo root, replace the quoted placeholders below. Copy the
**full squash commit SHA from the merged release PR's page**, even if other PRs
have since merged. Do not substitute the current `origin/main` tip. The ancestry
check must pass before tagging; any command failure stops this sequence.

```bash
RELEASE_PR_SHA='paste-full-squash-commit-SHA-from-merged-PR'
TAG='replace-with-release-tag'
git fetch origin --tags || exit 1
SHA=$(git rev-parse --verify "${RELEASE_PR_SHA}^{commit}") || exit 1
git merge-base --is-ancestor "$SHA" origin/main || exit 1
git log -1 --format='%H %s' "$SHA" || exit 1
git tag -a "$TAG" "$SHA" -m "$TAG: release" || exit 1
git push origin "refs/tags/$TAG" || exit 1
git worktree add --detach ".worktrees/release-$TAG" "$TAG" || exit 1
```

## Publish the CLI to npm

1. On a branch off `main`, bump `packages/cli/package.json` `version` to the
   new value (recent release commits are titled
   `chore(release): install-cli X.Y.Z -> X.Y.Z+1`).
2. Run a dry release from the repo root before opening the PR:

   ```bash
   pnpm release:dry
   ```

   This expands to
   `pnpm --filter @clawling/clawchat-plugin-install-cli release:dry`, which runs
   `pnpm typecheck && pnpm test && pnpm build && npm pack --dry-run` inside
   `packages/cli`. It validates that:

   - typecheck passes,
   - the Vitest suite passes,
   - `tsdown` produces a working `dist/index.cjs` plus `dist/index.d.cts`,
   - the tarball contents match `packages/cli/package.json:files`
     (currently `["dist", "README.md"]`).

3. Open the PR against `main` and squash-merge it once reviewed.
4. Tag the resulting `main` commit `cli-vX.Y.Z` and push the tag (see
   [Release order](#release-order-applies-to-all-three-artifacts)).
5. Publish from the clean tag checkout:

   ```bash
   # From the original repo root; use the TAG set above (cli-vX.Y.Z).
   : "${TAG:?set TAG to the release tag selected above}"
   cd ".worktrees/release-$TAG" || exit 1
   test "$(git rev-parse HEAD)" = "$(git rev-parse --verify "${TAG}^{commit}")" || exit 1
   test -z "$(git status --porcelain)" || exit 1
   pnpm install --frozen-lockfile &&
     pnpm release:dry &&                       # re-validate exactly what will ship
     pnpm --filter @clawling/clawchat-plugin-install-cli build &&
     cd packages/cli &&
     npm publish
   ```

   `packages/cli/package.json` declares `publishConfig.access: "public"`, so
   no extra flag is needed for the scoped package.

There is no GitHub Actions release workflow today; publishing is manual, and
nothing in the scripts checks that you are on a tag — the order above is on
you.

## Refresh the runtime install assets on R2

`install.md` at the repo root is the file end-users (or AI agents on their
behalf) read after running `npx -y @clawling/clawchat-plugin-install-cli`. The
upload script publishes **four** objects under the configured prefix, and always
all four together:

| Local file | R2 object (default prefix) | Content-Type |
|------------|----------------------------|--------------|
| `install.md` | `clawchat/install.md` | `text/markdown` |
| `scripts/install-clawchat.sh` | `clawchat/install-clawchat.sh` | `text/x-shellscript` |
| `scripts/install-clawchat.ps1` | `clawchat/install-clawchat.ps1` | `text/plain` |
| `docs/agent-protocol.md` | `clawchat/agent-protocol.md` | `text/markdown` |

The script aborts if any of them is missing, so a step added to the guide
that a script also performs means updating the guide **and** both scripts before
uploading.

Any change to these four source files, including a protocol-only change,
requires an R2 upload to reach readers. Merging into `main` does not update R2,
and R2 must never get ahead of `main`:
merge the change via PR, tag the `main` commit (`cli-vX.Y.Z` if it ships with a
CLI release, otherwise `install-YYYY.M.D-N`), then upload from a clean checkout
of that tag. They are hosted at the public R2 prefix configured in
`scripts/.env.r2.example`:

- bucket: set `R2_BUCKET`
- prefix: set `R2_PREFIX`
- endpoint: set `R2_ENDPOINT`
- public base URL: set `R2_PUBLIC_BASE_URL` if public URLs should be printed

To upload, start from the original repo root and use the `TAG` selected above:

```bash
: "${TAG:?set TAG to the release tag selected above}"
cd ".worktrees/release-$TAG" || exit 1
test "$(git rev-parse HEAD)" = "$(git rev-parse --verify "${TAG}^{commit}")" || exit 1
test -z "$(git status --porcelain)" || exit 1
# credentials: a fresh checkout has no scripts/.env.r2 (gitignored) — point at an existing one
export R2_ENV_FILE=/path/to/your/.env.r2       # template: scripts/.env.r2.example
scripts/upload-install-md-to-r2.sh
```

To validate without uploading:

```bash
scripts/upload-install-md-to-r2.sh --no-upload
```

The script reads `$REPO_ROOT/install.md`,
`$REPO_ROOT/scripts/install-clawchat.{sh,ps1}`, and
`$REPO_ROOT/docs/agent-protocol.md` directly — do not move those files without
also updating the script. The protocol file is an exported copy; update its
source and re-export it rather than editing it here.

## Release a skills / livewares change

The `skills/` and `livewares/` trees are versioned **independently of the npm
package**: both agent adapters fetch them from GitHub raw at a pinned
`skills-vX.Y.Z` tag, so publishing the CLI does not ship a skill change and a new
tag reaches nobody until every consumer's pin is moved.

1. Edit the files and bump their versions — a `SKILL.md` frontmatter `version:`,
   and/or the Liveware Sample's `liveware.json` `version`.
2. Regenerate the manifests and let CI verify them:

   ```bash
   pnpm skills:manifest && pnpm skills:check
   pnpm livewares:manifest && pnpm livewares:check
   ```

3. `pnpm skills:sync` to refresh the bundled snapshots in the sibling plugin
   repos, and commit those there (through each plugin repo's own PR flow).
4. Merge the skills change into `main` via PR, then tag the resulting `main`
   commit `skills-vX.Y.Z` and push the tag. The tag is what agents fetch, so it
   must never point at a commit that is not on `main`.
5. **Move the pin in all three consumers**, then release each:
   `DEFAULT_SKILLS_REF` in `packages/core/src/config.ts` here, plus the matching
   constant in each agent plugin repo. They must all name the same tag.

[`../skills/README.md`](../skills/README.md) has the full per-consumer checklist
and the tombstone rules for retired skill ids.

## Bootstrap scripts

`scripts/install-clawchat.sh` (bash) and `scripts/install-clawchat.ps1`
(PowerShell) are thin wrappers around
`npx -y @clawling/clawchat-plugin-install-cli@latest`. They are documented in the
root `README.md` and have no npm release step of their own — but they **are**
part of the R2 upload above, so a change to either only reaches users once that
upload is re-run.

Bootstrap-script tests run under Vitest
(`packages/cli/tests/install-script.test.ts`) and stand up temporary mock
executables on `PATH`, so they require no extra setup. They are part of
the normal `pnpm test` run.
