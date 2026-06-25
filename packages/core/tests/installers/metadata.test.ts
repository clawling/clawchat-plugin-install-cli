import { describe, expect, it } from "vitest";
import {
  assertVersionSatisfiesRange,
  isVersionOlder,
  parseHermesPluginList,
  parseHermesPluginYaml,
  parseHostVersion,
  parseOpenClawPackageJson,
  parseOpenClawPluginsJson,
} from "../../src/installers/metadata";

describe("installer metadata", () => {
  it("reads OpenClaw plugin metadata from package.json", () => {
    expect(parseOpenClawPackageJson(JSON.stringify({
      version: "0.1.1",
      clawchat: { openclaw: ">=2026.3.28" },
    }))).toEqual({ version: "0.1.1", hostRequirement: ">=2026.3.28" });
  });

  it("falls back to peerDependencies and engines for OpenClaw host requirements", () => {
    expect(parseOpenClawPackageJson(JSON.stringify({
      version: "0.1.2",
      peerDependencies: { openclaw: ">=2026.4.1" },
    })).hostRequirement).toBe(">=2026.4.1");
    expect(parseOpenClawPackageJson(JSON.stringify({
      version: "0.1.3",
      engines: { openclaw: ">=2026.5.1" },
    })).hostRequirement).toBe(">=2026.5.1");
  });

  it("reads Hermes plugin metadata from plugin.yaml", () => {
    expect(parseHermesPluginYaml(`manifest_version: 1\nname: clawchat\nversion: 0.1.1\nrequires:\n  hermes: \">=0.12.0\"\n`)).toEqual({
      version: "0.1.1",
      hostRequirement: ">=0.12.0",
    });
  });

  it("extracts host versions from CLI output", () => {
    expect(parseHostVersion("openclaw 2026.3.28\n")).toBe("2026.3.28");
    expect(parseHostVersion("Hermes Agent v0.12.0")).toBe("0.12.0");
  });

  it("supports minimum version ranges", () => {
    expect(() => assertVersionSatisfiesRange("0.12.0", ">=0.12.0", "Hermes")).not.toThrow();
    expect(() => assertVersionSatisfiesRange("0.11.9", ">=0.12.0", "Hermes")).toThrow("Hermes version 0.11.9 is too old; need >=0.12.0");
    expect(() => assertVersionSatisfiesRange("0.12.0", "^0.12.0", "Hermes")).toThrow("unsupported Hermes version requirement: ^0.12.0");
  });

  it("preserves build suffix ordering when comparing versions", () => {
    expect(isVersionOlder("2026.5.4-2", "2026.5.4-3")).toBe(true);
    expect(isVersionOlder("2026.5.4-3", "2026.5.4-2")).toBe(false);
  });

  it("finds clawchat in OpenClaw plugin JSON arrays and objects", () => {
    expect(parseOpenClawPluginsJson(JSON.stringify([{ name: "clawchat", version: "0.1.0" }]))).toBe("0.1.0");
    expect(parseOpenClawPluginsJson(JSON.stringify({ plugins: [{ name: "other", version: "1.0.0" }, { name: "clawchat", version: "0.1.1" }] }))).toBe("0.1.1");
    expect(parseOpenClawPluginsJson(JSON.stringify({ plugins: [] }))).toBeNull();
  });

  it("finds OpenClaw ClawChat plugin by package id or scoped package name", () => {
    expect(parseOpenClawPluginsJson(JSON.stringify({
      plugins: [{
        id: "clawchat-plugin-openclaw",
        name: "@clawling/clawchat-plugin-openclaw",
        version: "2026.5.4-3",
      }],
    }))).toBe("2026.5.4-3");
  });

  it("finds legacy OpenClaw ClawChat installs by previous scoped package name", () => {
    expect(parseOpenClawPluginsJson(JSON.stringify({
      plugins: [{
        name: "@newbase-clawchat/clawchat-plugin-openclaw",
        version: "2026.5.4-2",
      }],
    }))).toBe("2026.5.4-2");
  });

  it("finds clawchat version and status in Hermes table output", () => {
    const output = `│ clawchat       │ enabled     │ 0.1.0   │ ClawChat gateway integration for Hermes Agent. │ git     │`;

    expect(parseHermesPluginList(output)).toEqual({ version: "0.1.0", status: "enabled" });
  });
});
