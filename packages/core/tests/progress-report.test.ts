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
} from "../src/progress-report";

describe("install failure reports", () => {
  it.each([
    ["SCAN_BLOCKED", "security scan blocked", "scan_blocked"],
    ["PRECONDITION", "Hermes version 0.1 is too old; need >=0.12", "host_too_old"],
    ["PRECONDITION", "plugin metadata returned 404", "other"],
    ["HTTP_ERROR", "HTTP 503", "network"],
    ["METADATA", "invalid plugin.yaml", "network"],
    ["TIMEOUT", "install was stopped", "timeout"],
    ["SUBPROCESS", "hermes failed: spawnSync hermes ENOENT", "host_missing"],
    ["SUBPROCESS", "openclaw: command not found", "host_missing"],
    ["SUBPROCESS", "Plugin already\nexists", "already_exists"],
    ["SUBPROCESS", "exit code 1", "host_error"],
    ["VALIDATION", "invalid timeout", "bad_input"],
    ["INVALID_INPUT", "invalid target", "bad_input"],
    ["AUTH_MISSING", "missing auth", "other"],
    ["UNKNOWN_METHOD", "unknown method", "other"],
  ])("classifies %s (%s) as %s", (code, message, category) => {
    expect(classifyInstallFailure(new ClawchatError(code, message))).toBe(category);
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
    [null, "other"],
  ])("classifies %s as %s", (err, category) => {
    expect(classifyActivateFailure(err)).toBe(category);
  });

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
