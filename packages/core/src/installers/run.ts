import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { ClawchatError } from "../errors";

/** Per-call execution controls. */
export interface CommandOptions {
  /** Hard wall-clock cap (ms). On expiry the child is killed and a TIMEOUT error is thrown. */
  timeoutMs?: number;
  /**
   * Extra environment variables merged over `process.env` for this child only.
   * Values are NOT validated by `assertSafeCommand` and must be hardcoded
   * constants — never pass user input here. (spawnSync does not shell-expand
   * env, so this is defense-in-depth, not a live injection vector.)
   */
  env?: Readonly<Record<string, string>>;
}

export type CommandRunner = (cmd: string, args: readonly string[], options?: CommandOptions) => Promise<void>;
export type CommandCapturer = (cmd: string, args: readonly string[], options?: CommandOptions) => Promise<string>;

const SHELL_METACHARACTERS = /[\s&|;<>()`$\\"'%^]/;

function normalizeOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return value.toString("utf8");
}

function assertSafeShellToken(value: string): void {
  if (SHELL_METACHARACTERS.test(value)) {
    throw new ClawchatError("SUBPROCESS", `unsafe shell metacharacter in command input: ${value}`);
  }
}

function assertSafeCommand(cmd: string, args: readonly string[]): void {
  assertSafeShellToken(cmd);
  for (const arg of args) {
    assertSafeShellToken(arg);
  }
}

function formatCommand(cmd: string, args: readonly string[]): string {
  return [cmd, ...args].join(" ");
}

function spawnOptions(capture: boolean, options?: CommandOptions): SpawnSyncOptions {
  const base: SpawnSyncOptions = {
    shell: process.platform === "win32",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "pipe"],
    encoding: "utf8",
  };
  if (options?.timeoutMs && options.timeoutMs > 0) {
    base.timeout = options.timeoutMs;
    // SIGKILL (not SIGTERM) guarantees the per-attempt wall-clock cap even if a
    // child traps SIGTERM. git/hermes/curl have no cleanup that needs SIGTERM.
    base.killSignal = "SIGKILL";
  }
  if (options?.env) {
    base.env = { ...process.env, ...options.env };
  }
  return base;
}

/** Map a spawnSync `error` to a typed ClawchatError, distinguishing timeouts. */
function spawnError(cmd: string, args: readonly string[], error: Error, options?: CommandOptions): ClawchatError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT") {
    return new ClawchatError(
      "TIMEOUT",
      `${formatCommand(cmd, args)} timed out after ${options?.timeoutMs}ms`,
    );
  }
  return new ClawchatError("SUBPROCESS", `${cmd} failed: ${error.message}`);
}

export async function runCommand(cmd: string, args: readonly string[], options?: CommandOptions): Promise<void> {
  assertSafeCommand(cmd, args);

  const result = spawnSync(cmd, args as string[], spawnOptions(false, options));
  if (result.error) {
    throw spawnError(cmd, args, result.error, options);
  }
  if (result.status !== 0) {
    const stderr = normalizeOutput(result.stderr).trim();
    throw new ClawchatError(
      "SUBPROCESS",
      `${formatCommand(cmd, args)} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

export async function captureCommand(cmd: string, args: readonly string[], options?: CommandOptions): Promise<string> {
  assertSafeCommand(cmd, args);

  const result = spawnSync(cmd, args as string[], spawnOptions(true, options));
  if (result.error) {
    throw spawnError(cmd, args, result.error, options);
  }
  if (result.status !== 0) {
    const stderr = normalizeOutput(result.stderr).trim();
    throw new ClawchatError(
      "SUBPROCESS",
      `${formatCommand(cmd, args)} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return normalizeOutput(result.stdout);
}
