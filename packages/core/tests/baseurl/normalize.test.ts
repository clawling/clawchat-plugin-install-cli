// packages/core/tests/baseurl/normalize.test.ts
import { describe, expect, it } from "vitest";
import { normalizeHttpUrl, normalizeWsUrl } from "../../src/baseurl/normalize";

describe("normalizeWsUrl", () => {
  it("turns bare host:port into wss://…/ws (assume TLS)", () => {
    expect(normalizeWsUrl("example.test:39002")).toBe("wss://example.test:39002/ws");
  });
  it("keeps a full url verbatim (allows ws:// override), trimming trailing slash", () => {
    expect(normalizeWsUrl("ws://example.test:39002/ws/")).toBe("ws://example.test:39002/ws");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeWsUrl("  ")).toBe("");
  });
});

describe("normalizeHttpUrl", () => {
  it("turns bare host:port into https:// (assume TLS), no path", () => {
    expect(normalizeHttpUrl("example.test:39001")).toBe("https://example.test:39001");
  });
  it("keeps a full url verbatim (allows http:// override), trimming trailing slash", () => {
    expect(normalizeHttpUrl("http://example.test:39003/")).toBe("http://example.test:39003");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeHttpUrl("")).toBe("");
  });
});
