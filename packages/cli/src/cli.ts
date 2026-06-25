import { cac } from "cac";
import {
  installHermesPlugin,
  installOpenClawPlugin,
  normalizeHttpUrl,
  normalizeWsUrl,
  parseTarget,
  updateHermesPlugin,
  updateOpenClawPlugin,
  type ClawchatTarget,
  type InstallActionResult,
  type InstallProgressReporter,
} from "@clawling/clawchat-plugin-install-core";
import { defaultIo, type CliIo } from "./io";

type PluginAction = (options?: {
  force?: boolean;
  onProgress?: InstallProgressReporter;
  ref?: string;
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  mediaBaseUrl?: string;
  activateCode?: string;
}) => Promise<InstallActionResult>;

interface CliDeps extends CliIo {
  installOpenClawPlugin?: PluginAction;
  updateOpenClawPlugin?: PluginAction;
  installHermesPlugin?: PluginAction;
  updateHermesPlugin?: PluginAction;
}

interface BaseUrlFlags {
  apibaseurl?: string;
  wsbaseurl?: string;
  mediabaseurl?: string;
}

function buildBaseUrlOptions(ref: string | undefined, flags: BaseUrlFlags) {
  const apiBaseUrl = flags.apibaseurl ? normalizeHttpUrl(flags.apibaseurl) : undefined;
  const wsBaseUrl = flags.wsbaseurl ? normalizeWsUrl(flags.wsbaseurl) : undefined;
  const mediaBaseUrl = flags.mediabaseurl ? normalizeHttpUrl(flags.mediabaseurl) : undefined;
  return {
    ...(ref ? { ref } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(wsBaseUrl ? { wsBaseUrl } : {}),
    ...(mediaBaseUrl ? { mediaBaseUrl } : {}),
  };
}

function formatActionResult(result: InstallActionResult): string {
  const version = result.version ? ` ${result.version}` : "";
  const previous = result.previousVersion && result.previousVersion !== result.version
    ? ` from ${result.previousVersion}`
    : "";
  const detail = result.detail ? ` (${result.detail})` : "";
  const activated = result.activated ? " + activated" : "";
  return `${result.kind} ${result.status}${version}${previous}${detail}${activated}`;
}

function formatSummary(action: "install" | "update", target: ClawchatTarget, plugin: InstallActionResult): string {
  return [
    `ClawChat ${action} for ${target} complete`,
    formatActionResult(plugin),
  ].join("\n") + "\n";
}

function createProgressReporter(io: CliIo): InstallProgressReporter {
  return (message) => io.writeStdout(`${message}\n`);
}

export async function runClawchatCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  const io: CliIo = {
    readStdin: deps.readStdin ?? defaultIo.readStdin,
    writeStdout: deps.writeStdout ?? defaultIo.writeStdout,
    writeStderr: deps.writeStderr ?? defaultIo.writeStderr,
  };
  const pluginActions = {
    install: {
      openclaw: deps.installOpenClawPlugin ?? installOpenClawPlugin,
      hermes: deps.installHermesPlugin ?? installHermesPlugin,
    },
    update: {
      openclaw: deps.updateOpenClawPlugin ?? updateOpenClawPlugin,
      hermes: deps.updateHermesPlugin ?? updateHermesPlugin,
    },
  };
  const cli = cac("clawchat");
  const isHelpRequest = argv.includes("--help") || argv.includes("-h");
  let commandRan = false;

  cli
    .command("install", "Install ClawChat plugin")
    .option("--target <target>", "Target agent: openclaw or hermes (optionally host@ref)")
    .option("--force", "Reinstall ClawChat plugin even when current")
    .option("--apibaseurl <url>", "REST/API base url (host:port or full url)")
    .option("--wsbaseurl <url>", "WebSocket base url (host:port or full url)")
    .option("--mediabaseurl <url>", "Media base url (host:port or full url)")
    .option("--activate <code>", "Hermes only: run `hermes clawchat activate <code>` right after install (single-use code)")
    .action(
      async (options: {
        target?: string;
        force?: boolean;
        apibaseurl?: string;
        wsbaseurl?: string;
        mediabaseurl?: string;
        activate?: string;
      }) => {
        commandRan = true;
        const { host, ref } = parseTarget(options.target);
        const onProgress = createProgressReporter(io);
        const actionOptions = {
          force: options.force === true,
          onProgress,
          ...buildBaseUrlOptions(ref, options),
          ...(options.activate ? { activateCode: options.activate } : {}),
        };
        const pluginResult = await pluginActions.install[host](actionOptions);
        io.writeStdout(formatSummary("install", host, pluginResult));
      },
    );

  cli
    .command("update", "Update ClawChat plugin")
    .option("--target <target>", "Target agent: openclaw or hermes (optionally host@ref)")
    .option("--force", "Reinstall ClawChat plugin even when current")
    .option("--apibaseurl <url>", "REST/API base url (host:port or full url)")
    .option("--wsbaseurl <url>", "WebSocket base url (host:port or full url)")
    .option("--mediabaseurl <url>", "Media base url (host:port or full url)")
    .action(
      async (options: {
        target?: string;
        force?: boolean;
        apibaseurl?: string;
        wsbaseurl?: string;
        mediabaseurl?: string;
      }) => {
        commandRan = true;
        const { host, ref } = parseTarget(options.target);
        const onProgress = createProgressReporter(io);
        const actionOptions = {
          force: options.force === true,
          onProgress,
          ...buildBaseUrlOptions(ref, options),
        };
        const pluginResult = await pluginActions.update[host](actionOptions);
        io.writeStdout(formatSummary("update", host, pluginResult));
      },
    );

  cli.help();

  try {
    cli.parse(["node", "clawchat", ...argv], { run: false });
    if (isHelpRequest) {
      return 0;
    }
    await cli.runMatchedCommand();
    if (!commandRan) {
      cli.outputHelp();
      return 1;
    }
    return 0;
  } catch (err) {
    io.writeStderr(`${(err as Error).message}\n`);
    return 1;
  }
}
