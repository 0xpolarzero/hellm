# Smithers

**Orchestrate agents at scale with composable workflows.**

Tell your coding agent to do real, multi-step work — then Smithers runs it for minutes or
days with crash recovery, retries, human approvals, and full observability.

## What you get

- 🛡️ **Durable runs that survive crashes**: every completed step is persisted the moment it
  finishes, so a run resumes from where it stopped instead of starting over.
- 🔌 **Any agent, any model**: Claude Code, Codex, Pi, Antigravity, and more, plus any model
  through the AI SDK — swap the harness without rewriting the workflow.
- 🛠️ **Higher-quality output**: review loops, human approvals, and evals give agents the
  structure that real work demands.
- 🧩 **Dozens of ready-to-run workflows**: planning, implementation, review, debugging,
  tickets, audits, and long-horizon missions — and your agent can author new ones.

## Prompt your agent

Smithers is driven by your coding agent, **not** a GUI you click. Your agent runs Smithers
on your behalf: it scaffolds workflows, kicks off runs, watches them, and handles
approvals.

The fastest way to make your agent fluent is two fan-out commands. They install the
Smithers skill and register the MCP server into **every coding agent on your machine**
(Claude Code, Codex, Cursor, Copilot, Pi, Hermes, OpenClaw, and ~20 more):

```bash
bunx smithers-orchestrator skills add   # install the skill set into every detected agent
bunx smithers-orchestrator mcp add      # register Smithers as an MCP server everywhere
```

Then just ask:

> *"orchestrate an agent to add rate limiting and keep iterating until the tests pass."*

Your agent picks the right workflow, starts the run, and keeps going through retries and
review loops until the work is actually done.

See [Agent Support](https://smithers.sh/agents/overview) for the per-agent setup (skill,
MCP, instructions) for Claude Code, Codex, Cursor, Copilot, Pi, Hermes, and OpenClaw.

**Wire one agent by hand?** If you'd rather drop the curated onboarding skill into a single
agent directly:

```bash
mkdir -p ~/.claude/skills/smithers
curl -fsSL https://raw.githubusercontent.com/smithersai/smithers/main/skills/smithers/SKILL.md \
  -o ~/.claude/skills/smithers/SKILL.md
curl -fsSL https://smithers.sh/llms-full.txt \
  -o ~/.claude/skills/smithers/llms-full.txt
```

See [`skills/smithers/`](./skills/smithers) for the onboarding skill.

## Quick start

Prefer to drive it yourself from the CLI? Start here.

```bash
# scaffold the workflow pack into .smithers/
bunx smithers-orchestrator init

# turn a request into a practical implementation plan
bunx smithers-orchestrator workflow run plan --prompt "add rate limiting, audit logging, and API key rotation"
```

`init` scaffolds a `.smithers/` folder preloaded with production-ready workflows. Once
that's in place, you can chain a request from tickets to implementation:

```bash
# break a request into ticket files under .smithers/tickets/
bunx smithers-orchestrator workflow run tickets-create --prompt "add rate limiting, audit logging, and API key rotation"

# implement the tickets, each in its own worktree branch
bunx smithers-orchestrator workflow run kanban
```

Run `bunx smithers-orchestrator starters` to browse plain-English starters, and
`smithers workflow list` to see what's installed.

## Watch your runs

Whether your agent started a run or you did, you can see exactly what's happening:

```bash
smithers ps                # list active, paused, and recently completed runs
smithers inspect <run-id>  # steps, agents, approvals, and outputs for one run
smithers logs <run-id>     # tail the event log
smithers chat <run-id>     # read the agent's chat output
```

`ps` shows you what needs attention (a paused approval, a recent failure); `inspect` drills
into a single run so you can follow each step and agent as it works.

## Durable by default

Durability is the differentiator. Runs survive crashes, restarts, and flaky tools because
**every completed step is persisted to SQLite the moment it finishes** — the runtime always
knows what's done and what to run next. Approvals, human questions, retries, and replay are
first-class.

