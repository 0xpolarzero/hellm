---
name: smithers
description: Drive Smithers — a durable control plane for long-running coding agents. Use when the user wants multi-step, long-running, crash-safe, or human-in-the-loop agent work: "orchestrate agents", "run a workflow", "implement this and review it", "keep iterating until tests pass", "plan then build", or anything that needs retries, approvals, replay, or evals across multiple AI steps. YOU (the agent) run Smithers on the user's behalf — it is not a GUI the human clicks.
---

# Smithers

Smithers is a durable control plane for long-running coding agents. Workflows are
TypeScript (JSX), run for minutes or days, and survive crashes — every finished
step is persisted to SQLite, so a restart resumes from the last completed node
instead of starting over. Retries, human approvals, replay, evals, and sandbox
review all live in one place.

## You drive it, not the human

This is the thing to internalize: **you, the AI agent, operate Smithers.** The
human asks for an outcome ("implement rate limiting and don't stop until the
tests pass"); you reach for Smithers, run the workflow, watch it, and report
back. Smithers spawns *other* agents (Claude Code, Codex, etc.) as the workers
inside a workflow — you are the operator standing at the control panel, not a
person clicking buttons in a UI.

So when a task is bigger than one prompt — it has stages, needs to survive a
crash, needs a human to approve a step, or needs to loop until something is
true — don't hand-roll it turn by turn. Run a Smithers workflow.

### Smithers is your plan mode, with muscle

Think of Smithers as a **powerful version of plan mode**. Plan mode lets you lay
out steps before acting; Smithers lets you lay out steps *and then actually run
them* — durably, in order, with retries, approvals, and loops baked in. Instead
of writing a plan in prose and executing it yourself one message at a time, you
encode the plan as a workflow graph (`<Sequence>`, `<Parallel>`, `<Branch>`,
`<Ralph>`) and hand it to the runtime. The plan becomes executable, resumable,
and inspectable: each step is a real agent task whose output is persisted and
checked before the next step runs. Reach for it whenever you'd otherwise be
tempted to "make a plan and then carefully do each part" — Smithers *is* that,
made durable.

## 60 seconds to the aha

From inside the user's project (Bun ≥ 1.3, plus a model key like
`ANTHROPIC_API_KEY` in the env):

```bash
# 1. Scaffold .smithers/ with ready-made workflows (implement, review, plan, ralph, debug…)
bunx smithers-orchestrator init

# 2. Browse plain-English starters and their copy-paste commands
bunx smithers-orchestrator starters

# 3. Run one. This dispatches a real coding agent to do the work, durably.
bunx smithers-orchestrator workflow run implement --prompt "Add a /health endpoint"

# 4. Watch it
bunx smithers-orchestrator ps                 # active / paused / recent runs
bunx smithers-orchestrator logs <run-id> -f   # follow the event stream
```

That's the loop: scaffold → run a workflow → watch the run. The "aha" is step 3 —
you kicked off a multi-step agent job that you can crash, resume, fork, and
inspect, all from the CLI you already live in.

## The mental model

Smithers renders the workflow JSX tree every "frame." Each render answers one
question: *given what has already finished, what can run now?* Tasks produce
outputs validated by Zod schemas; the runtime persists them and renders again.
Crash mid-run and the next render picks up exactly where it left off — completed
nodes are never re-run.

```tsx
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";

const { Workflow, smithers, outputs } = createSmithers({
  analyze: z.object({ summary: z.string(), severity: z.enum(["low", "high"]) }),
  fix: z.object({ patch: z.string() }),
});

export default smithers((ctx) => (
  <Workflow name="bugfix">
    <Sequence>
      <Task id="analyze" output={outputs.analyze} agent={analyzer}>
        {`Analyze the bug: ${ctx.input.description}`}
      </Task>
      <Task id="fix" output={outputs.fix} agent={fixer}>
        {`Fix: ${ctx.output("analyze", { nodeId: "analyze" }).summary}`}
      </Task>
    </Sequence>
  </Workflow>
));
```

