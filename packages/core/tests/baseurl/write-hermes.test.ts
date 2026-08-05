// packages/core/tests/baseurl/write-hermes.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHermesEnvPath, writeHermesBaseUrls } from "../../src/baseurl/write-hermes";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-home-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function readEnv() {
  return fs.readFileSync(getHermesEnvPath({ homeDir: home, env: {}, platform: "linux" }), "utf8");
}

describe("writeHermesBaseUrls", () => {
  it("creates ~/.hermes/.env with KEY=value lines", () => {
    writeHermesBaseUrls(
      { CLAWCHAT_BASE_URL: "https://api.test:39001", CLAWCHAT_MEDIA_BASE_URL: "https://m.test:39003" },
      { homeDir: home, env: {}, platform: "linux" },
    );
    const text = readEnv();
    expect(text).toContain("CLAWCHAT_BASE_URL=https://api.test:39001\n");
    expect(text).toContain("CLAWCHAT_MEDIA_BASE_URL=https://m.test:39003\n");
  });

  it("replaces an existing key and preserves unrelated lines (e.g. token)", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "CLAWCHAT_TOKEN=keep\nCLAWCHAT_BASE_URL=https://old\n");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://new" }, { homeDir: home, env: {}, platform: "linux" });
    const text = readEnv();
    expect(text).toContain("CLAWCHAT_TOKEN=keep\n");
    expect(text).toContain("CLAWCHAT_BASE_URL=https://new\n");
    expect(text).not.toContain("https://old");
  });

  it("prefers HERMES_HOME/.env when set", () => {
    const hermesHome = path.join(home, "custom-hermes");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { env: { HERMES_HOME: hermesHome } });
    expect(fs.readFileSync(path.join(hermesHome, ".env"), "utf8")).toContain("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it("normalizes CRLF and blank lines to clean LF output", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "\r\nCLAWCHAT_TOKEN=keep\r\n");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    const text = readEnv();
    expect(text).not.toContain("\r");
    expect(text.startsWith("\n")).toBe(false);
    expect(text).toContain("CLAWCHAT_TOKEN=keep\n");
    expect(text).toContain("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it("is a no-op when no values are provided", () => {
    writeHermesBaseUrls({}, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.existsSync(getHermesEnvPath({ homeDir: home, env: {}, platform: "linux" }))).toBe(false);
  });
});
