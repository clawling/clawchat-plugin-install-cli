#!/usr/bin/env node
import { runClawchatCli } from "./cli";

runClawchatCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
