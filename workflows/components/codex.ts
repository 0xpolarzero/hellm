import { CodexAgent } from "smithers-orchestrator";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

type CodexConfigValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | null;

const DEFAULT_HEARTBEAT_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_WORKFLOWS_HEARTBEAT_TIMEOUT_MS,
  20 * 60 * 1000,
);

export function createCodexAgent(input: {
  taskSlug: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  maxOutputBytes: number;
  sandbox: CodexSandbox;
  fullAuto: boolean;
  systemPrompt?: string;
  idleTimeoutMs?: number;
  config?: Record<string, CodexConfigValue>;
}) {
  return new CodexAgent({
    model: input.model,
    env: createIsolatedCodexEnv(input.taskSlug),
    extraArgs: ["--ephemeral"],
    maxOutputBytes: input.maxOutputBytes,
    skipGitRepoCheck: true,
    sandbox: input.sandbox,
    fullAuto: input.fullAuto,
    timeoutMs: input.timeoutMs,
    idleTimeoutMs: input.idleTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
    config: {
      model_reasoning_effort: input.reasoningEffort,
      "features.multi_agent": false,
      "agents.max_threads": 1,
      ...input.config,
    },
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
  });
}

export function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createIsolatedCodexEnv(taskSlug: string): Record<string, string> {
  const configuredHome = process.env.SVVY_WORKFLOWS_CODEX_HOME?.trim();
  const codexHomeRoot =
    configuredHome && configuredHome.length > 0 ? resolve(configuredHome) : tmpdir();
  mkdirSync(codexHomeRoot, { recursive: true });

  const codexHome = mkdtempSync(resolve(codexHomeRoot, `svvy-codex-home-${taskSlug}-`));
  mkdirSync(codexHome, { recursive: true });

  const sourceCodexHome =
    process.env.CODEX_HOME?.trim() || resolve(process.env.HOME ?? homedir(), ".codex");

  for (const filename of ["auth.json", "config.toml"]) {
    const source = resolve(sourceCodexHome, filename);
    const target = resolve(codexHome, filename);
    if (existsSync(source) && !existsSync(target)) {
      copyFileSync(source, target);
    }
  }

  return {
    CODEX_HOME: codexHome,
  };
}
