import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@clawling/clawchat-plugin-install-cli";
const FINAL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() ||
      `git ${args[0]} exited with ${result.status ?? result.signal}`);
  }
  return result.stdout.trim();
}

export function checkReleaseTag({
  cwd = process.cwd(),
  tag,
  remote = "origin",
  mainBranch = "main",
  requireHead = true,
}) {
  const failures = [];
  function check(problem, action) {
    try {
      return action();
    } catch (error) {
      failures.push(`${problem}: ${error.message}`);
      return undefined;
    }
  }

  const root = check("Cannot find repository root", () =>
    git(cwd, ["rev-parse", "--show-toplevel"]));
  if (!root) return failures;

  const tagRef = `refs/tags/${tag}`;
  const mainRef = `refs/remotes/${remote}/${mainBranch}`;
  // Validate refs before using them as revisions, patterns, or refspecs.
  const validRefs = check("Invalid release tag or remote main ref", () => {
    if (!tag || !remote || remote.startsWith("-") || !mainBranch) {
      throw new Error("tag, remote, and main branch must be nonempty names");
    }
    git(root, ["check-ref-format", tagRef]);
    git(root, ["check-ref-format", mainRef]);
    return true;
  });
  if (!validRefs) return failures;

  check(`Tag ${tag} must exist locally as an annotated tag`, () => {
    if (git(root, ["cat-file", "-t", tagRef]) !== "tag") {
      throw new Error("lightweight tags are not allowed");
    }
  });
  const tagObject = check(`Cannot resolve local tag object ${tag}`, () =>
    git(root, ["rev-parse", "--verify", tagRef]));
  const commit = check(`Cannot peel tag ${tag} to a commit`, () =>
    git(root, ["rev-parse", "--verify", `${tagRef}^{commit}`]));

  if (requireHead) {
    check(`HEAD must equal the commit tagged ${tag}`, () => {
      const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
      if (commit && head !== commit) throw new Error(`HEAD is ${head}, tag is ${commit}`);
    });
    check("Working tree must be clean (including untracked files)", () => {
      if (git(root, ["status", "--porcelain", "--untracked-files=all"])) {
        throw new Error("commit or remove working tree changes before publishing");
      }
    });
  }

  check(`Tag ${tag} must be pushed and identical on ${remote}`, () => {
    const output = git(root, ["ls-remote", remote, tagRef]);
    const entry = output.split("\n").map((line) => line.split(/\s+/))
      .find(([, ref]) => ref === tagRef);
    if (!entry) throw new Error("tag is not pushed");
    if (tagObject && entry[0] !== tagObject) {
      throw new Error("remote tag object differs from local tag object");
    }
  });

  const fetched = check(`Cannot refresh ${remote}/${mainBranch}`, () => {
    git(root, ["fetch", "--quiet", "--no-tags", remote,
      `+refs/heads/${mainBranch}:${mainRef}`]);
    return true;
  });
  if (fetched && commit) {
    check(`Tag ${tag} commit must be an ancestor of ${remote}/${mainBranch}`, () =>
      git(root, ["merge-base", "--is-ancestor", commit, mainRef]));
  }
  return failures;
}

function main(args) {
  const [mode, version, ...options] = args;
  if (!((mode === "publish" && args.length === 1) ||
    (mode === "promote" && version &&
      (options.length === 0 || (options.length === 1 && options[0] === "--dry-run"))))) {
    throw new Error("Usage: release-guard.mjs publish | promote <X.Y.Z> [--dry-run]");
  }
  if (mode === "publish" && (process.env.npm_config_tag || "latest") !== "latest") {
    console.log("Release guard: non-latest dev channel is exempt from release-tag checks.");
    return 0;
  }
  if (mode === "promote" && !FINAL_VERSION.test(version)) {
    throw new Error("Promotion requires a final plain semver X.Y.Z; dev/prerelease versions are never promoted.");
  }

  const cwd = process.cwd();
  let releaseVersion = version;
  if (mode === "publish") {
    const root = git(cwd, ["rev-parse", "--show-toplevel"]);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "packages/cli/package.json"), "utf8"));
    if (typeof pkg.version !== "string" || !pkg.version) {
      throw new Error("packages/cli/package.json must contain a version");
    }
    releaseVersion = pkg.version;
  }
  const tag = `cli-v${releaseVersion}`;
  const failures = checkReleaseTag({ cwd, tag, requireHead: mode === "publish" });
  if (failures.length) {
    console.error(`Release guard failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    return 1;
  }
  console.log(`Release guard OK: ${tag} is annotated, pushed, and on origin/main${mode === "publish" ? "; HEAD matches and the working tree is clean" : ""}.`);
  if (mode === "promote") {
    const npmArgs = ["dist-tag", "add", `${PACKAGE_NAME}@${releaseVersion}`, "latest"];
    if (options.includes("--dry-run")) {
      console.log(`Would run: npm ${npmArgs.join(" ")}`);
      return 0;
    }
    const result = spawnSync("npm", npmArgs, { stdio: "inherit", shell: false });
    if (result.error) console.error(`Promotion failed: ${result.error.message}`);
    return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`Release guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
