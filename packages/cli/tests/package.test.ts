import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe("package dependencies", () => {
  it("does not publish workspace protocol dependencies", () => {
    for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      for (const [name, version] of Object.entries(packageJson[dependencyGroup] ?? {})) {
        expect(version, `${dependencyGroup}.${name}`).not.toMatch(/^workspace:/);
      }
    }
  });
});

describe("standalone skill package removal", () => {
  it("does not keep standalone skill package or publisher artifacts", () => {
    const removedPackageDir = ["sk", "ills"].join("");
    const removedPublisher = ["upload", "skill", "to", "r2.sh"].join("-");

    expect(existsSync(join(repoRoot, "packages", removedPackageDir, "package.json"))).toBe(false);
    expect(existsSync(join(repoRoot, "packages", removedPackageDir, "src", "index.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "scripts", removedPublisher))).toBe(false);
    expect(readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8")).not.toContain(
      ["packages", removedPackageDir].join("/"),
    );
  });
});
