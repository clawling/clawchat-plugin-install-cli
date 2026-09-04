export const DEFAULT_BASE_URL = "https://app.clawling.com";
export const OPENCLAW_CHANNEL = "clawchat-plugin-openclaw";
export const OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw";
// ClawChat is a non-catalog ("unsafe") plugin: older OpenClaw blocks it at install
// time without this flag, newer OpenClaw treats the flag as a deprecated no-op.
// Passing it on every delegated `openclaw plugins install/update` is safe on both.
export const OPENCLAW_UNSAFE_INSTALL_FLAG = "--dangerously-force-unsafe-install";
// OpenClaw >=2026.8 requires explicit consent to a plugin's declared capabilities before
// `plugins install/update/enable` will proceed. Older hosts reject the flag as an unknown
// option, so it is passed only when the host's own help advertises it.
export const OPENCLAW_ACCEPT_CAPABILITIES_FLAG = "--accept-capabilities";
export const HERMES_PLUGIN_YAML_URL =
  "https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml";
export const HERMES_PLUGIN_SPEC = "clawling/clawchat-plugin-hermes-agent";
export const HERMES_PLUGIN_NAME = "clawchat";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Canonical, official source for ClawChat agent skill markdown. The two agent
// adapters fetch `${OFFICIAL_SKILLS_BASE}/${ref}/skills/manifest.json` and the
// per-skill `SKILL.md` it references. This base is a hard-coded constant on
// purpose — a skill-update trigger signal never carries a URL, only a version
// that maps to `ref`. `clawling` is a public org so raw fetches are unauthed.
export const OFFICIAL_SKILLS_BASE =
  "https://raw.githubusercontent.com/clawling/clawchat-plugin-install-cli";
// Default git ref for the skills tree — an immutable `skills-vX.Y.Z` tag, not
// the moving `main`, so a caller that omits `ref` still reads a fixed tree
// rather than whatever has landed here since. Both agent adapters pin the same
// tag in their own copies of this constant; move all three together when a new
// skills tag ships.
export const DEFAULT_SKILLS_REF = "skills-v1.7.0";
// Refuse to treat an absurdly large response as a skill file (defence in depth
// against a poisoned/oversized download before it is hashed and written).
export const MAX_SKILL_BYTES = 256 * 1024;

export const TARGETS = ["openclaw", "hermes"] as const;
export type ClawchatTarget = (typeof TARGETS)[number];

export function isClawchatTarget(value: string): value is ClawchatTarget {
  return (TARGETS as readonly string[]).includes(value);
}
