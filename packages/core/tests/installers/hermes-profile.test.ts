import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isDefaultProfile,
  resolveHermesProfileHome,
  withHermesProfileArgs,
} from "../../src/installers/hermes-profile";

describe("isDefaultProfile", () => {
  it("treats undefined, empty, and 'default' as the default profile", () => {
    expect(isDefaultProfile(undefined)).toBe(true);
    expect(isDefaultProfile("")).toBe(true);
    expect(isDefaultProfile("  ")).toBe(true);
    expect(isDefaultProfile("default")).toBe(true);
    expect(isDefaultProfile("coder")).toBe(false);
  });
});

describe("withHermesProfileArgs", () => {
  it("leaves args unchanged for the default profile", () => {
    expect(withHermesProfileArgs(undefined, ["plugins", "list"])).toEqual(["plugins", "list"]);
    expect(withHermesProfileArgs("default", ["plugins", "list"])).toEqual(["plugins", "list"]);
  });

  it("prepends -p <profile> for a named profile", () => {
    expect(withHermesProfileArgs("coder", ["plugins", "install", "spec", "--enable"])).toEqual([
      "-p",
      "coder",
      "plugins",
      "install",
      "spec",
      "--enable",
    ]);
  });
});

describe("resolveHermesProfileHome", () => {
  const homeDir = "/home/u";

  it("uses ~/.hermes for the default profile", () => {
    expect(resolveHermesProfileHome(undefined, { homeDir, env: {} })).toBe(
      path.join(homeDir, ".hermes"),
    );
  });

  it("honors an explicit HERMES_HOME for the default profile", () => {
    expect(resolveHermesProfileHome("default", { homeDir, env: { HERMES_HOME: "/custom/home" } })).toBe(
      "/custom/home",
    );
  });

  it("resolves ~/.hermes/profiles/<name> for a named profile", () => {
    expect(resolveHermesProfileHome("coder", { homeDir, env: { HERMES_HOME: "/ignored" } })).toBe(
      path.join(homeDir, ".hermes", "profiles", "coder"),
    );
  });

  it("falls back to os.homedir() when no homeDir is given", () => {
    expect(resolveHermesProfileHome("coder", { env: {} })).toBe(
      path.join(os.homedir(), ".hermes", "profiles", "coder"),
    );
  });
});
