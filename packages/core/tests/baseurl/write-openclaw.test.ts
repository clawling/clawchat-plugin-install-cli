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
  it.each(["{bad json", "[]", "null", "42", '"text"'])("refuses invalid config %s without changing its bytes", (raw) => {
    const file = path.join(home, ".openclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    expect(() => writeOpenClawBaseUrls({ baseUrl: "https://example.invalid" }, { homeDir: home })).toThrow(
      expect.objectContaining({ code: "PRECONDITION" }),
    );
    expect(fs.readFileSync(file, "utf8")).toBe(raw);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["openclaw.json"]);
  });

  it("accepts whitespace as an empty config", () => {
    const file = path.join(home, ".openclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, " \n\t");
    writeOpenClawBaseUrls({ baseUrl: "https://example.invalid" }, { homeDir: home });
    expect(readConfig().channels["clawchat-plugin-openclaw"].baseUrl).toBe("https://example.invalid");
  });

  it("refuses a config that cannot be read", () => {
    const file = path.join(home, ".openclaw", "openclaw.json");
    fs.mkdirSync(file, { recursive: true });
    expect(() => writeOpenClawBaseUrls({ baseUrl: "https://example.invalid" }, { homeDir: home })).toThrow(
      expect.objectContaining({ code: "PRECONDITION" }),
    );
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("creates a missing config with mode 0600", () => {
    writeOpenClawBaseUrls({ baseUrl: "https://example.invalid" }, { homeDir: home });
    expect(fs.statSync(path.join(home, ".openclaw", "openclaw.json")).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("replaces the symlink target, preserves its mode and leaves no temp files", () => {
    const file = path.join(home, ".openclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const real = path.join(home, "real.json");
    fs.writeFileSync(real, "{}");
    fs.chmodSync(real, 0o640);
    const inode = fs.statSync(real).ino;
    fs.symlinkSync(real, file);
    writeOpenClawBaseUrls({ baseUrl: "https://example.invalid" }, { homeDir: home });
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    expect(fs.statSync(real).ino).not.toBe(inode);
    expect(fs.statSync(real).mode & 0o777).toBe(0o640);
    expect(JSON.parse(fs.readFileSync(real, "utf8")).channels).toBeDefined();
    expect(fs.readdirSync(home).sort()).toEqual([".openclaw", "real.json"]);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["openclaw.json"]);
  });
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
