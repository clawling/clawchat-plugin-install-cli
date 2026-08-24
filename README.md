# @clawling/clawchat-plugin-install-cli

CLI for installing and updating ClawChat plugins on supported agent
runtimes. Published to npm as
[`@clawling/clawchat-plugin-install-cli`](https://www.npmjs.com/package/@clawling/clawchat-plugin-install-cli);
this repository is the source.

The CLI exposes two commands — `install` and `update` — each accepting
`--target <openclaw|hermes>` and an optional `--force`. It delegates the
actual plugin work to the host agent's plugin manager.

## Quick start

For end-users / agents at install time, the canonical guide is
[`install.md`](install.md). The TL;DR:

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
# or
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

For OpenClaw, `install` delegates to
`openclaw plugins install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`.
Both `install` and `update` may also rewrite the user's `~/.openclaw/openclaw.json`
after that call: a config still referencing the pre-rename `openclaw-clawchat`
plugin id is migrated onto `clawchat-plugin-openclaw` (channel block,
`plugins.allow`, entries, tools) so upgrading from the old plugin keeps the
existing pairing. Nothing is written when no legacy id is present, and a
migration failure is reported as a warning rather than aborting the install.
ClawChat is a third-party (non-catalog) plugin: on older OpenClaw the flag
bypasses the install-time safety scan that would block it; on newer OpenClaw it
is a deprecated no-op (installs allowed by default, operator gating via
`security.installPolicy`). Passing it is safe on both. See
[`docs/architecture.md`](docs/architecture.md) for details.

For Hermes, `install` first fetches the remote `plugin.yaml`, checks that
`hermes --version` satisfies the declared requirement, and then runs
`hermes plugins install clawling/clawchat-plugin-hermes-agent --enable` (or
`hermes plugins update clawchat` if a newer version is needed).

For Hermes, `--profile <name>` (Hermes only) targets a specific Hermes profile:
the CLI passes `-p <name>` to the delegated `hermes` calls and writes base URLs
to that profile's `$HERMES_HOME/.env`. Omit it to target the active/default
profile.

On a host with more than one Hermes profile, confirm the profile **before**
installing or activating — every ClawChat identity is keyed on the active
`HERMES_HOME`, a mis-targeted run pairs a different agent with no error, and
connect codes are single-use:

- `--profile <name>` resolves to `<HERMES_HOME-or-platform-default>/profiles/<name>`.
  Pass it **or** point `HERMES_HOME` at the profile directory — never both, or
  credentials land in `…/profiles/<name>/profiles/<name>`.
- The delegated `hermes` calls follow `-p` → a profile-scoped `HERMES_HOME` → the
  sticky `<root>/active_profile` file → default. Bare-`python` entry points such
  as the Hermes 0.12 `clawchat_cli.py` fallback follow `HERMES_HOME` **only** and
  silently use the default profile; `hermes profile use` does not reach them.
- `hermes profile create <name>` does not switch the current shell or agent
  session into `<name>`.

Full procedure — confirm, pin, verify — in [`install.md`](install.md#1-verify-the-target-and-check-for-an-existing-install)
and the Hermes plugin's
[install guide](https://github.com/clawling/clawchat-plugin-hermes-agent/blob/main/docs/install.md#confirm-the-target-profile-before-every-install--activate).

The published npm package does not bundle a skill of its own — each agent
adapter ships a snapshot of its host's ClawChat skill markdown for
offline/first-run fallback. This repository, however, **is** the canonical host
for two trees those adapters fetch at runtime, both served from GitHub raw via
the `OFFICIAL_SKILLS_BASE` constant in `packages/core/src/config.ts` and pinned to
the same `skills-vX.Y.Z` tag:

- `skills/` plus the generated `skills/manifest.json` — the agent skill markdown.
- `livewares/` plus the generated `livewares/manifest.json` — the Liveware Sample
  demo app the plugins auto-install.

See [`skills/README.md`](skills/README.md) and the "Skills hosting subsystem" /
"Livewares hosting subsystem" sections of
[`docs/architecture.md`](docs/architecture.md).

## Update

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target openclaw
# or
npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes
```

For OpenClaw, `update` delegates to
`openclaw plugins update @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`.

For Hermes, `update` requires an installed plugin and delegates to
`hermes plugins update clawchat` followed by `hermes plugins enable clawchat`,
even when the installed `plugin.yaml` version already matches the remote
version. Pass `--force` as the explicit repair path: with `--force`, Hermes
runs `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`.
`--force` also lifts the "not installed" precondition — `update --force` on a
host with no ClawChat plugin installs it instead of failing, and reports
`installed`.
The same `--force` is recommended when a Hermes update fails with a dirty
checkout or fast-forward conflict.

If local ClawChat plugin files look corrupted while the version is already
current, rerun the same command with `--force` to reinstall the plugin.

## Pointing at a custom backend / installing a test branch

Pass the backend endpoints at install time. A bare `host:port` is normalized
assuming TLS (`--wsbaseurl` → `wss://host:port/ws`, `--apibaseurl` /
`--mediabaseurl` → `https://host:port`); pass a full `ws://`/`http://` URL to
opt out of TLS for non-TLS hosts. Use `host@ref` to install a test
branch/version instead of the published default:

```bash
# OpenClaw: install the `dev` dist-tag against a custom backend
npx -y @clawling/clawchat-plugin-install-cli@latest install \
  --target openclaw@dev \
  --apibaseurl <api-host:port> \
  --wsbaseurl <ws-host:port> \
  --mediabaseurl <media-host:port>

# Hermes: install a git branch against a custom backend
npx -y @clawling/clawchat-plugin-install-cli@latest install \
  --target hermes@https://github.com/clawling/clawchat-plugin-hermes-agent.git#dev \
  --apibaseurl <api-host:port> \
  --wsbaseurl <ws-host:port> \
  --mediabaseurl <media-host:port>
```

- `--apibaseurl` → REST/API base (activation/connect, profile, friends, moments …)
- `--wsbaseurl` → WebSocket messaging (`/ws` is appended for a bare `host:port`)
- `--mediabaseurl` → media upload/download

Where and when they are written differs per target:

- **Hermes** — into `<Hermes home>/.env`, **before** the host is touched. The
  Hermes home is `$HERMES_HOME` when exported, otherwise the platform default:
  `~/.hermes` on POSIX, `%LOCALAPPDATA%\hermes` on Windows. With
  `--profile <name>` it is that profile's directory,
  `<root>/profiles/<name>/.env`.
- **OpenClaw** — into `~/.openclaw/openclaw.json` under channel
  `clawchat-plugin-openclaw`, **after** the plugin is installed. The channel id
  is not registered until the install finishes, so writing it earlier makes
  OpenClaw's own config validation fail with "unknown channel id".

The plugin reads them at startup, falling back to its built-in defaults when
unset. `--target openclaw@<ref>` installs the npm
dist-tag/version `<ref>`; `--target hermes@<giturl#branch>` installs that git
ref (forced) and runs the version compat check against the branch's
`plugin.yaml`. Both flags work on `update` as well as `install`.

## Bootstrap script (alternative entry-point)

```bash
scripts/install-clawchat.sh openclaw
scripts/install-clawchat.sh hermes
```

The script requires an explicit target, verifies the target CLI is
available (auto-activating a Hermes virtualenv if needed), and uses
`npx -y @clawling/clawchat-plugin-install-cli@latest` without installing a global
`clawchat` command. It installs the plugin when missing; when an installed
plugin is detected, it runs `update --target <target>` and retries with
`--force` if the update fails.

`scripts/install-clawchat.ps1` is the PowerShell equivalent for Windows, with the
same argument and behaviour:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-clawchat.ps1 <openclaw|hermes>
```

Both scripts are published to R2 alongside `install.md` (see
[`docs/release.md`](docs/release.md)), so end-users usually fetch them from there
rather than from a checkout.

## Documentation map

- [`install.md`](install.md) — runtime install guide for end-users and AI
  agents. Also the file published to R2.
- [`docs/README.md`](docs/README.md) — docs index (long-form documentation):
  - [`docs/architecture.md`](docs/architecture.md) — workspace topology,
    install flows per target, library API, security notes.
  - [`docs/development.md`](docs/development.md) — pnpm setup, build,
    test, local plugin testing.
  - [`docs/release.md`](docs/release.md) — how to publish the CLI, refresh the
    R2-hosted `install.md` and installer scripts, and cut a skills tag.
  - [`docs/runtime-install-guide.md`](docs/runtime-install-guide.md) —
    what `install.md` is for and how it is delivered.
- [`packages/core/README.md`](packages/core/README.md) —
  workspace-private core library.
- [`AGENTS.md`](AGENTS.md) — coding conventions for contributors and
  coding agents.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

See [`docs/development.md`](docs/development.md) for filters, environment
variables, and how to test against a local plugin build.