Core components: `<Workflow>` (root), `<Task>` (an AI or static step),
`<Sequence>` (ordered), `<Parallel>` (concurrent), `<Branch>` (conditional),
`<Loop>` / `<Ralph>` (loop until a condition is true — great for "keep fixing
until the reviewer approves"), plus durable human-in-the-loop suspension
(`<Approval>`, `<HumanTask>`, `<Signal>`, `<WaitForEvent>`) and `<Timer>`,
sandboxes, and sub-flows. A suspended run is a row, not a process — it costs
nothing while it waits.

```tsx
<Ralph until={ctx.latest("review")?.approved} maxIterations={5}>
  <Task id="implement" output={outputs.fix} agent={coder}>Fix based on feedback</Task>
  <Task id="review" output={outputs.review} agent={reviewer}>Review the implementation</Task>
</Ralph>
```

## Why a durable runtime, not a queue or a framework

The right agent topology changes every six months (chains → ReAct → tools →
plan-execute → crews/swarms → background agents). Underneath all of them sits a
layer that *doesn't* change: durable steps, persisted state, retries,
suspension, observability. Smithers is that stable layer. Build it yourself from
a queue + a database and you reinvent ~60% of a real durable-execution engine,
badly; couple to a topology framework and you rewrite when the meta moves.
Smithers hands you the primitive instead and lets you compose the shape — one
high-token agentic workflow (gstack) shrank ~80% just by composing components
rather than hand-writing the orchestration.

## Patterns ship as components — don't hand-roll them

Anything seen twice across the orchestration field was promoted to a composable
component. Reach for these before writing your own loop:

- `<ReviewLoop>` — producer + reviewer(s), loop until approved (array = consensus)
- `<Optimizer>` — generator + evaluator, loop until a target score
- `<ScanFixVerify>` — scanner → parallel fixers → verifier, retry survivors
- `<Panel>` — N reviewers in parallel, a moderator synthesizes (vote/consensus/merge)
- `<Debate>` — proposer vs opponent for N rounds, a judge decides
- `<Supervisor>` — boss plans, workers run in parallel, boss re-delegates failures
- `<Saga>` — forward steps with compensations that fire in reverse on failure
- `<Kanban>` / `<MergeQueue>` — items flow through columns / serialize risky ops
- `<EscalationChain>` — tier 1 → tier 2 → human on low confidence
- `<ClassifyAndRoute>` / `<GatherAndSynthesize>` — route to specialists / fan-out-fan-in

More ship in the box — `<CheckSuite>`, `<DecisionTable>`, `<Poller>`,
`<Runbook>`, `<DriftDetector>`, `<ContentPipeline>`, `<LoopUntilScored>`,
`<TryCatchFinally>`, `<ContinueAsNew>` — and the catalog grows; check the docs
for the current set. Each is ~20–40 lines of JSX over the substrate — read,
fork, or copy them. ~90 more ready-to-edit recipes live in `examples/` (listed
below).

## Beyond control flow — the production surface

The same substrate carries the concerns you'd otherwise bolt on later:

- **Isolation** — `<Worktree>` (per-agent git worktrees), `<Sandbox>` (freestyle / docker / process), `<Subflow>` & `<SuperSmithers>` (nest a workflow as a node).
- **Budgets** — `<Aspects>` propagates token / latency / cost budgets to a subtree (`fail` | `warn` | `skip-remaining`).
- **Scorers / evals** — attach `faithfulness`, `relevancy`, `schemaAdherence`, or `llmJudge(...)` to any `<Task>`; inspect with `smithers scores <run>`.
- **Memory** — cross-run facts + history per namespace; `memory={{ recall, save }}` auto-injects the top-K relevant facts; query with `smithers memory`.
- **Hot mode** — `--hot true` re-renders against persisted state when you edit the workflow or an `.mdx` prompt mid-run; finished tasks stay put.
- **Time travel** — every render is a frame: `smithers timeline | fork | replay | rewind | diff | timetravel | retry-task`.
- **Observability / serving** — `smithers observability up` (Grafana/Prometheus/Tempo/OTLP); `smithers up … --serve --metrics` exposes an HTTP API, SSE event stream, and `/metrics`. A workflow can even serve its own React front-end.
- **Agents** — pluggable runtimes (claude, codex, antigravity, kimi, amp, forge, Effect-native) configured in `agents.ts`; `agent={[primary, fallback]}` falls back on failure.
- **Tools** — built-in `read`/`write`/`edit`/`bash`/`grep`/`ls` with path containment (`--root`); `smithers openapi <spec>` generates typed AI SDK tools from an OpenAPI spec.
- **Integrations** — run Smithers itself as an MCP server (`smithers mcp add`), sync skills into agent dirs (`smithers skills add`), durable schedules (`smithers cron`), pager-style `smithers alerts`, a structured `<HumanTask>` queue (`smithers human`), and `smithers hijack` to hand off a live agent session.
- **Lower-level API** — `Smithers.workflow().step(...)` exposes the raw Effect-ts surface (Schedules, Layers, fibers); mix it with JSX in one workflow.

## The `.smithers/` folder

`smithers init` scaffolds a `.smithers/` directory in the project. It is a real
Bun/TypeScript package (it has its own `package.json`, `tsconfig.json`,
`bunfig.toml`, and `preload.ts`), and it's where everything you author lives.
The layout separates the four things you edit — **agents, workflows, prompts,
and components** — from runtime state, which is gitignored.

```
.smithers/
├── agents.ts            # WHERE AGENTS ARE CONFIGURED. Named agent pools
│                        #   (claude, smart, cheapFast, smartTool, …) mapped to
│                        #   provider instances (ClaudeCodeAgent, Codex, …).
│                        #   Workflows import { agents } from "../agents".
│                        #   Generated from ~/.smithers/accounts.json — manage
│                        #   accounts with `smithers agent add|list|remove`.
├── smithers.config.ts   # repoCommands { lint, test, coverage } the workflows call
├── workflows/           # WHERE WORKFLOWS GO. One .tsx per workflow (implement,
│                        #   review, plan, ralph, debug, research, …). These are
│                        #   the executable graphs you run with `smithers up` /
│                        #   `smithers workflow run`.
├── prompts/             # WHERE MDX PROMPTS GO. One .mdx per prompt, authored as
│                        #   JSX prompt components. A workflow imports one and
│                        #   renders it as a tag:
│                        #     import PlanPrompt from "../prompts/plan.mdx";
│                        #     <PlanPrompt prompt={ctx.input.prompt} />
├── components/          # WHERE COMPONENTS GO. Reusable workflow .tsx pieces and
│                        #   their Zod output schemas (ValidationLoop, Review,
│                        #   LoopUntilScored, ForEachFeature, …). Imported by
│                        #   workflows like any React-style component.
├── ui/                  # workflow UI sources for the `smithers ui` command
├── specs/  tickets/     # feature specs and tickets some workflows read/write
│
│   # ── runtime state (gitignored — don't author here) ──
├── executions/  runs/   # per-run event logs and persisted frames
├── sandboxes/           # sandboxed review checkouts
├── state/  tmp/  *.db   # SQLite + scratch
└── node_modules/
```

The mental shortcut: **agents** say *who* does the work (`agents.ts`),
**workflows** say *what* happens and in what order (`workflows/*.tsx`),
**prompts** say *what to tell the agent* (`prompts/*.mdx`), and **components**
are the reusable building blocks workflows compose from (`components/*.tsx`). A
typical workflow file imports from all three: `../agents`, `../prompts/foo.mdx`,
and `../components/Bar`.

## Operating runs

Everything is a CLI verb (prefix with `bunx smithers-orchestrator` if it isn't on PATH):

```bash
smithers up workflow.tsx --input '{"description":"Fix bug"}'   # start a run
smithers up workflow.tsx --run-id <id> --resume true          # resume after a crash
smithers ps                                                   # list runs
smithers inspect <run-id>                                     # full run state
smithers logs <run-id> -f                                     # follow events
smithers approve <run-id> --node review                       # clear an approval gate
smithers cancel <run-id>                                      # stop a run
smithers eval workflow.tsx --cases evals/smoke.jsonl --suite smoke
```

When a workflow pauses on a human approval or question, the run is durable — it
waits. Resolve it with `smithers approve` / `smithers deny` / `smithers signal`
and the run continues from there.

## When to use Smithers vs. just answering

- **Use it** when order matters across steps, you need crash recovery, a human
  must approve mid-run, different steps need different models/tools, or you need
  to loop until something is true. Also when the user wants the work to keep
  going while they're away.
- **Skip it** for a single prompt → single response, or a quick one-off edit you
  can just do yourself. Smithers adds no value there.

## Examples — copy one and edit it

The repo ships ~90 runnable example workflows plus a few deployment/integration
setups. They're the fastest way to see a pattern wired end-to-end — find the one
closest to the task, copy it into `.smithers/workflows/`, and edit. Browse them
on GitHub:

**https://github.com/smithersai/smithers/tree/main/examples**

*Starters & building blocks*
- `simple-workflow` — minimal schema-driven end-to-end workflow (start here)
- `pi-hello-world` — smallest possible workflow, one typed output
- `pi-tools-workflow` — minimal workflow exercising built-in tools
- `ralph-loop` — the Ralph loop: keep iterating until the work is done
- `fan-out-fan-in` — split work into N parallel agents, aggregate results
- `waterfall` — sequential phases, each receives the previous phase's output
- `etl` — Extract → Transform → Load, per-stage agents
- `milestone` — state-machine progression M0 → M1 → … → Complete
- `gate` — block execution until an external condition is met (polling)
- `plan` — agent produces a structured, prioritized action plan
- `discovery` — scan a codebase/API, categorize findings, store structured results
- `scaffold` — generate project/feature structure from a template or spec

*Multi-agent orchestration patterns*
- `code-review-loop` — producer + reviewer, loop until approved
- `review-cycle` — implement → review → fix, loop until approved
- `debate` — two agents argue opposing positions, a judge decides
- `panel` — N specialists review in parallel, a moderator synthesizes
- `supervisor` — boss agent plans and delegates to workers dynamically
- `kanban` — process items through columns (backlog → in-progress → review → done)
- `classifier-switchboard` — route items through a typed enum to specialists
- `triage` — intake → classify/prioritize → route to handlers
- `parallel-tickets` — triage → wave-by-wave parallel execution → merge queue
- `prompt-optimizer-harness` — run prompt variants against test cases, evaluate, pick best
- `gastown` — clone of Steve Yegge's multi-agent framework on Smithers primitives

*Code, repo & CI workflows*
- `refactor` — analyze → plan refactor → apply → validate
- `coverage-loop` — run tests → measure coverage → write tests → repeat to target
- `migration` — plan → transform files → validate → report
- `dependency-update` — check outdated deps → assess risk → update → verify
- `changelog` — analyze git history → categorize → generate changelog
- `doc-sync` — compare docs to code → find drift → fix → PR
- `docs-fixup-bot` — scan docs for broken examples/drift and propose fixes
- `docs-patcher` — detect public API/CLI changes, patch affected docs, verify
- `branch-doctor` — diagnose a broken branch (bad rebases, partial cherry-picks)
- `bisect-guide` — orchestrate git bisect with an agent reading each outcome
- `pr-lifecycle` — rebase → self-review → push → poll CI → merge
- `pr-shepherd` — watch a PR to ready-for-review, gather diffs/tests/context
- `repo-janitor` — scheduled cleanup of warnings, stale TODOs, broken examples
- `merge-conflict-mediator` — explain the semantic disagreement in a conflict
- `standards-reviewer` — review changes against repo-local standards files
- `patch-plausibility-gate` — verify a candidate patch before promotion
- `failing-test-author` — from an issue/traceback, write the smallest failing test
- `flake-hunter` — rerun a failing test under variants to characterize flakiness
- `test-sharder-judge` — use the diff to select and order the most relevant tests
- `repro-harness-builder` — build a minimal Docker/harness repro from an issue
- `change-blast-radius` — map a diff to impacted services, tests, docs, owners
- `smoketest` — setup environment → run smoke checks → report
- `audit` — scan → categorize → process → report

*Ops, SRE & monitoring*
- `alert-suppressor` — classify alerts against prior incidents, suppress noise
- `benchmark-sheriff` — run benchmarks vs a baseline, escalate only real regressions
- `canary-judge` — compare logs/metrics/traces between stable and canary
- `collector-probe` — wrap agent calls with timing/usage collection + alerting
- `command-watchdog` — run a command on a schedule, escalate only on failure
- `config-diff-explainer` — explain env/Helm/Terraform/k8s diffs
- `contract-drift-sentinel` — compare OpenAPI/JSON Schema/GraphQL/protobuf contracts
- `error-clusterer` — group recurring errors into clusters
- `log-digest` — compress build/test/deploy logs into root-cause hypotheses
- `mcp-health-probe` — periodically exercise MCP servers/tools, detect outages
- `rollback-advisor` — read failed-deploy evidence, produce a rollback/mitigation
- `runbook-executor` — run safe runbook steps, pause on risky ones for approval
- `slo-breach-explainer` — on SLO alarms, pull traces/logs and explain the breach
- `trace-explainer` — read agent/workflow traces, produce a concise explanation
- `visual-diff-explainer` — compare baseline/current screenshots, explain regressions
- `retry-budget-manager` — track retry budgets across steps, adapt backoff/routing
- `fail-only-report` — run commands, invoke an agent only when a run fails
- `schema-conformance-gate` — validate extracted/generated data against schema rules

*Typed extraction & data*
- `extract-anything-workbench` — reusable local workbench for typed extraction
- `typed-extractor-stage` — turn messy text/files into a typed structured object
- `dynamic-schema-enricher` — build/select output schemas dynamically at runtime
- `receipt-stream-watcher` — stream a structured extraction from receipt data
- `survey-answerer-agent` — read source material, produce constrained typed answers
- `openapi-contract-agent` — convert JSON Schema/OpenAPI into typed structures
- `blog-analyzer-pipeline` — ingest blog content, analyze topics, emit insights

*Business, inbox & support agents*
- `financial-inbox-guard` — monitor finance mailboxes for invoices/exceptions
- `invoice-approval-watch` — extract invoice data, validate, route for approval
- `lead-enricher` — enrich a raw inbound lead with firmographic/context data
- `lead-router-with-approval` — score leads, propose routing, gate on approval
- `meeting-briefer` — watch meetings, classify intent, gather CRM/context
- `feedback-pulse` — watch feedback streams, extract pain points and sentiment
- `revenue-scout` — scan conversations/forms for revenue signals
- `social-inbox-router` — classify social inbox items into leads/noise/etc.
- `service-desk-dispatcher` — distinguish incidents from requests/policy questions
- `support-deflector` — classify support issues, retrieve knowledge, deflect
- `memory-support-agent` — support conversations with durable cross-run memory
- `form-filler-assistant` — extract known fields from docs/input, fill forms
- `friday-bot` — scheduled digest gathering context across systems
- `tweet-thread` — post a pre-generated tweet thread to X/Twitter
- `trust-safety-moderator` — screen content, classify risk, route edge cases
- `compliance-evidence-collector` — gather compliance evidence from APIs/MCP tools
- `threat-intel-enricher` — enrich a security alert with external/internal context
- `ransomware-isolation-coordinator` — coordinate ransomware-response steps

*Agent runtimes & repros*
- `kimi-example` — minimal workflow run against the Kimi agent
- `chat-log-repro` — minimal chat-log-visibility repro (Claude Code + Codex)

*Deployment & sandbox integrations (subfolders)*
- `bun-port-smithers/` — production-oriented workflow pack (porting work for Bun)
- `freestyle/` — Freestyle VM sandbox provider example (real-computer agents)
- `dstack/` — Smithers + dstack on Google Cloud, serving Kimi K2
- `kubernetes/` — run Smithers workflows distributed on a Kubernetes cluster

## Full reference

This skill ships the complete docs next to it as **`llms-full.txt`** — read it
when you need the exact API: every component, the CLI catalog, the Gateway HTTP
API and browser console, memory, OpenAPI tools, evals, optimization, and the
full event union.

The docs are **progressively disclosed**, so you don't have to load the whole
bundle to answer a focused question. Start narrow and widen only as needed:

- **`smithers.sh/llms.txt`** — a tiny index that points to the topic fragments below.
- **Topic fragments** (each a few KB, pull only what's relevant):
  `llms-core.txt` (runtime, JSX surface, CLI, components, recipes, types, errors),
  `llms-memory.txt`, `llms-openapi.txt`, `llms-observability.txt` (HTTP server,
  gateway, MCP, OpenTelemetry), `llms-effect.txt` (Effect-ts authoring API),
  `llms-integrations.txt` (agent runtimes, tools), `llms-events.txt` (the full
  `SmithersEvent` union).
- **`llms-full.txt`** — everything concatenated, when you want it all in context.

```bash
bunx smithers-orchestrator docs           # prints llms.txt (the concise index)
bunx smithers-orchestrator docs-full      # prints llms-full.txt
bunx smithers-orchestrator ask "How do I add a human approval gate?"
```

- Docs: **https://smithers.sh**  ·  fragments at `smithers.sh/llms-*.txt`
- Repo: **https://github.com/smithersai/smithers**
- npm package: `smithers-orchestrator`

**When in doubt, clone the repo** (`github.com/smithersai/smithers`) and read the
source directly — the docs and `llms-*.txt` bundles can lag the code. The
ground truth lives in `packages/components/src/components/` (every component +
its `*Props.ts`), `apps/cli/src/` (the CLI), and `examples/` (~90 runnable
workflows). Grep there before guessing at an API.
