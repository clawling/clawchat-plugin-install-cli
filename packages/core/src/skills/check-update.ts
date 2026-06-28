import crypto from "node:crypto";
import {
  DEFAULT_SKILLS_REF,
  MAX_SKILL_BYTES,
  OFFICIAL_SKILLS_BASE,
  type ClawchatTarget,
} from "../config";
import { ClawchatError } from "../errors";
import type { FetchLike } from "../http/client";
import { isVersionOlder } from "../installers/metadata";

/**
 * Skill-version check against the canonical, official skill source.
 *
 * This is the TypeScript reference implementation of the cross-language
 * contract documented in `ops/agent-plugin/skill-dynamic-update-plan.md`
 * (§3, §6.6). The Hermes (Python) adapter re-implements the same `manifest.json`
 * read + semver compare; the OpenClaw (TypeScript) adapter and this CLI can
 * reuse this module. Nothing here applies an update — the consuming adapter
 * owns the consent flow and the atomic file overwrite.
 */

/** One skill row inside `skills/manifest.json`, under `skills.<target>.<id>`. */
export interface SkillManifestEntry {
  /** Skill version (matches the SKILL.md frontmatter `version`). */
  version: string;
  /** Repo-relative path under `skills/`, e.g. `openclaw/clawchat/SKILL.md`. */
  path: string;
  /** Lowercase hex sha256 of the raw `SKILL.md` bytes. */
  sha256: string;
  /** Byte length of the raw `SKILL.md`. */
  bytes: number;
}

/** Parsed `skills/manifest.json`. */
export interface SkillsManifest {
  schema: number;
  skills: Record<string, Record<string, SkillManifestEntry>>;
}

/** Per-skill verdict from {@link checkSkillUpdate}. */
export interface SkillUpdate {
  skillId: string;
  /** Locally installed version, or `null` when the skill is not installed. */
  current: string | null;
  /** Version offered by the official source. */
  latest: string;
  hasUpdate: boolean;
  /** Where the new content lives, ready to hand to {@link fetchSkillMarkdown}. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface CheckSkillUpdateOutcome {
  /** The git ref the manifest was read from. */
  ref: string;
  results: SkillUpdate[];
  /** True when at least one skill has a newer version available. */
  hasUpdate: boolean;
}

export interface CheckSkillUpdateOptions {
  /** Which host's skill set to check (`openclaw` | `hermes`). */
  target: ClawchatTarget;
  /** Locally installed versions: `{ "<skillId>": "<version>" }`. */
  current: Record<string, string>;
  /** Git tag/branch to read; defaults to {@link DEFAULT_SKILLS_REF}. */
  ref?: string;
  /** Raw base URL; defaults to {@link OFFICIAL_SKILLS_BASE}. */
  base?: string;
  fetchFn?: FetchLike;
}

function skillsBase(base: string | undefined, ref: string): string {
  return `${(base ?? OFFICIAL_SKILLS_BASE).replace(/\/+$/, "")}/${ref}/skills`;
}

/** URL of the manifest for a given ref. */
export function manifestUrl(ref: string = DEFAULT_SKILLS_REF, base?: string): string {
  return `${skillsBase(base, ref)}/manifest.json`;
}

/** URL of a single skill markdown file (from a manifest entry's `path`). */
export function skillContentUrl(entryPath: string, ref: string = DEFAULT_SKILLS_REF, base?: string): string {
  return `${skillsBase(base, ref)}/${entryPath.replace(/^\/+/, "")}`;
}

function asEntry(value: unknown, where: string): SkillManifestEntry {
  if (!value || typeof value !== "object") {
    throw new ClawchatError("METADATA", `skills manifest entry ${where} is not an object`);
  }
  const v = value as Record<string, unknown>;
  const version = typeof v.version === "string" ? v.version.trim() : "";
  const path = typeof v.path === "string" ? v.path.trim() : "";
  const sha256 = typeof v.sha256 === "string" ? v.sha256.trim().toLowerCase() : "";
  const bytes = typeof v.bytes === "number" ? v.bytes : NaN;
  if (!version) throw new ClawchatError("METADATA", `skills manifest entry ${where} missing version`);
  if (!path) throw new ClawchatError("METADATA", `skills manifest entry ${where} missing path`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ClawchatError("METADATA", `skills manifest entry ${where} has invalid sha256`);
  }
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new ClawchatError("METADATA", `skills manifest entry ${where} has invalid bytes`);
  }
  return { version, path, sha256, bytes };
}

