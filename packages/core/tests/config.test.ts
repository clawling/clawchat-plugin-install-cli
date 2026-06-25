import { describe, expect, it } from "vitest";
import { HERMES_PLUGIN_SPEC, HERMES_PLUGIN_YAML_URL, OPENCLAW_PLUGIN_SPEC } from "../src/config";

describe("config", () => {
  it("points Hermes installs and metadata checks at the current plugin repository", () => {
    expect(HERMES_PLUGIN_SPEC).toBe("clawling/clawchat-plugin-hermes-agent");
    expect(HERMES_PLUGIN_YAML_URL).toBe(
      "https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml",
    );
  });

  it("points OpenClaw installs at the current npm package", () => {
    expect(OPENCLAW_PLUGIN_SPEC).toBe("@clawling/clawchat-plugin-openclaw");
  });
});
