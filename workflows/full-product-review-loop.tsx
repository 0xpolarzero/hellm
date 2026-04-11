/** @jsxImportSource smithers-orchestrator */

import {
  CodexAgent,
  Loop,
  Sequence,
  Task,
  Workflow,
  Worktree,
  createSmithers,
} from "smithers-orchestrator";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import AddressReviewPrompt from "./prompts/full-product-review-loop/address-review.mdx";
import ImplementPrompt from "./prompts/full-product-review-loop/implement.mdx";
import ReviewPrompt from "./prompts/full-product-review-loop/review.mdx";

const DEFAULT_IMPLEMENT_TIMEOUT_MS = parsePositiveInt(
  process.env.HELLM_FULL_PRODUCT_IMPLEMENT_TIMEOUT_MS,
  90 * 60 * 1000,
);
const DEFAULT_REVIEW_TIMEOUT_MS = parsePositiveInt(
  process.env.HELLM_FULL_PRODUCT_REVIEW_TIMEOUT_MS,
  60 * 60 * 1000,
);
const DEFAULT_ADDRESS_TIMEOUT_MS = parsePositiveInt(
  process.env.HELLM_FULL_PRODUCT_ADDRESS_TIMEOUT_MS,
  90 * 60 * 1000,
);
const DEFAULT_MAX_ITERATIONS = parsePositiveInt(process.env.HELLM_FULL_PRODUCT_MAX_ITERATIONS, 8);
const DEFAULT_HEARTBEAT_TIMEOUT_MS = parsePositiveInt(
  process.env.HELLM_FULL_PRODUCT_HEARTBEAT_TIMEOUT_MS,
  20 * 60 * 1000,
);

const inputSchema = z.object({
  goal: z
    .string()
    .default(
      "Implement the full hellm product described by docs/, get the test suite into a correct passing state, and adapt incorrect or incomplete tests when the real contract demands it.",
    ),
  repoRoot: z.string().default("."),
  worktreePath: z.string().default(".worktrees/full-product-review-loop"),
  branch: z
    .string()
    .default(process.env.HELLM_FULL_PRODUCT_BRANCH ?? "workflow/full-product-review-loop"),
  baseBranch: z.string().default(process.env.HELLM_FULL_PRODUCT_BASE_BRANCH ?? "main"),
  implementTimeoutMs: z.number().int().positive().default(DEFAULT_IMPLEMENT_TIMEOUT_MS),
  reviewTimeoutMs: z.number().int().positive().default(DEFAULT_REVIEW_TIMEOUT_MS),
  addressTimeoutMs: z.number().int().positive().default(DEFAULT_ADDRESS_TIMEOUT_MS),
  maxIterations: z.number().int().positive().default(DEFAULT_MAX_ITERATIONS),
  onMaxReached: z.enum(["return-last", "fail"]).default("return-last"),
});

const reviewFindingSchema = z.object({
  severity: z.enum(["blocker", "high", "medium", "low", "nit"]),
  location: z.string(),
  problem: z.string(),
  requiredAction: z.string(),
});

