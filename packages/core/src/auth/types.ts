import type { ClawchatTarget } from "../config";

export interface TargetAuth {
  target: ClawchatTarget;
  token: string;
  refreshToken?: string;
  userId?: string;
  baseUrl?: string;
}

export interface AuthReadOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`; injectable so both home layouts are testable. */
  platform?: NodeJS.Platform;
}
