/** @jsxImportSource smithers-orchestrator */

/**
 * Lifecycle:
 * 1. Inventory the feature surface and update `docs/features.ts` exhaustively.
 * 2. Plan coverage by mapping feature ids to unit, integration, and journey-level e2e obligations.
 * 3. Write tests first from that coverage plan, including any required e2e scenarios.
 * 4. Implement the feature to satisfy the documented contract and authored tests.
 * 5. Reconcile the implemented surface against the spec, POC, and feature inventory.
 * 6. Review the result, then address findings and re-review until the reviewer approves or reports a real block.
 */

import { Loop, Sequence, Task, Workflow, Worktree, createSmithers } from "smithers-orchestrator";
import { resolve } from "node:path";
import { z } from "zod";
import { createCodexAgent, parsePositiveInt } from "../components/codex";
import AddressReviewPrompt from "../prompts/implement-feature/address-review.mdx";
import CoveragePlanPrompt from "../prompts/implement-feature/coverage-plan.mdx";
import ImplementPrompt from "../prompts/implement-feature/implement.mdx";
import ListFeaturesPrompt from "../prompts/implement-feature/list-features.mdx";
import ReviewPrompt from "../prompts/implement-feature/review.mdx";
import SurfaceCheckPrompt from "../prompts/implement-feature/surface-check.mdx";
import WriteTestsPrompt from "../prompts/implement-feature/write-tests.mdx";

const DEFAULT_FEATURE_INVENTORY_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_INVENTORY_TIMEOUT_MS,
  45 * 60 * 1000,
);
const DEFAULT_TEST_AUTHOR_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_TEST_AUTHOR_TIMEOUT_MS,
  90 * 60 * 1000,
);
const DEFAULT_COVERAGE_PLAN_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_COVERAGE_PLAN_TIMEOUT_MS,
  45 * 60 * 1000,
);
const DEFAULT_IMPLEMENT_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_IMPLEMENT_TIMEOUT_MS,
  90 * 60 * 1000,
);
const DEFAULT_SURFACE_CHECK_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_SURFACE_CHECK_TIMEOUT_MS,
  60 * 60 * 1000,
);
const DEFAULT_REVIEW_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_REVIEW_TIMEOUT_MS,
  60 * 60 * 1000,
);
const DEFAULT_ADDRESS_TIMEOUT_MS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_ADDRESS_TIMEOUT_MS,
  90 * 60 * 1000,
);
const DEFAULT_MAX_ITERATIONS = parsePositiveInt(
  process.env.SVVY_IMPLEMENT_FEATURE_MAX_ITERATIONS,
  6,
);

const inputSchema = z.object({
  specPath: z.string().min(1),
  pocPath: z.string().min(1),
  slug: z.string().min(1).optional(),
  repoRoot: z.string().default("."),
  worktreeRoot: z.string().default(".worktrees/implement-feature"),
  branchPrefix: z.string().default("workflow/implement-feature"),
  baseBranch: z.string().default(process.env.SVVY_IMPLEMENT_FEATURE_BASE_BRANCH ?? "main"),
  featureInventoryTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_FEATURE_INVENTORY_TIMEOUT_MS),
  coveragePlanTimeoutMs: z.number().int().positive().default(DEFAULT_COVERAGE_PLAN_TIMEOUT_MS),
  testAuthorTimeoutMs: z.number().int().positive().default(DEFAULT_TEST_AUTHOR_TIMEOUT_MS),
  implementTimeoutMs: z.number().int().positive().default(DEFAULT_IMPLEMENT_TIMEOUT_MS),
  surfaceCheckTimeoutMs: z.number().int().positive().default(DEFAULT_SURFACE_CHECK_TIMEOUT_MS),
  reviewTimeoutMs: z.number().int().positive().default(DEFAULT_REVIEW_TIMEOUT_MS),
  addressTimeoutMs: z.number().int().positive().default(DEFAULT_ADDRESS_TIMEOUT_MS),
  maxIterations: z.number().int().positive().default(DEFAULT_MAX_ITERATIONS),
  onMaxReached: z.enum(["return-last", "fail"]).default("return-last"),
});