/** Parse and validate raw manifest text. Exported for adapter/test reuse. */
export function parseSkillsManifest(text: string): SkillsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ClawchatError("METADATA", `failed to parse skills manifest: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ClawchatError("METADATA", "skills manifest must be a JSON object");
  }
  const data = parsed as Record<string, unknown>;
  if (data.schema !== 1) {
    throw new ClawchatError("METADATA", `unsupported skills manifest schema: ${JSON.stringify(data.schema)}`);
  }
  if (!data.skills || typeof data.skills !== "object") {
    throw new ClawchatError("METADATA", "skills manifest missing `skills`");
  }
  const skills: SkillsManifest["skills"] = {};
  for (const [target, entries] of Object.entries(data.skills as Record<string, unknown>)) {
    if (!entries || typeof entries !== "object") {
      throw new ClawchatError("METADATA", `skills manifest target ${target} is not an object`);
    }
    skills[target] = {};
    for (const [skillId, entry] of Object.entries(entries as Record<string, unknown>)) {
      skills[target][skillId] = asEntry(entry, `${target}.${skillId}`);
    }
  }
  return { schema: 1, skills };
}

async function fetchText(url: string, fetchFn: FetchLike): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(url, { method: "GET" });
  } catch (err) {
    throw new ClawchatError("HTTP_ERROR", `fetch ${url} failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new ClawchatError("HTTP_ERROR", `fetch ${url} returned status ${response.status}`);
  }
  return response.text();
}

/**
 * Read the official manifest for `target` and compare each skill's offered
 * version against the locally installed `current` map. A skill missing from
 * `current` is reported as `hasUpdate: true` (latest is newer than nothing).
 */
export async function checkSkillUpdate(options: CheckSkillUpdateOptions): Promise<CheckSkillUpdateOutcome> {
  const ref = options.ref ?? DEFAULT_SKILLS_REF;
  const fetchFn = options.fetchFn ?? fetch;
  const text = await fetchText(manifestUrl(ref, options.base), fetchFn);
  const manifest = parseSkillsManifest(text);
  const targetSkills = manifest.skills[options.target];
  if (!targetSkills) {
    throw new ClawchatError("METADATA", `skills manifest has no entry for target ${options.target}`);
  }

  const results: SkillUpdate[] = [];
  for (const [skillId, entry] of Object.entries(targetSkills)) {
    const current = options.current[skillId] ?? null;
    const hasUpdate = current === null ? true : isVersionOlder(current, entry.version);
    results.push({
      skillId,
      current,
      latest: entry.version,
      hasUpdate,
      path: entry.path,
      sha256: entry.sha256,
      bytes: entry.bytes,
    });
  }
  return { ref, results, hasUpdate: results.some((r) => r.hasUpdate) };
}

/**
 * Download one skill markdown file and integrity-check it against the manifest
 * entry (size cap + exact sha256). Returns the raw markdown text on success.
 */
export async function fetchSkillMarkdown(
  entry: Pick<SkillManifestEntry, "path" | "sha256" | "bytes">,
  options: { ref?: string; base?: string; fetchFn?: FetchLike } = {},
): Promise<string> {
  const ref = options.ref ?? DEFAULT_SKILLS_REF;
  const fetchFn = options.fetchFn ?? fetch;
  const text = await fetchText(skillContentUrl(entry.path, ref, options.base), fetchFn);
  const buf = Buffer.from(text, "utf8");
  if (buf.length > MAX_SKILL_BYTES) {
    throw new ClawchatError("METADATA", `skill ${entry.path} is ${buf.length} bytes, over the ${MAX_SKILL_BYTES} cap`);
  }
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha256 !== entry.sha256.toLowerCase()) {
    throw new ClawchatError("METADATA", `skill ${entry.path} sha256 mismatch: got ${sha256}, expected ${entry.sha256}`);
  }
  return text;
}
