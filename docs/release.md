# Release

This project ships three artifacts that are released independently:

1. The npm package `@clawling/clawchat-plugin-install-cli`, published from
   `packages/cli`.
2. The runtime install assets — `install.md` plus both one-shot installer
   scripts — uploaded to a public R2 prefix by
   `scripts/upload-install-md-to-r2.sh`. Agents and end-users fetch these at
   install time.
3. The `skills/` and `livewares/` trees, released together under a
   `skills-vX.Y.Z` git tag that the two agent adapters pin to.

> Shipping a test/pre-release build instead of a real release? Use the `dev`
> dist-tag flow in [`dev-release.md`](dev-release.md) so you don't push
> unfinished work to `latest`.

## Publish the CLI to npm

1. Make sure the working tree is clean and you are on the release branch.
2. Bump `packages/cli/package.json` `version` to the new value (Conventional
   Commits would call this `chore(cli): release X.Y.Z`).
3. Run a dry release from the repo root:

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

4. Publish:

   ```bash
   pnpm --filter @clawling/clawchat-plugin-install-cli build
   cd packages/cli
   npm publish
   ```

   `packages/cli/package.json` declares `publishConfig.access: "public"`, so
   no extra flag is needed for the scoped package.

5. Tag the commit and push (release tagging convention follows the existing
   `chore(cli): release X.Y.Z` commits in `git log`).

There is no GitHub Actions release workflow today; publishing is manual.

## Refresh the runtime install assets on R2

`install.md` at the repo root is the file end-users (or AI agents on their
behalf) read after running `npx -y @clawling/clawchat-plugin-install-cli`. The
upload script publishes **three** objects under the configured prefix, and always
all three together:

| Local file | R2 object (default prefix) | Content-Type |
|------------|----------------------------|--------------|
| `install.md` | `clawchat/install.md` | `text/markdown` |
| `scripts/install-clawchat.sh` | `clawchat/install-clawchat.sh` | `text/x-shellscript` |
| `scripts/install-clawchat.ps1` | `clawchat/install-clawchat.ps1` | `text/plain` |

The script aborts if any of the three is missing, so a step added to the guide
that a script also performs means updating the guide **and** both scripts before
uploading. They are hosted at the public R2 prefix configured in
`scripts/.env.r2.example`:

- bucket: set `R2_BUCKET`
- prefix: set `R2_PREFIX`
- endpoint: set `R2_ENDPOINT`
- public base URL: set `R2_PUBLIC_BASE_URL` if public URLs should be printed

To upload:

```bash
cp scripts/.env.r2.example scripts/.env.r2     # if not already set
# fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, R2_ENDPOINT, and R2_BUCKET
scripts/upload-install-md-to-r2.sh
```

To validate without uploading:

```bash
scripts/upload-install-md-to-r2.sh --no-upload
```

The script reads `$REPO_ROOT/install.md` and `$REPO_ROOT/scripts/install-clawchat.{sh,ps1}`
directly — do not move those files without also updating the script.

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
   repos, and commit those.
4. Tag this repo `skills-vX.Y.Z` and push the tag.
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
