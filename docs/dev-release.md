# Dev Release (Pre-release channel)

How to publish an **unreleased / test build** of
`@clawling/clawchat-plugin-install-cli` so other people can try it, **without**
touching the `latest` channel that real end-users get.

This is the companion to [`release.md`](release.md):

- `release.md` → ships the production build to npm `latest`. The bootstrap
  script (`scripts/install-clawchat.sh`) and the R2-hosted `install.md` both
  pull `@clawling/clawchat-plugin-install-cli@latest`, so **anything on `latest`
  goes straight to real users**.
- `dev-release.md` (this file) → ships a pre-release build to a separate `dev`
  dist-tag that only testers opt into via `@dev`. `latest` is left untouched.

---

## ⚠️ Rule #1 — bump the version on EVERY publish

> **You must increase the version number before every single `npm publish`,
> dev builds included. There are no exceptions.**

Why this is non-negotiable:

- npm versions are **immutable**. Once `0.1.9` exists, you can never republish,
  overwrite, or re-upload `0.1.9` — not even with `--force`. `npm unpublish` is
  also blocked for anything older than 72h / with downloads.
- So if you publish, find a bug, fix it, and try to publish again **with the
  same version**, npm rejects it with `403 You cannot publish over the
  previously published versions`.

Check what already exists before picking a number:

```bash
npm view @clawling/clawchat-plugin-install-cli versions
npm view @clawling/clawchat-plugin-install-cli dist-tags
```

Use a **prerelease identifier** for dev builds so they sort *below* the eventual
final release and never accidentally become `latest`:

| Round | `packages/cli/package.json` version |
|-------|-------------------------------------|
| first dev build of 0.2.0 | `0.2.0-dev.0` |
| next iteration           | `0.2.0-dev.1` |
| next iteration           | `0.2.0-dev.2` |
| … keep incrementing      | `0.2.0-dev.N` |
| final production release | `0.2.0` (via [`release.md`](release.md)) |

> Tip: `npm version prerelease --preid dev --no-git-tag-version` (run inside
> `packages/cli`) bumps `…-dev.N` → `…-dev.N+1` for you. The first prerelease of
> a new line still needs a manual edit, e.g. `0.2.0-dev.0`.

---

## Steps

All commands run from the repo root unless noted.

1. **Make sure the tree is clean** and you are on the branch you want to test.

2. **Bump `packages/cli/package.json` `version`** to the next prerelease value
   (see the table above). This is the step people forget — do it first.

3. **Validate** exactly as for a real release:

   ```bash
   pnpm release:dry
   ```

   This runs `typecheck + test + build + npm pack --dry-run` inside
   `packages/cli` and confirms the tarball contents match `files`
   (`["dist", "README.md"]`).

4. **Build and publish to the `dev` dist-tag:**

   ```bash
   pnpm --filter @clawling/clawchat-plugin-install-cli build
   cd packages/cli
   npm publish --tag dev
   ```

   - `--tag dev` is what keeps this off `latest`. **Never** run a bare
     `npm publish` for a dev build — without `--tag` npm defaults to `latest`
     and your unfinished build becomes what every user installs.
   - `publishConfig.access: "public"` is already set, so no `--access` flag is
     needed for the scoped package.

5. **Verify the channels:**

   ```bash
   npm view @clawling/clawchat-plugin-install-cli dist-tags
   # expect e.g. { latest: '0.1.9', dev: '0.2.0-dev.0' }
   ```

   Confirm `latest` did **not** move.

---

## Consume / test the dev build

Testers opt into the dev channel explicitly with `@dev`:

```bash
# OpenClaw
npx -y @clawling/clawchat-plugin-install-cli@dev install --target openclaw

# Hermes
npx -y @clawling/clawchat-plugin-install-cli@dev install --target hermes
```

Or pin an exact prerelease version when you need to compare two dev builds:

```bash
npx -y @clawling/clawchat-plugin-install-cli@0.2.0-dev.1 install --target openclaw
```

Note: the bootstrap script `scripts/install-clawchat.sh` hard-codes
`@clawling/clawchat-plugin-install-cli@latest`, so it will **not** pick up dev
builds. If you want a tester to use the bootstrap flow against a dev build,
either tell them to run the `npx … @dev` command above directly, or refresh a
**dev copy** of the R2 assets (next section).

---

## (Optional) Dev copy of the R2 install assets

The production `install.md` / `install-clawchat.sh` live at the R2 prefix
`clawchat/` (see [`release.md`](release.md)). To stage a dev copy without
overwriting the production objects, override `R2_PREFIX`:

```bash
cp scripts/.env.r2.example scripts/.env.r2     # fill in the AWS_* keys
R2_PREFIX=clawchat-dev scripts/upload-install-md-to-r2.sh
# → uploads clawchat-dev/install.md and clawchat-dev/install-clawchat.sh
```

If your dev `install.md` should drive a dev CLI build, edit the `npx` spec in
your local `install.md` / `install-clawchat.sh` to use `@dev` before uploading.
Do **not** point the production `clawchat/` prefix at `@dev`.

---

## Promote a dev build to production

When the dev build is validated, you do **not** re-tag the `…-dev.N` version —
cut a clean final version:

1. Bump `packages/cli/package.json` to the final version (drop the `-dev.N`
   suffix), e.g. `0.2.0-dev.3` → `0.2.0`.
2. Follow [`release.md`](release.md) (publish to `latest`, then refresh the
   production R2 `install.md`).

(You *can* alternatively move the tag with
`npm dist-tag add @clawling/clawchat-plugin-install-cli@0.2.0 latest`, but
publishing the clean `0.2.0` per `release.md` is the convention here.)

---

## Quick reference

```bash
# 1. bump packages/cli/package.json -> e.g. 0.2.0-dev.0   (REQUIRED every time)
# 2. validate
pnpm release:dry
# 3. build + publish to the dev channel only
pnpm --filter @clawling/clawchat-plugin-install-cli build
cd packages/cli && npm publish --tag dev
# 4. verify latest did not move
npm view @clawling/clawchat-plugin-install-cli dist-tags
# 5. test
npx -y @clawling/clawchat-plugin-install-cli@dev install --target openclaw
```

There is no GitHub Actions release workflow today; dev publishing is manual,
just like production.
