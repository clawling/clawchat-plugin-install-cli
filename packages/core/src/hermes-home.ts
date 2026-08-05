import * as os from "node:os";
import * as path from "node:path";

/**
 * Where Hermes keeps its home directory, per platform.
 *
 * `~/.hermes` is the POSIX layout only. On Windows Hermes uses
 * `%LOCALAPPDATA%\hermes` (`hermes_constants._get_platform_default_hermes_home`),
 * falling back to `<home>\AppData\Local\hermes` when LOCALAPPDATA is unset.
 *
 * This package used to hardcode the POSIX path in three places, so on a Windows
 * desktop with no `HERMES_HOME` exported the installer wrote `CLAWCHAT_BASE_URL`
 * into a directory Hermes never reads and `readHermesAuth` looked for the token
 * there too — a paired agent reported as unauthenticated, and a custom backend
 * URL silently ignored.
 */
export interface HermesHomeOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  /** Defaults to `process.platform`; injectable so both layouts are testable. */
  platform?: NodeJS.Platform;
}

/** Hermes' native home for this platform, ignoring `HERMES_HOME`. */
export function platformDefaultHermesHome(options: HermesHomeOptions = {}): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    return path.join(localAppData || path.join(homeDir, "AppData", "Local"), "hermes");
  }
  return path.join(homeDir, ".hermes");
}

/**
 * The Hermes root: an explicit `HERMES_HOME` when exported, else the
 * platform-native default. Named profiles live under `<root>/profiles/<name>`.
 */
export function resolveHermesHomeRoot(options: HermesHomeOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = env.HERMES_HOME?.trim();
  return configured || platformDefaultHermesHome(options);
}
