import { describe, expect, it } from "vitest";
import * as core from "../src/index";
import type { InstallActionResult } from "../src/index";

describe("core public API", () => {
  it("does not export standalone skill management APIs", () => {
    expect(core).not.toHaveProperty(["install", "Skill"].join(""));
    expect(core).not.toHaveProperty(["update", "Skill"].join(""));
    expect(core).not.toHaveProperty(["resolve", "Skill", "Dir"].join(""));
    expect(core).not.toHaveProperty(["CLAWCHAT", "SKILL", "TGZ", "URL"].join("_"));
  });

  it("types install action results as plugin-only", () => {
    const pluginResult: InstallActionResult = {
      kind: "plugin",
      target: "openclaw",
      status: "installed",
    };

    expect(pluginResult.kind).toBe("plugin");

    const skillResult = {
      // @ts-expect-error standalone skill install results are not part of the core API
      kind: "skill",
      target: "openclaw",
      status: "installed",
    } satisfies InstallActionResult;

    expect(skillResult.kind).toBe("skill");
  });
});
