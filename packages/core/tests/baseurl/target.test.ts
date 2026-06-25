// packages/core/tests/baseurl/target.test.ts
import { describe, expect, it } from "vitest";
import { hermesRawYamlUrl, parseHermesGitRef, parseTarget } from "../../src/baseurl/target";

describe("parseTarget", () => {
  it("parses a bare host", () => {
    expect(parseTarget("openclaw")).toEqual({ host: "openclaw" });
  });
  it("splits host@ref on the first @ (ref may contain @ later)", () => {
    expect(parseTarget("openclaw@dev")).toEqual({ host: "openclaw", ref: "dev" });
    expect(parseTarget("hermes@https://github.com/o/r.git#dev")).toEqual({
      host: "hermes",
      ref: "https://github.com/o/r.git#dev",
    });
  });
  it("rejects an unknown host", () => {
    expect(() => parseTarget("bogus")).toThrow(/openclaw, hermes/);
  });
  it("rejects a non-string", () => {
    expect(() => parseTarget(undefined)).toThrow(/--target/);
  });
});

describe("hermesRawYamlUrl", () => {
  it("derives a raw url from a full git url with branch", () => {
    expect(hermesRawYamlUrl("https://github.com/clawling/clawchat-plugin-hermes-agent.git#dev")).toBe(
      "https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/dev/plugin.yaml",
    );
  });
  it("defaults to main when no branch is given", () => {
    expect(hermesRawYamlUrl("clawling/clawchat-plugin-hermes-agent")).toBe(
      "https://raw.githubusercontent.com/clawling/clawchat-plugin-hermes-agent/main/plugin.yaml",
    );
  });
  it("returns null for an unparseable ref", () => {
    expect(hermesRawYamlUrl("git@example.com:weird")).toBeNull();
  });
});

describe("parseHermesGitRef", () => {
  it("parses owner/repo shorthand defaulting to main", () => {
    expect(parseHermesGitRef("clawling/clawchat-plugin-hermes-agent")).toEqual({
      owner: "clawling",
      repo: "clawchat-plugin-hermes-agent",
      branch: "main",
      cloneUrl: "https://github.com/clawling/clawchat-plugin-hermes-agent.git",
    });
  });

  it("parses a full git url with a branch fragment into url + branch (fragment never kept in the url)", () => {
    expect(parseHermesGitRef("https://github.com/clawling/clawchat-plugin-hermes-agent.git#dev")).toEqual({
      owner: "clawling",
      repo: "clawchat-plugin-hermes-agent",
      branch: "dev",
      cloneUrl: "https://github.com/clawling/clawchat-plugin-hermes-agent.git",
    });
  });

  it("parses owner/repo with a branch", () => {
    expect(parseHermesGitRef("clawling/clawchat-plugin-hermes-agent#feature/x")).toMatchObject({
      branch: "feature/x",
      cloneUrl: "https://github.com/clawling/clawchat-plugin-hermes-agent.git",
    });
  });

  it("returns null for a non-GitHub ref", () => {
    expect(parseHermesGitRef("git@example.com:weird")).toBeNull();
  });
});
