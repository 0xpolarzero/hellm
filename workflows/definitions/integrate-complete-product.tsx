/** @jsxImportSource smithers-orchestrator */

import { Loop, Sequence, Task, Worktree, openSmithersBackend } from "smithers-orchestrator";
import { resolve } from "node:path";
import { z } from "zod";
import { parsePositiveInt } from "../components/codex";
import { GeminiCliAgent } from "../components/gemini-cli";

const inputSchema = z.object({
  repoRoot: z.string().default(".."),
  worktreeRoot: z.string().default(".worktrees/complete-product-v2-integrated"),
  branch: z.string().default("workflow/complete-product-v2-integrated"),
  baseBranch: z.string().default("main"),
  packageIds: z.array(z.string()).optional(),
  taskTimeoutMs: z.number().int().positive().default(parsePositiveInt(process.env.SVVY_COMPLETE_PRODUCT_TASK_TIMEOUT_MS, 3 * 60 * 60 * 1000)),
  reviewTimeoutMs: z.number().int().positive().default(parsePositiveInt(process.env.SVVY_COMPLETE_PRODUCT_REVIEW_TIMEOUT_MS, 90 * 60 * 1000)),
  maxReviewIterations: z.number().int().positive().default(8),
  maxFinalIterations: z.number().int().positive().default(8),
});

