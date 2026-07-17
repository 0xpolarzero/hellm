/** @jsxImportSource smithers-orchestrator */

import { Loop, Parallel, PiAgent, Sequence, Task, Worktree, openSmithersBackend } from "smithers-orchestrator";
import { resolve } from "node:path";
import { z } from "zod";
import { createCodexAgent, parsePositiveInt, type CodexSandbox } from "../components/codex";
import { GeminiCliAgent } from "../components/gemini-cli";

const inputSchema = z.object({
  repoRoot: z.string().default("."),
  worktreeRoot: z.string().default(".worktrees/complete-product-v2"),
  branch: z.string().default("workflow/complete-product-v2"),
  baseBranch: z.string().default("main"),
  referenceWorktree: z.string().optional(),
  packageIds: z.array(z.string()).optional(),
  maxPackageConcurrency: z.number().int().positive().default(10),
  taskTimeoutMs: z.number().int().positive().default(parsePositiveInt(process.env.SVVY_COMPLETE_PRODUCT_TASK_TIMEOUT_MS, 3 * 60 * 60 * 1000)),
  reviewTimeoutMs: z.number().int().positive().default(parsePositiveInt(process.env.SVVY_COMPLETE_PRODUCT_REVIEW_TIMEOUT_MS, 90 * 60 * 1000)),
  maxReviewIterations: z.number().int().positive().default(4),
  maxFinalIterations: z.number().int().positive().default(6),
});

const auditSchema = z.object({
  status: z.enum(["READY", "BLOCKED"]),
  summary: z.string(),
  inProgressFeatureIds: z.array(z.string()),
  openProgressItems: z.number().int().nonnegative(),
  packageRisks: z.array(z.string()),
  integrationRisks: z.array(z.string()),
  blockers: z.array(z.string()),
});

