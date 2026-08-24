# @clawling/clawchat-plugin-install-cli

CLI for installing and updating ClawChat plugins in supported agents.

## Install

```bash
npx -y @clawling/clawchat-plugin-install-cli install --target openclaw
```

```bash
npx -y @clawling/clawchat-plugin-install-cli install --target hermes
```

For OpenClaw, `install` delegates to `openclaw plugins install @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`. ClawChat is a third-party (non-catalog) plugin: on older OpenClaw the flag bypasses the install-time safety scan that would block it, and on newer OpenClaw it is a deprecated no-op (installs allowed by default; operator gating via `security.installPolicy`) — safe on both. For Hermes, `install` first fetches the remote `plugin.yaml`, validates that `hermes --version` satisfies the declared requirement, and only then installs or updates the plugin. ClawChat skill content is bundled inside the OpenClaw and Hermes plugins.

Both commands accept `--force` to reinstall the plugin even when the host reports it as current.

`install` also accepts `--activate <code>` (Hermes only): after a successful install the CLI runs `hermes clawchat activate <code>` once, so installing and pairing is a single command. The code is single-use and is never retried; the result line ends with `+ activated`.

For Hermes, `--profile <name>` targets a specific Hermes profile: the CLI passes `-p <name>` to the delegated `hermes` calls and writes base URLs to that profile's `$HERMES_HOME/.env`. It resolves to `<HERMES_HOME-or-platform-default>/profiles/<name>`, so pass `--profile` **or** point `HERMES_HOME` at the profile directory — never both. On a multi-profile host, confirm the active profile before installing or activating: a mis-targeted run pairs a different agent with no error, and connect codes are single-use.

## Update

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target openclaw
```

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes
```

For OpenClaw, `update` delegates to `openclaw plugins update @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`. For Hermes, `update` requires an installed plugin and delegates to `hermes plugins update clawchat`, even when the installed `plugin.yaml` version already matches the remote version. `--force` lifts that requirement: `update --target hermes --force` on a host with no ClawChat plugin installs it instead of failing.

Use `--force` as an explicit repair/reinstall path. For Hermes, `--force` runs `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`. For Hermes update failures caused by dirty local plugin files or Git fast-forward conflicts, repair explicitly with `npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes --force`.
