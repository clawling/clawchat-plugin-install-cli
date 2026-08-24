import { ClawchatError } from "../errors";

export interface PluginArtifactMetadata {
  version: string;
  hostRequirement?: string;
}

export interface HermesInstalledPlugin {
  version: string;
  status: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseYamlScalar(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return match?.[1]?.trim();
}

function parseNestedYamlScalar(text: string, parent: string, key: string): string | undefined {
  const block = text.match(new RegExp(`^${parent}:\\s*\\n((?:[ \\t]+[^\\n]+\\n?)+)`, "m"));
  if (!block) {
    return undefined;
  }
  const match = (block[1] ?? "").match(new RegExp(`^[ \\t]+${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return match?.[1]?.trim();
}

export function parseOpenClawPackageJson(text: string): PluginArtifactMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ClawchatError("METADATA", `failed to parse OpenClaw package.json: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ClawchatError("METADATA", "OpenClaw package.json must be a JSON object");
  }
  const data = parsed as Record<string, any>;
  const version = readString(data.version);
  if (!version) {
    throw new ClawchatError("METADATA", "OpenClaw package.json is missing version");
  }
  const hostRequirement =
    readString(data.clawchat?.openclaw) ??
    readString(data.peerDependencies?.openclaw) ??
    readString(data.engines?.openclaw);
  return { version, hostRequirement };
}

export function parseHermesPluginYaml(text: string): PluginArtifactMetadata {
  const version = parseYamlScalar(text, "version");
  if (!version) {
    throw new ClawchatError("METADATA", "Hermes plugin.yaml is missing version");
  }
  return {
    version,
    hostRequirement: parseNestedYamlScalar(text, "requires", "hermes"),
  };
}

export function parseHostVersion(text: string): string {
  const match = text.match(/\d+(?:\.\d+){1,3}/);
  if (!match) {
    throw new ClawchatError("METADATA", `could not parse host version from: ${JSON.stringify(text)}`);
  }
  const version = match[0];
  if (!version) {
    throw new ClawchatError("METADATA", `could not parse host version from: ${JSON.stringify(text)}`);
  }
  return version;
}

function parseComparableVersion(version: string): { parts: number[]; build: number } {
  const match = version.match(/^(\d+(?:\.\d+){1,3})(?:-(\d+))?$/);
  if (!match) {
    throw new ClawchatError("METADATA", `unsupported version: ${version}`);
  }
  return {
    parts: (match[1] ?? "").split(".").map(Number),
    build: match[2] ? Number(match[2]) : 0,
  };
}

function compareVersions(a: string, b: string): number {
  const left = parseComparableVersion(a);
  const right = parseComparableVersion(b);
  const width = Math.max(left.parts.length, right.parts.length);
  for (let i = 0; i < width; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  const buildDiff = left.build - right.build;
  if (buildDiff !== 0) {
    return buildDiff > 0 ? 1 : -1;
  }
  return 0;
}

export function isVersionOlder(current: string, candidate: string): boolean {
  return compareVersions(current, candidate) < 0;
}

export function assertVersionSatisfiesRange(current: string, range: string | undefined, label: string): void {
  if (!range) {
    return;
  }
  const match = range.match(/^>=(\d+(?:\.\d+){1,3})$/);
  if (!match) {
    throw new ClawchatError("METADATA", `unsupported ${label} version requirement: ${range}`);
  }
  const minimum = match[1];
  if (!minimum) {
    throw new ClawchatError("METADATA", `unsupported ${label} version requirement: ${range}`);
  }
  if (compareVersions(current, minimum) < 0) {
    throw new ClawchatError("PRECONDITION", `${label} version ${current} is too old; need ${range}`);
  }
}

export function parseOpenClawPluginsJson(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ClawchatError("METADATA", `failed to parse openclaw plugins list --json: ${(err as Error).message}`);
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.plugins)
      ? (parsed as { plugins: unknown[] }).plugins
      : Array.isArray((parsed as Record<string, unknown>)?.data)
        ? (parsed as { data: unknown[] }).data
        : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const item = candidate as Record<string, unknown>;
    const id = readString(item.id);
    const name = readString(item.name);
    if (
      id === "clawchat" ||
      id === "clawchat-plugin-openclaw" ||
      name === "clawchat" ||
      name === "@clawling/clawchat-plugin-openclaw"
    ) {
      return readString(item.version) ?? null;
    }
  }
  return null;
}

export function parseHermesPluginList(text: string): HermesInstalledPlugin | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("│") || !line.includes("clawchat")) {
      continue;
    }
    const cells = line.split("│").map((cell) => cell.trim()).filter(Boolean);
    if (cells[0] === "clawchat") {
      return {
        status: cells[1] ?? "",
        version: cells[2] ?? "",
      };
    }
  }
  return null;
}