const packagePlanSchema = z.object({
  packageId: z.string(),
  status: z.enum(["READY_FOR_TESTS", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  featureIds: z.array(z.string()),
  progressItems: z.array(z.string()),
  existingTestFiles: z.array(z.string()),
  plannedTestFiles: z.array(z.string()),
  failingContracts: z.array(z.string()),
  risks: z.array(z.string()),
});

const testSchema = z.object({
  packageId: z.string(),
  status: z.enum(["READY_FOR_IMPLEMENTATION", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  featureIds: z.array(z.string()),
  progressItems: z.array(z.string()),
  testFilesChanged: z.array(z.string()),
  failingContracts: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const implementationSchema = z.object({
  packageId: z.string(),
  status: z.enum(["READY_FOR_REVIEW", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  featureIds: z.array(z.string()),
  progressItemsCompleted: z.array(z.string()),
  filesChanged: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const reviewFindingSchema = z.object({
  severity: z.enum(["blocker", "high", "medium", "low"]),
  location: z.string(),
  problem: z.string(),
  requiredAction: z.string(),
});

const reviewSchema = z.object({
  packageId: z.string(),
  approved: z.boolean(),
  continueLoop: z.boolean(),
  verdict: z.enum(["LGTM", "CHANGES_REQUIRED", "BLOCKED"]),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
  validationRan: z.array(z.string()),
  blockers: z.array(z.string()),
});

const addressSchema = z.object({
  packageId: z.string(),
  status: z.enum(["READY_FOR_REVIEW", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  findingsAddressed: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const integrationSchema = z.object({
  stage: z.string(),
  status: z.enum(["READY", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  featureIdsCovered: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const resultSchema = z.object({
  approved: z.boolean(),
  branch: z.string(),
  worktreePath: z.string(),
  packageCount: z.number().int().positive(),
  packageApprovals: z.array(z.string()),
  finalVerdict: z.string().nullable(),
  summary: z.string(),
  unresolvedIssues: z.array(z.string()),
});

const { smithers, Workflow, outputs } = await openSmithersBackend({
  audit: auditSchema,
  plans: packagePlanSchema,
  tests: testSchema,
  implementation: implementationSchema,
  review: reviewSchema,
  address: addressSchema,
  integration: integrationSchema,
  result: resultSchema,
});

type Review = z.infer<typeof reviewSchema>;

type WorkPackage = {
  id: string;
  title: string;
  featureIds: string[];
  progressSections: string[];
  scope: string;
};

const packages: WorkPackage[] = [
  {
    id: "core-contracts",
    title: "Core schemas and package boundaries",
    featureIds: ["effect-package-architecture"],
    progressSections: ["Current Baseline", "0A. Effect Package Architecture"],
    scope: "@svvy/core public schemas, branded ids, errors, generated declarations, boundary ledgers, forbidden imports, and package-owned Effect service contracts. Do not implement package-private behavior in core.",
  },
  {
    id: "state-services",
    title: "Durable state services and read models",
    featureIds: ["structured-session-state", "durable-artifact-storage", "session-summary-read-models", "app-logs-surface"],
    progressSections: ["0A. Effect Package Architecture", "1. Structured Session State", "19. App Logs Surface"],
    scope: "@svvy/state repositories, SQLite-backed durable facts, queue/wait/command/artifact/log/session read models, invalidations, transactional invariants, redaction, and package API tests against real state layers.",
  },
  {
    id: "runtime-composition",
    title: "Runtime composition and source coordination",
    featureIds: ["source-invalidation", "workspace-runtime-recovery", "multi-workspace-runtime", "context-budget-observability"],
    progressSections: ["0. Source Invalidation", "16. Recovery And Test Coverage", "17. Context Budget Observability"],
    scope: "@svvy/runtime layer composition, app-global and workspace runtime scopes, source coordinators, invalidation, recovery claims and leases, published notifications, context budgets, and package-safe bootstrap seams.",
  },
  {
    id: "commands-tools",
    title: "Commands, tools, and execute_typescript lifecycle",
    featureIds: ["execute-typescript-surface", "live-tool-projection", "request-user-input", "turn-command-state", "true-system-prompt-channel"],
    progressSections: ["2. `execute_typescript`", "3. Turn Decisions And Delegation"],
    scope: "Complete actor-local generated facades, shell/apply-patch/execute_typescript/request-input command lifecycles, nested tool children, approvals, cancellation, timeout, oversized output, crash recovery, projection, and real package integration tests.",
  },
  {
    id: "sandbox-pi-runtime",
    title: "Sandbox and pi-backed actor runtime",
    featureIds: ["desktop-shell", "multi-surface-runtime"],
    progressSections: ["0A. Effect Package Architecture", "2. `execute_typescript`"],
    scope: "@svvy/sandbox native helper and policy enforcement plus @svvy/pi-adapter actor/session behavior. Preserve pi ownership of interaction. Verify real package composition, process lifecycle, streaming, abort, and failure behavior without alternate shells or test-only runtime paths.",
  },
  {
    id: "threads-queues-recovery",
    title: "Handler threads, queued messages, waits, and episodes",
    featureIds: ["session-threads", "durable-episodes", "session-wait-state", "queued-surface-messages", "structured-session-state"],
    progressSections: ["4. Handler Threads", "13A. Queued Surface Messages", "16. Recovery And Test Coverage"],
    scope: "Thread start/follow-up/report/episode contracts, handler-local continuation, FIFO surface queues, blocking input and timer persistence, ownership, cancellation, crash/restart recovery, and runtime-state integration tests through package APIs.",
  },
  {
    id: "workflows-bridge",
    title: "Workflow source library and task-agent bridge",
    featureIds: ["workflows-generated-surface", "execute-typescript-surface", "context-budget-observability"],
    progressSections: ["6. Workflows Source, Build, And Generated Surface"],
    scope: "App-owned Workflows source, generated @svvyx/workflows surface, package generation/link refresh, official Smithers CLI instructions, runtime-owned runTaskAgent bridge, parameters, cancellation/failure output, and packaged-app-safe integration. Never use repo-root workflows as product runtime assets.",
  },
  {
    id: "extensions-agents",
    title: "Extensions, secrets, ambient resources, and agent profiles",
    featureIds: ["provider-auth", "ambient-agent-resources", "snippets", "extension-env-secrets", "web-extension-surface", "extension-loading", "agent-profiles"],
    progressSections: ["2A. Prompt-Only TinyFish Web Extension", "11. Agents Pane And Agent Profiles", "14. Agents, Extensions, And Generated Agent Context", "14A. Ambient Agent Resources"],
    scope: "@svvy/extensions source/build/loading, generated prompt contracts, TinyFish Web instructions, snippets, env/secret references and host secret mutations, provider auth, ambient-resource settings, agent profile resolution, and package/integration tests with raw-secret non-disclosure.",
  },
  {
    id: "desktop-bootstrap",
    title: "Desktop facade and app bootstrap cutover",
    featureIds: ["desktop-shell", "multi-session-support", "multi-workspace-runtime", "workspace-runtime-recovery"],
    progressSections: ["Current Baseline", "0A. Effect Package Architecture", "8. Workspace Navigation, Live Surfaces, And Core Projection"],
    scope: "@svvy/desktop facade-only host lifecycle and src/bun bootstrap composition through real package layers. Remove renderer-local authority and injected fake production paths. Add composed app/bootstrap tests that exercise renderer-to-facade-to-runtime-to-state behavior.",
  },
  {
    id: "renderer-surfaces",
    title: "Renderer integration and interactive surfaces",
    featureIds: ["multi-surface-runtime", "workspace-runtime-recovery", "command-palette", "composer-mention-links", "artifacts-projection", "prompt-history", "assistant-markdown-rendering", "app-logs-surface"],
    progressSections: ["8. Workspace Navigation, Live Surfaces, And Core Projection", "9. Command Palette And Quick Open", "10. Pane Layout, Surface Ownership, And Expanded Surfaces", "13. Composer Mention Links", "19. App Logs Surface"],
    scope: "Svelte renderer read-model consumption, workspace tabs, session/sidebar state, Dockview placement and restore, command palette/hotkeys, composer mentions, artifacts, markdown, logs, stable live-state slots, and mounted tests against real desktop/runtime facades rather than renderer-local fake state.",
  },
];



type WorkflowAgentInput = {
  taskSlug: string;
  model: string;
  reasoningEffort: "medium" | "high" | "xhigh";
  timeoutMs: number;
  maxOutputBytes: number;
  sandbox: CodexSandbox;
  fullAuto: boolean;
};

const workflowAgentKind = process.env.SVVY_WORKFLOWS_AGENT?.trim();
const usePiAgent = workflowAgentKind === "pi";
const useGeminiCliAgent = workflowAgentKind === "gemini";
const createWorkflowAgent = (input: WorkflowAgentInput) => {
  if (usePiAgent) {
    return new PiAgent({
      id: input.taskSlug,
      provider: process.env.SVVY_WORKFLOWS_PI_PROVIDER?.trim() || "openrouter",
      model: input.model,
      thinking: input.reasoningEffort,
      timeoutMs: input.timeoutMs,
      idleTimeoutMs: parsePositiveInt(
        process.env.SVVY_WORKFLOWS_HEARTBEAT_TIMEOUT_MS,
        20 * 60 * 1000,
      ),
      maxOutputBytes: input.maxOutputBytes,
      yolo: input.fullAuto,
      noSession: true,
    });
  }
  if (useGeminiCliAgent) {
    return new GeminiCliAgent({
      id: input.taskSlug,
      model: input.model,
      timeoutMs: input.timeoutMs,
      idleTimeoutMs: parsePositiveInt(
        process.env.SVVY_WORKFLOWS_HEARTBEAT_TIMEOUT_MS,
        20 * 60 * 1000,
      ),
      maxOutputBytes: input.maxOutputBytes,
    });
  }
  return createCodexAgent(input);
};

const generalModel = usePiAgent
  ? process.env.SVVY_WORKFLOWS_PI_MODEL?.trim() || "openai/gpt-5.2-codex"
  : useGeminiCliAgent
    ? process.env.SVVY_WORKFLOWS_GEMINI_MODEL?.trim() || "gemini-2.5-pro"
    : process.env.SVVY_WORKFLOWS_CODEX_MODEL?.trim() || "gpt-5.6-luna";
const reviewModel = usePiAgent
  ? process.env.SVVY_WORKFLOWS_PI_REVIEW_MODEL?.trim() || "openai/gpt-5.4"
  : useGeminiCliAgent
    ? process.env.SVVY_WORKFLOWS_GEMINI_REVIEW_MODEL?.trim() || "gemini-2.5-pro"
    : process.env.SVVY_WORKFLOWS_REVIEW_MODEL?.trim() || "gpt-5.6-sol";
const planner = createWorkflowAgent({ taskSlug: "complete-product-v2-audit", model: reviewModel, reasoningEffort: "xhigh", timeoutMs: 3 * 60 * 60 * 1000, maxOutputBytes: 3_000_000, sandbox: "read-only", fullAuto: true });
const packagePlanner = createWorkflowAgent({ taskSlug: "complete-product-v2-package-plan", model: generalModel, reasoningEffort: "medium", timeoutMs: 90 * 60 * 1000, maxOutputBytes: 3_000_000, sandbox: "read-only", fullAuto: true });
const testAuthor = createWorkflowAgent({ taskSlug: "complete-product-v2-tests", model: generalModel, reasoningEffort: "high", timeoutMs: 3 * 60 * 60 * 1000, maxOutputBytes: 4_000_000, sandbox: "workspace-write", fullAuto: true });
const implementer = createWorkflowAgent({ taskSlug: "complete-product-v2-implement", model: generalModel, reasoningEffort: "high", timeoutMs: 3 * 60 * 60 * 1000, maxOutputBytes: 4_000_000, sandbox: "workspace-write", fullAuto: true });
const reviewer = createWorkflowAgent({ taskSlug: "complete-product-v2-review-restored", model: reviewModel, reasoningEffort: "xhigh", timeoutMs: 90 * 60 * 1000, maxOutputBytes: 3_000_000, sandbox: "read-only", fullAuto: true });
const fixer = createWorkflowAgent({ taskSlug: "complete-product-v2-fix-restored", model: generalModel, reasoningEffort: "high", timeoutMs: 3 * 60 * 60 * 1000, maxOutputBytes: 4_000_000, sandbox: "workspace-write", fullAuto: true });
const e2eAgent = createWorkflowAgent({ taskSlug: "complete-product-v2-e2e", model: usePiAgent ? generalModel : "gpt-5.3-codex-spark", reasoningEffort: "high", timeoutMs: 3 * 60 * 60 * 1000, maxOutputBytes: 4_000_000, sandbox: "workspace-write", fullAuto: true });

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const repoRoot = resolve(input.repoRoot);
  const worktreePath = resolve(repoRoot, input.worktreeRoot);
  const referenceWorktreePath = input.referenceWorktree
    ? resolve(repoRoot, input.referenceWorktree)
    : undefined;
  const requestedPackageIds = new Set(input.packageIds ?? packages.map((item) => item.id));
  const unknownPackageIds = [...requestedPackageIds].filter(
    (id) => !packages.some((item) => item.id === id),
  );
  if (unknownPackageIds.length > 0) {
    throw new Error(`Unknown package ids: ${unknownPackageIds.join(", ")}`);
  }
  const activePackages = packages.filter((item) => requestedPackageIds.has(item.id));
  const audit = ctx.latest("audit", "audit-product");
  const packageReviews = new Map(
    activePackages.map((item) => [
      item.id,
      ctx.latest("review", `${item.id}-review`) as Review | undefined,
    ]),
  );
  const packageImplementations = new Map(
    activePackages.map((item) => [
      item.id,
      ctx.latest("implementation", `${item.id}-implement`),
    ]),
  );
  const allPackagesReady = activePackages.every(
    (item) =>
      packageImplementations.get(item.id)?.status !== "BLOCKED" &&
      packageReviews.get(item.id)?.approved === true,
  );
  const packagePhaseTerminal =
    audit?.status === "BLOCKED" ||
    activePackages.every((item) => {
      const implementation = packageImplementations.get(item.id);
      const review = packageReviews.get(item.id);
      return (
        implementation?.status === "BLOCKED" ||
        review?.approved === true ||
        review?.continueLoop === false
      );
    });
  const finalReview = ctx.latest("review", "final-review") as Review | undefined;
  const finalReviewCount = (ctx.outputs.review ?? []).filter(
    (row) => row.packageId === "final",
  ).length;
  const stopFinal = finalReview?.approved === true || finalReview?.continueLoop === false;
  const resultReady =
    audit?.status === "BLOCKED" ||
    (packagePhaseTerminal && !allPackagesReady) ||
    (allPackagesReady && stopFinal);

  return (
    <Workflow name="svvy-complete-product-v2" cache={false}>
      <Sequence>
        <Task id="audit-product" output={outputs.audit} agent={planner} timeoutMs={input.taskTimeoutMs}>
          {auditPrompt(referenceWorktreePath)}
        </Task>

        {audit?.status === "READY" ? (
          <Parallel maxConcurrency={input.maxPackageConcurrency}>
            {activePackages.map((item) => {
              const plan = ctx.latest("plans", `${item.id}-plan`);
              const testResult = ctx.latest("tests", `${item.id}-tests`);
              const implementation = packageImplementations.get(item.id);
              const review = packageReviews.get(item.id);
              const reviewCount = (ctx.outputs.review ?? []).filter(
                (row) => row.packageId === item.id,
              ).length;
              const stop =
                implementation?.status === "BLOCKED" ||
                review?.approved === true ||
                review?.continueLoop === false;
              return (
                <Worktree
                  key={item.id}
                  id={`${item.id}-worktree`}
                  path={`${worktreePath}-${item.id}`}
                  branch={`${input.branch}-${item.id}`}
                  baseBranch={input.baseBranch}
                >
                  <Sequence>
                    <Task
                      id={`${item.id}-plan`}
                      output={outputs.plans}
                      agent={packagePlanner}
                      timeoutMs={input.reviewTimeoutMs}
                    >
                      {packagePlanPrompt(item, audit, referenceWorktreePath)}
                    </Task>
                    {plan && plan.status !== "BLOCKED" ? (
                      <Task
                        id={`${item.id}-tests`}
                        output={outputs.tests}
                        agent={testAuthor}
                        timeoutMs={input.taskTimeoutMs}
                      >
                        {testPrompt(item, audit, plan, referenceWorktreePath)}
                      </Task>
                    ) : null}
                    {testResult && testResult.status !== "BLOCKED" ? (
                      <Task
                        id={`${item.id}-implement`}
                        output={outputs.implementation}
                        agent={implementer}
                        timeoutMs={input.taskTimeoutMs}
                      >
                        {implementationPrompt(item, testResult, referenceWorktreePath)}
                      </Task>
                    ) : null}
                    {implementation && implementation.status !== "BLOCKED" ? (
                      <Loop
                        id={`${item.id}-review-loop`}
                        until={stop}
                        maxIterations={input.maxReviewIterations}
                        onMaxReached="fail"
                      >
                        <Sequence>
                          {reviewCount > 0 &&
                          review?.approved !== true &&
                          review?.continueLoop !== false ? (
                            <Task
                              id={`${item.id}-address`}
                              output={outputs.address}
                              agent={fixer}
                              timeoutMs={input.taskTimeoutMs}
                            >
                              {addressPrompt(item, review, referenceWorktreePath)}
                            </Task>
                          ) : null}
                          <Task
                            id={`${item.id}-review`}
                            output={outputs.review}
                            agent={reviewer}
                            timeoutMs={input.reviewTimeoutMs}
                          >
                            {reviewPrompt(
                              item,
                              testResult!,
                              implementation,
                              reviewCount + 1,
                              referenceWorktreePath,
                            )}
                          </Task>
                        </Sequence>
                      </Loop>
                    ) : null}
                  </Sequence>
                </Worktree>
              );
            })}
          </Parallel>
        ) : null}

        {allPackagesReady ? (
          <Worktree
            id="complete-product-integration-worktree"
            path={worktreePath}
            branch={input.branch}
            baseBranch={input.baseBranch}
          >
            <Sequence>
              <Task
                id="integrate-package-branches"
                output={outputs.integration}
                agent={implementer}
                timeoutMs={input.taskTimeoutMs}
              >
                {integrationPrompt(activePackages, input.branch, referenceWorktreePath)}
              </Task>
              <Task
                id="backend-coverage"
                output={outputs.integration}
                agent={implementer}
                timeoutMs={input.taskTimeoutMs}
              >
                {backendCoveragePrompt()}
              </Task>
              <Task
                id="composed-app-verification"
                output={outputs.integration}
                agent={implementer}
                timeoutMs={input.taskTimeoutMs}
              >
                {composedAppPrompt()}
              </Task>
              <Task
                id="live-journey-repair"
                output={outputs.integration}
                agent={e2eAgent}
                timeoutMs={input.taskTimeoutMs}
              >
                {liveJourneyPrompt()}
              </Task>
              <Loop
                id="final-review-loop"
                until={stopFinal}
                maxIterations={input.maxFinalIterations}
                onMaxReached="fail"
              >
                <Sequence>
                  {finalReviewCount > 0 &&
                  finalReview?.approved !== true &&
                  finalReview?.continueLoop !== false ? (
                    <Task
                      id="final-address"
                      output={outputs.address}
                      agent={fixer}
                      timeoutMs={input.taskTimeoutMs}
                    >
                      {finalAddressPrompt(finalReview)}
                    </Task>
                  ) : null}
                  <Task
                    id="final-review"
                    output={outputs.review}
                    agent={reviewer}
                    timeoutMs={input.taskTimeoutMs}
                  >
                    {finalReviewPrompt(finalReviewCount + 1)}
                  </Task>
                </Sequence>
              </Loop>
            </Sequence>
          </Worktree>
        ) : null}

        {resultReady ? (
          <Task id="complete-product-result" output={outputs.result}>
            {{
              approved: finalReview?.approved ?? false,
              branch: input.branch,
              worktreePath,
              packageCount: activePackages.length,
              packageApprovals: activePackages
                .filter((item) => packageReviews.get(item.id)?.approved)
                .map((item) => item.id),
              finalVerdict: finalReview?.verdict ?? null,
              summary: finalReview?.approved
                ? "All package, composed-app, backend coverage, and live journey gates were approved."
                : "Product completion workflow did not reach final approval.",
              unresolvedIssues: [
                ...(audit?.blockers ?? []),
                ...activePackages.flatMap((item) => packageReviews.get(item.id)?.blockers ?? []),
                ...(finalReview?.blockers ?? []),
                ...(finalReview?.findings ?? []).map(
                  (finding) => `${finding.severity} ${finding.location}: ${finding.problem}`,
                ),
              ],
            }}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});

function commonRules(referenceWorktreePath?: string) {
  const priorWork =
    referenceWorktreePath === undefined
      ? ""
      : `A prior unfinished workflow worktree exists at ${referenceWorktreePath}. Inspect only relevant scoped diffs as leads, independently verify every adopted change, and never merge or copy it wholesale.`;
  return [
    "Read AGENTS.md, docs/prd.md, and docs/features.ts before work.",
    "Use docs/references/pi-mono for pi, docs/references/effect-smol and docs/references/t3code for Effect v4, and https://smithers.sh/llms-full.txt plus docs/references/smithers for Smithers.",
    "Treat unexpected changes as user work. Do not use compatibility paths, test-only product behavior, fake production facades, renderer-owned authority, or an alternate shell/TUI.",
    "Work through package APIs and composed layers. Run focused checks only during the task; the final stages run global gates.",
    "Bound context aggressively: never run unbounded git diff or log, never read an entire file over 500 lines, and never paste generated artifacts or large tool output into the conversation. Start with name/status/stat, then inspect targeted hunks, symbols, ranges, searches, and focused tests.",
    "Update docs/features.ts and docs/progress.md only when behavior and verification genuinely satisfy the source-of-truth contract.",
    "If you edit an isolated worktree, commit every scoped change before returning so downstream integration can consume the branch.",
    priorWork,
  ]
    .filter(Boolean)
    .join(" ");
}

function auditPrompt(referenceWorktreePath?: string) {
  return `${commonRules(referenceWorktreePath)}\n\nRead the entire current product, roadmap, feature inventory, package boundaries, app bootstrap, and test inventories. Do not edit. Establish exact current facts after the package migration: every in-progress feature id, every unchecked roadmap contract, duplicate or stale roadmap claims, package/API seams still bypassed, tests that inject fakes instead of composing real layers, and live journeys lacking evidence. Validate that the ten work packages in this workflow collectively cover every gap. Report READY unless an external credential or unavailable platform makes source implementation impossible; ordinary failing code is not a blocker.`;
}

function packagePlanPrompt(
  item: WorkPackage,
  audit: z.infer<typeof auditSchema>,
  referenceWorktreePath?: string,
) {
  return `${commonRules(referenceWorktreePath)}\n\nPackage: ${item.id} — ${item.title}\nDeclared feature ids: ${item.featureIds.join(", ")}\nRoadmap sections: ${item.progressSections.join("; ")}\nScope: ${item.scope}\nAudit: ${audit.summary}\n\nDo not edit. Build a complete contract-test plan for this package slice. Inspect every relevant unchecked roadmap contract, production owner, public package API, existing unit/integration/app test, and known migration defect. Name exact existing and planned test files, observable success, failure, recovery, cancellation, precedence, ownership, and persistence contracts, realistic composed layers, expected failing behavior, dependencies on other package branches, and overlap hazards. Keep renderer/native e2e out unless package/app APIs cannot prove the behavior. Report READY_FOR_TESTS unless an external prerequisite makes the test contract impossible.`;
}

function testPrompt(
  item: WorkPackage,
  audit: z.infer<typeof auditSchema>,
  plan: z.infer<typeof packagePlanSchema>,
  referenceWorktreePath?: string,
) {
  return `${commonRules(referenceWorktreePath)}\n\nPackage: ${item.id} — ${item.title}\nDeclared feature ids: ${item.featureIds.join(", ")}\nRoadmap sections: ${item.progressSections.join("; ")}\nScope: ${item.scope}\nAudit: ${audit.summary}\nPlan: ${plan.summary}\nPlanned tests:\n${formatList(plan.plannedTestFiles)}\nPlanned failing contracts:\n${formatList(plan.failingContracts)}\n\nAuthor tests before product changes. Stay within this package slice and its directly owned integration-test files; do not modify product code, shared source-of-truth docs, generated ledgers, or another package's fixtures. Add or strengthen behavior tests at the lowest real boundary: package unit tests for pure invariants, package integration tests using real composed Effect layers and repositories, and app/bootstrap integration tests only where multiple packages meet. Replace shallow projection/source-shape assertions when they fail to prove behavior. Tests must fail on plausible migration defects and cover success, failure, cancellation/recovery, precedence, ownership, and persistence where relevant. Run focused tests, record expected failures precisely, and commit the test-only change even while tests expose missing product behavior. Return the exact feature ids and roadmap items covered.`;
}

function implementationPrompt(
  item: WorkPackage,
  tests: z.infer<typeof testSchema>,
  referenceWorktreePath?: string,
) {
  return `${commonRules(referenceWorktreePath)}\n\nPackage: ${item.id} — ${item.title}\nScope: ${item.scope}\nTest author summary: ${tests.summary}\nFailing contracts:\n${formatList(tests.failingContracts)}\nUnresolved test issues:\n${formatList(tests.unresolvedIssues)}\n\nImplement the complete scoped behavior at its owning package boundary. Make the authored tests pass, then inspect the named roadmap sections for related gaps tests may have missed. Delete obsolete pre-package paths and fake production composition instead of bridging them. Keep allocation and copies bounded. Exercise a real smoke path through the changed package API or app facade, not only a test file. Run focused typecheck/tests and commit the implementation. Update source-of-truth feature/progress records only for contracts now implemented and verified; completed progress items require the actual commit hash, so leave them unchecked until the commit exists.`;
}

function reviewPrompt(
  item: WorkPackage,
  tests: z.infer<typeof testSchema>,
  implementation: z.infer<typeof implementationSchema>,
  round: number,
  referenceWorktreePath?: string,
) {
  return `${commonRules(referenceWorktreePath)}\n\nReview round ${round} for ${item.id} — ${item.title}. Read the complete branch diff against main and relevant source, not summaries alone. Scope: ${item.scope}\nTests: ${tests.summary}\nImplementation: ${implementation.summary}\n\nAct as a strict package-migration reviewer. Verify behavior is owned by the correct package, public APIs are real and composed, state transitions and failures are durable, renderer/desktop do not retain authority, tests defend observable contracts through real layers, and no unchecked scoped roadmap item is falsely treated as done. Run focused checks. Approve only with no blocker, high, medium, or low findings and no unverified scoped behavior. Set continueLoop true for actionable code, test, or doc findings and false only for a genuine external blocker.`;
}

function addressPrompt(
  item: WorkPackage,
  review?: Review,
  referenceWorktreePath?: string,
) {
  return `${commonRules(referenceWorktreePath)}\n\nAddress every finding from the latest review for ${item.id} — ${item.title}.\nVerdict: ${review?.verdict ?? "CHANGES_REQUIRED"}\nSummary: ${review?.summary ?? "No summary"}\nFindings:\n${formatFindings(review)}\nBlockers:\n${formatList(review?.blockers)}\n\nFix causes, not assertions or symptoms. Add or adjust contract tests when a finding exposes an unprotected behavior. Run focused checks and a smoke path, then commit the repair. Return BLOCKED only for an external prerequisite that source changes cannot resolve.`;
}

function integrationPrompt(
  items: WorkPackage[],
  branch: string,
  referenceWorktreePath?: string,
) {
  const branches = items.map((item) => `${branch}-${item.id}`);
  return `${commonRules(referenceWorktreePath)}\n\nIntegrate the approved package branches into the current integration branch in this exact dependency order:\n${formatList(branches)}\n\nInspect every branch diff before merging. Require its approved review output to match the actual branch. Merge or cherry-pick the complete committed package work; never discard tests to resolve conflicts. Resolve overlaps according to the PRD, generated contracts, package ownership, and the current package architecture rather than whichever branch merged first. Reject and repair stale source-relative imports, fake facades, duplicated authorities, compatibility paths, invalid generated ledgers, and package cycles. After each logical dependency group, run its focused package and integration tests so failures are attributable. Finish with all package typechecks and backend tests green, a clean committed integration branch, and an exact list of merged package ids and unresolved issues.`;
}

function backendCoveragePrompt() {
  return `${commonRules()}\n\nBuild and enforce an exhaustive backend-first feature coverage inventory. Map every docs/features.ts id to concrete package-unit, package-integration, composed-app, and live-e2e evidence. A feature may omit e2e only when package/app tests prove the user-visible contract without renderer/native lifecycle dependence; record that rationale. Add a machine-checked strict gate that rejects unknown ids, missing files, duplicate ids, projection-only evidence presented as lifecycle coverage, and any shipped/in-progress feature without the required real evidence. Fill uncovered package and app integration contracts and fix product defects they reveal. Keep the e2e layer minimal. Run the new strict backend coverage gate and focused suites.`;
}

function composedAppPrompt() {
  return `${commonRules()}\n\nVerify the real composed application from src/bun bootstrap through @svvy/desktop facades, @svvy/runtime, @svvy/pi-adapter, @svvy/extensions, @svvy/state, and @svvy/sandbox. Replace remaining fake-facade integration tests with production-layer harnesses where practical. Exercise startup, session creation/resume, prompt turn, command lifecycle, persistence/reload, queue/wait recovery, handler delegation, workflow task-agent bridge, source refresh, and shutdown. Fix every defect. Run package tests plus the composed smoke scenarios. Do not use e2e for contracts available through the composed backend/app facade.`;
}

function liveJourneyPrompt() {
  return `${commonRules()}\n\nRun the canonical OrbStack lane with bun run test:e2e. For failures, inspect retained e2e-results evidence and reproduce with bun run inspect:app -- --workspace <absolute-path> plus electrobun-browser-tools before changing code. Fix product causes; do not add retries, broad waits, selector churn, fallback paths, or test-only behavior. Reconcile e2e/feature-coverage.ts so only journeys requiring real renderer/native interaction remain live e2e obligations. Exercise representative visual/native journeys for workspace/session navigation, composer/mentions/attachments, streaming and tool cards, queues/waits/approvals, threads, workflows/agents/extensions panes, layout restore, recovery, and logs. Capture manual screenshots under screenshots when manual inspection is required. Run the strict e2e coverage gate.`;
}

function finalReviewPrompt(round: number) {
  return `${commonRules()}\n\nFinal product review round ${round}. Audit the entire branch against every docs/features.ts entry and every docs/progress.md unchecked item, then inspect implementation and test evidence. Run bun run check, the strict backend feature coverage gate, bun run check:e2e-coverage:complete, and bun run test:e2e. Inspect per-test failures and retained evidence; top-level green is insufficient if child work failed or skipped required behavior. Verify package migration cutover, packaged-app-safe workflow integration, real composed app behavior, and minimal but sufficient e2e coverage. Reconcile docs/features.ts and docs/progress.md to truth. Approve only when the intended PRD surface is implemented, all feature ids have enforced evidence, all required live journeys pass, no scoped roadmap implementation item remains open without a genuine external blocker, and no blocker/high/medium/low finding remains.`;
}

function finalAddressPrompt(review?: Review) {
  return `${commonRules()}\n\nFix every final-review finding across product code, package tests, composed integration, live journeys, feature coverage inventories, and source-of-truth docs.\nVerdict: ${review?.verdict ?? "CHANGES_REQUIRED"}\nSummary: ${review?.summary ?? "No summary"}\nFindings:\n${formatFindings(review)}\nBlockers:\n${formatList(review?.blockers)}\n\nReproduce failures, repair root causes, and rerun the exact failing gate plus the affected smoke path. Do not narrow the contract or relabel unfinished behavior.`;
}

function formatFindings(review?: Review) {
  return review?.findings.length ? review.findings.map((finding) => `- [${finding.severity}] ${finding.location}: ${finding.problem} Required: ${finding.requiredAction}`).join("\n") : "- none";
}

function formatList(items?: string[]) {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}