const integrationSchema = z.object({
  packageId: z.string(),
  status: z.enum(["READY_FOR_REVIEW", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  sourceBranch: z.string(),
  commitsCreated: z.array(z.string()),
  filesChanged: z.array(z.string()),
  contractsIntegrated: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const findingSchema = z.object({
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
  findings: z.array(findingSchema),
  validationRan: z.array(z.string()),
  blockers: z.array(z.string()),
});

const resultSchema = z.object({
  approved: z.boolean(),
  branch: z.string(),
  worktreePath: z.string(),
  packageApprovals: z.array(z.string()),
  finalVerdict: z.string().nullable(),
  summary: z.string(),
  unresolvedIssues: z.array(z.string()),
});

const { smithers, Workflow, outputs } = await openSmithersBackend({
  integration: integrationSchema,
  review: reviewSchema,
  result: resultSchema,
});

type Review = z.infer<typeof reviewSchema>;

type IntegrationPackage = {
  id: string;
  title: string;
  sourceBranch: string;
  scope: string;
};

const packages: IntegrationPackage[] = [
  {
    id: "core-contracts",
    title: "Core schemas and package boundaries",
    sourceBranch: "workflow/complete-product-v2-core-contracts",
    scope: "Integrate canonical branded ids, errors, recovery and context contracts, generated declarations, package-boundary ledgers, and Effect service ownership without pulling package-private behavior into @svvy/core.",
  },
  {
    id: "state-services",
    title: "Durable state services and read models",
    sourceBranch: "workflow/complete-product-v2-state-services",
    scope: "Integrate SQLite-backed durable facts, artifacts, queues, waits, commands, logs, session read models, transactional invariants, invalidation, redaction, and real state layers while reconciling the core contract shape already on the integration branch.",
  },
  {
    id: "sandbox-pi-runtime",
    title: "Sandbox and pi-backed actor runtime",
    sourceBranch: "workflow/complete-product-v2-sandbox-pi-runtime",
    scope: "Integrate native sandbox policy enforcement and pi-backed actor/session lifecycle, preserving pi ownership of interaction, process cleanup, streaming, abort, and failure behavior without alternate shells or test-only runtime paths.",
  },
  {
    id: "threads-queues-recovery",
    title: "Handler threads, queues, waits, and recovery",
    sourceBranch: "workflow/complete-product-v2-threads-queues-recovery",
    scope: "Integrate handler continuation, FIFO surface queues, durable episodes, blocking input, timers, ownership, cancellation, crash/restart recovery, and runtime-state boundaries against the canonical core/state APIs now present.",
  },
  {
    id: "commands-tools",
    title: "Commands and tools lifecycle",
    sourceBranch: "workflow/complete-product-v2-commands-tools",
    scope: "Integrate accepted shell, Apply Patch, execute_typescript, nested child, request-input, approval, cancellation, timeout, failure, oversized-output, projection, and recovery lifecycles through runtime-owned command control.",
  },
  {
    id: "workflows-bridge",
    title: "Workflow source library and task-agent bridge",
    sourceBranch: "workflow/complete-product-v2-workflows-bridge",
    scope: "Integrate app-owned workflow source/build/link assets and the narrow runtime-owned runTaskAgent bridge with durable attempts, cancellation, generated declarations, packaged-app-safe Smithers usage, and no loopback runtime-control tools.",
  },
  {
    id: "runtime-composition",
    title: "Runtime composition and recovery",
    sourceBranch: "workflow/complete-product-v2-runtime-composition",
    scope: "Integrate composed Effect layers, app-global and workspace runtime scopes, source coordinators, invalidation, recovery claims and leases, workflow task-attempt scopes, context budgets, notifications, and bootstrap seams after all lower-level contracts have landed.",
  },
  {
    id: "extensions-agents",
    title: "Extensions, agents, profiles, env, and secrets",
    sourceBranch: "workflow/complete-product-v2-extensions-agents",
    scope: "Integrate extension source/build/load authority, agent profiles and manifests, promoted build verification, CLI readiness, TinyFish guidance, env/secret mutation boundaries, generated packages, and app/runtime composition without exposing raw secrets.",
  },
  {
    id: "desktop-bootstrap",
    title: "Desktop bootstrap and facade composition",
    sourceBranch: "workflow/complete-product-v2-desktop-bootstrap",
    scope: "Integrate @svvy/desktop and Bun bootstrap strictly over injected package facades, runtime generation fencing, restart/workspace recovery, queue draining, restored workspace cleanup, title worker scopes, teardown, and packaged lifecycle behavior.",
  },
  {
    id: "renderer-surfaces",
    title: "Renderer surfaces and native windows",
    sourceBranch: "workflow/complete-product-v2-renderer-surfaces",
    scope: "Integrate durable multi-surface restoration, tabs/sidebar/panel state, detached native windows, workspace routing, renderer notifications, recovery facts, and UI state without moving authority out of packages/runtime/state.",
  },
];

const model = process.env.SVVY_WORKFLOWS_GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
const reviewModel = process.env.SVVY_WORKFLOWS_GEMINI_REVIEW_MODEL?.trim() || model;
const heartbeatTimeoutMs = parsePositiveInt(process.env.SVVY_WORKFLOWS_HEARTBEAT_TIMEOUT_MS, 20 * 60 * 1000);
const integrationAgents = new Map(
  packages.map((item) => [
    item.id,
    new GeminiCliAgent({
      id: `complete-product-v2-integrate-${item.id}`,
      model,
      timeoutMs: 3 * 60 * 60 * 1000,
      idleTimeoutMs: heartbeatTimeoutMs,
      maxOutputBytes: 4_000_000,
    }),
  ]),
);
const reviewAgents = new Map(
  packages.map((item) => [
    item.id,
    new GeminiCliAgent({
      id: `complete-product-v2-review-integration-${item.id}`,
      model: reviewModel,
      timeoutMs: 90 * 60 * 1000,
      idleTimeoutMs: heartbeatTimeoutMs,
      maxOutputBytes: 3_000_000,
    }),
  ]),
);
const finalFixer = new GeminiCliAgent({
  id: "complete-product-v2-final-integration-fix",
  model,
  timeoutMs: 3 * 60 * 60 * 1000,
  idleTimeoutMs: heartbeatTimeoutMs,
  maxOutputBytes: 4_000_000,
});
const finalReviewer = new GeminiCliAgent({
  id: "complete-product-v2-final-integration-review",
  model: reviewModel,
  timeoutMs: 3 * 60 * 60 * 1000,
  idleTimeoutMs: heartbeatTimeoutMs,
  maxOutputBytes: 4_000_000,
});

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const repoRoot = resolve(input.repoRoot);
  const worktreePath = resolve(repoRoot, input.worktreeRoot);
  const requestedPackageIds = new Set(input.packageIds ?? packages.map((item) => item.id));
  const unknownPackageIds = [...requestedPackageIds].filter(
    (id) => !packages.some((item) => item.id === id),
  );
  if (unknownPackageIds.length > 0) {
    throw new Error(`Unknown package ids: ${unknownPackageIds.join(", ")}`);
  }
  const activePackages = packages.filter((item) => requestedPackageIds.has(item.id));
  const packageReviews = new Map(
    activePackages.map((item) => [
      item.id,
      ctx.latest("review", `${item.id}-review`) as Review | undefined,
    ]),
  );
  const allPackagesApproved = activePackages.every(
    (item) => packageReviews.get(item.id)?.approved === true,
  );
  const finalReview = ctx.latest("review", "final-integration-review") as Review | undefined;
  const finalReviewCount = (ctx.outputs.review ?? []).filter((row) => row.packageId === "final").length;
  const stopFinal = finalReview?.approved === true || finalReview?.continueLoop === false;

  return (
    <Workflow name="svvy-integrate-complete-product-v2" cache={false}>
      <Worktree
        id="complete-product-v2-integration-worktree"
        path={worktreePath}
        branch={input.branch}
        baseBranch={input.baseBranch}
      >
        <Sequence>
          {activePackages.map((item) => {
            const review = packageReviews.get(item.id);
            const reviewCount = (ctx.outputs.review ?? []).filter(
              (row) => row.packageId === item.id,
            ).length;
            const stop = review?.approved === true || review?.continueLoop === false;
            return (
              <Loop
                key={item.id}
                id={`${item.id}-integration-review-loop`}
                until={stop}
                maxIterations={input.maxReviewIterations}
                onMaxReached="fail"
              >
                <Sequence>
                  <Task
                    id={`${item.id}-integrate`}
                    output={outputs.integration}
                    agent={integrationAgents.get(item.id)!}
                    timeoutMs={input.taskTimeoutMs}
                  >
                    {integrationPrompt(item, review, reviewCount + 1)}
                  </Task>
                  <Task
                    id={`${item.id}-review`}
                    output={outputs.review}
                    agent={reviewAgents.get(item.id)!}
                    timeoutMs={input.reviewTimeoutMs}
                  >
                    {integrationReviewPrompt(item, reviewCount + 1)}
                  </Task>
                </Sequence>
              </Loop>
            );
          })}

          {allPackagesApproved ? (
            <Loop
              id="final-integration-review-loop"
              until={stopFinal}
              maxIterations={input.maxFinalIterations}
              onMaxReached="fail"
            >
              <Sequence>
                {finalReview !== undefined && finalReviewCount > 0 && finalReview.approved !== true && finalReview.continueLoop !== false ? (
                  <Task
                    id="final-integration-fix"
                    output={outputs.integration}
                    agent={finalFixer}
                    timeoutMs={input.taskTimeoutMs}
                  >
                    {finalFixPrompt(finalReview)}
                  </Task>
                ) : null}
                <Task
                  id="final-integration-review"
                  output={outputs.review}
                  agent={finalReviewer}
                  timeoutMs={input.taskTimeoutMs}
                >
                  {finalReviewPrompt(finalReviewCount + 1)}
                </Task>
              </Sequence>
            </Loop>
          ) : null}

          {allPackagesApproved && stopFinal ? (
            <Task id="complete-product-v2-integration-result" output={outputs.result}>
              {{
                approved: finalReview?.approved ?? false,
                branch: input.branch,
                worktreePath,
                packageApprovals: activePackages
                  .filter((item) => packageReviews.get(item.id)?.approved === true)
                  .map((item) => item.id),
                finalVerdict: finalReview?.verdict ?? null,
                summary: finalReview?.approved
                  ? "All reviewed package branches were semantically integrated and the composed product gates passed."
                  : "The semantic integration workflow stopped without final approval.",
                unresolvedIssues: [
                  ...(finalReview?.blockers ?? []),
                  ...(finalReview?.findings ?? []).map(
                    (finding) => `${finding.severity} ${finding.location}: ${finding.problem}`,
                  ),
                ],
              }}
            </Task>
          ) : null}
        </Sequence>
      </Worktree>
    </Workflow>
  );
});

function commonRules() {
  return [
    "Read AGENTS.md, docs/prd.md, and docs/features.ts before work.",
    "Use docs/references/pi-mono for pi, docs/references/effect-smol and docs/references/t3code for Effect v4, and https://smithers.sh/llms-full.txt plus docs/references/smithers for Smithers.",
    "Treat unexpected changes as user work. Do not reset, stash, discard, or overwrite them.",
    "Do not merge, cherry-pick, or copy a source branch wholesale. Inspect its final diff and relevant commits in bounded slices, then adopt only verified behavior into the current integration branch.",
    "Preserve stronger behavior already integrated. Reconcile overlapping contracts at the owning package boundary; do not keep dual schemas, compatibility paths, shims, aliases, test-only product behavior, fake production facades, renderer-owned authority, or an alternate shell/TUI.",
    "Use package APIs and composed Effect layers. Delete obsolete paths rather than bridging them.",
    "Bound context: start with name/status/stat summaries, then inspect targeted hunks, symbols, ranges, searches, and focused tests. Never dump an unbounded diff, log, generated artifact, or file over 500 lines.",
    "Run focused typecheck, behavior tests, and a real smoke path for the integrated slice. Commit every scoped source, test, and source-of-truth doc change with a Conventional Commit before returning; never stage unrelated workflow-authoring changes.",
  ].join(" ");
}

function integrationPrompt(item: IntegrationPackage, review: Review | undefined, round: number) {
  const findings = review?.findings.length
    ? review.findings.map((finding) => `- [${finding.severity}] ${finding.location}: ${finding.problem} Required: ${finding.requiredAction}`).join("\n")
    : "- none; this is the first semantic integration pass";
  return `${commonRules()}\n\nIntegration round ${round} for ${item.id} — ${item.title}.\nSource branch: ${item.sourceBranch}\nScope: ${item.scope}\n\nCurrent reviewer findings:\n${findings}\n\nWork in the current integration worktree. Compare the source branch's final intended state to the current integration branch through its merge base, relevant commit summaries, file stats, and targeted hunks. Integrate the complete scoped contract semantically in dependency order. Verify every adopted test still defends a real observable contract and update it for canonical APIs where needed. Resolve all listed findings at the source. Run the focused package/app checks that cover this slice plus a smoke path. Commit only the scoped integration. Return BLOCKED only for an external prerequisite; ordinary conflicts or failing code must be repaired.`;
}

function integrationReviewPrompt(item: IntegrationPackage, round: number) {
  return `${commonRules()}\n\nStrict semantic integration review round ${round} for ${item.id} — ${item.title}.\nSource branch: ${item.sourceBranch}\nScope: ${item.scope}\n\nDo not edit. Inspect the source branch's complete final contract and the current integration branch, including relevant production code, tests, package exports, generated declarations, docs/features.ts, and docs/progress.md. Verify no required scoped behavior remains branch-only; no earlier integrated behavior regressed; package ownership, Effect layers, state transitions, failures, cancellation, recovery, redaction, and packaged-app boundaries compose cleanly; and tests exercise real package/app seams rather than mocks that bypass behavior. Run focused checks. Approve only with zero findings and no unverified scoped behavior. Set continueLoop true for any actionable code finding; use BLOCKED only for an external prerequisite.`;
}

function finalFixPrompt(review: Review) {
  const findings = review.findings.length
    ? review.findings.map((finding) => `- [${finding.severity}] ${finding.location}: ${finding.problem} Required: ${finding.requiredAction}`).join("\n")
    : "- none";
  return `${commonRules()}\n\nFinal composed-product repair. The ten package branches are integrated. Repair every root cause from the strict final review without undoing package ownership or weakening tests.\n\nFindings:\n${findings}\nBlockers:\n${review.blockers.map((item) => `- ${item}`).join("\n") || "- none"}\n\nReproduce each failure, repair production contracts at their owners, reconcile generated declarations and source-of-truth docs, then run focused checks, bun run check, the strict e2e coverage inventory gate, and representative composed app smoke paths that do not require the full OrbStack lane. Commit the complete repair.`;
}

function finalReviewPrompt(round: number) {
  return `${commonRules()}\n\nFinal composed-product integration review round ${round}. Do not edit. Review the entire integration branch against main and all ten source branches in bounded slices. Read the source-of-truth PRD, exhaustive feature inventory, roadmap, package boundaries, app bootstrap, renderer facades, generated declarations, and test inventories. Verify every intended contract is integrated once at its owner, the package migration has no bypasses or fake composition, state/recovery/cancellation/secret boundaries are coherent end to end, and completed roadmap/feature claims match real behavior. Run bun run check, bun run check:e2e-coverage:complete, and focused smoke scenarios through the real composed app/runtime facades. Do not run the OrbStack e2e lane here; it runs after the integration branch lands. Approve only with zero findings, no unresolved diagnostics, and green gates. Set continueLoop true for actionable defects and BLOCKED only for an unavailable external prerequisite.`;
}