const implementSchema = z.object({
  status: z.enum(["DONE", "PARTIAL", "BLOCKED"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  validationRan: z.array(z.string()),
  testsUpdated: z.array(z.string()),
  docsConsulted: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
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
  summary: z.string(),
  unresolvedIssues: z.array(z.string()),
});

const { smithers, outputs } = createSmithers({
  implement: implementSchema,
  review: reviewSchema,
  address: addressSchema,
  result: resultSchema,
});

type WorkflowInput = z.infer<typeof inputSchema>;
type ImplementResult = z.infer<typeof implementSchema>;
type ReviewResult = z.infer<typeof reviewSchema>;
type AddressResult = z.infer<typeof addressSchema>;

const IMPLEMENT_MODEL = process.env.HELLM_FULL_PRODUCT_IMPLEMENT_MODEL ?? "gpt-5.3-codex";
const IMPLEMENT_REASONING_EFFORT =
  process.env.HELLM_FULL_PRODUCT_IMPLEMENT_REASONING_EFFORT ?? "medium";
const ADDRESS_MODEL = process.env.HELLM_FULL_PRODUCT_ADDRESS_MODEL ?? IMPLEMENT_MODEL;
const ADDRESS_REASONING_EFFORT =
  process.env.HELLM_FULL_PRODUCT_ADDRESS_REASONING_EFFORT ?? IMPLEMENT_REASONING_EFFORT;
const REVIEW_MODEL = process.env.HELLM_FULL_PRODUCT_REVIEW_MODEL ?? "gpt-5.3-codex";
const REVIEW_REASONING_EFFORT = process.env.HELLM_FULL_PRODUCT_REVIEW_REASONING_EFFORT ?? "high";

const IMPLEMENT_SYSTEM_PROMPT = `You are implementing the hellm product from this repository's docs.

Read and follow AGENTS.md strictly.
Read docs/prd.md before acting.
Read docs/features.ts before changing product behavior, scope, or tests.
Use docs/references/pi-mono as the default local reference for pi behavior.
Use docs/references/smithers as the default local reference for Smithers behavior.

Goal:
- move the repository materially toward the full documented product
- keep tests honest
- get validation passing when the real contract allows it
- adapt incorrect or underspecified tests when they do not match the documented product

Execution style:
- make coherent progress, not performative churn
- you do not need to finish the whole product in one pass
- prefer the smallest high-leverage set of changes that leaves the repo in a better state
- run focused validation before you finish
- do not run git commands
- return structured JSON matching the implement schema`;

const ADDRESS_SYSTEM_PROMPT = `You are addressing review findings in the hellm repository.

Read and follow AGENTS.md strictly.
Read docs/prd.md and docs/features.ts before changing product behavior or tests.
Use docs/references/pi-mono and docs/references/smithers as the default local references.

Goal:
- resolve the validated review findings
- continue moving the repository toward the full documented product
- strengthen or correct tests when the existing tests are wrong or stop short of the real contract

Execution style:
- do not blindly obey bad feedback; correct the repo honestly
- if the best next move is broader than one line-item, take the broader coherent fix
- leave the repo in a cleaner state for the next review
- run focused validation before you finish
- do not run git commands
- return structured JSON matching the address schema`;

const REVIEW_SYSTEM_PROMPT = `You are reviewing the hellm repository in read-only mode.

Read and follow AGENTS.md strictly.
Read docs/prd.md and docs/features.ts before deciding whether the current state is good enough.
Use docs/references/pi-mono and docs/references/smithers as the default local references.

Focus on:
- correctness and regressions
- missing or incorrect product behavior relative to docs/prd.md and docs/features.ts
- missing, incorrect, or insufficient tests
- validation gaps
- whether the current repo state materially advances the documented product

Execution style:
- do not edit files, stage changes, or create commits
- use read-only inspection and validation commands only
- keep findings concrete and actionable
- approve only when the repo is in a coherent state for the documented goal
- set continueLoop=false only when the work is done or a human decision is required
- return structured JSON matching the review schema`;

const implementAgent = createFullProductCodexAgent({
  taskSlug: "implement",
  model: IMPLEMENT_MODEL,
  reasoningEffort: IMPLEMENT_REASONING_EFFORT,
  timeoutMs: DEFAULT_IMPLEMENT_TIMEOUT_MS,
  maxOutputBytes: 4_000_000,
  sandbox: resolveCodexSandbox(process.env.HELLM_FULL_PRODUCT_IMPLEMENT_SANDBOX, "workspace-write"),
  fullAuto: process.env.HELLM_FULL_PRODUCT_IMPLEMENT_FULL_AUTO !== "0",
  systemPrompt: IMPLEMENT_SYSTEM_PROMPT,
});

const addressAgent = createFullProductCodexAgent({
  taskSlug: "address-review",
  model: ADDRESS_MODEL,
  reasoningEffort: ADDRESS_REASONING_EFFORT,
  timeoutMs: DEFAULT_ADDRESS_TIMEOUT_MS,
  maxOutputBytes: 4_000_000,
  sandbox: resolveCodexSandbox(process.env.HELLM_FULL_PRODUCT_ADDRESS_SANDBOX, "workspace-write"),
  fullAuto: process.env.HELLM_FULL_PRODUCT_ADDRESS_FULL_AUTO !== "0",
  systemPrompt: ADDRESS_SYSTEM_PROMPT,
});

const reviewAgent = createFullProductCodexAgent({
  taskSlug: "review",
  model: REVIEW_MODEL,
  reasoningEffort: REVIEW_REASONING_EFFORT,
  timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
  maxOutputBytes: 2_000_000,
  sandbox: "read-only",
  fullAuto: false,
  systemPrompt: REVIEW_SYSTEM_PROMPT,
});

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const worktreePath = resolve(input.repoRoot, input.worktreePath);
  const reviewPasses = ctx.outputs.review ?? [];
  const latestReview = ctx.latest("review", "review");
  const latestImplement = ctx.latest("implement", "implement");
  const latestAddress = ctx.latest("address", "address-review");
  const reviewIterations = reviewPasses.length;
  const stopLoop = latestReview?.approved === true || latestReview?.continueLoop === false;

  return (
    <Workflow name="hellm-full-product-review-loop" cache={false}>
      <Worktree
        id="full-product-worktree"
        path={worktreePath}
        branch={input.branch}
        baseBranch={input.baseBranch}
      >
        <Sequence>
          <Loop
            id="full-product-review-cycle"
            until={stopLoop}
            maxIterations={input.maxIterations}
            onMaxReached={input.onMaxReached}
          >
            <Sequence>
              {reviewIterations === 0 ? (
                <Task
                  id="implement"
                  output={outputs.implement}
                  agent={implementAgent}
                  timeoutMs={input.implementTimeoutMs}
                >
                  <ImplementPrompt
                    goal={input.goal}
                    branch={input.branch}
                    baseBranch={input.baseBranch}
                    worktreePath={worktreePath}
                  />
                </Task>
              ) : (
                <Task
                  id="address-review"
                  output={outputs.address}
                  agent={addressAgent}
                  timeoutMs={input.addressTimeoutMs}
                >
                  <AddressReviewPrompt
                    goal={input.goal}
                    branch={input.branch}
                    baseBranch={input.baseBranch}
                    worktreePath={worktreePath}
                    reviewRound={reviewIterations}
                    reviewVerdict={latestReview?.verdict ?? "CHANGES_REQUIRED"}
                    reviewSummary={latestReview?.summary ?? "No prior review summary was captured."}
                    formattedFindings={formatFindings(latestReview)}
                    formattedBlockers={formatList(latestReview?.blockers)}
                    formattedResidualRisks={formatList(latestReview?.residualRisks)}
                    latestImplementSummary={
                      latestImplement?.summary ?? "No earlier implementation summary was captured."
                    }
                    latestAddressSummary={
                      latestAddress?.summary ?? "No earlier address-review summary was captured."
                    }
                  />
                </Task>
              )}

              <Task
                id="review"
                output={outputs.review}
                agent={reviewAgent}
                timeoutMs={input.reviewTimeoutMs}
              >
                <ReviewPrompt
                  goal={input.goal}
                  branch={input.branch}
                  baseBranch={input.baseBranch}
                  worktreePath={worktreePath}
                  reviewRound={reviewIterations + 1}
                  priorReviewSummary={
                    latestReview?.summary ?? "No prior review; this is the first review pass."
                  }
                  priorReviewVerdict={latestReview?.verdict ?? "NONE"}
                />
              </Task>
            </Sequence>
          </Loop>

          <Task id="full-product-review-loop-result" output={outputs.result}>
            {buildResult({
              input,
              worktreePath,
              latestImplement,
              latestAddress,
              latestReview,
              reviewIterations: (ctx.outputs.review ?? []).length,
            })}
          </Task>
        </Sequence>
      </Worktree>
    </Workflow>
  );
});