```bash
smithers up workflow.tsx --input '{"description":"Fix bug"}'
smithers up workflow.tsx --run-id abc123 --resume true   # resume after a crash
smithers rewind abc123 --frame 4                          # time-travel to an earlier frame
smithers fork abc123                                      # branch an alternate timeline
smithers replay abc123                                    # replay from a checkpoint
```

## Any agent, any model

Smithers doesn't bet on one lab or one harness. Point a task at whichever agent is best
for the job and switch freely:

- **CLI agents**: [Claude Code](./docs/integrations/cli-agents.mdx), Codex,
  [Pi](./docs/integrations/pi-integration.mdx), Antigravity, and more, driven through
  their own runtimes.
- **SDK agents**: any model the [Vercel AI SDK](./docs/integrations/sdk-agents.mdx)
  supports, with tools, structured output, and MCP.
- **Mix them in one workflow**: let a frontier model plan, a fast model fan out, and a
  specialized harness do the edits. The workflow doesn't change when the model does.

## Built-in workflows

`smithers init` installs a pack of ready-to-run workflows. Point your agent at one and go
via `bunx smithers-orchestrator workflow run <id> --prompt "..."`:

**Build**

| Workflow | What it does |
| --- | --- |
| `implement` | Implement a focused change with validation and review feedback loops. |
| `research-plan-implement` | Research a request, produce a plan, then implement it with validation and review. |
| `ticket-create` / `tickets-create` | Turn a request into one or many structured implementation tickets. |
| `kanban` | Implement ticket files in worktree branches, board-style. |

**Plan**

| Workflow | What it does |
| --- | --- |
| `plan` | Create a practical implementation plan before code changes begin. |
| `research` | Gather repository and external context before planning or building. |
| `grill-me` | Ask targeted questions until vague requirements become actionable. |
| `mission` | Run long-horizon work as approved milestones with focused workers and validation. |

**Quality**

| Workflow | What it does |
| --- | --- |
| `review` | Review current repository changes with one or more configured agents. |
| `debug` | Reproduce, fix, validate, and review a reported bug. |
| `improve-test-coverage` | Find and add high-impact missing tests for the repository. |
| `audit` | Audit feature groups for tests, docs, observability, and maintainability gaps. |
| `feature-enum` | Build or refine a code-backed feature inventory for a repository. |
| `ralph` | Keep working continuously on an open-ended maintenance prompt. |

See [`docs/workflows/`](./docs/workflows/overview.mdx) for the full pack.

## Examples

The [`examples/`](./examples) folder has 90+ runnable workflows covering real patterns. Copy one as a starting point:

| Example | Pattern |
| --- | --- |
| [`code-review-loop`](./examples/code-review-loop.jsx) | Implement → review → fix, looped until approved. |
| [`coverage-loop`](./examples/coverage-loop.jsx) | Run tests, measure coverage, write tests, repeat to target. |
| [`panel`](./examples/panel.jsx) | N specialist agents review in parallel, a moderator synthesizes. |
| [`debate`](./examples/debate.jsx) | Two agents argue opposing positions; a judge decides. |
| [`supervisor`](./examples/supervisor.jsx) | A boss agent plans and delegates to workers dynamically. |
| [`fan-out-fan-in`](./examples/fan-out-fan-in.jsx) | Split work across N parallel agents, aggregate results. |
| [`parallel-tickets`](./examples/parallel-tickets.jsx) | Triage, run waves of work in parallel, merge-queue the results. |
| [`migration`](./examples/migration.jsx) | Plan → transform files → validate → report. |
| [`pr-shepherd`](./examples/pr-shepherd.jsx) | Watch a PR, gather context, leave structured review comments. |
| [`canary-judge`](./examples/canary-judge.jsx) | Compare stable vs. canary metrics; recommend promote/hold/rollback. |
| [`slo-breach-explainer`](./examples/slo-breach-explainer.jsx) | On an SLO alarm, pull traces/logs/changes and explain the cause. |
| [`repo-janitor`](./examples/repo-janitor.jsx) | On a schedule, clean warnings, stale TODOs, and doc drift. |