const featureInventorySchema = z.object({
  status: z.enum(["READY_FOR_COVERAGE_PLAN", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  featureIds: z.array(z.string()),
  filesChanged: z.array(z.string()),
  docsConsulted: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const coverageObligationSchema = z.object({
  scenarioId: z.string(),
  scenarioName: z.string(),
  featureIds: z.array(z.string()),
  coverageLevels: z.array(z.enum(["unit", "integration", "e2e"])),
  summary: z.string(),
  existingTestFiles: z.array(z.string()),
  plannedTestFiles: z.array(z.string()),
});

const testCoveragePlanSchema = z.object({
  status: z.enum(["READY_FOR_TESTS", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  obligations: z.array(coverageObligationSchema),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const testPlanSchema = z.object({
  status: z.enum(["READY_FOR_IMPLEMENTATION", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  testFiles: z.array(z.string()),
  e2eTestFiles: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const implementationSchema = z.object({
  status: z.enum(["READY_FOR_SURFACE_CHECK", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  validationRan: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});

const surfaceCheckSchema = z.object({
  status: z.enum(["READY_FOR_REVIEW", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  featureIdsConfirmed: z.array(z.string()),
  featureIdsAdded: z.array(z.string()),
  testFilesAdded: z.array(z.string()),
  filesChanged: z.array(z.string()),
  validationRan: z.array(z.string()),
  remainingIssues: z.array(z.string()),
});

const reviewFindingSchema = z.object({
  severity: z.enum(["blocker", "high", "medium", "low", "nit"]),
  location: z.string(),
  problem: z.string(),
  requiredAction: z.string(),
});

const reviewSchema = z.object({
  approved: z.boolean(),
  continueLoop: z.boolean(),
  verdict: z.enum(["LGTM", "CHANGES_REQUIRED", "BLOCKED"]),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
  blockers: z.array(z.string()),
  residualRisks: z.array(z.string()),
  validationRan: z.array(z.string()),
});

const addressSchema = z.object({
  status: z.enum(["READY_FOR_REVIEW", "PARTIAL", "BLOCKED", "NEEDS_HUMAN_DECISION"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  validationRan: z.array(z.string()),
  findingsAddressed: z.array(z.string()),
  remainingIssues: z.array(z.string()),
  humanDecisionsNeeded: z.array(z.string()),
});

const resultSchema = z.object({
  approved: z.boolean(),
  continueLoop: z.boolean(),
  reviewIterations: z.number().int().nonnegative(),
  latestReviewVerdict: z.string().nullable(),
  branch: z.string(),
  worktreePath: z.string(),
  specPath: z.string(),
  pocPath: z.string(),
  featureIds: z.array(z.string()),
  summary: z.string(),
  unresolvedIssues: z.array(z.string()),
});

const { smithers, outputs } = createSmithers({
  featureInventory: featureInventorySchema,
  testCoveragePlan: testCoveragePlanSchema,
  testPlan: testPlanSchema,
  implementation: implementationSchema,
  surfaceCheck: surfaceCheckSchema,
  review: reviewSchema,
  address: addressSchema,
  result: resultSchema,
});

type WorkflowInput = z.infer<typeof inputSchema>;
type FeatureInventoryResult = z.infer<typeof featureInventorySchema>;
type TestCoveragePlanResult = z.infer<typeof testCoveragePlanSchema>;
type TestPlanResult = z.infer<typeof testPlanSchema>;
type ImplementationResult = z.infer<typeof implementationSchema>;
type SurfaceCheckResult = z.infer<typeof surfaceCheckSchema>;
type ReviewResult = z.infer<typeof reviewSchema>;
type AddressResult = z.infer<typeof addressSchema>;

const FEATURE_INVENTORY_AGENT = createCodexAgent({
  taskSlug: "implement-feature-inventory",
  model: process.env.SVVY_IMPLEMENT_FEATURE_INVENTORY_MODEL ?? "gpt-5.4",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_INVENTORY_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_FEATURE_INVENTORY_TIMEOUT_MS,
  maxOutputBytes: 2_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

const TEST_COVERAGE_PLAN_AGENT = createCodexAgent({
  taskSlug: "implement-feature-coverage-plan",
  model: process.env.SVVY_IMPLEMENT_FEATURE_COVERAGE_PLAN_MODEL ?? "gpt-5.4",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_COVERAGE_PLAN_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_COVERAGE_PLAN_TIMEOUT_MS,
  maxOutputBytes: 2_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

const TEST_AUTHOR_AGENT = createCodexAgent({
  taskSlug: "implement-feature-tests",
  model: process.env.SVVY_IMPLEMENT_FEATURE_TEST_AUTHOR_MODEL ?? "gpt-5.3-codex",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_TEST_AUTHOR_REASONING_EFFORT ?? "high",
  timeoutMs: DEFAULT_TEST_AUTHOR_TIMEOUT_MS,
  maxOutputBytes: 4_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

const IMPLEMENT_AGENT = createCodexAgent({
  taskSlug: "implement-feature-implement",
  model: process.env.SVVY_IMPLEMENT_FEATURE_IMPLEMENT_MODEL ?? "gpt-5.3-codex",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_IMPLEMENT_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_IMPLEMENT_TIMEOUT_MS,
  maxOutputBytes: 4_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

const SURFACE_CHECK_AGENT = createCodexAgent({
  taskSlug: "implement-feature-surface-check",
  model: process.env.SVVY_IMPLEMENT_FEATURE_SURFACE_CHECK_MODEL ?? "gpt-5.3-codex",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_SURFACE_CHECK_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_SURFACE_CHECK_TIMEOUT_MS,
  maxOutputBytes: 3_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

const REVIEW_AGENT = createCodexAgent({
  taskSlug: "implement-feature-review",
  model: process.env.SVVY_IMPLEMENT_FEATURE_REVIEW_MODEL ?? "gpt-5.4",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_REVIEW_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
  maxOutputBytes: 2_000_000,
  sandbox: "read-only",
  fullAuto: true,
});

const ADDRESS_AGENT = createCodexAgent({
  taskSlug: "implement-feature-address",
  model: process.env.SVVY_IMPLEMENT_FEATURE_ADDRESS_MODEL ?? "gpt-5.3-codex",
  reasoningEffort: process.env.SVVY_IMPLEMENT_FEATURE_ADDRESS_REASONING_EFFORT ?? "xhigh",
  timeoutMs: DEFAULT_ADDRESS_TIMEOUT_MS,
  maxOutputBytes: 4_000_000,
  sandbox: "workspace-write",
  fullAuto: true,
});

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const normalized = normalizeInput(input);
  const latestFeatureInventory = ctx.latest("featureInventory", "feature-inventory");
  const latestCoveragePlan = ctx.latest("testCoveragePlan", "test-coverage-plan");
  const latestTestPlan = ctx.latest("testPlan", "write-tests");
  const latestImplementation = ctx.latest("implementation", "implement-feature");
  const latestSurfaceCheck = ctx.latest("surfaceCheck", "surface-check");
  const latestReview = ctx.latest("review", "review");
  const latestAddress = ctx.latest("address", "address-review");
  const reviewIterations = (ctx.outputs.review ?? []).length;
  const featureIds = collectFeatureIds(latestFeatureInventory, latestSurfaceCheck);
  const blockedBeforeReview =
    latestFeatureInventory?.status === "BLOCKED" ||
    latestCoveragePlan?.status === "BLOCKED" ||
    latestTestPlan?.status === "BLOCKED" ||
    latestImplementation?.status === "BLOCKED" ||
    latestSurfaceCheck?.status === "BLOCKED";
  const canPlanCoverage = !!latestFeatureInventory && latestFeatureInventory.status !== "BLOCKED";
  const canWriteTests =
    canPlanCoverage && !!latestCoveragePlan && latestCoveragePlan.status !== "BLOCKED";
  const canImplement = canWriteTests && !!latestTestPlan && latestTestPlan.status !== "BLOCKED";
  const canSurfaceCheck =
    canImplement && !!latestImplementation && latestImplementation.status !== "BLOCKED";
  const canReview =
    canSurfaceCheck && !!latestSurfaceCheck && latestSurfaceCheck.status !== "BLOCKED";
  const stopLoop =
    blockedBeforeReview || latestReview?.approved === true || latestReview?.continueLoop === false;

  return (
    <Workflow name="svvy-implement-feature" cache={false}>
      <Worktree
        id="implement-feature-worktree"
        path={normalized.worktreePath}
        branch={normalized.branch}
        baseBranch={input.baseBranch}
      >
        <Sequence>
          <Task
            id="feature-inventory"
            output={outputs.featureInventory}
            agent={FEATURE_INVENTORY_AGENT}
            timeoutMs={input.featureInventoryTimeoutMs}
          >
            <ListFeaturesPrompt
              specPath={input.specPath}
              pocPath={input.pocPath}
              branch={normalized.branch}
              baseBranch={input.baseBranch}
              worktreePath={normalized.worktreePath}
            />
          </Task>

          {canPlanCoverage ? (
            <Task
              id="test-coverage-plan"
              output={outputs.testCoveragePlan}
              agent={TEST_COVERAGE_PLAN_AGENT}
              timeoutMs={input.coveragePlanTimeoutMs}
            >
              <CoveragePlanPrompt
                specPath={input.specPath}
                pocPath={input.pocPath}
                branch={normalized.branch}
                baseBranch={input.baseBranch}
                worktreePath={normalized.worktreePath}
                featureIdsFormatted={formatList(featureIds)}
                featureInventorySummary={
                  latestFeatureInventory?.summary ?? "No feature inventory summary was captured."
                }
              />
            </Task>
          ) : null}

          {canWriteTests ? (
            <Task
              id="write-tests"
              output={outputs.testPlan}
              agent={TEST_AUTHOR_AGENT}
              timeoutMs={input.testAuthorTimeoutMs}
            >
              <WriteTestsPrompt
                specPath={input.specPath}
                pocPath={input.pocPath}
                branch={normalized.branch}
                baseBranch={input.baseBranch}
                worktreePath={normalized.worktreePath}
                featureIdsFormatted={formatList(featureIds)}
                featureInventorySummary={
                  latestFeatureInventory?.summary ?? "No feature inventory summary was captured."
                }
                coveragePlanSummary={
                  latestCoveragePlan?.summary ?? "No coverage-plan summary was captured."
                }
                coveragePlanFormatted={formatCoveragePlan(latestCoveragePlan)}
              />
            </Task>
          ) : null}

          {canImplement ? (
            <Task
              id="implement-feature"
              output={outputs.implementation}
              agent={IMPLEMENT_AGENT}
              timeoutMs={input.implementTimeoutMs}
            >
              <ImplementPrompt
                specPath={input.specPath}
                pocPath={input.pocPath}
                branch={normalized.branch}
                baseBranch={input.baseBranch}
                worktreePath={normalized.worktreePath}
                featureIdsFormatted={formatList(featureIds)}
                featureInventorySummary={
                  latestFeatureInventory?.summary ?? "No feature inventory summary was captured."
                }
                coveragePlanSummary={
                  latestCoveragePlan?.summary ?? "No coverage-plan summary was captured."
                }
                coveragePlanFormatted={formatCoveragePlan(latestCoveragePlan)}
                testPlanSummary={latestTestPlan?.summary ?? "No test summary was captured."}
              />
            </Task>
          ) : null}

          {canSurfaceCheck ? (
            <Task
              id="surface-check"
              output={outputs.surfaceCheck}
              agent={SURFACE_CHECK_AGENT}
              timeoutMs={input.surfaceCheckTimeoutMs}
            >
              <SurfaceCheckPrompt
                specPath={input.specPath}
                pocPath={input.pocPath}
                branch={normalized.branch}
                baseBranch={input.baseBranch}
                worktreePath={normalized.worktreePath}
                featureIdsFormatted={formatList(featureIds)}
                featureInventorySummary={
                  latestFeatureInventory?.summary ?? "No feature inventory summary was captured."
                }
                coveragePlanSummary={
                  latestCoveragePlan?.summary ?? "No coverage-plan summary was captured."
                }
                coveragePlanFormatted={formatCoveragePlan(latestCoveragePlan)}
                testPlanSummary={latestTestPlan?.summary ?? "No test summary was captured."}
                implementationSummary={
                  latestImplementation?.summary ?? "No implementation summary was captured."
                }
              />
            </Task>
          ) : null}

          {canReview ? (
            <Loop
              id="implement-feature-review-cycle"
              until={stopLoop}
              maxIterations={input.maxIterations}
              onMaxReached={input.onMaxReached}
            >
              <Sequence>
                {reviewIterations > 0 ? (
                  <Task
                    id="address-review"
                    output={outputs.address}
                    agent={ADDRESS_AGENT}
                    timeoutMs={input.addressTimeoutMs}
                  >
                    <AddressReviewPrompt
                      specPath={input.specPath}
                      pocPath={input.pocPath}
                      branch={normalized.branch}
                      baseBranch={input.baseBranch}
                      worktreePath={normalized.worktreePath}
                      reviewRound={reviewIterations}
                      featureIdsFormatted={formatList(featureIds)}
                      reviewVerdict={latestReview?.verdict ?? "CHANGES_REQUIRED"}
                      reviewSummary={latestReview?.summary ?? "No review summary was captured."}
                      formattedFindings={formatFindings(latestReview)}
                      formattedBlockers={formatList(latestReview?.blockers)}
                      formattedResidualRisks={formatList(latestReview?.residualRisks)}
                      coveragePlanSummary={
                        latestCoveragePlan?.summary ?? "No coverage-plan summary was captured."
                      }
                      coveragePlanFormatted={formatCoveragePlan(latestCoveragePlan)}
                      implementationSummary={
                        latestImplementation?.summary ?? "No implementation summary was captured."
                      }
                      surfaceCheckSummary={
                        latestSurfaceCheck?.summary ?? "No surface-check summary was captured."
                      }
                      latestAddressSummary={
                        latestAddress?.summary ?? "No previous address-review summary was captured."
                      }
                    />
                  </Task>
                ) : null}

                <Task
                  id="review"
                  output={outputs.review}
                  agent={REVIEW_AGENT}
                  timeoutMs={input.reviewTimeoutMs}
                >
                  <ReviewPrompt
                    specPath={input.specPath}
                    pocPath={input.pocPath}
                    branch={normalized.branch}
                    baseBranch={input.baseBranch}
                    worktreePath={normalized.worktreePath}
                    reviewRound={reviewIterations + 1}
                    featureIdsFormatted={formatList(featureIds)}
                    featureInventorySummary={
                      latestFeatureInventory?.summary ??
                      "No feature inventory summary was captured."
                    }
                    coveragePlanSummary={
                      latestCoveragePlan?.summary ?? "No coverage-plan summary was captured."
                    }
                    coveragePlanFormatted={formatCoveragePlan(latestCoveragePlan)}
                    testPlanSummary={latestTestPlan?.summary ?? "No test summary was captured."}
                    implementationSummary={
                      latestImplementation?.summary ?? "No implementation summary was captured."
                    }
                    surfaceCheckSummary={
                      latestSurfaceCheck?.summary ?? "No surface-check summary was captured."
                    }
                    priorReviewVerdict={latestReview?.verdict ?? "NONE"}
                    priorReviewSummary={
                      latestReview?.summary ?? "No prior review; this is the first review pass."
                    }
                  />
                </Task>
              </Sequence>
            </Loop>
          ) : null}

          <Task id="implement-feature-result" output={outputs.result}>
            {buildResult({
              input,
              normalized,
              latestFeatureInventory,
              latestCoveragePlan,
              latestTestPlan,
              latestImplementation,
              latestSurfaceCheck,
              latestReview,
              latestAddress,
              reviewIterations: (ctx.outputs.review ?? []).length,
            })}
          </Task>
        </Sequence>
      </Worktree>
    </Workflow>
  );
});

function normalizeInput(input: WorkflowInput) {
  const repoRoot = resolve(input.repoRoot);
  const slug = slugify(input.slug ?? input.specPath);
  return {
    slug,
    branch: `${input.branchPrefix}/${slug}`,
    worktreePath: resolve(repoRoot, input.worktreeRoot, slug),
  };
}

function buildResult(input: {
  input: WorkflowInput;
  normalized: ReturnType<typeof normalizeInput>;
  latestFeatureInventory?: FeatureInventoryResult;
  latestCoveragePlan?: TestCoveragePlanResult;
  latestTestPlan?: TestPlanResult;
  latestImplementation?: ImplementationResult;
  latestSurfaceCheck?: SurfaceCheckResult;
  latestReview?: ReviewResult;
  latestAddress?: AddressResult;
  reviewIterations: number;
}) {
  const featureIds = collectFeatureIds(input.latestFeatureInventory, input.latestSurfaceCheck);
  const unresolvedIssues = new Set<string>();

  for (const issue of input.latestFeatureInventory?.unresolvedIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestCoveragePlan?.unresolvedIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestTestPlan?.unresolvedIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestImplementation?.unresolvedIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestSurfaceCheck?.remainingIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestAddress?.remainingIssues ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestAddress?.humanDecisionsNeeded ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestReview?.blockers ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const issue of input.latestReview?.residualRisks ?? []) {
    unresolvedIssues.add(issue);
  }

  for (const finding of input.latestReview?.findings ?? []) {
    unresolvedIssues.add(`${finding.severity} ${finding.location}: ${finding.problem}`);
  }

  const approved = input.latestReview?.approved ?? false;
  const continueLoop = input.latestReview?.continueLoop ?? false;
  const latestVerdict = input.latestReview?.verdict ?? null;
  const blockedStage = resolveBlockedStage(input);

  let summary = `Stopped after ${input.reviewIterations} review round(s).`;
  if (approved) {
    summary = `Approved after ${input.reviewIterations} review round(s).`;
  } else if (blockedStage) {
    summary = `Stopped before review completion because ${blockedStage} reported BLOCKED.`;
  } else if (continueLoop === false && latestVerdict === "BLOCKED") {
    summary = `Stopped after ${input.reviewIterations} review round(s) because the latest review requested a human decision or external unblocker.`;
  } else if (latestVerdict) {
    summary = `Stopped after ${input.reviewIterations} review round(s) with latest verdict ${latestVerdict}.`;
  }

  return {
    approved,
    continueLoop,
    reviewIterations: input.reviewIterations,
    latestReviewVerdict: latestVerdict,
    branch: input.normalized.branch,
    worktreePath: input.normalized.worktreePath,
    specPath: input.input.specPath,
    pocPath: input.input.pocPath,
    featureIds,
    summary,
    unresolvedIssues: [...unresolvedIssues],
  };
}

function resolveBlockedStage(input: {
  latestFeatureInventory?: FeatureInventoryResult;
  latestCoveragePlan?: TestCoveragePlanResult;
  latestTestPlan?: TestPlanResult;
  latestImplementation?: ImplementationResult;
  latestSurfaceCheck?: SurfaceCheckResult;
}) {
  if (input.latestFeatureInventory?.status === "BLOCKED") {
    return "feature-inventory";
  }
  if (input.latestCoveragePlan?.status === "BLOCKED") {
    return "test-coverage-plan";
  }
  if (input.latestTestPlan?.status === "BLOCKED") {
    return "write-tests";
  }
  if (input.latestImplementation?.status === "BLOCKED") {
    return "implement-feature";
  }
  if (input.latestSurfaceCheck?.status === "BLOCKED") {
    return "surface-check";
  }
  return null;
}

function collectFeatureIds(
  featureInventory?: FeatureInventoryResult,
  surfaceCheck?: SurfaceCheckResult,
) {
  return [
    ...new Set([
      ...(featureInventory?.featureIds ?? []),
      ...(surfaceCheck?.featureIdsConfirmed ?? []),
      ...(surfaceCheck?.featureIdsAdded ?? []),
    ]),
  ];
}

function formatFindings(review?: ReviewResult) {
  if (!review || review.findings.length === 0) {
    return "- none";
  }

  return review.findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.location}: ${finding.problem} Required action: ${finding.requiredAction}`,
    )
    .join("\n");
}

function formatList(items?: string[]) {
  if (!items || items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatCoveragePlan(plan?: TestCoveragePlanResult) {
  if (!plan || plan.obligations.length === 0) {
    return "- none";
  }

  return plan.obligations
    .map((obligation) => {
      const levels = obligation.coverageLevels.join(", ");
      const features = obligation.featureIds.join(", ");
      const existing =
        obligation.existingTestFiles.length > 0 ? obligation.existingTestFiles.join(", ") : "none";
      const planned =
        obligation.plannedTestFiles.length > 0 ? obligation.plannedTestFiles.join(", ") : "none";

      return [
        `- ${obligation.scenarioId}: ${obligation.scenarioName}`,
        `  features: ${features}`,
        `  coverage: ${levels}`,
        `  summary: ${obligation.summary}`,
        `  existing tests: ${existing}`,
        `  planned tests: ${planned}`,
      ].join("\n");
    })
    .join("\n");
}

function slugify(value: string) {
  return value
    .replace(/^.*\//, "")
    .replace(/(\.spec\.md|\.poc\.ts)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
