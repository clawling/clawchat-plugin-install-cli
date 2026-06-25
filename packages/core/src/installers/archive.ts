import * as fs from "node:fs";
import { ClawchatError } from "../errors";
import { captureCommand, runCommand, type CommandCapturer, type CommandRunner } from "./run";

export async function readFirstExistingTgzFile(
  tgzPath: string,
  candidates: readonly string[],
  capture: CommandCapturer = captureCommand,
): Promise<string> {
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return await capture("tar", ["-xOf", tgzPath, candidate]);
    } catch (err) {
      errors.push(`${candidate}: ${(err as Error).message}`);
    }
  }
  throw new ClawchatError("METADATA", `none of the expected files were found in ${tgzPath}: ${errors.join("; ")}`);
}

export async function extractTgz(
  tgzPath: string,
  destinationDir: string,
  run: CommandRunner = runCommand,
): Promise<void> {
  fs.mkdirSync(destinationDir, { recursive: true });
  await run("tar", ["-xzf", tgzPath, "-C", destinationDir]);
}

export function removePath(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}
