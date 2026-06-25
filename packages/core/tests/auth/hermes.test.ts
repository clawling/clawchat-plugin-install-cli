import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHermesAuth } from "../../src/auth/hermes";

const dirs: string[] = [];

function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-hermes-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readHermesAuth", () => {
  it("reads tokens from HERMES_HOME .env", () => {
    const homeDir = tmpHome();
    const hermesHome = path.join(homeDir, "custom-hermes");
    fs.mkdirSync(hermesHome, { recursive: true });
    fs.writeFileSync(
      path.join(hermesHome, ".env"),
      "CLAWCHAT_TOKEN=access-token\nCLAWCHAT_REFRESH_TOKEN=refresh-token\nCLAWCHAT_BASE_URL=http://localhost:10086\nCLAWCHAT_USER_ID=usr_agent\n",
    );

    expect(
      readHermesAuth({
        homeDir,
        env: { HERMES_HOME: hermesHome },
      }),
    ).toEqual({
      target: "hermes",
      token: "access-token",
      refreshToken: "refresh-token",
      baseUrl: "http://localhost:10086",
      userId: "usr_agent",
    });
  });

  it("falls back to ~/.hermes/.env", () => {
    const homeDir = tmpHome();
    const fallback = path.join(homeDir, ".hermes");
    fs.mkdirSync(fallback, { recursive: true });
    fs.writeFileSync(path.join(fallback, ".env"), "CLAWCHAT_TOKEN=access-token\n");

    expect(readHermesAuth({ homeDir, env: {} })).toEqual({
      target: "hermes",
      token: "access-token",
      refreshToken: undefined,
      baseUrl: undefined,
    });
  });

  it("returns null when token is missing", () => {
    const homeDir = tmpHome();
    const fallback = path.join(homeDir, ".hermes");
    fs.mkdirSync(fallback, { recursive: true });
    fs.writeFileSync(path.join(fallback, ".env"), "CLAWCHAT_REFRESH_TOKEN=refresh-token\n");

    expect(readHermesAuth({ homeDir, env: {} })).toBeNull();
  });
});
