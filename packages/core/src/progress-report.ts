import { ClawchatError } from "./errors";
import { classifyOpenClawRefusal } from "./installers/openclaw-host";

export const PROGRESS_REPORT_PREFIX = "CLAWCHAT_REPORT: ";
export const INSTALL_FAILURE_CATEGORIES = Object.freeze([
  "scan_blocked", "host_missing", "host_too_old", "npx_missing", "network",
  "timeout", "already_exists", "host_error", "bad_input", "prerelease_refused", "legacy_config", "other",
] as const);
export const ENABLE_FAILURE_CATEGORIES = Object.freeze([
  "deps_failed", "scan_disabled", "other",
] as const);
export const ACTIVATE_FAILURE_CATEGORIES = Object.freeze([
  "already_paired", "code_rejected", "network", "no_command", "plugin_too_old", "timeout", "other",
] as const);
export const PROGRESS_REPORT_REASONS = Object.freeze([
  "plugin_installed", "plugin_enabled", "plugin_activated",
  ...INSTALL_FAILURE_CATEGORIES.map((category) => `plugin_install_failed:${category}`),
  ...ENABLE_FAILURE_CATEGORIES.map((category) => `plugin_enable_failed:${category}`),
  ...ACTIVATE_FAILURE_CATEGORIES.map((category) => `plugin_activate_failed:${category}`),
]);

// Track the stage without changing the error's identity, code, message or keys.
const activationFailures = new WeakSet<Error>();

export function markActivationFailure(err: Error): Error {
  activationFailures.add(err);
  return err;
}

export function isActivationFailure(err: unknown): boolean {
  return err instanceof Error && activationFailures.has(err);
}

export function classifyInstallFailure(err: unknown): string {
  if (!(err instanceof ClawchatError)) return "other";
  switch (err.code) {
    case "SCAN_BLOCKED": return "scan_blocked";
    case "PRERELEASE_REFUSED": return "prerelease_refused";
    case "LEGACY_CONFIG": return "legacy_config";
    case "PRECONDITION": return /too\s+old/i.test(err.message) ? "host_too_old" : "other";
    case "TIMEOUT": return "timeout";
    case "HTTP_ERROR":
    case "METADATA": return "network";
    case "SUBPROCESS": {
      const refusal = classifyOpenClawRefusal(err.message);
      if (refusal) return refusal;
      if (/\bENOENT\b|\bnot\s+found\b/i.test(err.message)) return "host_missing";
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
