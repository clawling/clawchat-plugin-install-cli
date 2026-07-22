import * as os from "node:os";
import * as path from "node:path";

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
 * layout: the default profile is `~/.hermes` (or an explicit `HERMES_HOME`);
 * a named profile is `~/.hermes/profiles/<name>`.
 */
export function resolveHermesProfileHome(
  profile: string | undefined,
  opts: { homeDir?: string; env?: Record<string, string | undefined> } = {},
): string {
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();
  if (isDefaultProfile(profile)) {
    return env.HERMES_HOME?.trim() || path.join(homeDir, ".hermes");
  }
  return path.join(homeDir, ".hermes", "profiles", (profile as string).trim());
}
