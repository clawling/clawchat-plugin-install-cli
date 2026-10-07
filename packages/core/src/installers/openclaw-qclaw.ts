// packages/core/src/installers/openclaw-qclaw.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getOpenClawConfigPath } from "../auth/openclaw";
import { OPENCLAW_PLUGIN_SPEC } from "../config";
import type { CommandCapturer } from "./run";
import type { InstallProgressReporter } from "./types";

/**
 * QClaw is a desktop app that bundles an OpenClaw engine (`<install dir>/resources/openclaw/`)
 * and keeps its state in `~/.qclaw/` (`C:\Users\<user>\.qclaw\` on Windows) instead of
 * `~/.openclaw/`.
 *
 * `openclaw plugins install` on QClaw lays the package down under
 * `~/.qclaw/npm/projects/clawling-clawchat-plugin-openclaw-<hash>/` like on any host, but
 * the engine never discovers it: QClaw's `plugins.load.paths` only lists its own bundled
 * `config/extensions` directory and no installed-plugin index is written, so the gateway
 * reports `plugin not found`. Adding the installed package directory to
 * `plugins.load.paths` by hand made it load (field report on QClaw 2026.6.5, Windows). This
 * module does that step for the user.
 *
 * Caveat the user is told about: `openclaw doctor --fix` may treat the entry as stale config
 * and drop it; rerunning the installer puts it back.
 */
const QCLAW_STATE_DIR_NAME = ".qclaw";
const OPENCLAW_CONFIG_FILE_NAME = "openclaw.json";

/** Suffix OpenClaw appends to a managed npm project dir for each artifact generation. */
const GENERATION_SEPARATOR = "__openclaw-generation__";

