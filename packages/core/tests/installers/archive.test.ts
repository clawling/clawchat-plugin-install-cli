import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTgz, readFirstExistingTgzFile, removePath } from "../../src/installers/archive";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-archive-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("archive helpers", () => {
  it("reads the first existing file from a tgz", async () => {
    const capture = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (args[2] === "missing.json") {
        throw new Error("missing");
      }
      return "{\"version\":\"0.1.0\"}";
    });

    await expect(readFirstExistingTgzFile("/tmp/plugin.tgz", ["missing.json", "package/package.json"], capture)).resolves.toBe("{\"version\":\"0.1.0\"}");
    expect(capture.mock.calls).toEqual([
      ["tar", ["-xOf", "/tmp/plugin.tgz", "missing.json"]],
      ["tar", ["-xOf", "/tmp/plugin.tgz", "package/package.json"]],
    ]);
  });

  it("extracts tgz archives into an existing directory", async () => {
    const dir = tmpDir();
    const run = vi.fn(async () => undefined);

    await extractTgz("/tmp/skill.tgz", dir, run);

    expect(run).toHaveBeenCalledWith("tar", ["-xzf", "/tmp/skill.tgz", "-C", dir]);
  });

  it("removes files or directories", () => {
    const dir = tmpDir();
    const file = path.join(dir, "artifact.tgz");
    fs.writeFileSync(file, "artifact", "utf8");

    removePath(file);

    expect(fs.existsSync(file)).toBe(false);
  });
});
