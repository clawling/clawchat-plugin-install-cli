# @clawling/clawchat-plugin-install-cli

CLI for installing and updating ClawChat plugins in supported agents.

## Install

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw
```

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes
```

For OpenClaw, `install` delegates to `openclaw plugins install @clawling/clawchat-plugin-openclaw --force --dangerously-force-unsafe-install`. `--force` is unconditional on install; the CLI also appends `--accept-capabilities` when the host's install help advertises it. ClawChat is a third-party (non-catalog) plugin: on older OpenClaw the unsafe-install flag bypasses the install-time safety scan that would block it, and on newer OpenClaw it is a deprecated no-op (installs allowed by default; operator gating via `security.installPolicy`) — safe on both. For Hermes, `install` first fetches the remote `plugin.yaml`, validates that `hermes --version` satisfies the declared requirement, and only then installs or updates the plugin. ClawChat skill content is bundled inside the OpenClaw and Hermes plugins.

Both commands accept `--force` to reinstall the plugin even when the host reports it as current.

For Hermes, both `install` and `update` accept `--install-timeout <seconds>` for the canonical remote `hermes plugins install` step (including `--force` reinstalls). The flag overrides `CLAWCHAT_INSTALL_TIMEOUT_SECONDS`; both accept integers from 1 to 3600 seconds, with a default of 120 seconds (120_000 ms). Invalid values fail validation. The progress line shows the limit; on timeout the command is stopped with SIGKILL and the error explains how to raise it. Other Hermes steps keep their existing budgets, and OpenClaw ignores this setting.

`install` also accepts `--activate <code>` (Hermes only): after a successful install the CLI runs `hermes clawchat activate <code>` once, so installing and pairing is a single command. The code is single-use and is never retried; the result line ends with `+ activated`.

For Hermes, `--profile <name>` targets a specific Hermes profile: the CLI passes `-p <name>` to the delegated `hermes` calls and writes base URLs to that profile's `$HERMES_HOME/.env`. It resolves to `<HERMES_HOME-or-platform-default>/profiles/<name>`, so pass `--profile` **or** point `HERMES_HOME` at the profile directory — never both. On a multi-profile host, confirm the active profile before installing or activating: a mis-targeted run pairs a different agent with no error, and connect codes are single-use.

## Update

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target openclaw
```

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes
```

For OpenClaw, `update` delegates to `openclaw plugins update @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`, appending `--accept-capabilities` when supported by the host. For Hermes, `update` requires an installed plugin and delegates to `hermes plugins update clawchat`, even when the installed `plugin.yaml` version already matches the remote version, followed by `hermes plugins enable clawchat` unless the host reports that its scan disabled the plugin (`SCAN_BLOCKED`). `--force` lifts that requirement: `update --target hermes --force` on a host with no ClawChat plugin installs it instead of failing.

Use `--force` as an explicit repair/reinstall path. For Hermes, the first attempt is `hermes plugins install clawling/clawchat-plugin-hermes-agent --enable`, without the host's `--force`. Only after the scan passes and the host reports `already exists` does the CLI retry with `--force --enable` to replace the existing install. Scan refusals stop with `SCAN_BLOCKED`; the CLI's `--force` does not override them. For Hermes update failures caused by dirty local plugin files or Git fast-forward conflicts, repair explicitly with `npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes --force`.
