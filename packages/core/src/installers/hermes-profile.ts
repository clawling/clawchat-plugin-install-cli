import * as path from "node:path";
import { type HermesHomeOptions, resolveHermesHomeRoot } from "../hermes-home";

/** A profile name meaning "the default HERMES_HOME" — no -p flag, no redirect. */
export function isDefaultProfile(profile?: string): boolean {
  const name = profile?.trim();
  return !name || name === "default";
}

/**
 * Prepend `-p <profile>` to a `hermes` argument list for a named profile.
 * Mirrors Hermes' own `hermes -p <name> <subcommand>` selection, which is
 * pre-parsed before argparse and stripped from argv.
 */
export function withHermesProfileArgs(profile: string | undefined, args: readonly string[]): string[] {
  if (isDefaultProfile(profile)) {
    return [...args];
  }
  return ["-p", (profile as string).trim(), ...args];
}

/**
 * Resolve a profile name to its HERMES_HOME directory, mirroring Hermes'
 * layout: the default profile is the Hermes root (an explicit `HERMES_HOME`,
 * else the platform-native default — `~/.hermes` on POSIX,
 * `%LOCALAPPDATA%\hermes` on Windows); a named profile is
 * `<root>/profiles/<name>`.
 */
export function resolveHermesProfileHome(
  profile: string | undefined,
  opts: HermesHomeOptions = {},
): string {
  const baseRoot = resolveHermesHomeRoot(opts);
  if (isDefaultProfile(profile)) {
    return baseRoot;
  }
  return path.join(baseRoot, "profiles", (profile as string).trim());
}
