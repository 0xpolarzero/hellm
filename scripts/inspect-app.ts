import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_AGENT_SETTINGS_STATE } from "../src/shared/agent-settings";

const BRIDGE_METADATA_PREFIX = "svvy bridge:";
const STARTUP_FAILURE_PREFIX = "svvy desktop startup failed";
const PROJECT_ROOT = resolve(import.meta.dir, "..");
const INSPECTION_HOME_PREFIX = "svvy-inspect-home-";
const CUA_DRIVER_CANDIDATES = ["cua-driver", "CuaDriver", "cuadriver"] as const;
export const INSPECT_APP_STARTUP_TIMEOUT_MS = 120_000;

export interface InspectAppOptions {
  workspace: string;
  home: string | null;
  keepHome: boolean;
  stubProvider: boolean;
  help: boolean;
}

export interface BridgeMetadata {
  appId: string;
  bridgeUrl: string | null;
}

export interface CuaDriverAvailability {
  executable: string;
  ready: boolean;
  sandboxRestricted: boolean;
  detail: string;
}

export function resolveInspectionProcessEnv(
  appHome: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const hostHome = env.HOME?.trim();
  return {
    ...env,
    ...(env.CARGO_HOME?.trim() || !hostHome ? {} : { CARGO_HOME: join(hostHome, ".cargo") }),
    ...(env.RUSTUP_HOME?.trim() || !hostHome ? {} : { RUSTUP_HOME: join(hostHome, ".rustup") }),
    HOME: appHome,
  };
}

export function detectCuaDriver(
  which: (candidate: string) => string | null = Bun.which,
): string | null {
  for (const candidate of CUA_DRIVER_CANDIDATES) {
    const executable = which(candidate);
    if (executable) return executable;
  }
  return null;
}

export async function probeCuaDriver(
  executable: string | null,
  run: (executable: string) => Promise<{ exitCode: number; stdout: string }> = async (
    candidate,
  ) => {
    const child = Bun.spawn([candidate, "call", "list_windows", "--compact"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]).finally(() => clearTimeout(timeout));
    return { exitCode, stdout };
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CuaDriverAvailability | null> {
  if (!executable) return null;
  try {
    const result = await run(executable);
    if (result.exitCode !== 0) {
      return unavailableCuaDriverProbe(
        executable,
        `window probe exited with code ${result.exitCode}`,
        env,
      );
    }
    const parsed = JSON.parse(result.stdout) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as Record<string, unknown>).windows)
    ) {
      return unavailableCuaDriverProbe(executable, "window probe returned invalid JSON", env);
    }
    const windowCount = ((parsed as Record<string, unknown>).windows as unknown[]).length;
    return windowCount > 0
      ? {
          executable,
          ready: true,
          sandboxRestricted: false,
          detail: `${windowCount} native window(s) visible`,
        }
      : unavailableCuaDriverProbe(executable, "window probe returned no native windows", env);
  } catch (error) {
    return unavailableCuaDriverProbe(
      executable,
      error instanceof Error ? error.message : String(error),
      env,
    );
  }
}

function unavailableCuaDriverProbe(
  executable: string,
  detail: string,
  env: NodeJS.ProcessEnv,
): CuaDriverAvailability {
  const sandboxRestricted = env.CODEX_SANDBOX?.trim().toLowerCase() === "seatbelt";
  return {
    executable,
    ready: false,
    sandboxRestricted,
    detail: sandboxRestricted ? `host probe required; sandboxed ${detail}` : detail,
  };
}

export function parseInspectAppArgs(
  args: readonly string[],
  cwd = process.cwd(),
): InspectAppOptions {
  let workspace: string | null = null;
  let home: string | null = null;
  let keepHome = false;
  let stubProvider = false;
  let help = false;

  const readValue = (flag: "--workspace" | "--home", index: number): [string, number] => {
    const argument = args[index];
    const equalsPrefix = `${flag}=`;
    if (argument?.startsWith(equalsPrefix)) {
      const value = argument.slice(equalsPrefix.length);
      if (!value) {
        throw new Error(`${flag} requires a non-empty path.`);
      }
      return [value, index];
    }

    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`${flag} requires a path.`);
    }
    return [value, index + 1];
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--keep-home") {
      keepHome = true;
      continue;
    }
    if (argument === "--stub-provider") {
      stubProvider = true;
      continue;
    }
    if (argument === "--workspace" || argument?.startsWith("--workspace=")) {
      if (workspace !== null) {
        throw new Error("--workspace may only be provided once.");
      }
      const [value, consumedIndex] = readValue("--workspace", index);
      workspace = value;
      index = consumedIndex;
      continue;
    }
    if (argument === "--home" || argument?.startsWith("--home=")) {
      if (home !== null) {
        throw new Error("--home may only be provided once.");
      }
      const [value, consumedIndex] = readValue("--home", index);
      home = value;
      index = consumedIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
  }

  return {
    workspace: resolve(cwd, workspace ?? "."),
    home: home === null ? null : resolve(cwd, home),
    keepHome,
    stubProvider,
    help,
  };
}

