import { ClawchatError } from "../errors";

export function requireString(
  input: Record<string, unknown>,
  key: string,
  method: string,
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ClawchatError("INVALID_INPUT", `${method} requires ${key}`);
  }
  return value;
}

export function optionalPositiveInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ClawchatError("INVALID_INPUT", `${key} must be a positive integer`);
  }
  return Number(value);
}

export function pickDefined(
  input: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) {
      picked[key] = input[key];
    }
  }
  return picked;
}
