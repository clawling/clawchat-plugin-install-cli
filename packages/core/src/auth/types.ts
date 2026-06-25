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
}
