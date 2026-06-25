// packages/core/tests/baseurl/write-openclaw.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeOpenClawBaseUrls } from "../../src/baseurl/write-openclaw";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-home-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf8"));
}

describe("writeOpenClawBaseUrls", () => {
  it("creates the config file and channel when absent", () => {
    writeOpenClawBaseUrls(
      { baseUrl: "https://api.test:39001", websocketUrl: "wss://ws.test:39002/ws", mediaBaseUrl: "https://m.test:39003" },
      { homeDir: home },
    );
    expect(readConfig().channels["clawchat-plugin-openclaw"]).toEqual({
      baseUrl: "https://api.test:39001",
      websocketUrl: "wss://ws.test:39002/ws",
      mediaBaseUrl: "https://m.test:39003",
    });
  });

  it("merges into existing config, preserving other keys", () => {
    const dir = path.join(home, ".openclaw");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "openclaw.json"),
      JSON.stringify({ channels: { "clawchat-plugin-openclaw": { token: "keep" } }, other: 1 }),
    );
    writeOpenClawBaseUrls({ baseUrl: "https://api.test:39001" }, { homeDir: home });
    const cfg = readConfig();
    expect(cfg.other).toBe(1);
    expect(cfg.channels["clawchat-plugin-openclaw"]).toEqual({ token: "keep", baseUrl: "https://api.test:39001" });
  });

  it("is a no-op when no values are provided (does not touch fs)", () => {
    writeOpenClawBaseUrls({}, { homeDir: home });
    expect(fs.existsSync(path.join(home, ".openclaw", "openclaw.json"))).toBe(false);
  });
});
