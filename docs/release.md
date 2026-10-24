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

From the original repo root, replace the placeholders below. Get the **full
squash commit SHA from the merged release PR**, not the floating `origin/main`
tip: it may already include a later PR. The ancestry check must pass before
tagging; any command failure stops this sequence.

```bash
RELEASE_PR_SHA=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid) || exit 1
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
     npm publish --dry-run &&                  # exercises the release-tag guard
     npm publish
   ```

   `packages/cli/package.json` declares `publishConfig.access: "public"`, so
   no extra flag is needed for the scoped package.

There is no GitHub Actions release workflow today; publishing is manual.
`prepublishOnly` runs `scripts/release-guard.mjs publish` before publishing to
`latest` (the default). It requires an annotated `cli-v<package version>` tag,
HEAD at that tag's commit, a clean working tree (including untracked files), an
identical tag object pushed to `origin`, and that commit on freshly fetched
`origin/main`. Any Git error stops publication. Ignored build files are fine.
`npm publish --dry-run` from the tag checkout exercises the same guard;
`pnpm release:dry` uses `npm pack --dry-run` and does not exercise it.
`npm publish --tag dev` is exempt (as are other explicitly non-`latest` tags).
The guard must not be skipped: fix failures by correcting the checkout or
release state, never by disabling lifecycle scripts or bypassing checks.

## Record the release

After publishing, create a GitHub Release keyed by the pushed tag. For a CLI
release, using the `TAG` and `SHA` selected above:

```bash
gh release create "$TAG" --verify-tag --title "$TAG" \
  --notes "commit: $SHA
npm: @clawling/clawchat-plugin-install-cli@<version>
R2 objects uploaded: no"
```

Record the commit SHA, the npm version when applicable, and whether all four R2
objects were uploaded. For a `skills-v*` release, record all three consumer pins:
which version of each adapter plugin and which CLI repository commit names
which `skills-v*` tag. Add later results by editing the Release notes (for
example, `gh release edit "$TAG" --notes-file release-notes.md`). Never move the
tag to update a release record.

### Promote an existing version to `latest`

For an already-published final version, run from the repo root:

```bash
pnpm release:promote <X.Y.Z> --dry-run
pnpm release:promote <X.Y.Z>
```

The guard requires `cli-vX.Y.Z` to exist locally as an annotated tag, match the
pushed tag object, and point to a commit on freshly fetched `origin/main`.
Promotion may run from any checkout; it does not require HEAD at the tag or a
clean working tree. Only plain final `X.Y.Z` versions are accepted; dev versions
are never promoted. After the checks pass, the script moves npm's `latest`
dist-tag. Never run a raw `npm dist-tag add … latest` command.

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
`skills-vX.Y.Z` tag, so publishing the CLI does not ship a skill change. A new
tag reaches a consumer only when its pinned ref changes and that artifact ships.

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
5. **Move the pin in all three consumers** on their main branches via PR:
   `DEFAULT_SKILLS_REF` in `packages/core/src/config.ts` here, plus the matching
   constant in each agent plugin repo. They must all name the same tag. Release
   both adapter plugins with their changed pins. Moving the CLI's default on
   `main` does not require a CLI npm release (it is a library default; the
   published CLI bundle does not include the skills subsystem). Ship only the artifacts whose pinned ref actually changed.
   Record the two plugin versions and CLI commit, with each pinned `skills-v*`
   tag, in the skills tag's GitHub Release notes (see [Record the release](#record-the-release)).

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

## Planned: versioned R2 layout (not implemented)

Upload all four objects under an immutable prefix such as
`<prefix>/releases/<tag>/…`, together with a `manifest.json` recording the tag,
commit SHA, and sha256 of each object. Verify every uploaded object against the
manifest before switching the entry objects that installers read, through a
copy or a small pointer object. The switch must expose only a complete release,
so a partial upload never changes what readers get. Rollback re-points the
entries to the previous release prefix.

This is a planned design only. `scripts/upload-install-md-to-r2.sh` still
overwrites the four objects in place today.
