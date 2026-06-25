// packages/core/src/baseurl/normalize.ts
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Bare `host:port` → `wss://host:port/ws`; a schemed URL is kept verbatim. */
export function normalizeWsUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    return "";
  }
  if (HAS_SCHEME.test(value)) {
    return trimTrailingSlash(value);
  }
  return `wss://${trimTrailingSlash(value)}/ws`;
}

/** Bare `host:port` → `https://host:port`; a schemed URL is kept verbatim. */
export function normalizeHttpUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    return "";
  }
  if (HAS_SCHEME.test(value)) {
    return trimTrailingSlash(value);
  }
  return `https://${trimTrailingSlash(value)}`;
}