function splitAnyPath(value: string): string[] {
  return value.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

/** Whether `configPath` is QClaw's `openclaw.json` (`…/.qclaw/openclaw.json`, any separator/case). */
export function isQClawConfigPath(configPath: string): boolean {
  const segments = splitAnyPath(configPath.trim());
  if (segments.length < 2) {
    return false;
  }
  const file = segments[segments.length - 1]!;
  const dir = segments[segments.length - 2]!;
  return file.toLowerCase() === OPENCLAW_CONFIG_FILE_NAME && dir.toLowerCase() === QCLAW_STATE_DIR_NAME;
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

export interface ResolveActiveConfigOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The config file the host itself reads.
 *
 * Asks the host (`openclaw config file`) first: a QClaw `openclaw` launcher may point the
 * engine at `~/.qclaw` internally, which our own env/home resolution cannot see. Falls back
 * to {@link getOpenClawConfigPath} when the host cannot be asked (older engine, no CLI).
 */
export async function resolveActiveOpenClawConfigPath(
  capture: CommandCapturer,
  options: ResolveActiveConfigOptions = {},
): Promise<string> {
  const homeDir = options.homeDir ?? os.homedir();
  try {
    const output = await capture("openclaw", ["config", "file"]);
    const line = output
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => /\.json5?$/i.test(entry))
      .pop();
    if (line) {
      return expandHome(line, homeDir);
    }
  } catch {
    // fall through to the local resolution
  }
  return getOpenClawConfigPath({ homeDir, env: options.env });
}

/** OpenClaw's `safePathSegmentHashed` without the hash: the stable prefix of the project dir. */
function managedProjectDirPrefix(packageName: string): string {
  return packageName
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * The directory of the ClawChat package that the host's managed npm installer laid down
 * under `<stateDir>/npm/projects/`, or null when there is none. When several generations
 * exist, the most recently written one wins.
 */
export function findManagedOpenClawPluginDir(
  stateDir: string,
  packageName: string = OPENCLAW_PLUGIN_SPEC,
): string | null {
  const projectsDir = path.join(stateDir, "npm", "projects");
  const prefix = `${managedProjectDirPrefix(packageName)}-`;
  let entries: string[];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  let best: { dir: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    const pkgDir = path.join(projectsDir, entry, "node_modules", ...packageName.split("/"));
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(path.join(pkgDir, "package.json")).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtimeMs > best.mtimeMs) {
      best = { dir: pkgDir, mtimeMs };
    }
  }
  return best?.dir ?? null;
}

function normalizeForCompare(value: string): string {
  // Compare paths written by hand on Windows the way Windows does: separator- and
  // case-insensitive, and ignoring a trailing separator.
  return splitAnyPath(value.trim()).join("/").toLowerCase();
}

/** Whether `entry` points at some generation of the same managed package as `pluginDir`. */
function isOtherGenerationOf(entry: string, pluginDir: string): boolean {
  const entrySegments = splitAnyPath(entry.trim()).map((s) => s.toLowerCase());
  const pluginSegments = splitAnyPath(pluginDir).map((s) => s.toLowerCase());
  const projectsIndex = pluginSegments.lastIndexOf("projects");
  if (projectsIndex < 0 || entrySegments.length !== pluginSegments.length) {
    return false;
  }
  const projectDir = pluginSegments[projectsIndex + 1] ?? "";
  const baseProject = projectDir.split(GENERATION_SEPARATOR)[0]!;
  return pluginSegments.every((segment, index) => {
    if (index === projectsIndex + 1) {
      return entrySegments[index]!.split(GENERATION_SEPARATOR)[0] === baseProject;
    }
    return entrySegments[index] === segment;
  });
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type LoadPathResult = "added" | "present";

/**
 * Idempotently add `pluginDir` to `plugins.load.paths` in `configPath`.
 *
 * Keeps every other entry and every other key; drops only entries that point at another
 * generation of the same managed package (two copies of one plugin id would collide).
 * Throws — without writing — when the file is not plain JSON or `plugins.load.paths`
 * exists but is not a list: rewriting either would lose the user's config.
 */
export function addOpenClawPluginLoadPath(configPath: string, pluginDir: string): LoadPathResult {
  const raw = fs.readFileSync(configPath, "utf8");
  const config: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
  if (!isPlainObject(config)) {
    throw new Error(`${configPath} is not a JSON object`);
  }
  if (config.plugins !== undefined && !isPlainObject(config.plugins)) {
    throw new Error(`plugins in ${configPath} is not an object`);
  }
  const plugins: Record<string, any> = config.plugins ?? {};
  if (plugins.load !== undefined && !isPlainObject(plugins.load)) {
    throw new Error(`plugins.load in ${configPath} is not an object`);
  }
  const load: Record<string, any> = plugins.load ?? {};
  if (load.paths !== undefined && !Array.isArray(load.paths)) {
    throw new Error(`plugins.load.paths in ${configPath} is not a list`);
  }
  const paths: unknown[] = load.paths ?? [];

  const wanted = normalizeForCompare(pluginDir);
  if (paths.some((entry) => typeof entry === "string" && normalizeForCompare(entry) === wanted)) {
    return "present";
  }

  load.paths = [
    ...paths.filter((entry) => !(typeof entry === "string" && isOtherGenerationOf(entry, pluginDir))),
    pluginDir,
  ];
  plugins.load = load;
  config.plugins = plugins;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return "added";
}

export interface EnsureQClawLoadPathOptions extends ResolveActiveConfigOptions {
  capture: CommandCapturer;
  onProgress?: InstallProgressReporter;
}

/**
 * After an install/update: when the active OpenClaw config is QClaw's, make sure the
 * installed plugin directory is in its `plugins.load.paths`. A no-op on any other host.
 * Never throws — a failure here leaves a working install on stock OpenClaw untouched and
 * prints the manual step instead.
 */
export async function ensureQClawPluginLoadPath(options: EnsureQClawLoadPathOptions): Promise<void> {
  const progress = options.onProgress;
  let configPath: string;
  try {
    configPath = await resolveActiveOpenClawConfigPath(options.capture, options);
  } catch {
    return;
  }
  if (!isQClawConfigPath(configPath)) {
    return;
  }
  const stateDir = path.dirname(configPath);
  const manualStep =
    `add the plugin directory (under ${path.join(stateDir, "npm", "projects")}, ` +
    `…/node_modules/${OPENCLAW_PLUGIN_SPEC}) to plugins.load.paths in ${configPath}, then restart QClaw.`;
  const pluginDir = findManagedOpenClawPluginDir(stateDir);
  if (!pluginDir) {
    progress?.(`Warning: QClaw detected but the installed plugin directory was not found; ${manualStep}`);
    return;
  }
  try {
    const result = addOpenClawPluginLoadPath(configPath, pluginDir);
    progress?.(
      result === "added"
        ? `QClaw detected: added ${pluginDir} to plugins.load.paths in ${configPath}.`
        : `QClaw detected: ${pluginDir} is already in plugins.load.paths.`,
    );
    progress?.(
      "Note: `openclaw doctor --fix` may remove that entry as stale; rerun this installer if the plugin stops loading.",
    );
  } catch (error) {
    progress?.(
      `Warning: could not update plugins.load.paths for QClaw (${(error as Error)?.message ?? error}); ${manualStep}`,
    );
  }
}
