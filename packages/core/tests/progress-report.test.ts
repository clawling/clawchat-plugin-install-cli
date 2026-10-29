import { describe, expect, it } from "vitest";
import { ClawchatError } from "../src/errors";
import {
  ACTIVATE_FAILURE_CATEGORIES,
  ENABLE_FAILURE_CATEGORIES,
  INSTALL_FAILURE_CATEGORIES,
  PROGRESS_REPORT_PREFIX,
  PROGRESS_REPORT_REASONS,
  classifyActivateFailure,
  classifyInstallFailure,
  formatProgressReport,
  isActivationFailure,
  markActivationFailure,
  markMetadataFailure,
} from "../src/progress-report";

describe("install failure reports", () => {
  it.each([
    ["SCAN_BLOCKED", "security scan blocked", "scan_blocked"],
    ["PRECONDITION", "Hermes version 0.1 is too old; need >=0.12", "host_too_old"],
    ["PRECONDITION", "plugin metadata returned 404", "other"],
    ["PRERELEASE_REFUSED", "host refused the plugin version", "prerelease_refused"],
    ["LEGACY_CONFIG", "host refused legacy config", "legacy_config"],
    ["HTTP_ERROR", "HTTP 503", "network"],
    ["METADATA", "invalid plugin.yaml", "other"],
    ["TIMEOUT", "install was stopped", "timeout"],
    ["SUBPROCESS", "hermes failed: spawnSync hermes ENOENT", "host_missing"],
    ["SUBPROCESS", "openclaw: command not found", "host_missing"],
    ["SUBPROCESS", "hermes failed: spawn hermes ENOENT", "host_missing"],
    ["SUBPROCESS", "openclaw failed: spawn openclaw.cmd ENOENT", "host_missing"],
    ["SUBPROCESS", "hermes failed: spawn hermes.exe ENOENT", "host_missing"],
    ["SUBPROCESS", "hermes: not found", "host_missing"],
    ["SUBPROCESS", "'openclaw' is not recognized as an internal or external command", "host_missing"],
    ["SUBPROCESS", "git failed: spawn git ENOENT", "host_error"],
    ["SUBPROCESS", "repository not found", "host_error"],
    ["SUBPROCESS", "plugin clawchat not found", "host_error"],
    ["SUBPROCESS", "spawn hermes-helper ENOENT", "host_error"],
    ["SUBPROCESS", "my-hermes: not found", "host_error"],
    ["SUBPROCESS", "network configuration invalid", "host_error"],
    ["SUBPROCESS", "Plugin already\nexists", "already_exists"],
    ["SUBPROCESS", "exit code 1", "host_error"],
    ["SUBPROCESS", "Resolved @clawling/clawchat-plugin-openclaw to prerelease version 2026.10.27-1, but prereleases are only installed when explicitly requested. Use an exact version.", "prerelease_refused"],
    ["SUBPROCESS", 'plugin "placeholder" requires OpenClaw >=2026.5.4, but this host is 2026.4.14. Upgrade OpenClaw and retry.', "host_too_old"],
    ["SUBPROCESS", 'plugin "placeholder" requires OpenClaw >=2026.5.4, but this host version could not be determined.', "host_too_old"],
    ["SUBPROCESS", "\u001b[31mLegacy config keys detected:\u001b[0m\n  - gateway.bind: placeholder not found", "legacy_config"],
    ["SUBPROCESS", "Config invalid; run `openclaw doctor --fix` before installing plugins. Placeholder not found.", "legacy_config"],
    ["SUBPROCESS", "Config invalid outside the plugin recovery path for placeholder; run `openclaw doctor --fix` before reinstalling it.", "legacy_config"],
    ["SUBPROCESS", "Config invalid: placeholder not found", "host_error"],
    ["SUBPROCESS", "Run openclaw doctor --fix", "host_error"],
    ["SUBPROCESS", "Resolved placeholder to prerelease version 2026.10.27-1, but prereleases are only installed when explicitly requested. Other command not found.", "prerelease_refused"],
    ["SUBPROCESS", 'plugin "placeholder" requires OpenClaw >=2026.5.4; host version not found.', "host_too_old"],
    ["VALIDATION", "invalid timeout", "bad_input"],
    ["INVALID_INPUT", "invalid target", "bad_input"],
    ["AUTH_MISSING", "missing auth", "other"],
    ["UNKNOWN_METHOD", "unknown method", "other"],
  ])("classifies %s (%s) as %s", (code, message, category) => {
    expect(classifyInstallFailure(new ClawchatError(code, message))).toBe(category);
  });

  it.each([
    "unable to get local issuer certificate", "self-signed certificate",
    "self signed certificate", "certificate verify failed", "certificate has expired",
    "unknown issuer", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SSL certificate problem",
    "invalid peer certificate",
  ])("prioritizes TLS verification failure over metadata (%s)", (message) => {
    expect(classifyInstallFailure(new Error(message))).toBe("tls");
    expect(classifyInstallFailure(markMetadataFailure(new ClawchatError("HTTP_ERROR", message)))).toBe("tls");
  });

  it.each(["Could not resolve host", "Failed to connect", "Connection reset", "ECONNRESET", "Connection timed out", "early EOF", "RPC failed"])(
    "classifies explicit subprocess transport failure as network (%s)", (message) => {
      expect(classifyInstallFailure(new ClawchatError("SUBPROCESS", `git failed: ${message}`))).toBe("network");
      expect(classifyInstallFailure(new Error(message))).toBe("other");
    },
  );

  it("marks only metadata transport errors without changing their identity or fields", () => {
    const err = new ClawchatError("TIMEOUT", "metadata timed out");
    const keys = Object.keys(err);
    expect(classifyInstallFailure(err)).toBe("timeout");
    expect(markMetadataFailure(err)).toBe(err);
    expect(classifyInstallFailure(err)).toBe("metadata");
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("metadata timed out");
    expect(Object.keys(err)).toEqual(keys);
    expect(classifyInstallFailure(new ClawchatError("TIMEOUT", err.message))).toBe("timeout");
    expect(classifyInstallFailure(new Error("TLS network certificate configuration invalid"))).toBe("other");
  });

  it.each([new Error("ENOENT already exists"), { code: "TIMEOUT", message: "timeout" }, null, "failure"])(
    "uses other for an untyped failure %j", (err) => {
      expect(classifyInstallFailure(err)).toBe("other");
    },
  );
});

