import { stripVTControlCharacters } from "node:util";
import { OPENCLAW_PLUGIN_HOST_COMPAT, OPENCLAW_PLUGIN_SPEC } from "../config";
import { ClawchatError } from "../errors";
import type { CommandCapturer } from "./run";
import type { InstallProgressReporter } from "./types";

const UPGRADE_ADVICE =
  "Upgrade OpenClaw (`npm install -g openclaw@latest`, or the host's own updater such as `openclaw update`), then rerun the same installer command.";

function parseHostVersion(output: string) {
  const match = stripVTControlCharacters(output).match(/(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-([\w.-]+))?/);
  if (!match) return undefined;
  return {
    text: match[0],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined && !/^\d+$/.test(match[4]),
  };
}

function meetsMinimum(host: NonNullable<ReturnType<typeof parseHostVersion>>, minimum: string): boolean {
  const parts = minimum.split(".").map(Number);
  for (let index = 0; index < parts.length; index++) {
    const difference = host.parts[index]! - parts[index]!;
    if (difference !== 0) return difference > 0;
  }
  // A numeric suffix is a stable correction; beta/alpha/rc are below the base.
  return !host.prerelease;
}

export async function openClawSpec(
  capture: CommandCapturer,
  ref?: string,
  progress?: InstallProgressReporter,
): Promise<string> {
  if (ref) return `${OPENCLAW_PLUGIN_SPEC}@${ref}`;

  let host: ReturnType<typeof parseHostVersion>;
  try {
    host = parseHostVersion(await capture("openclaw", ["--version"]));
  } catch {
    // Unknown forks/wrappers retain the existing unpinned install path.
  }
  if (!host) {
    progress?.("OpenClaw version could not be read; using the unpinned plugin spec.");
    return OPENCLAW_PLUGIN_SPEC;
  }

  const compatible = OPENCLAW_PLUGIN_HOST_COMPAT.find((entry) => meetsMinimum(host, entry.minHostVersion));
  if (!compatible) {
    const minimum = OPENCLAW_PLUGIN_HOST_COMPAT[OPENCLAW_PLUGIN_HOST_COMPAT.length - 1]!.minHostVersion;
    throw new ClawchatError(
      "PRECONDITION",
      `OpenClaw ${host.text} is too old; the plugin requires >=${minimum}. ${UPGRADE_ADVICE}`,
    );
  }
  if (compatible.pluginVersion) {
    progress?.(
      `OpenClaw ${host.text}: pinning ${compatible.pluginVersion}, the last plugin version compatible with this host. Upgrade OpenClaw to get the latest plugin.`,
    );
    return `${OPENCLAW_PLUGIN_SPEC}@${compatible.pluginVersion}`;
  }
  return OPENCLAW_PLUGIN_SPEC;
}

export function classifyOpenClawRefusal(message: string): "legacy_config" | "prerelease_refused" | "host_too_old" | undefined {
  const text = stripVTControlCharacters(message);
  if (/Legacy config keys detected/i.test(text) || (/Config invalid/i.test(text) && /doctor\s+--fix/i.test(text))) {
    return "legacy_config";
  }
  if (/Resolved [^\r\n]* to prerelease version [^\r\n]*but prereleases are only installed when explicitly requested/i.test(text)) {
    return "prerelease_refused";
  }
  if (/requires OpenClaw\s+>=/i.test(text)) return "host_too_old";
  return undefined;
}

function legacyConfigKeys(text: string): string[] {
  const section = text.split(/Legacy config keys detected:[^\S\r\n]*/i)[1];
  if (!section) return [];
  const keys = new Set<string>();
  for (const line of section.trimStart().split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+([^:]+):/);
    if (!item) break;
    const key = item[1]!.trim();
    if (/^[A-Za-z0-9_.\-\[\]"*]+$/.test(key)) keys.add(key);
    if (keys.size >= 10) break;
  }
  return [...keys];
}

/** Only known host refusals are replaced; all other failures keep their identity. */
export function translateOpenClawRefusal(error: unknown): unknown {
  if (!(error instanceof ClawchatError) || error.code !== "SUBPROCESS") return error;
  const text = stripVTControlCharacters(error.message);
  switch (classifyOpenClawRefusal(text)) {
    case "legacy_config": {
      const keys = legacyConfigKeys(text);
      return new ClawchatError(
        "LEGACY_CONFIG",
        (keys.length ? `OpenClaw refused the install because of legacy config keys: ${keys.join(", ")}. ` :
          "OpenClaw refused the install because its config is invalid. Run `openclaw config validate` to list the keys. ") +
        "The installer did not change your OpenClaw config. Back up the config file, then run `openclaw doctor --fix` to migrate legacy keys (or edit the listed keys by hand as `openclaw config validate` describes), and rerun this installer.",
      );
    }
    case "prerelease_refused": {
      const hostLine = text.match(/Resolved [^\r\n]*/i)![0];
      const pinned = OPENCLAW_PLUGIN_HOST_COMPAT.find((entry) => entry.pluginVersion)!;
      const latestMinimum = OPENCLAW_PLUGIN_HOST_COMPAT[0]!.minHostVersion;
      return new ClawchatError(
        "PRERELEASE_REFUSED",
        `${hostLine}\nThis OpenClaw is older than the plugin supports or its version could not be read. Check \`openclaw --version\`. ${UPGRADE_ADVICE} ` +
        `Or retry with an exact version \`--target openclaw@${pinned.pluginVersion}\` on hosts >=${pinned.minHostVersion} and <${latestMinimum}.`,
      );
    }
    case "host_too_old": {
      // Retain only the compatibility refusal, never unrelated config output/values.
      const hostLine = text.match(/plugin "[^"\r\n]*" requires OpenClaw\s+>=[^\r\n]*/i)?.[0] ?? "The plugin requires a newer OpenClaw host.";
      return new ClawchatError(
        "PRECONDITION",
        `${hostLine}\nOpenClaw is too old or its version could not be determined. ${UPGRADE_ADVICE}`,
      );
    }
    default: return error;
  }
}
