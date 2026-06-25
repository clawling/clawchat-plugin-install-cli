import type { ClawchatTarget } from "../config";
import { readHermesAuth } from "./hermes";
import { readOpenClawAuth } from "./openclaw";
import type { AuthReadOptions, TargetAuth } from "./types";

interface ResolveTargetAuthOptions extends AuthReadOptions {
  readers?: {
    openclaw: () => TargetAuth | null;
    hermes: () => TargetAuth | null;
  };
}

export function resolveTargetAuth(
  target: ClawchatTarget,
  options: ResolveTargetAuthOptions = {},
): TargetAuth | null {
  const readers = options.readers ?? {
    openclaw: () => readOpenClawAuth(options),
    hermes: () => readHermesAuth(options),
  };
  return target === "openclaw" ? readers.openclaw() : readers.hermes();
}

export type { AuthReadOptions, TargetAuth } from "./types";
export { readHermesAuth } from "./hermes";
export { readOpenClawAuth } from "./openclaw";
