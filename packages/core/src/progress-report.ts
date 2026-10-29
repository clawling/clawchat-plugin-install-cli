import { ClawchatError } from "./errors";
import { classifyOpenClawRefusal } from "./installers/openclaw-host";

export const PROGRESS_REPORT_PREFIX = "CLAWCHAT_REPORT: ";
export const INSTALL_FAILURE_CATEGORIES = Object.freeze([
  "scan_blocked", "host_missing", "host_too_old", "npx_missing", "network", "tls", "metadata",
  "timeout", "already_exists", "host_error", "bad_input", "prerelease_refused", "legacy_config", "other",
] as const);
export const ENABLE_FAILURE_CATEGORIES = Object.freeze([
  "deps_failed", "deps_network", "deps_tls", "deps_timeout", "scan_disabled", "other",
] as const);
export const ACTIVATE_FAILURE_CATEGORIES = Object.freeze([
  "already_paired", "code_rejected", "network", "no_command", "plugin_too_old", "timeout", "other",
] as const);
export const PROGRESS_REPORT_REASONS = Object.freeze([
  "plugin_installed", "plugin_enabled", "plugin_activated", "plugin_awaiting_restart",
  ...INSTALL_FAILURE_CATEGORIES.map((category) => `plugin_install_failed:${category}`),
  ...ENABLE_FAILURE_CATEGORIES.map((category) => `plugin_enable_failed:${category}`),
  ...ACTIVATE_FAILURE_CATEGORIES.map((category) => `plugin_activate_failed:${category}`),
]);

// Track the stage without changing the error's identity, code, message or keys.
const activationFailures = new WeakSet<Error>();
const metadataFailures = new WeakSet<Error>();

export function markMetadataFailure(err: Error): Error {
  metadataFailures.add(err);
  return err;
}

export function markActivationFailure(err: Error): Error {
  activationFailures.add(err);
  return err;
}

export function isActivationFailure(err: unknown): boolean {
  return err instanceof Error && activationFailures.has(err);
}

export function classifyInstallFailure(err: unknown): string {
  if (!(err instanceof Error)) return "other";
  if (err instanceof ClawchatError && err.code === "SCAN_BLOCKED") return "scan_blocked";
  if (/unable to get local issuer certificate|self[- ]signed certificate|certificate verify failed|certificate has expired|unknown issuer|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SSL certificate problem|invalid peer certificate/i.test(err.message)) return "tls";
  if (metadataFailures.has(err)) return "metadata";
  if (!(err instanceof ClawchatError)) return "other";
  switch (err.code) {
    case "SCAN_BLOCKED": return "scan_blocked";
    case "PRERELEASE_REFUSED": return "prerelease_refused";
    case "LEGACY_CONFIG": return "legacy_config";
    case "PRECONDITION": return /too\s+old/i.test(err.message) ? "host_too_old" : "other";
    case "TIMEOUT": return "timeout";
    case "HTTP_ERROR": return "network";
    case "SUBPROCESS": {
      const refusal = classifyOpenClawRefusal(err.message);
      if (refusal) return refusal;
      if (/\bspawn(?:Sync)?\s+(?:hermes|openclaw)(?:\.exe|\.cmd)?\s+ENOENT\b|(?:^|\s)(?:hermes|openclaw):\s+(?:command\s+)?not found\b|'(?:hermes|openclaw)' is not recognized\b/i.test(err.message)) return "host_missing";
      if (/Could not resolve host|Failed to connect|Connection reset|ECONNRESET|Connection timed out|early EOF|RPC failed/i.test(err.message)) return "network";
      if (/\balready\s+exists\b/i.test(err.message)) return "already_exists";
      return "host_error";
    }
    case "VALIDATION":
    case "INVALID_INPUT": return "bad_input";
    default: return "other";
  }
}

export function classifyActivateFailure(err: unknown): string {
  if (!(err instanceof Error)) return "other";
  if (/already\s+paired/i.test(err.message)) return "already_paired";
  if (err instanceof ClawchatError && err.code === "TIMEOUT") return "timeout";
  if (/clawchat: activation failed \(validation(?:\s[^)\r\n]*)?\): this connect code (?:is expired|is invalid|was already redeemed|is not pairable)\b/i.test(err.message)) return "code_rejected";
  const transport = /clawchat: activation failed \(transport(?:\s[^)\r\n]*)?\):[^\r\n]*/i.exec(err.message)?.[0];
  if (transport) {
    if (/\([^)]*\bstatus=/i.test(transport)) return "other";
    return /timed out/i.test(transport) ? "timeout" : "network";
  }
  if (/\b(?:unknown|invalid|unrecognized|no\s+such)\s+command\s*[:=]?\s*['"]?clawchat\b/i.test(err.message) ||
      /\bclawchat['"]?\s+(?:is\s+)?(?:an?\s+)?(?:unknown|invalid|unrecognized)\s+(?:hermes\s+)?command\b/i.test(err.message) ||
      /\bclawchat['"]?\s+is\s+not\s+a\s+(?:valid\s+)?command\b/i.test(err.message) ||
      /\binvalid\s+choice\s*:\s*['"]?clawchat\b/i.test(err.message)) return "no_command";
  return "other";
}

export function formatProgressReport(reason: string): string {
  if (!PROGRESS_REPORT_REASONS.includes(reason)) {
    throw new Error("Invalid progress report reason");
  }
  return `${PROGRESS_REPORT_PREFIX}${reason}\n`;
}