export function parseBridgeMetadataLine(line: string): BridgeMetadata | null {
  const prefixIndex = line.indexOf(BRIDGE_METADATA_PREFIX);
  if (prefixIndex < 0) {
    return null;
  }

  const payload = line.slice(prefixIndex + BRIDGE_METADATA_PREFIX.length).trim();
  if (!payload) {
    throw new Error("svvy bridge metadata is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`svvy bridge metadata is not valid JSON: ${message}`, { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("svvy bridge metadata must be a JSON object.");
  }

  const metadata = parsed as Record<string, unknown>;
  if (typeof metadata.appId !== "string" || metadata.appId.trim().length === 0) {
    throw new Error("svvy bridge metadata requires a non-empty appId.");
  }
  if (!("bridgeUrl" in metadata)) {
    throw new Error("svvy bridge metadata requires bridgeUrl (string or null).");
  }
  if (
    metadata.bridgeUrl !== null &&
    (typeof metadata.bridgeUrl !== "string" || metadata.bridgeUrl.trim().length === 0)
  ) {
    throw new Error("svvy bridge metadata bridgeUrl must be a non-empty string or null.");
  }

  return {
    appId: metadata.appId,
    bridgeUrl: metadata.bridgeUrl as string | null,
  };
}

export function isStartupFailureLine(line: string): boolean {
  return line.includes(STARTUP_FAILURE_PREFIX);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderBrowserToolsGuidance(
  metadata: BridgeMetadata,
  cuaDriver: CuaDriverAvailability | null = null,
  options: { stubProvider?: boolean } = {},
): string {
  const connection = metadata.bridgeUrl
    ? `--url ${shellQuote(metadata.bridgeUrl)}`
    : `--app ${shellQuote(metadata.appId)}`;
  const cli = "bunx electrobun-browser-tools";
  const cuaDriverGuidance = cuaDriver?.ready
    ? [`CuaDriver: ready at ${cuaDriver.executable} (${cuaDriver.detail})`]
    : cuaDriver?.sandboxRestricted
      ? [
          `CuaDriver: installed at ${cuaDriver.executable}, but sandbox-restricted (${cuaDriver.detail}).`,
          `CuaDriver host probe: authorize this read-only command outside the Codex sandbox: ${shellQuote(cuaDriver.executable)} call list_windows '{}' --compact`,
        ]
      : cuaDriver
        ? [
            `CuaDriver: installed at ${cuaDriver.executable}, but unavailable (${cuaDriver.detail}).`,
          ]
        : [
            "CuaDriver: unavailable in PATH; native/physical interaction is not available in this lane.",
          ];
  const stubProviderGuidance = options.stubProvider
    ? [
        "",
        "Credential-free live prompt smoke:",
        `${cli} page click ${shellQuote("role:button:Create a new orchestrator")} ${connection} --visible true --json`,
        `${cli} page fill role:textbox ${shellQuote("Return a rich inspection response with Markdown, code, and a Mermaid diagram.")} ${connection} --visible true --json`,
        `${cli} page click ${shellQuote("role:button:Send")} ${connection} --visible true --json`,
        `${cli} page wait-for ${shellQuote("text:Live inspection response")} ${connection} --state visible --timeout 15000 --json`,
        `${cli} page screenshot ${connection} --path ${shellQuote(join(PROJECT_ROOT, "screenshots", "live-inspection.png"))} --json`,
      ]
    : [];

  return [
    "svvy is ready for live inspection.",
    `Bridge target: ${metadata.bridgeUrl ?? metadata.appId}`,
    ...cuaDriverGuidance,
    "",
    `${cli} doctor ${connection} --json`,
    `${cli} status ${connection} --json`,
    `${cli} tree ${connection} --json`,
    `${cli} layout snapshot ${connection} --summary --json`,
    `${cli} state list ${connection} --json`,
    `${cli} state get surfaces ${connection} --json`,
    `${cli} state get sessions ${connection} --json`,
    `${cli} events summary ${connection} --json`,
    `${cli} logs summary ${connection} --json`,
    `${cli} logs tail ${connection} --json`,
    `${cli} errors list ${connection} --json`,
    `${cli} network summary ${connection} --json`,
    `${cli} perf summary ${connection} --json`,
    `${cli} page resolve role:button ${connection} --visible true --max-matches 50 --json`,
    `${cli} page snapshot ${connection} --summary --json`,
    `${cli} page url ${connection} --json`,
    ...stubProviderGuidance,
    "",
    "Use role:button:Accessible name, role:textbox, test-id, or CSS refs with page resolve, click, fill, press, or wait-for.",
    "Request a full page snapshot only when you need detailed layout evidence.",
    "When finished, press Ctrl+C in this inspect:app terminal to stop the full dev process tree and clean its temporary HOME.",
  ].join("\n");
}

export function renderInspectAppHelp(): string {
  return [
    "Usage: bun scripts/inspect-app.ts [options]",
    "",
    "Launch the normal svvy dev app with an isolated HOME and print live browser-tools commands.",
    "",
    "Options:",
    "  --workspace <path>  Startup workspace (default: current directory)",
    "  --home <path>       Use this HOME instead of creating an isolated temporary HOME",
    "  --keep-home         Retain an automatically created HOME after the app exits",
    "  --stub-provider     Run a deterministic local provider for credential-free live prompts",
    "  -h, --help          Show this help",
  ].join("\n");
}

async function assertDirectory(path: string, label: string): Promise<void> {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not accessible at ${path}: ${message}`, { cause: error });
  }
  if (!details.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

async function streamOutput(
  stream: ReadableStream<Uint8Array>,
  destination: NodeJS.WriteStream,
  inspectLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const abort = (): void => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      destination.write(value);
      pending += decoder.decode(value, { stream: true });

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        inspectLine(pending.slice(0, newlineIndex).replace(/\r$/, ""));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    }

    pending += decoder.decode();
    if (pending.length > 0) {
      inspectLine(pending.replace(/\r$/, ""));
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

type InspectionSubprocess = Pick<Bun.Subprocess, "exited" | "kill" | "pid">;

export function signalInspectionProcessTree(
  child: InspectionSubprocess,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through if the process group disappeared before the signal.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The immediate child also exited before the fallback signal.
  }
}

async function waitForInspectionExit(
  child: InspectionSubprocess,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    child.exited.then(() => true),
    new Promise<void>((resolveForce) => {
      timer = setTimeout(resolveForce, timeoutMs);
    }).then(() => false),
  ]);
  if (timer) clearTimeout(timer);
  return exited;
}

export async function terminateInspectionProcessTree(
  child: InspectionSubprocess,
  graceMs = 5_000,
  forceMs = 2_000,
  signalTree = signalInspectionProcessTree,
): Promise<void> {
  signalTree(child, "SIGTERM");
  if (await waitForInspectionExit(child, graceMs)) return;
  signalTree(child, "SIGKILL");
  await waitForInspectionExit(child, forceMs);
}

type InspectionProviderStub = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly requests: Array<Record<string, unknown>>;
  stop(): void;
};

export function startInspectionProviderStub(): InspectionProviderStub {
  const apiKey = "svvy-live-inspection-key";
  const requests: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/api/coding/paas/v4/chat/completions") {
        return Response.json(
          { error: "Unsupported inspection-provider request." },
          { status: 404 },
        );
      }
      if (request.headers.get("authorization") !== `Bearer ${apiKey}`) {
        return Response.json(
          { error: "Invalid inspection-provider authorization." },
          { status: 401 },
        );
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json(
          { error: "Inspection-provider request must be JSON." },
          { status: 400 },
        );
      }
      const payload = body as Record<string, unknown>;
      if (
        typeof payload.model !== "string" ||
        !Array.isArray(payload.messages) ||
        payload.stream !== true
      ) {
        return Response.json(
          { error: "Inspection-provider request must be a streaming chat completion." },
          { status: 422 },
        );
      }
      requests.push(payload);
      const richResponse = Array.isArray(payload.tools) && payload.tools.length > 0;
      const content = richResponse
        ? [
            "# Live inspection response",
            "",
            "The real desktop prompt lifecycle reached the deterministic local provider.",
            "",
            "- Streaming: active",
            "- Runtime: real dev app",
            "- Credentials: local stub only",
            "",
            "```ts",
            'const lane = "inspect:app";',
            "```",
            "",
            "```mermaid",
            "flowchart LR",
            "  Prompt --> Runtime",
            "  Runtime --> UI",
            "```",
          ].join("\n")
        : "Live inspection";
      const contentSplit = richResponse ? content.indexOf("```mermaid") : content.length;
      const contentParts = [content.slice(0, contentSplit), content.slice(contentSplit)].filter(
        Boolean,
      );
      const completionId = `chatcmpl-inspection-${requests.length}`;
      const chunks = [
        ...contentParts.map((part, index) => ({
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model: payload.model,
          choices: [
            {
              index: 0,
              delta: { ...(index === 0 ? { role: "assistant" } : {}), content: part },
              finish_reason: null,
            },
          ],
        })),
        {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model: payload.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
        {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model: payload.model,
          choices: [],
          usage: {
            prompt_tokens: 64,
            completion_tokens: 32,
            total_tokens: 96,
          },
        },
      ];
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            for (let index = 0; index < chunks.length; index += 1) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index])}\n\n`));
              if (richResponse && index < contentParts.length - 1) await Bun.sleep(500);
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(responseStream, {
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        },
      });
    },
  });

  return {
    apiKey,
    baseUrl: `http://127.0.0.1:${server.port}/api/coding/paas/v4`,
    requests,
    stop: () => server.stop(true),
  };
}