## Author your own

The built-in workflows are normal Smithers TSX files: run them as-is, have your agent
adapt them to your repo, or have it write new ones from the same primitives. A workflow
is a JSX tree of tasks:

```tsx
import { createSmithers, Sequence } from "smithers-orchestrator";
import { z } from "zod";

const { Workflow, Task, smithers, outputs } = createSmithers({
  analyze: z.object({
    summary: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  }),
  fix: z.object({
    patch: z.string(),
    explanation: z.string(),
  }),
});

export default smithers((ctx) => (
  <Workflow name="bugfix">
    <Sequence>
      <Task id="analyze" output={outputs.analyze} agent={analyzer}>
        {`Analyze the bug: ${ctx.input.description}`}
      </Task>

      <Task id="fix" output={outputs.fix} agent={fixer}>
        {`Fix this issue: ${ctx.latest("analyze").summary}`}
      </Task>
    </Sequence>
  </Workflow>
));
```

Each task output is validated against its Zod schema and persisted to SQLite. If the
process crashes, Smithers resumes from the last completed node without re-running
finished work.

### Components

| Component    | Purpose                        |
| ------------ | ------------------------------ |
| `<Workflow>` | Root container                 |
| `<Task>`     | AI or static task node         |
| `<Sequence>` | Ordered execution              |
| `<Parallel>` | Concurrent execution           |
| `<Branch>`   | Conditional execution          |
| `<Ralph>`    | Loop until a condition is met  |

```tsx
<Ralph until={ctx.latest("validate")?.approved} maxIterations={5}>
  <Task id="implement" output={outputs.implement} agent={coder}>
    Fix based on feedback
  </Task>

  <Task id="validate" output={outputs.review} agent={reviewer}>
    Review the implementation
  </Task>
</Ralph>
```

There are many more: approvals, merge queues, sub-workflows, signals, timers, sagas, and
composite patterns. See [Components](https://smithers.sh/components/workflow).

## Deeper capabilities

- **Observability**: every run emits Prometheus metrics and OpenTelemetry traces — bring up
  the local stack with `smithers observability up` (Grafana, Prometheus, Tempo, OTLP
  collector) and serve metrics with `smithers up workflow.tsx --serve --metrics`.
- **Evals**: run repeatable workflow regressions from JSON/JSONL cases with
  `smithers eval workflow.tsx --cases evals/smoke.jsonl --suite smoke`; the command exits
  non-zero when any case fails.
- **Prompt optimization**: run GEPA-style optimization against an eval suite with
  `smithers optimize`, which writes an optimized prompt artifact only when the score
  improves.
- **Hot reload**: edit prompts, config, agent settings, or JSX structure mid-run with
  `smithers up workflow.tsx --hot` — in-flight tasks finish on their original code; only
  newly scheduled tasks pick up changes.
- **Scale across machines**: the same `<Sandbox>` primitive runs agents locally or on a
  remote provider ([gVisor](https://gvisor.dev), Kubernetes,
  [freestyle.sh](https://freestyle.sh), [Daytona](https://daytona.io), and
  [Cloudflare](https://workers.cloudflare.com)) with no change to the workflow. See
  [`examples/freestyle-sandbox-provider`](./docs/examples/freestyle-sandbox-provider.mdx)
  and the [Sandbox component](https://smithers.sh/components/sandbox).

## Read next

- [Install the agent skill](./skills/smithers) — make your coding agent fluent in Smithers.
- [Tour](https://smithers.sh/tour) — a guided walk through a real run.
- [How It Works](https://smithers.sh/how-it-works) — the durable execution model.
- [Components](https://smithers.sh/components/workflow) — the full primitive set.

## Docs

Full documentation lives at **[smithers.sh](https://smithers.sh)**.

## License

MIT
