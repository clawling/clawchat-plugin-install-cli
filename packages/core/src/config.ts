export const DEFAULT_BASE_URL = "https://app.clawling.com";
export const OPENCLAW_CHANNEL = "clawchat-plugin-openclaw";
export const OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw";
// ClawChat is a non-catalog ("unsafe") plugin: older OpenClaw blocks it at install
// time without this flag, newer OpenClaw treats the flag as a deprecated no-op.
// Passing it on every delegated `openclaw plugins install/update` is safe on both.
export const OPENCLAW_UNSAFE_INSTALL_FLAG = "--dangerously-force-unsafe-install";
export const HERMES_PLUGIN_YAML_URL =
  "https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml";
export const HERMES_PLUGIN_SPEC = "clawling/clawchat-plugin-hermes-agent";
export const HERMES_PLUGIN_NAME = "clawchat";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const TARGETS = ["openclaw", "hermes"] as const;
export type ClawchatTarget = (typeof TARGETS)[number];

export function isClawchatTarget(value: string): value is ClawchatTarget {
  return (TARGETS as readonly string[]).includes(value);
}