describe("activation failure reports", () => {
  it.each([
    [new ClawchatError("SUBPROCESS", "this Hermes profile is already paired"), "already_paired"],
    [new ClawchatError("TIMEOUT", "activation was stopped"), "timeout"],
    [new Error("Unknown command 'clawchat'"), "no_command"],
    [new Error("invalid command: clawchat"), "no_command"],
    [new Error("argument command: invalid choice: 'clawchat'"), "no_command"],
    [new Error("hermes clawchat is not a valid command"), "no_command"],
    [new Error("No such command 'clawchat'"), "no_command"],
    [new Error("'clawchat' is an unknown Hermes command"), "no_command"],
    [new Error("hermes clawchat activate failed: invalid code"), "other"],
    [new ClawchatError("HTTP_ERROR", "activation failed"), "other"],
    [new Error("clawchat: activation failed (transport /v1/activate): Connection reset"), "network"],
    [new Error("clawchat: activation failed (transport): activation request timed out"), "timeout"],
    [new Error("clawchat: activation failed (transport status=503): network unavailable"), "other"],
    [new Error("clawchat: activation failed (transport status=504): upstream timed out"), "other"],
    [new Error("clawchat: activation failed (transport status=400): unknown command clawchat"), "other"],
    [new Error("clawchat: activation failed (transport): connection refused; body mentions status=503"), "network"],
    [new Error("clawchat: activation failed (api status=503): network unavailable"), "other"],
    [new Error("clawchat: activation failed (validation): connect code is required"), "other"],
    [new Error("clawchat: activation failed (auth): this connect code is invalid."), "other"],
    [new Error("this connect code is invalid; network error"), "other"],
    [new Error("clawchat: activation failed (validation): this connect code is invalidated"), "other"],
    [null, "other"],
  ])("classifies %s as %s", (err, category) => {
    expect(classifyActivateFailure(err)).toBe(category);
  });

  it.each(["is expired", "is invalid", "was already redeemed", "is not pairable (status=expired)"])(
    "recognizes the plugin validation refusal when the connect code %s", (reason) => {
      expect(classifyActivateFailure(new Error(`clawchat: activation failed (validation /v1/activate code=100): this connect code ${reason}. Ask your owner…`))).toBe("code_rejected");
    },
  );

  it("preserves the original error and its public fields when marking activation", () => {
    const err = new ClawchatError("SUBPROCESS", "already paired");
    const keys = Object.keys(err);
    expect(isActivationFailure(err)).toBe(false);
    expect(markActivationFailure(err)).toBe(err);
    expect(isActivationFailure(err)).toBe(true);
    expect(err.code).toBe("SUBPROCESS");
    expect(err.message).toBe("already paired");
    expect(Object.keys(err)).toEqual(keys);
    expect(isActivationFailure(new Error("already paired"))).toBe(false);
  });
});

describe("progress report whitelist", () => {
  it("contains every stage and category exactly once and cannot be mutated", () => {
    expect(PROGRESS_REPORT_REASONS).toEqual([
      "plugin_installed", "plugin_enabled", "plugin_activated",
      ...INSTALL_FAILURE_CATEGORIES.map((c) => `plugin_install_failed:${c}`),
      ...ENABLE_FAILURE_CATEGORIES.map((c) => `plugin_enable_failed:${c}`),
      ...ACTIVATE_FAILURE_CATEGORIES.map((c) => `plugin_activate_failed:${c}`),
    ]);
    expect(new Set(PROGRESS_REPORT_REASONS).size).toBe(PROGRESS_REPORT_REASONS.length);
    for (const list of [PROGRESS_REPORT_REASONS, INSTALL_FAILURE_CATEGORIES, ENABLE_FAILURE_CATEGORIES, ACTIVATE_FAILURE_CATEGORIES]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });

  it.each(PROGRESS_REPORT_REASONS)("formats only the fixed word %s", (reason) => {
    expect(reason).toMatch(/^[a-z_]+(:[a-z_]+)?$/);
    expect(reason.length).toBeLessThanOrEqual(60);
    expect(formatProgressReport(reason)).toBe(`${PROGRESS_REPORT_PREFIX}${reason}\n`);
  });

  it.each(["plugin_install_failed:sk-test-SECRET /home/someone/x", "plugin_installed\nother", ""])(
    "rejects a reason outside the whitelist", (reason) => {
      expect(() => formatProgressReport(reason)).toThrow("Invalid progress report reason");
    },
  );
});
