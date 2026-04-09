import { startHellmTui } from "./runtime.ts";

interface ParsedCliOptions {
  cwd?: string;
  initOnly?: boolean;
  initialMessage?: string;
}

function parseCliOptions(args: readonly string[]): ParsedCliOptions {
  let cwd: string | undefined;
  let initOnly = false;
  const initialMessageParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      initialMessageParts.push(...args.slice(index + 1));
      break;
    }

    if (arg === "--init-only") {
      initOnly = true;
      continue;
    }

    if (arg === "--cwd") {
      cwd = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
      continue;
    }

    if (arg === "--message") {
      const message = args[index + 1];
      if (message) {
        initialMessageParts.push(message);
      }
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      initialMessageParts.push(arg);
    }
  }

  const initialMessage = initialMessageParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");

  return {
    ...(cwd ? { cwd } : {}),
    ...(initOnly ? { initOnly } : {}),
    ...(initialMessage.length > 0 ? { initialMessage } : {}),
  };
}

const parsed = parseCliOptions(process.argv.slice(2));
const cwd =
  parsed.cwd ??
  process.env.HELLM_CWD ??
  process.env.INIT_CWD ??
  process.env.npm_config_local_prefix ??
  process.cwd();

await startHellmTui({
  ...parsed,
  cwd,
});
