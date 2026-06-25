# Release

This project ships two artifacts that are released independently:

1. The npm package `@clawling/clawchat-plugin-install-cli`, published from
   `packages/cli`.
2. The runtime install guide `install.md`, uploaded to a public R2 prefix
   by `scripts/upload-install-md-to-r2.sh`. Agents and end-users fetch this
   file at install time.

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

## Refresh the runtime install guide on R2

`install.md` at the repo root is the file end-users (or AI agents on their
behalf) read after running `npx -y @clawling/clawchat-plugin-install-cli`. It is
hosted at the public R2 prefix configured in
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

The script reads `$REPO_ROOT/install.md` directly — do not move that file
without also updating the script.

## Bootstrap script

`scripts/install-clawchat.sh` is a thin bash wrapper around
`npx -y @clawling/clawchat-plugin-install-cli@latest`. It is documented in the root
`README.md`; it does not need a release step because users invoke it from
either the GitHub raw URL or a checked-out copy.

Bootstrap-script tests run under Vitest
(`packages/cli/tests/install-script.test.ts`) and stand up temporary mock
executables on `PATH`, so they require no extra setup. They are part of
the normal `pnpm test` run.
