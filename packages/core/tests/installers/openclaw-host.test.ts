import { describe, expect, it, vi } from "vitest";
import { ClawchatError } from "../../src/errors";
import { openClawSpec, translateOpenClawRefusal } from "../../src/installers/openclaw-host";

describe("OpenClaw version boundaries", () => {
  it.each([
    ["OpenClaw 2026.5.4", "2026.10.9-2"],
    ["OpenClaw 2026.5.4-1 (placeholder)", "2026.10.9-2"],
    ["2026.8.0", "2026.10.9-2"],
    ["2026.8.1-beta.4", "2026.10.9-2"],
    ["2026.8.1-alpha.1", "2026.10.9-2"],
    ["2026.8.1-rc.1", "2026.10.9-2"],
    ["2026.8.1", undefined],
    ["2026.8.1-2", undefined],
    ["OpenClaw v2026.8.1 (placeholder)", undefined],
    ["\u001b[32mOpenClaw 2026.8.1-1\u001b[0m", undefined],
    ["OpenClaw 2026.10.10-beta.4", undefined],
  ])("selects a compatible plugin at the host version boundary (%s)", async (output, pin) => {
    const capture = vi.fn(async () => output);
    expect(await openClawSpec(capture)).toBe(`@clawling/clawchat-plugin-openclaw${pin ? `@${pin}` : ""}`);
    expect(capture.mock.calls).toEqual([["openclaw", ["--version"]]]);
  });

  it.each(["2026.5.3-9", "2026.5.4-beta.4", "2026.5.4-rc.1"])("refuses hosts below the oldest supported stable release (%s)", async (output) => {
    await expect(openClawSpec(vi.fn(async () => output))).rejects.toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("too old") });
  });
});

describe("OpenClaw config refusal details", () => {
  it.each([
    "Config invalid; run `openclaw doctor --fix` before installing plugins.",
    "Config invalid outside the plugin recovery path for placeholder; run `openclaw doctor --fix` before reinstalling it.",
    "Legacy config keys detected:\n  - invalid key: PLACEHOLDER_VALUE",
  ])("asks for validation when no safe key paths are available (%s)", (output) => {
    const error = translateOpenClawRefusal(new ClawchatError("SUBPROCESS", output)) as ClawchatError;
    expect(error.code).toBe("LEGACY_CONFIG");
    expect(error.message).toContain("Run `openclaw config validate` to list the keys.");
    expect(error.message).not.toContain("PLACEHOLDER_VALUE");
  });

  it("limits the key list and ignores values, malformed paths and later output sections", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `tools.placeholder${index}`);
    const output = "Legacy config keys detected:\n  - invalid path: PLACEHOLDER_SECRET\n" +
      keys.map((key) => `  - ${key}: PLACEHOLDER_SECRET`).join("\n") + "\n\n  - unrelated.path: PLACEHOLDER_SECRET";
    const error = translateOpenClawRefusal(new ClawchatError("SUBPROCESS", output)) as ClawchatError;
    for (const key of keys.slice(0, 10)) expect(error.message).toContain(key);
    for (const text of [keys[10], keys[11], "invalid path", "unrelated.path", "PLACEHOLDER_SECRET"]) {
      expect(error.message).not.toContain(text);
    }
  });

  it("stops extracting keys at the end of the legacy-key section", () => {
    const output = "Legacy config keys detected:\n  - gateway.bind: PLACEHOLDER_SECRET\n\nOther problems:\n  - unrelated.path: PLACEHOLDER_SECRET";
    const error = translateOpenClawRefusal(new ClawchatError("SUBPROCESS", output)) as ClawchatError;
    expect(error.message).toContain("gateway.bind");
    expect(error.message).not.toContain("unrelated.path");
    expect(error.message).not.toContain("PLACEHOLDER_SECRET");
  });

  it("keeps array and quoted wildcard key paths without their values", () => {
    const output = 'Legacy config keys detected:\n  - agents.list[0].workspace: PLACEHOLDER_VALUE\n  - tools.bySender["*"]: PLACEHOLDER_SECRET';
    const error = translateOpenClawRefusal(new ClawchatError("SUBPROCESS", output)) as ClawchatError;
    expect(error.message).toContain("agents.list[0].workspace");
    expect(error.message).toContain('tools.bySender["*"]');
    expect(error.message).not.toContain("PLACEHOLDER_VALUE");
    expect(error.message).not.toContain("PLACEHOLDER_SECRET");
  });

  it.each([new Error("Config invalid; run openclaw doctor --fix"), new ClawchatError("TIMEOUT", "Legacy config keys detected")])(
    "preserves failures outside subprocess refusals (%s)", (error) => {
      expect(translateOpenClawRefusal(error)).toBe(error);
    },
  );
});
