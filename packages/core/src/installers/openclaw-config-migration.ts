// packages/core/src/installers/openclaw-config-migration.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { getOpenClawConfigPath } from "../auth/openclaw";
import { OPENCLAW_CHANNEL } from "../config";

/** Old OpenClaw ClawChat plugin id / channel key (pre-rename). */
export const OLD_OPENCLAW_CLAWCHAT_ID = "openclaw-clawchat";
/** New OpenClaw ClawChat plugin id / channel key. */
export const NEW_OPENCLAW_CLAWCHAT_ID = OPENCLAW_CHANNEL;

// Guard against prototype-pollution: never treat these as data keys.
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own, enumerable, non-prototype-pollution keys of a plain object. */
function safeKeys(obj: Record<string, any>): string[] {
  return Object.keys(obj).filter((k) => !FORBIDDEN_KEYS.has(k));
}

function isNonEmptyObject(value: unknown): value is Record<string, any> {
  return isPlainObject(value) && safeKeys(value).length > 0;
}

/**
 * Deterministically migrate an OpenClaw config that still references the legacy
 * `openclaw-clawchat` plugin id over to the new `clawchat-plugin-openclaw` id.
 *
 * Pure: the input is never mutated (a structured clone is returned). Idempotent:
 * when no legacy id appears anywhere, `changes` is empty and `config` is an
 * untouched clone. Tolerates missing / oddly-typed sections without throwing and
 * ignores prototype-pollution keys.
 */
export function migrateLegacyOpenClawClawChatConfig(
  input: Record<string, any>,
): { config: Record<string, any>; changes: string[] } {
  const NEW_ID = NEW_OPENCLAW_CLAWCHAT_ID;
  const OLD_ID = OLD_OPENCLAW_CLAWCHAT_ID;
  // Hard invariant: the channel constant must already be the renamed id.
  if (NEW_ID !== "clawchat-plugin-openclaw") {
    throw new Error(`OPENCLAW_CHANNEL must be "clawchat-plugin-openclaw", got "${NEW_ID}"`);
  }

  const config: Record<string, any> = isPlainObject(input)
    ? structuredClone(input)
    : {};
  const changes: string[] = [];

  // 1. channels: move / merge-missing the old channel block into the new key.
  if (isPlainObject(config.channels)) {
    const channels = config.channels;
    const oldChannel = channels[OLD_ID];
    if (isNonEmptyObject(oldChannel)) {
      const newChannel = channels[NEW_ID];
      if (!isNonEmptyObject(newChannel)) {
        // Move the whole block to the new key.
        channels[NEW_ID] = oldChannel;
        changes.push(`channels: moved "${OLD_ID}" block to "${NEW_ID}"`);
      } else {
        // Merge-missing: only copy keys absent in the new block; new always wins.
        const copied: string[] = [];
        for (const key of safeKeys(oldChannel)) {
          if (!(key in newChannel)) {
            newChannel[key] = oldChannel[key];
            copied.push(key);
          }
        }
        if (copied.length > 0) {
          changes.push(
            `channels: merged missing keys [${copied.join(", ")}] from "${OLD_ID}" into "${NEW_ID}"`,
          );
        }
      }
      delete channels[OLD_ID];
      changes.push(`channels: removed legacy "${OLD_ID}" key`);
    } else if (OLD_ID in channels && !isNonEmptyObject(oldChannel)) {
      // Leave empty / non-object old channel untouched (nothing to migrate).
    }
  }

  // 2 + 3. plugins.allow and plugins.entries.
  if (isPlainObject(config.plugins)) {
    const plugins = config.plugins;

    // 2. allow: drop old id, ensure new id present, preserve order + dedup.
    if (Array.isArray(plugins.allow)) {
      const original: unknown[] = plugins.allow;
      const hadOld = original.includes(OLD_ID);
      if (hadOld) {
        const seen = new Set<unknown>();
        const next: unknown[] = [];
        for (const item of original) {
          if (item === OLD_ID) continue;
          if (seen.has(item)) continue;
          seen.add(item);
          next.push(item);
        }
        if (!seen.has(NEW_ID)) {
          next.push(NEW_ID);
        }
        plugins.allow = next;
        changes.push(`plugins.allow: replaced "${OLD_ID}" with "${NEW_ID}"`);
      }
    }

    // 3. entries: merge-missing old entry into new (new wins), delete old.
    if (isPlainObject(plugins.entries)) {
      const entries = plugins.entries;
      const oldEntry = entries[OLD_ID];
      if (OLD_ID in entries) {
        if (isPlainObject(oldEntry)) {
          const newEntry = isPlainObject(entries[NEW_ID]) ? entries[NEW_ID] : {};
          for (const key of safeKeys(oldEntry)) {
            if (!(key in newEntry)) {
              newEntry[key] = oldEntry[key];
            }
          }
          entries[NEW_ID] = newEntry;
        }
        delete entries[OLD_ID];
        changes.push(`plugins.entries: migrated "${OLD_ID}" to "${NEW_ID}"`);
      }
    }
  }

  // 4. tools.allow and tools.alsoAllow: replace old id -> new id, dedup.
  if (isPlainObject(config.tools)) {
    const tools = config.tools;
    for (const field of ["allow", "alsoAllow"] as const) {
      if (Array.isArray(tools[field]) && tools[field].includes(OLD_ID)) {
        const seen = new Set<unknown>();
        const next: unknown[] = [];
        for (const item of tools[field] as unknown[]) {
          const mapped = item === OLD_ID ? NEW_ID : item;
          if (seen.has(mapped)) continue;
          seen.add(mapped);
          next.push(mapped);
        }
        tools[field] = next;
        changes.push(`tools.${field}: replaced "${OLD_ID}" with "${NEW_ID}"`);
      }
    }
  }

  return { config, changes };
}

export interface ApplyLegacyOpenClawMigrationOptions {
  homeDir?: string;
}

/**
 * Read the OpenClaw config, run {@link migrateLegacyOpenClawClawChatConfig}, and
 * write it back only when something changed. Unreadable / invalid config is a
 * no-op returning `[]`. The on-disk format matches `writeOpenClawBaseUrls`
 * (2-space JSON + trailing newline).
 */
export function applyLegacyOpenClawConfigMigration(
  options: ApplyLegacyOpenClawMigrationOptions = {},
): string[] {
  const configPath = getOpenClawConfigPath({ homeDir: options.homeDir });

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) {
    return [];
  }

  const { config, changes } = migrateLegacyOpenClawClawChatConfig(parsed);
  if (changes.length === 0) {
    return [];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return changes;
}
