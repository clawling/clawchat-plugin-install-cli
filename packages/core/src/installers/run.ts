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

/**
 * Whether the child is launched through a shell.
 *
 * Windows only, and not by choice: `npm`, `npx`, and the host CLIs installed
 * through them are `.cmd` shims, which Node refuses to spawn directly (EINVAL
 * unless `shell: true`). On POSIX we exec the binary and argv reaches it
 * verbatim — nothing re-parses it.
 *
 * This predicate is the ONLY reason arguments need sanitizing, so
 * {@link prepareArgs} is keyed off the same function: if a platform is ever
 * added here, it must get its own quoting rule there in the same change.
 */
function usesShell(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

/**
 * A command *name* is always a hardcoded constant in this package (`git`,
 * `hermes`, `openclaw`, `tar`, `curl`). Nothing legitimate needs a
 * metacharacter, so names stay strictly rejected on every platform.
 */
const UNSAFE_COMMAND_NAME = /[\s&|;<>()`$\\"'%^\u0000-\u001f]/;

/**
 * Characters that cannot be made safe inside a cmd.exe double-quoted argument:
 *  - `%` — cmd.exe expands `%VAR%` even between double quotes.
 *  - `"` — closes our own quoting, and cmd's escape rules there are not portable.
 *  - control chars — CR/LF/NUL truncate or corrupt the command line.
 * Everything else — spaces, `&`, `|`, `^`, `<`, `>`, `(`, `)`, and backslashes,
 * i.e. every character a real Windows path is made of — is inert once quoted.
 */
const WINDOWS_UNQUOTABLE = /["%\u0000-\u001f]/;

/**
 * Args made only of these characters reach cmd.exe unchanged and cannot be
 * split or reinterpreted, so they are passed bare (`clone`, `--depth`, `1`,
 * `https://…`, `@clawling/clawchat-plugin-openclaw`). A whitelist, not a
 * blacklist: anything else gets quoted rather than guessed about.
 */
const WINDOWS_BARE_SAFE = /^[A-Za-z0-9._\-+@/:#]+$/;

function normalizeOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return value.toString("utf8");
}

function assertSafeCommandName(cmd: string): void {
  if (UNSAFE_COMMAND_NAME.test(cmd)) {
    throw new ClawchatError("SUBPROCESS", `unsafe shell metacharacter in command name: ${cmd}`);
  }
}

function quoteWindowsArg(value: string): string {
  if (value === "") {
    return '""';
  }
  if (WINDOWS_BARE_SAFE.test(value)) {
    return value;
  }
  // CommandLineToArgvW rules: a run of backslashes is only special immediately
  // before a quote, where each pair collapses to one and a lone one escapes the
  // quote. We append a closing quote, so a trailing run must be doubled —
  // otherwise `C:\dir\` would escape it and swallow the rest of the line.
  return `"${value.replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Prepare `args` for the platform's spawn mode.
 *
 * POSIX: returned verbatim. `shell: false` means execvp receives them as argv
 * and no shell ever sees them, so there is nothing to escape — and rejecting
 * spaces or backslashes here would only break legitimate paths.
 *
 * Windows: quoted for cmd.exe, because `shell: true` is unavoidable there (see
 * {@link usesShell}). This is what makes Windows paths usable at all: they are
 * full of backslashes and frequently contain spaces (`C:\Users\Zhang San\…`),
 * every one of which used to be rejected outright.
 */
export function prepareArgs(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!usesShell(platform)) {
    return [...args];
  }
  return args.map((arg) => {
    if (WINDOWS_UNQUOTABLE.test(arg)) {
      throw new ClawchatError("SUBPROCESS", `unsafe shell metacharacter in command input: ${arg}`);
    }
    return quoteWindowsArg(arg);
  });
}

function formatCommand(cmd: string, args: readonly string[]): string {
  return [cmd, ...args].join(" ");
}

function spawnOptions(capture: boolean, options?: CommandOptions): SpawnSyncOptions {
  const base: SpawnSyncOptions = {
    shell: usesShell(process.platform),
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
  assertSafeCommandName(cmd);

  // Error messages below quote the ORIGINAL args, not the platform-prepared
  // ones — a Windows user should read the path they passed, not our quoting.
  const result = spawnSync(cmd, prepareArgs(args), spawnOptions(false, options));
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
  assertSafeCommandName(cmd);

  const result = spawnSync(cmd, prepareArgs(args), spawnOptions(true, options));
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
