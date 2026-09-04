// packages/core/tests/baseurl/write-openclaw.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("writeOpenClawBaseUrls on a host with a relocated state dir", () => {
  // The e2e regression: on a container host exporting OPENCLAW_STATE_DIR the base URLs
  // landed in ~/.openclaw/openclaw.json while the host read <state dir>/openclaw.json,
  // so the plugin kept its built-in app.clawling.com defaults.
  it("writes into the config the host reads, not the home layout", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-state-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    try {
      writeOpenClawBaseUrls(
        { baseUrl: "https://api.test:39001", websocketUrl: "wss://ws.test:39002/ws" },
        { homeDir: home },
      );

      expect(
        JSON.parse(fs.readFileSync(path.join(stateDir, "openclaw.json"), "utf8")).channels[
          "clawchat-plugin-openclaw"
        ],
      ).toEqual({
        baseUrl: "https://api.test:39001",
        websocketUrl: "wss://ws.test:39002/ws",
      });
      expect(fs.existsSync(path.join(home, ".openclaw", "openclaw.json"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
