export const HANDLER_CONTEXT_KEYS = ["ci"] as const;

export type HandlerContextKey = (typeof HANDLER_CONTEXT_KEYS)[number];

export type HandlerContextActor = "handler";

export interface HandlerContextPack {
  key: HandlerContextKey;
  title: string;
  summary: string;
  version: string;
  allowedActors: HandlerContextActor[];
  prompt: string;
}

const CI_CONTEXT_PROMPT = [
  "Loaded handler context pack: Project CI.",
  "",
  "Project CI is svvy's dedicated product lane for repeatable repository confidence checks. It is not a separate runtime profile, a standalone orchestrator, or a custom CI engine.",
  "",
  "When configuring or modifying Project CI:",
  "- Inspect real repository facts first, including package scripts, lockfiles, task runners, existing CI files, Makefiles, README guidance, and test configuration.",
  "- Ask the user when the durable confidence policy is ambiguous instead of guessing every repository has test, lint, typecheck, or build scripts.",
  "- Write reusable Project CI workflow assets only under `.svvy/workflows/{definitions,prompts,components,entries}/ci/`.",
  "- The default saved entry path is `.svvy/workflows/entries/ci/project-ci.tsx` and the default workflow id is `project_ci`.",
  '- CI entries are normal Smithers runnable saved entries. They must export `productKind = "project-ci" as const` and a `resultSchema`.',
  "- The entry's terminal output must validate against `resultSchema` and must contain a Project CI result with `status`, `summary`, and stable `checks`.",
  "- Use stable `checkId` values such as `typecheck`, `unit_tests`, `eslint`, `build`, `integration`, `docs`, or repository-specific ids.",
  "- Use open check `kind` strings; recommended kinds are `typecheck`, `test`, `lint`, `build`, `integration`, `docs`, and `manual`.",
  "- Do not scaffold fake passing checks or placeholder commands just to make Project CI look configured.",
  "- After writing saved workflow files, rely on the returned saved-workflow validation feedback and keep editing until the final saved workflow state validates cleanly.",
  '- Confirm the entry appears through `smithers.list_workflows({ productKind: "project-ci" })`, then run it with `smithers.run_workflow`.',
  "",
  "Project CI recording rules are strict:",
  '- Project CI records are created only from entries declaring `productKind = "project-ci"`.',
  "- The terminal output must directly validate against the entry's declared `resultSchema`.",
  "- Never infer CI state from logs, command names, labels, tags, filenames, node output, final prose, or arbitrary workflow output.",
  "- Invalid or missing result output is a CI troubleshooting state, not an invitation to parse partial facts.",
].join("\n");

export const HANDLER_CONTEXT_PACKS: Record<HandlerContextKey, HandlerContextPack> = {
  ci: {
    key: "ci",
    title: "Project CI",
    summary: "Guidance for configuring and modifying Project CI saved workflow entries.",
    version: "2026-04-24",
    allowedActors: ["handler"],
    prompt: CI_CONTEXT_PROMPT,
  },
};

export function isHandlerContextKey(value: string): value is HandlerContextKey {
  return (HANDLER_CONTEXT_KEYS as readonly string[]).includes(value);
}

export function validateHandlerContextKeys(keys: readonly string[]): HandlerContextKey[] {
  const validKeys: HandlerContextKey[] = [];
  const seen = new Set<HandlerContextKey>();
  for (const key of keys) {
    if (!isHandlerContextKey(key)) {
      throw new Error(`Unknown handler context key: ${key}`);
    }
    if (!seen.has(key)) {
      seen.add(key);
      validKeys.push(key);
    }
  }
  return validKeys;
}

export function getHandlerContextPack(key: HandlerContextKey): HandlerContextPack {
  return HANDLER_CONTEXT_PACKS[key];
}

export function buildHandlerContextRegistryPrompt(): string {
  return [
    "Available optional handler context keys:",
    '- `ci`: Project CI authoring guidance. If Project CI only needs to be run, discover configured CI entries with `smithers.list_workflows({ productKind: "project-ci" })` and run one through `smithers.run_workflow`. If Project CI needs to be configured or modified, call `request_context({ keys: ["ci"] })` before authoring CI assets.',
  ].join("\n");
}

export function buildOrchestratorContextRoutingPrompt(): string {
  return [
    "Optional handler context routing:",
    '- `ci` is available for Project CI authoring. When a delegated objective clearly needs Project CI configuration or modification from the first handler turn, pass `context: ["ci"]` to `thread.start`.',
  ].join("\n");
}

export function buildLoadedHandlerContextPrompt(keys: readonly string[]): string | undefined {
  const validKeys = validateHandlerContextKeys(keys);
  if (validKeys.length === 0) {
    return undefined;
  }

  return validKeys.map((key) => getHandlerContextPack(key).prompt).join("\n\n");
}
