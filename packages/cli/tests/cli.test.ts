import { describe, expect, it, vi } from "vitest";
import { runClawchatCli } from "../src/cli";

function createIo(stdin = "") {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      readStdin: async () => stdin,
      writeStdout: (value: string) => {
        stdout += value;
      },
      writeStderr: (value: string) => {
        stderr += value;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("runClawchatCli help", () => {
  it("returns success for --help", async () => {
    const io = createIo();

    const code = await runClawchatCli(["--help"], { ...io.io });

    expect(code).toBe(0);
    expect(io.stderr).toBe("");
  });
});

describe("runClawchatCli install/update", () => {
  it("installs OpenClaw plugin only and prints a plugin summary", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "installed" as const,
      version: "0.1.3",
      previousVersion: null,
    }));

    const code = await runClawchatCli(["install", "--target", "openclaw"], {
      ...io.io,
      installOpenClawPlugin,
    });

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledTimes(1);
    expect(io.stdout).toContain("ClawChat install for openclaw complete");
    expect(io.stdout).toContain("plugin installed 0.1.3");
    expect(io.stdout).not.toContain("skill ");
  });

  it("updates Hermes plugin only and prints skipped plugin status", async () => {
    const io = createIo();
    const updateHermesPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "hermes" as const,
      status: "skipped" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["update", "--target", "hermes"], {
      ...io.io,
      updateHermesPlugin,
    });

    expect(code).toBe(0);
    expect(updateHermesPlugin).toHaveBeenCalledTimes(1);
    expect(io.stdout).toContain("ClawChat update for hermes complete");
    expect(io.stdout).toContain("plugin skipped 0.1.3");
    expect(io.stdout).not.toContain("skill ");
  });

  it("forwards force only to install plugin actions", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "updated" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["install", "--target", "openclaw", "--force"], {
      ...io.io,
      installOpenClawPlugin,
    });

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("forwards force only to update plugin actions", async () => {
    const io = createIo();
    const updateHermesPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "hermes" as const,
      status: "updated" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["update", "--target", "hermes", "--force"], {
      ...io.io,
      updateHermesPlugin,
    });

    expect(code).toBe(0);
    expect(updateHermesPlugin).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("fails with the plugin error when plugin install fails", async () => {
    const io = createIo();

    const code = await runClawchatCli(["install", "--target", "hermes"], {
      ...io.io,
      installHermesPlugin: async () => {
        throw new Error("plugin failed");
      },
    });

    expect(code).toBe(1);
    expect(io.stderr).toContain("plugin failed");
  });

  it("does not run removed call command", async () => {
    const io = createIo();
    const callMethod = vi.fn(async () => ({ ok: true }));

    const code = await runClawchatCli(
      ["call", "get_user_profile", "--target", "openclaw", "--input", "{}"],
      {
        ...io.io,
        callMethod,
        resolveAuth: () => ({ target: "openclaw", token: "access-token" }),
      } as any,
    );

    expect(code).toBe(1);
    expect(callMethod).not.toHaveBeenCalled();
  });

  it("does not run removed skill command", async () => {
    const io = createIo();

    const code = await runClawchatCli(["skill", "install", "--target", "openclaw"], {
      ...io.io,
    });

    expect(code).toBe(1);
  });

  it("normalizes base-url flags and threads ref to the openclaw installer", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "installed" as const,
      version: "0.1.3",
      previousVersion: null,
    }));

    const code = await runClawchatCli(
      [
        "install",
        "--target",
        "openclaw@dev",
        "--apibaseurl",
        "example.test:39001",
        "--wsbaseurl",
        "example.test:39002",
        "--mediabaseurl",
        "example.test:39003",
      ],
      { ...io.io, installOpenClawPlugin },
    );

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "dev",
        apiBaseUrl: "https://example.test:39001",
        wsBaseUrl: "wss://example.test:39002/ws",
        mediaBaseUrl: "https://example.test:39003",
      }),
    );
  });
});
