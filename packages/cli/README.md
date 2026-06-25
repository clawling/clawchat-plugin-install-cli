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

## Update

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target openclaw
```

```bash
npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes
```

For OpenClaw, `update` delegates to `openclaw plugins update @clawling/clawchat-plugin-openclaw --dangerously-force-unsafe-install`. For Hermes, `update` requires an installed plugin and delegates to `hermes plugins update clawchat`, even when the installed `plugin.yaml` version already matches the remote version.

Use `--force` as an explicit repair/reinstall path. For Hermes, `--force` runs `hermes plugins install clawling/clawchat-plugin-hermes-agent --force --enable`. For Hermes update failures caused by dirty local plugin files or Git fast-forward conflicts, repair explicitly with `npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes --force`.