async function runLiveInspection(options: InspectAppOptions): Promise<number> {
  await assertDirectory(options.workspace, "Workspace");

  let ownedHome: string | null = null;
  const home = options.home ?? (await mkdtemp(join(tmpdir(), INSPECTION_HOME_PREFIX)));
  if (options.home === null) {
    ownedHome = home;
  } else {
    await mkdir(home, { recursive: true });
    await assertDirectory(home, "HOME");
  }

  console.log(`svvy inspection workspace: ${options.workspace}`);
  console.log(
    `svvy inspection HOME: ${home}${ownedHome ? (options.keepHome ? " (retained)" : " (temporary)") : ""}`,
  );

  let providerStub: InspectionProviderStub | null = null;
  try {
    providerStub = options.stubProvider ? startInspectionProviderStub() : null;
    if (providerStub) {
      const agentDirectory = join(home, ".config", "svvy", "pi");
      await mkdir(agentDirectory, { recursive: true });
      await Promise.all([
        Bun.write(
          join(agentDirectory, "models.json"),
          `${JSON.stringify({ providers: { zai: { baseUrl: providerStub.baseUrl } } }, null, 2)}\n`,
        ),
        Bun.write(
          join(agentDirectory, "agent-settings.json"),
          `${JSON.stringify(
            {
              ...DEFAULT_AGENT_SETTINGS_STATE,
              agents: {
                ...DEFAULT_AGENT_SETTINGS_STATE.agents,
                titleNamer: {
                  ...DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer,
                  provider: "zai",
                  model: "glm-5-turbo",
                },
              },
            },
            null,
            2,
          )}\n`,
        ),
      ]);
      console.log(`svvy inspection provider stub: ${providerStub.baseUrl}`);
    }
  } catch (error) {
    providerStub?.stop();
    if (ownedHome && !options.keepHome) {
      await rm(ownedHome, { force: true, recursive: true });
    }
    throw error;
  }

  let child;
  try {
    child = Bun.spawn([process.execPath, "run", "dev"], {
      cwd: PROJECT_ROOT,
      detached: process.platform !== "win32",
      env: {
        ...resolveInspectionProcessEnv(home),
        SVVY_DEV_WORKSPACE_CWD: options.workspace,
        ...(providerStub ? { ZAI_API_KEY: providerStub.apiKey } : {}),
      },
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    providerStub?.stop();
    if (ownedHome && !options.keepHome) {
      await rm(ownedHome, { force: true, recursive: true });
    }
    throw error;
  }

  let childExited = false;
  let metadata: BridgeMetadata | null = null;
  let startupSettled = false;
  let resolveMetadata!: (value: BridgeMetadata) => void;
  let rejectMetadata!: (error: Error) => void;
  const metadataPromise = new Promise<BridgeMetadata>((resolvePromise, rejectPromise) => {
    resolveMetadata = resolvePromise;
    rejectMetadata = rejectPromise;
  });

  const inspectLine = (line: string): void => {
    if (startupSettled) return;
    try {
      if (isStartupFailureLine(line)) {
        startupSettled = true;
        rejectMetadata(
          new Error(
            "Cannot inspect svvy: the app reported a startup failure before mounting its bridge. See the streamed diagnostic above.",
          ),
        );
        return;
      }
      const parsed = parseBridgeMetadataLine(line);
      if (!parsed) return;
      metadata = parsed;
      startupSettled = true;
      resolveMetadata(parsed);
    } catch (error) {
      startupSettled = true;
      const message = error instanceof Error ? error.message : String(error);
      rejectMetadata(
        new Error(`Cannot inspect svvy: malformed startup bridge metadata. ${message}`),
      );
    }
  };

  const outputFailure: { current: Error | null } = { current: null };
  const outputAbortController = new AbortController();
  const captureOutputFailure = (error: unknown): void => {
    if (outputAbortController.signal.aborted) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    outputFailure.current ??= normalized;
    if (!startupSettled) {
      startupSettled = true;
      rejectMetadata(
        new Error(`Cannot inspect svvy: failed to read dev output. ${normalized.message}`),
      );
    }
  };
  const stdoutTask = streamOutput(
    child.stdout,
    process.stdout,
    inspectLine,
    outputAbortController.signal,
  ).catch(captureOutputFailure);
  const stderrTask = streamOutput(
    child.stderr,
    process.stderr,
    inspectLine,
    outputAbortController.signal,
  ).catch(captureOutputFailure);
  const exitCodePromise = child.exited.then((code) => {
    childExited = true;
    return code;
  });

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let forwardedSignal: NodeJS.Signals | null = null;
  let signalForceTimer: ReturnType<typeof setTimeout> | undefined;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = (): void => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      signalInspectionProcessTree(child, signal);
      signalForceTimer = setTimeout(() => {
        if (childExited) return;
        signalInspectionProcessTree(child, "SIGKILL");
        outputAbortController.abort(
          new Error(`Forced shutdown after ${signal} did not settle within 5s.`),
        );
      }, 5_000);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const metadataOrStartupExit = exitCodePromise.then(async (code) => {
      await Promise.all([stdoutTask, stderrTask]);
      if (outputFailure.current) {
        throw new Error(
          `Cannot inspect svvy: failed to read dev output. ${outputFailure.current.message}`,
        );
      }
      if (metadata) {
        return { kind: "ready", metadata } as const;
      }
      if (forwardedSignal) {
        return { exitCode: code, kind: "interrupted" } as const;
      }
      throw new Error(
        `Cannot inspect svvy: the dev lane exited with code ${code} before printing ${BRIDGE_METADATA_PREFIX} JSON.`,
      );
    });
    const startup = await Promise.race([
      metadataPromise.then(
        (readyMetadata) => ({ kind: "ready", metadata: readyMetadata }) as const,
      ),
      metadataOrStartupExit,
      new Promise<never>((_resolve, reject) => {
        startupTimer = setTimeout(() => {
          reject(
            new Error(
              `Cannot inspect svvy: timed out after ${INSPECT_APP_STARTUP_TIMEOUT_MS / 1_000}s waiting for ${BRIDGE_METADATA_PREFIX} JSON.`,
            ),
          );
        }, INSPECT_APP_STARTUP_TIMEOUT_MS);
      }),
    ]);
    if (startupTimer) clearTimeout(startupTimer);
    if (startup.kind === "interrupted") {
      return startup.exitCode;
    }
    console.log(
      `\n${renderBrowserToolsGuidance(startup.metadata, await probeCuaDriver(detectCuaDriver()), {
        stubProvider: options.stubProvider,
      })}\n`,
    );

    const exitCode = await exitCodePromise;
    await Promise.all([stdoutTask, stderrTask]);
    if (outputFailure.current) {
      throw new Error(
        `Cannot inspect svvy: failed to read dev output. ${outputFailure.current.message}`,
      );
    }
    return exitCode;
  } catch (error) {
    if (!childExited) {
      await terminateInspectionProcessTree(child);
    }
    outputAbortController.abort(error);
    await Promise.all([stdoutTask, stderrTask]);
    throw error;
  } finally {
    if (startupTimer) clearTimeout(startupTimer);
    if (signalForceTimer) clearTimeout(signalForceTimer);
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    if (ownedHome) {
      if (options.keepHome) {
        console.log(`Retained svvy inspection HOME: ${ownedHome}`);
      } else {
        await rm(ownedHome, { force: true, recursive: true });
      }
    }
    if (providerStub) {
      console.log(`svvy inspection provider requests: ${providerStub.requests.length}`);
      providerStub.stop();
    }
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  const options = parseInspectAppArgs(args);
  if (options.help) {
    console.log(renderInspectAppHelp());
    return 0;
  }
  return await runLiveInspection(options);
}

if (import.meta.main) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
