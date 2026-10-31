/**
 * Raw error text on stderr is intentional: see cli.test.ts tests
 * "preserving the original error text" and
 * "keeps placeholder secrets and paths out of failure reports".
 * Credentials must therefore be redacted where errors are constructed
 * (run.ts secretArgs). This helper only verifies output boundaries.
 */
import { vi } from "vitest";

export const PLACEHOLDER_SECRETS = {
  accessToken: "PLACEHOLDER-ACCESS-TOKEN",
  refreshToken: "PLACEHOLDER-REFRESH-TOKEN",
  authorization: "Authorization: Bearer PLACEHOLDER-BEARER-TOKEN", // redact-allow:bearer-literal (placeholder fixture)
  bearerToken: "PLACEHOLDER-BEARER-TOKEN",
  userinfo: "https://user:PLACEHOLDER-URL-PASSWORD@example.invalid", // redact-allow:email (placeholder URL userinfo fixture)
  urlPassword: "PLACEHOLDER-URL-PASSWORD",
  query: "?token=PLACEHOLDER-QUERY-TOKEN",
  queryToken: "PLACEHOLDER-QUERY-TOKEN",
  activationCode: "PLACEHOLDER-ACTIVATE-CODE-0000",
};

export function createCapturingIo(stdin = "", captureProcessWrites = false) {
  let stdout = "";
  let stderr = "";
  let processStdout = "";
  let processStderr = "";
  const restores: (() => void)[] = [];
  if (captureProcessWrites) {
    for (const stream of ["stdout", "stderr"] as const) {
      const spy = vi.spyOn(process[stream], "write").mockImplementation((chunk: any, ...rest: any[]) => {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        if (stream === "stdout") { stdout += text; processStdout += text; }
        else { stderr += text; processStderr += text; }
        const cb = rest.find(value => typeof value === "function");
        cb?.();
        return true;
      });
      restores.push(() => spy.mockRestore());
    }
  }
  return {
    io: {
      readStdin: async () => stdin,
      writeStdout: (value: string) => { stdout += value; },
      writeStderr: (value: string) => { stderr += value; },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get processStdout() { return processStdout; },
    get processStderr() { return processStderr; },
    restore: () => { for (const restore of restores.reverse()) restore(); restores.length = 0; },
  };
}

export function assertNoSecrets(outputs: Record<string, string>, secrets: Record<string, string> = PLACEHOLDER_SECRETS): void {
  for (const [outlet, text] of Object.entries(outputs)) {
    for (const [name, secret] of Object.entries(secrets)) {
      if (secret && text.includes(secret)) throw new Error(`${outlet} contains placeholder secret ${name}`);
    }
  }
}