function buildResult(input: {
  input: WorkflowInput;
  worktreePath: string;
  latestImplement?: ImplementResult;
  latestAddress?: AddressResult;
  latestReview?: ReviewResult;
  reviewIterations: number;
}) {
  const unresolvedIssues = new Set<string>();

  for (const issue of input.latestImplement?.unresolvedIssues ?? []) {
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
  const continueLoop = input.latestReview?.continueLoop ?? true;
  const latestVerdict = input.latestReview?.verdict ?? null;

  let summary = `Stopped after ${input.reviewIterations} review round(s).`;
  if (approved) {
    summary = `Approved after ${input.reviewIterations} review round(s).`;
  } else if (continueLoop === false) {
    summary = `Stopped after ${input.reviewIterations} review round(s) because the latest review requested a human decision or manual follow-up.`;
  } else if (latestVerdict) {
    summary = `Stopped after ${input.reviewIterations} review round(s) with latest verdict ${latestVerdict}.`;
  }

  return {
    approved,
    continueLoop,
    reviewIterations: input.reviewIterations,
    latestReviewVerdict: latestVerdict,
    branch: input.input.branch,
    worktreePath: input.worktreePath,
    summary,
    unresolvedIssues: [...unresolvedIssues],
  };
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

function createIsolatedCodexEnv(taskSlug: string): Record<string, string> {
  const configuredHome = process.env.HELLM_FULL_PRODUCT_CODEX_HOME?.trim();
  const codexHomeRoot =
    configuredHome && configuredHome.length > 0 ? resolve(configuredHome) : tmpdir();
  mkdirSync(codexHomeRoot, { recursive: true });

  const codexHome = mkdtempSync(resolve(codexHomeRoot, `hellm-codex-home-${taskSlug}-`));
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

function createFullProductCodexAgent(input: {
  taskSlug: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  maxOutputBytes: number;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  fullAuto: boolean;
  systemPrompt: string;
}) {
  return new CodexAgent({
    model: input.model,
    env: createIsolatedCodexEnv(`full-product-review-loop-${input.taskSlug}`),
    extraArgs: ["--ephemeral"],
    maxOutputBytes: input.maxOutputBytes,
    skipGitRepoCheck: true,
    sandbox: input.sandbox,
    fullAuto: input.fullAuto,
    timeoutMs: input.timeoutMs,
    idleTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
    config: {
      model_reasoning_effort: input.reasoningEffort,
      "features.multi_agent": false,
      "agents.max_threads": 1,
    },
    systemPrompt: input.systemPrompt,
  });
}

function resolveCodexSandbox(
  value: string | undefined,
  fallback: "read-only" | "workspace-write" | "danger-full-access",
) {
  switch (value) {
    case "read-only":
    case "workspace-write":
    case "danger-full-access":
      return value;
    default:
      return fallback;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
