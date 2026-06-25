import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOpenClawAuth } from "../../src/auth/openclaw";

const dirs: string[] = [];

function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-openclaw-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readOpenClawAuth", () => {
  it("reads token, refresh token, and user id from openclaw.json", () => {
    const homeDir = tmpHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({
        channels: {
          "clawchat-plugin-openclaw": {
            enabled: true,
            token: "access-token",
            refreshToken: "refresh-token",
            userId: "usr_agent",
          },
        },
      }),
    );

    expect(readOpenClawAuth({ homeDir })).toEqual({
      target: "openclaw",
      token: "access-token",
      refreshToken: "refresh-token",
      userId: "usr_agent",
    });
  });

  it("returns null when the config file is missing", () => {
    expect(readOpenClawAuth({ homeDir: tmpHome() })).toBeNull();
  });

  it("returns null when the clawchat channel token is missing", () => {
    const homeDir = tmpHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({ channels: { "clawchat-plugin-openclaw": { enabled: true } } }),
    );

    expect(readOpenClawAuth({ homeDir })).toBeNull();
  });
});
