import * as fs from "node:fs";
import * as path from "node:path";
import { platformDefaultHermesHome } from "../hermes-home";
import type { AuthReadOptions, TargetAuth } from "./types";

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equals = line.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    const rawValue = line.slice(equals + 1).trim();
    values[key] = rawValue.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
  }
  return values;
}

function getHermesEnvPaths(options: AuthReadOptions): string[] {
  const env = options.env ?? process.env;
  const paths: string[] = [];
  if (env.HERMES_HOME?.trim()) {
    paths.push(path.join(env.HERMES_HOME, ".env"));
  }
  // Platform-native fallback: ~/.hermes on POSIX, %LOCALAPPDATA%\\hermes on
  // Windows. Probing only the POSIX path reported a paired Windows agent as
  // unauthenticated whenever HERMES_HOME was not exported.
  paths.push(path.join(platformDefaultHermesHome(options), ".env"));
  return paths;
}

export function readHermesAuth(options: AuthReadOptions = {}): TargetAuth | null {
  for (const envPath of getHermesEnvPaths(options)) {
    let parsed: Record<string, string>;
    try {
      parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
    } catch {
      continue;
    }

    const token = parsed.CLAWCHAT_TOKEN;
    if (!token) {
      continue;
    }

    return {
      target: "hermes",
      token,
      refreshToken: parsed.CLAWCHAT_REFRESH_TOKEN,
      baseUrl: parsed.CLAWCHAT_BASE_URL,
      userId: parsed.CLAWCHAT_USER_ID,
    };
  }

  return null;
}
