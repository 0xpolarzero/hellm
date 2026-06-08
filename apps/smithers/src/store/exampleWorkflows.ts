import type { StoreWorkflow } from "./workflows";

/**
 * Accent color per example category. Examples derive their card color from this
 * map so the palette stays consistent; the installed defaults in
 * `workflows.ts` pick their own colors.
 */
const CATEGORY_COLOR: Record<string, string> = {
  Coding: "#2670a9",
  Planning: "#bf5b16",
  Review: "#356fd2",
  Testing: "#1f9d6b",
  Ops: "#c2691c",
  Incident: "#d6336c",
  Security: "#b5532a",
  Data: "#0f8f78",
  Docs: "#7a51c8",
  Sales: "#2f9e44",
  Support: "#1098ad",
  Finance: "#c08a1e",
  Agents: "#6d56d8",
  Monitoring: "#4a63d0",
  Basics: "#5a6b7a",
  Marketing: "#e8590c",
};

type ExampleSeed = {
  /** Matches the example filename in `examples/<id>.jsx`. */
  id: string;
  name: string;
  description: string;
  category: keyof typeof CATEGORY_COLOR & string;
  icon: string;
};

/**
 * Every runnable workflow under `examples/` (minus the three — `audit`,
 * `kanban`, `plan` — that ship pre-installed in the default pack; see
 * `workflows.ts`).
 * These appear in the store as "Available" workflows you can install. Keep this
 * list in sync when example workflows are added or removed.
 */
