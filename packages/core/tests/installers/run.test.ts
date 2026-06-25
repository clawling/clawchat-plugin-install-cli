import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClawchatError } from "../../src/errors";
import { captureCommand, runCommand } from "../../src/installers/run";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

describe("runCommand", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("rejects unsafe shell metacharacters before spawning", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(runCommand("openclaw", ["plugins", "install", "pkg.tgz; rm -rf /", "--force"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("rejects Windows shell expansion and escape characters", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(runCommand("openclaw", ["plugins", "%USERPROFILE%"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter"),
    });
    await expect(runCommand("openclaw", ["plugins", "^&"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("rejects whitespace that could split shell tokens", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(runCommand("openclaw", ["plugins", "pkg name.tgz"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("wraps spawn errors in ClawchatError", async () => {
    spawnSyncMock.mockReturnValue({
      error: new Error("not found"),
      status: null,
    } as ReturnType<typeof spawnSync>);

    await expect(runCommand("openclaw", ["plugins"])).rejects.toEqual(
      new ClawchatError("SUBPROCESS", "openclaw failed: not found"),
    );
  });

  it("throws on non-zero status and includes stderr", async () => {
    spawnSyncMock.mockReturnValue({
      status: 2,
      stderr: "bad plugin\n",
    } as ReturnType<typeof spawnSync>);

    await expect(runCommand("hermes", ["plugins", "install", "clawling/clawchat-plugin-hermes-agent"])).rejects.toEqual(
      new ClawchatError(
        "SUBPROCESS",
        "hermes plugins install clawling/clawchat-plugin-hermes-agent failed with exit code 2: bad plugin",
      ),
    );
  });

  it("passes timeout to spawnSync and reports ETIMEDOUT as a TIMEOUT error", async () => {
    const timeoutError = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" });
    spawnSyncMock.mockReturnValue({
      error: timeoutError,
      status: null,
      signal: "SIGTERM",
    } as unknown as ReturnType<typeof spawnSync>);

    await expect(runCommand("git", ["clone", "https://example.com/x.git"], { timeoutMs: 1234 })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: expect.stringContaining("timed out after 1234ms"),
    });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "git",
      ["clone", "https://example.com/x.git"],
      expect.objectContaining({ timeout: 1234, killSignal: "SIGKILL" }),
    );
  });

  it("merges the env option over process.env for the child only", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    process.env.CLAWCHAT_RUN_TEST_MARKER = "parent";

    await runCommand("git", ["clone", "https://example.com/x.git"], { env: { GIT_TERMINAL_PROMPT: "0" } });

    const passedEnv = spawnSyncMock.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(passedEnv.GIT_TERMINAL_PROMPT).toBe("0");
    // Inherited parent env is preserved alongside the override.
    expect(passedEnv.CLAWCHAT_RUN_TEST_MARKER).toBe("parent");
    delete process.env.CLAWCHAT_RUN_TEST_MARKER;
  });

  it("does not set a child env when no env option is given (inherits parent)", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await runCommand("git", ["clone", "https://example.com/x.git"]);

    expect(spawnSyncMock.mock.calls[0]?.[2]?.env).toBeUndefined();
  });
});

describe("captureCommand", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("returns stdout for successful commands", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "openclaw 2026.3.28\n",
      stderr: "",
    } as ReturnType<typeof spawnSync>);

    await expect(captureCommand("openclaw", ["--version"])).resolves.toBe("openclaw 2026.3.28\n");
  });

  it("rejects unsafe capture inputs before spawning", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(captureCommand("tar", ["-xOf", "bad path.tgz", "package.json"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("throws on non-zero capture status and includes stderr", async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "missing file\n",
    } as ReturnType<typeof spawnSync>);

    await expect(captureCommand("tar", ["-xOf", "/tmp/pkg.tgz", "package.json"])).rejects.toEqual(
      new ClawchatError("SUBPROCESS", "tar -xOf /tmp/pkg.tgz package.json failed with exit code 1: missing file"),
    );
  });
});
