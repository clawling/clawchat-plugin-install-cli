// packages/core/src/baseurl/target.ts
import { isClawchatTarget, type ClawchatTarget } from "../config";
import { ClawchatError } from "../errors";

export interface ParsedTarget {
  host: ClawchatTarget;
  ref?: string;
}

/** Split `host[@ref]` on the FIRST `@` (host never contains `@`). */
export function parseTarget(value: unknown): ParsedTarget {
  if (typeof value !== "string" || !value.trim()) {
    throw new ClawchatError("VALIDATION", "--target is required (openclaw or hermes)");
  }
  const at = value.indexOf("@");
  const host = at === -1 ? value : value.slice(0, at);
  const ref = at === -1 ? "" : value.slice(at + 1).trim();
  if (!isClawchatTarget(host)) {
    throw new ClawchatError("VALIDATION", "--target must be one of: openclaw, hermes");
  }
  return ref ? { host, ref } : { host };
}

/**
 * Derive the raw `plugin.yaml` URL for a Hermes git ref so the compat pre-check
 * reads the branch being installed. Returns null when the ref can't be parsed.
 * Accepts `owner/repo[#branch]` and `https://github.com/owner/repo[.git][#branch]`.
 */
export function hermesRawYamlUrl(ref: string): string | null {
  const parsed = parseHermesGitRef(ref);
  if (!parsed) {
    return null;
  }
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.branch}/plugin.yaml`;
}

export interface HermesGitRef {
  owner: string;
  repo: string;
  branch: string;
  /** Clone-ready https URL (`.git` suffixed) — git/curl strip `#branch`, so it is never embedded. */
  cloneUrl: string;
}

/**
 * Parse a Hermes git ref into its GitHub coordinates so the CLI can clone the
 * exact branch itself. Accepts `owner/repo[#branch]` and
 * `https://github.com/owner/repo[.git][#branch]` (and ssh `github.com:owner/repo`).
 * Returns null when the ref is not a recognizable GitHub repo — callers then
 * fall back to handing the raw ref to `hermes plugins install`.
 *
 * NOTE: a `#branch` fragment in a clone URL is silently dropped by git/curl, so
 * the branch MUST be passed via `git clone --branch`, never left in the URL.
 */
export function parseHermesGitRef(ref: string): HermesGitRef | null {
  let spec = ref.trim();
  let branch = "main";
  const hash = spec.indexOf("#");
  if (hash !== -1) {
    branch = spec.slice(hash + 1).trim() || "main";
    spec = spec.slice(0, hash);
  }
  spec = spec.replace(/\.git$/, "");
  const match =
    spec.match(/github\.com[/:]([^/]+)\/([^/]+)$/i) ?? spec.match(/^([^/@:\s]+)\/([^/@:\s]+)$/);
  if (!match) {
    return null;
  }
  const owner = match[1]!;
  const repo = match[2]!;
  return { owner, repo, branch, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}