const EXAMPLE_SEEDS: ExampleSeed[] = [
  {
    id: "alert-suppressor",
    name: "Alert Suppressor",
    description:
      "Classify incoming alerts against prior incidents and noise rules, escalating only novel or high-risk ones.",
    category: "Monitoring",
    icon: "🔕",
  },
  {
    id: "benchmark-sheriff",
    name: "Benchmark Sheriff",
    description:
      "Run benchmarks against a stored baseline and explain only when metrics move materially.",
    category: "Testing",
    icon: "📊",
  },
  {
    id: "bisect-guide",
    name: "Bisect Guide",
    description:
      "Drive git bisect with an agent interpreting ambiguous outcomes at each step.",
    category: "Coding",
    icon: "🪓",
  },
  {
    id: "blog-analyzer-pipeline",
    name: "Blog Analyzer Pipeline",
    description:
      "Ingest blog content, analyze topics, and emit structured editorial insights.",
    category: "Data",
    icon: "📰",
  },
  {
    id: "branch-doctor",
    name: "Branch Doctor",
    description:
      "Diagnose a broken branch from bad rebases or partial cherry-picks and propose a minimal recovery.",
    category: "Coding",
    icon: "🩺",
  },
  {
    id: "canary-judge",
    name: "Canary Judge",
    description:
      "Compare stable vs canary telemetry and recommend promote, hold, or rollback.",
    category: "Ops",
    icon: "🐤",
  },
  {
    id: "change-blast-radius",
    name: "Change Blast Radius",
    description:
      "Map a diff to the services, tests, docs, and owners it likely impacts.",
    category: "Review",
    icon: "💥",
  },
  {
    id: "changelog",
    name: "Changelog",
    description:
      "Analyze git history, categorize changes, and generate a formatted changelog.",
    category: "Docs",
    icon: "📝",
  },
  {
    id: "chat-log-repro",
    name: "Chat Log Repro",
    description:
      "Minimal repro that checks chat-log visibility for Claude Code and Codex agents.",
    category: "Basics",
    icon: "🧪",
  },
  {
    id: "classifier-switchboard",
    name: "Classifier Switchboard",
    description:
      "Route messages through a typed enum classifier to specialized domain handlers.",
    category: "Agents",
    icon: "🔀",
  },
  {
    id: "code-review-loop",
    name: "Code Review Loop",
    description:
      "Implement, review, and fix in a loop until the change passes review.",
    category: "Review",
    icon: "🔁",
  },
  {
    id: "collector-probe",
    name: "Collector Probe",
    description:
      "Wrap agent calls with timing and usage collection and alert only on quality or cost drift.",
    category: "Monitoring",
    icon: "📈",
  },
  {
    id: "command-watchdog",
    name: "Command Watchdog",
    description:
      "Run a command on a schedule and escalate only when output or timing becomes notable.",
    category: "Monitoring",
    icon: "🐕",
  },
  {
    id: "compliance-evidence-collector",
    name: "Compliance Evidence Collector",
    description:
      "Gather compliance evidence from APIs and tools, then assemble a review packet.",
    category: "Security",
    icon: "🗂️",
  },
  {
    id: "config-diff-explainer",
    name: "Config Diff Explainer",
    description:
      "Read config, Helm, Terraform, and k8s diffs and produce a plain-English risk summary.",
    category: "Ops",
    icon: "⚙️",
  },
  {
    id: "contract-drift-sentinel",
    name: "Contract Drift Sentinel",
    description:
      "Diff OpenAPI, GraphQL, and protobuf contracts and flag likely breaking changes.",
    category: "Review",
    icon: "📐",
  },
  {
    id: "coverage-loop",
    name: "Coverage Loop",
    description:
      "Run tests, measure coverage, write tests, and repeat until the target is met.",
    category: "Testing",
    icon: "🧪",
  },
  {
    id: "debate",
    name: "Debate",
    description:
      "Two agents argue opposing positions and a judge synthesizes a decision.",
    category: "Agents",
    icon: "⚖️",
  },
  {
    id: "dependency-update",
    name: "Dependency Update",
    description: "Check outdated deps, assess risk, update, and verify with tests.",
    category: "Coding",
    icon: "📦",
  },
  {
    id: "discovery",
    name: "Discovery",
    description:
      "Scan a codebase or API, categorize findings, and store structured results.",
    category: "Data",
    icon: "🔭",
  },
  {
    id: "doc-sync",
    name: "Doc Sync",
    description:
      "Compare docs to code, find discrepancies, fix them, and open a PR.",
    category: "Docs",
    icon: "🔄",
  },
  {
    id: "docs-fixup-bot",
    name: "Docs Fixup Bot",
    description:
      "Scan docs for broken examples or drift and propose validated fixes.",
    category: "Docs",
    icon: "🩹",
  },
  {
    id: "docs-patcher",
    name: "Docs Patcher",
    description:
      "Detect public API and CLI changes, patch affected docs, and open a follow-up PR.",
    category: "Docs",
    icon: "🧷",
  },
  {
    id: "dynamic-schema-enricher",
    name: "Dynamic Schema Enricher",
    description:
      "Pick or build an output schema per source or tenant, then extract into that shape.",
    category: "Data",
    icon: "🧬",
  },
  {
    id: "error-clusterer",
    name: "Error Clusterer",
    description:
      "Group recurring errors into clusters and maintain a searchable explanation set.",
    category: "Incident",
    icon: "🧩",
  },
  {
    id: "etl",
    name: "ETL",
    description:
      "Extract, transform, and load data with a dedicated agent per stage.",
    category: "Data",
    icon: "🛢️",
  },
  {
    id: "extract-anything-workbench",
    name: "Extract Anything Workbench",
    description:
      "A local bench for trying typed extraction over arbitrary inputs before committing.",
    category: "Data",
    icon: "🧰",
  },
  {
    id: "fail-only-report",
    name: "Fail Only Report",
    description:
      "Run commands and invoke an agent only when a run fails or regresses.",
    category: "Ops",
    icon: "🚨",
  },
  {
    id: "failing-test-author",
    name: "Failing Test Author",
    description:
      "Given an issue or traceback, write the smallest failing test before any fix.",
    category: "Testing",
    icon: "❌",
  },
  {
    id: "fan-out-fan-in",
    name: "Fan Out Fan In",
    description: "Split work across N parallel agents and merge their results.",
    category: "Agents",
    icon: "🪢",
  },
  {
    id: "feedback-pulse",
    name: "Feedback Pulse",
    description:
      "Watch feedback streams, extract pain points and sentiment, and route notable themes.",
    category: "Support",
    icon: "💬",
  },
  {
    id: "financial-inbox-guard",
    name: "Financial Inbox Guard",
    description:
      "Monitor finance mailboxes for invoices, exceptions, and risky language.",
    category: "Finance",
    icon: "🛡️",
  },
  {
    id: "flake-hunter",
    name: "Flake Hunter",
    description:
      "Rerun a failing test under controlled variants and report on flakiness.",
    category: "Testing",
    icon: "🎲",
  },
  {
    id: "form-filler-assistant",
    name: "Form Filler Assistant",
    description:
      "Extract known fields, ask for missing ones, then fill forms with validated data.",
    category: "Data",
    icon: "🖊️",
  },
  {
    id: "friday-bot",
    name: "Friday Bot",
    description:
      "Run on a schedule, gather context, and produce a weekly summary or action list.",
    category: "Monitoring",
    icon: "📅",
  },
  {
    id: "gastown",
    name: "Gastown",
    description:
      "A faithful recreation of Steve Yegge's Gas Town multi-agent framework on Smithers.",
    category: "Agents",
    icon: "🏙️",
  },
  {
    id: "gate",
    name: "Gate",
    description:
      "Block execution until an external condition is met, polling until satisfied.",
    category: "Ops",
    icon: "🚧",
  },
  {
    id: "invoice-approval-watch",
    name: "Invoice Approval Watch",
    description:
      "Extract invoice data, validate against rules, and route suspicious items for approval.",
    category: "Finance",
    icon: "🧾",
  },
  {
    id: "kimi-example",
    name: "Kimi Example",
    description: "A minimal Sequence example driven by the Kimi agent.",
    category: "Basics",
    icon: "🌙",
  },
  {
    id: "lead-enricher",
    name: "Lead Enricher",
    description:
      "Take a raw inbound lead, enrich its context, and write a structured profile.",
    category: "Sales",
    icon: "🧑‍💼",
  },
  {
    id: "lead-router-with-approval",
    name: "Lead Router With Approval",
    description:
      "Score inbound leads, propose routing, and ask a human on borderline cases.",
    category: "Sales",
    icon: "🚦",
  },
  {
    id: "log-digest",
    name: "Log Digest",
    description:
      "Compress build, test, and deploy logs into root-cause hypotheses and next commands.",
    category: "Incident",
    icon: "📜",
  },
  {
    id: "mcp-health-probe",
    name: "MCP Health Probe",
    description:
      "Periodically exercise MCP servers and report only on material capability drift.",
    category: "Monitoring",
    icon: "🛰️",
  },
  {
    id: "meeting-briefer",
    name: "Meeting Briefer",
    description:
      "Watch scheduled meetings, gather context, and create a prep brief.",
    category: "Agents",
    icon: "🗓️",
  },
  {
    id: "memory-support-agent",
    name: "Memory Support Agent",
    description:
      "Handle support chats with durable per-customer memory and isolation.",
    category: "Support",
    icon: "🧠",
  },
  {
    id: "merge-conflict-mediator",
    name: "Merge Conflict Mediator",
    description:
      "Explain merge conflicts, propose a resolution, and stage the fix for review.",
    category: "Coding",
    icon: "🤝",
  },
  {
    id: "migration",
    name: "Migration",
    description: "Plan, transform files, validate, and report on a migration.",
    category: "Coding",
    icon: "🚚",
  },
  {
    id: "milestone",
    name: "Milestone",
    description:
      "Progress through milestone gates as a state machine (M0 → M1 → …).",
    category: "Planning",
    icon: "🏁",
  },
  {
    id: "openapi-contract-agent",
    name: "OpenAPI Contract Agent",
    description:
      "Turn JSON Schema and OpenAPI into typed interfaces for extraction or tool calls.",
    category: "Data",
    icon: "🔌",
  },
  {
    id: "panel",
    name: "Panel",
    description:
      "N specialist agents review in parallel, then a moderator synthesizes.",
    category: "Agents",
    icon: "👥",
  },
  {
    id: "parallel-tickets",
    name: "Parallel Tickets",
    description:
      "Triage tickets into dependency waves and run each wave in parallel.",
    category: "Coding",
    icon: "🧵",
  },
  {
    id: "patch-plausibility-gate",
    name: "Patch Plausibility Gate",
    description:
      "Verify a candidate patch with parallel lint, test, and build before promotion.",
    category: "Review",
    icon: "🚪",
  },
  {
    id: "pi-hello-world",
    name: "Pi Hello World",
    description: "The smallest Pi-agent workflow: a single typed hello-world task.",
    category: "Basics",
    icon: "👋",
  },
  {
    id: "pi-tools-workflow",
    name: "Pi Tools Workflow",
    description: "A Pi-agent workflow demonstrating tool use.",
    category: "Basics",
    icon: "🛠️",
  },
  {
    id: "pr-lifecycle",
    name: "PR Lifecycle",
    description:
      "Shepherd a PR through rebase, self-review, push, CI, and merge.",
    category: "Coding",
    icon: "🛤️",
  },
  {
    id: "pr-shepherd",
    name: "PR Shepherd",
    description:
      "Watch a PR reach ready-for-review, gather context, and leave structured comments.",
    category: "Review",
    icon: "🐑",
  },
  {
    id: "prompt-optimizer-harness",
    name: "Prompt Optimizer Harness",
    description:
      "Run prompt variants against test cases and select the best performer.",
    category: "Agents",
    icon: "🎛️",
  },
  {
    id: "ralph-loop",
    name: "Ralph Loop",
    description:
      "Keep an agent working continuously until a check reports done (the Ralph loop).",
    category: "Coding",
    icon: "♻️",
  },
  {
    id: "ransomware-isolation-coordinator",
    name: "Ransomware Isolation Coordinator",
    description:
      "Coordinate ransomware response steps (isolate, notify, capture) with approval gates.",
    category: "Security",
    icon: "🔒",
  },
  {
    id: "receipt-stream-watcher",
    name: "Receipt Stream Watcher",
    description:
      "Stream a typed extraction from receipts and stop once enough fields are present.",
    category: "Data",
    icon: "🪙",
  },
  {
    id: "refactor",
    name: "Refactor",
    description: "Analyze, plan a refactor, apply the changes, and validate.",
    category: "Coding",
    icon: "🔧",
  },
  {
    id: "repo-janitor",
    name: "Repo Janitor",
    description:
      "Run on a schedule to clean warnings, stale TODOs, and docs drift via PRs.",
    category: "Coding",
    icon: "🧹",
  },
  {
    id: "repro-harness-builder",
    name: "Repro Harness Builder",
    description:
      "Build a minimal Docker repro from an issue so later steps run reproducibly.",
    category: "Testing",
    icon: "🐳",
  },
  {
    id: "retry-budget-manager",
    name: "Retry Budget Manager",
    description:
      "Track retry budgets, adapt backoff per failure class, and escalate when wasteful.",
    category: "Ops",
    icon: "⏳",
  },
  {
    id: "revenue-scout",
    name: "Revenue Scout",
    description:
      "Scan support and email threads for latent sales opportunities and route them.",
    category: "Sales",
    icon: "💰",
  },
  {
    id: "review-cycle",
    name: "Review Cycle",
    description: "Implement, review, fix, and loop until the work is approved.",
    category: "Review",
    icon: "🧐",
  },
  {
    id: "rollback-advisor",
    name: "Rollback Advisor",
    description:
      "Read failed-deploy evidence and recommend a rollback, with optional approval.",
    category: "Ops",
    icon: "⏪",
  },
  {
    id: "runbook-executor",
    name: "Runbook Executor",
    description:
      "Run safe runbook steps automatically and pause on risky steps for approval.",
    category: "Ops",
    icon: "📕",
  },
  {
    id: "scaffold",
    name: "Scaffold",
    description:
      "Generate project or feature structure from a template or spec, then verify.",
    category: "Coding",
    icon: "🏗️",
  },
  {
    id: "schema-conformance-gate",
    name: "Schema Conformance Gate",
    description:
      "Validate extracted data against schema rules and block bad outputs.",
    category: "Data",
    icon: "🛂",
  },
  {
    id: "service-desk-dispatcher",
    name: "Service Desk Dispatcher",
    description:
      "Tell incidents from requests and route each to the right service-desk path.",
    category: "Support",
    icon: "🎧",
  },
  {
    id: "simple-workflow",
    name: "Simple Workflow",
    description:
      "A minimal two-step Sequence: the smallest end-to-end Smithers workflow.",
    category: "Basics",
    icon: "🔰",
  },
  {
    id: "slo-breach-explainer",
    name: "SLO Breach Explainer",
    description:
      "When SLO alarms trip, pull traces and logs and explain the causal chain.",
    category: "Incident",
    icon: "📉",
  },
  {
    id: "smoketest",
    name: "Smoketest",
    description:
      "Provision an environment, run smoke checks, and report pass or fail.",
    category: "Testing",
    icon: "💨",
  },
  {
    id: "social-inbox-router",
    name: "Social Inbox Router",
    description:
      "Classify social inbox items into leads, support, noise, or follow-up.",
    category: "Sales",
    icon: "📥",
  },
  {
    id: "standards-reviewer",
    name: "Standards Reviewer",
    description:
      "Review changes against repo standards files and comment only on violations.",
    category: "Review",
    icon: "📏",
  },
  {
    id: "supervisor",
    name: "Supervisor",
    description: "A boss agent plans and delegates to worker agents dynamically.",
    category: "Agents",
    icon: "🧑‍✈️",
  },
  {
    id: "support-deflector",
    name: "Support Deflector",
    description:
      "Classify support issues, retrieve knowledge, draft a reply, and escalate on risk.",
    category: "Support",
    icon: "🛟",
  },
  {
    id: "survey-answerer-agent",
    name: "Survey Answerer Agent",
    description:
      "Read source material and produce constrained, typed survey answers.",
    category: "Data",
    icon: "🗳️",
  },
  {
    id: "test-sharder-judge",
    name: "Test Sharder Judge",
    description:
      "Select the most relevant tests, shard them across runners, and adjudicate.",
    category: "Testing",
    icon: "🔪",
  },
  {
    id: "threat-intel-enricher",
    name: "Threat Intel Enricher",
    description:
      "Enrich a security alert with context and recommend severity and first actions.",
    category: "Security",
    icon: "🕵️",
  },
  {
    id: "trace-explainer",
    name: "Trace Explainer",
    description:
      "Read agent and workflow traces and explain where time, tokens, or failures went.",
    category: "Monitoring",
    icon: "🔬",
  },
  {
    id: "triage",
    name: "Triage",
    description:
      "Intake a batch of items, classify and prioritize each, and route to the right handler.",
    category: "Agents",
    icon: "🧭",
  },
  {
    id: "trust-safety-moderator",
    name: "Trust Safety Moderator",
    description:
      "Screen content, classify policy risk, and route edge cases for review.",
    category: "Security",
    icon: "🚫",
  },
  {
    id: "tweet-thread",
    name: "Tweet Thread",
    description: "Post a pre-generated countdown tweet thread to X/Twitter.",
    category: "Marketing",
    icon: "🐦",
  },
  {
    id: "typed-extractor-stage",
    name: "Typed Extractor Stage",
    description:
      "Turn messy text into a typed object for downstream workflow steps.",
    category: "Data",
    icon: "🧱",
  },
  {
    id: "visual-diff-explainer",
    name: "Visual Diff Explainer",
    description:
      "Compare baseline and current screenshots and explain visual regressions.",
    category: "Testing",
    icon: "🖼️",
  },
  {
    id: "waterfall",
    name: "Waterfall",
    description:
      "Run sequential phases where each receives the previous phase's output.",
    category: "Planning",
    icon: "💧",
  },
];

export const EXAMPLE_WORKFLOWS: StoreWorkflow[] = EXAMPLE_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  description: seed.description,
  icon: seed.icon,
  category: seed.category,
  color: CATEGORY_COLOR[seed.category],
  starter: `Run the ${seed.name} workflow:\n\n`,
}));
