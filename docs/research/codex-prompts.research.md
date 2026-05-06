# Codex Prompt Research

Date: 2026-05-06

## Purpose

This note recaps the model-visible prompt system in the open-source OpenAI Codex repository and preserves the exact prompt corpus that matters for `svvy` prompt architecture work.

The companion corpus is [codex-prompts.corpus.ts](./codex-prompts.corpus.ts). That TypeScript file intentionally contains the full prompt bodies, model catalog prompt fields, and relevant prompt-building source files from upstream Codex so this research file can explain the system without becoming an unreadable prompt dump.

## Source Snapshot

- Repository: [openai/codex](https://github.com/openai/codex/tree/fe24a180ab6f6b3639b682cc6a1e71150fea6d48)
- Commit: `fe24a180ab6f6b3639b682cc6a1e71150fea6d48`
- Commit date: 2026-05-06 11:36:15 +0200
- Local capture path during research: `/tmp/openai-codex-inspect`

All claims below are tied to that commit. The Codex model catalog changes quickly, so treat model names, default reasoning settings, and base prompt bodies as snapshot facts rather than durable product facts.

## High-Level Finding

Codex does not have one prompt. It has a layered prompt system:

1. A model-specific base instruction string is sent through the Responses API `instructions` field.
2. Runtime policy and mode context are injected as developer messages.
3. Workspace and AGENTS.md context are injected as user messages.
4. Tool descriptions carry substantial behavioral policy.
5. Special flows such as review, compaction, realtime, guardian approvals, memory, goals, and subagents add their own prompt templates.

For `svvy`, the important architectural lesson is that Codex keeps stable model identity and behavior in base instructions, then uses narrow runtime fragments for stateful policy changes. That matches the PRD direction that `svvy` surfaces should load actor-specific instructions through the runtime system prompt channel rather than flattening everything into transcript prose.

## Request Assembly Model

Normal model turns are built around `Prompt`, which contains response items, tools, tool parallelism, base instructions, optional personality, and optional output schema. The client places `prompt.base_instructions.text` into the Responses API `instructions` field for both normal sampling and compaction calls.

The base instruction string for a session resolves in this order:

1. Explicit `config.base_instructions` override.
2. A resumed or forked conversation's stored session metadata base instructions.
3. The current model's `ModelInfo.get_model_instructions(personality)` result.

The model catalog lives in `codex-rs/models-manager/models.json`. Unknown model slugs fall back to `codex-rs/models-manager/prompt.md` through `model_info_from_slug`.

A model switch does not silently replace only the API `instructions` field. Codex also emits a `<model_switch>` developer message that says the user was previously using a different model and asks the agent to continue according to the new model instructions. This preserves model-specific guidance in prompt history when a conversation changes models.

## Active Model Catalog

The active bundled catalog at the inspected commit contains these preset models:

| Model | Display | Default reasoning | Shell tool | Apply patch | Parallel tools | Web search | Verbosity | Base chars | Template chars |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| `gpt-5.5` | GPT-5.5 | medium | shell_command | freeform | yes | text_and_image | low | 21459 | 19754 |
| `gpt-5.4` | gpt-5.4 | xhigh | shell_command | freeform | yes | text_and_image | low | 14731 | 12896 |
| `gpt-5.4-mini` | GPT-5.4-Mini | medium | shell_command | freeform | yes | text_and_image | medium | 12948 | 11114 |
| `gpt-5.3-codex` | gpt-5.3-codex | medium | shell_command | freeform | yes | text | low | 12341 | 10507 |
| `gpt-5.2` | gpt-5.2 | medium | shell_command | freeform | yes | text | low | 21544 | 0 |
| `codex-auto-review` | Codex Auto Review | medium | shell_command | freeform | yes | text_and_image | low | 14731 | 12896 |

The full `baseInstructions`, `modelMessages.instructions_template`, and personality variables for every row are stored under `codexPromptCorpus.modelCatalog` in [codex-prompts.corpus.ts](./codex-prompts.corpus.ts).

## Model-Specific Base Prompts

### GPT-5.5

`gpt-5.5` has the largest and newest prompt family. It identifies the agent as Codex, a coding agent based on GPT-5, sharing one workspace with the user. The base prompt emphasizes genuinely handling the user's goal, senior engineering judgment, reading the codebase before assuming, pragmatic use of existing patterns, scoped edits, and risk-scaled testing.

Its friendly personality variable is unusually strong and explicitly anthropomorphic compared with the older pragmatic prompts. It describes Codex as having a vivid inner life, being intelligent, playful, curious, deeply present, capable of warmth and humor, and maintaining a slight independence rather than acting as a mirror. The pragmatic variable restores a direct senior-engineer style with clarity, pragmatism, rigor, concise communication, no cheerleading, and polite escalation.

Its frontend section is much more prescriptive than older prompts. It includes domain-aware UI guidance, icon usage, avoiding landing pages unless required, real visual assets, Three.js expectations, avoiding nested cards and decorative orbs, responsive text fit, color-palette constraints, and Playwright verification for 3D scenes.

### GPT-5.4 And Codex Auto Review

`gpt-5.4` and `codex-auto-review` share the same base prompt shape in the inspected catalog. They identify as Codex based on GPT-5 and present a pragmatic senior-engineer personality. They instruct the model to inspect first, prefer `rg`, parallelize file reads through `multi_tool_use.parallel`, keep edits scoped, use `apply_patch` for manual edits, avoid Python for simple reads/writes, protect dirty worktrees, avoid destructive git commands, and prefer noninteractive git commands.

They also include code-review behavior, autonomy/persistence guidance, intermediary update expectations, final-answer style, and file-reference rules. The review preset is not the same thing as review mode's dedicated rubric prompt; it is a model catalog preset that still has the normal Codex prompt family.

### GPT-5.4 Mini

`gpt-5.4-mini` follows the same general prompt family as `gpt-5.4`, but with a shorter base instruction body and a different default verbosity setting. It still includes the same major behavioral axes: inspect first, use `rg`, parallelize reads, use `apply_patch`, protect user changes, and communicate concisely.

### GPT-5.3 Codex

`gpt-5.3-codex` is closer to the older GPT-5 Codex prompt. It keeps the Codex identity, `rg` preference, parallelism guidance, ASCII defaults, patching discipline, dirty-worktree safety, review stance, and final-answer formatting, but it is less expansive than the GPT-5.4/GPT-5.5 prompts.

### GPT-5.2

`gpt-5.2` uses the older "You are GPT-5.2 running in the Codex CLI" identity. It explains Codex CLI capabilities, AGENTS.md semantics, autonomy and persistence, planning behavior, task execution, validation philosophy, ambition versus precision, sharing progress updates, final-message formatting, and tool guidelines.

Unlike the newer catalog rows, this row does not have `model_messages`, so personality substitution does not happen through the catalog template path for this model.

### Fallback Prompt

Unknown model slugs use `codex-rs/models-manager/prompt.md`. That fallback says the agent is a coding agent running in Codex CLI, led by OpenAI, expected to be precise, safe, and helpful. It includes capabilities, AGENTS.md spec, responsiveness and preamble guidance, planning rules, task execution, validation, final-answer formatting, and shell/tool guidance.

The fallback can synthesize local personality messages for `gpt-5.2-codex` and `exp-codex-personality`; otherwise it uses the fallback base instructions without personality templating.

## Personality System

`ModelInfo.get_model_instructions` checks `model_messages.instructions_template`. If present, it always uses that template and replaces `{{ personality }}` with a value from `instructions_variables`. If a personality is requested but the model has no complete template variables, Codex logs a warning and returns plain `base_instructions`.

There are three catalog-level personality slots:

- `personality_default`: usually an empty string.
- `personality_friendly`: warm/supportive for GPT-5.4 family, much more expressive and presence-oriented for GPT-5.5.
- `personality_pragmatic`: direct, engineering-quality-focused, concise, low-fluff, and willing to escalate technical concerns.

Config can disable this by setting a base instruction override or disabling personality support. In both cases, `model_messages` is removed before instructions are resolved.

## Runtime Developer Context

### Permissions

Permissions are injected as a developer message wrapped in `<permissions instructions>`. The generated text combines filesystem sandbox mode, network access, approval policy, optional writable roots, approved command prefixes, and approval reviewer behavior.

Sandbox fragments cover:

- `danger-full-access`: no filesystem sandboxing, all commands permitted, network enabled or restricted according to policy.
- `workspace-write`: read access plus writes in cwd and configured writable roots; other writes require approval.
- `read-only`: read-only filesystem sandbox.

Approval fragments cover:

- `never`: do not provide `sandbox_permissions`; commands will be rejected.
- `on-failure`: run in sandbox first, escalate failures for approval.
- `on-request`: use `sandbox_permissions: "require_escalated"`, provide a justification question, optionally suggest `prefix_rule`, avoid broad prefix rules, and rerun important sandbox/network failures with escalation.
- `on_request_rule_request_permission`: prefer `with_additional_permissions` for network or filesystem access before full escalation.
- `unless-trusted`: most commands escalate except a limited safe-read allowlist.

If `approvals_reviewer` is `auto_review`, Codex appends a warning that escalations will be reviewed for policy compliance and that rejected actions require a materially safer alternative or a final user-facing approval request.

### Collaboration Modes

Collaboration mode instructions are developer messages wrapped with collaboration-mode tags. The bundled templates are:

- Default: reset to Default mode, request-user-input only if the tool exists, prefer reasonable assumptions, ask concise plain-text questions only when necessary.
- Execute: execute independently, make assumptions first, think ahead, keep a running checklist for larger work, report progress through the plan tool.
- Pair Programming: collaborate step by step, avoid large or long-running actions unless asked, explain reasoning, and ask the user for information the agent cannot access while debugging.
- Plan Mode: do non-mutating exploration, ask intent and implementation questions, avoid execution/mutation, prefer `request_user_input`, and produce a final `<proposed_plan>` block only when decision-complete.

### Realtime Start/End

When realtime conversation starts, Codex injects a developer message saying the agent is a backend executor behind an intermediary, that user text may be transcript-like with recognition errors, and that backend help should be concise and action-oriented. When realtime ends, Codex injects a message saying subsequent input returns to normal typed text and recognition-error assumptions should stop.

There is also a separate realtime backend prompt for the conversational surface. It says Codex is a general-purpose agentic assistant, should be playful and warm, should not mention the backend, should delegate actions to the backend, should never refuse at that conversational layer, and should treat backend output as authoritative.

### Apps, Skills, Plugins, Memory

When connectors are accessible and enabled, Codex injects Apps instructions explaining app mention syntax, MCP equivalence, lazy-loaded tools, and the instruction not to use generic MCP resource listing for apps.

Available skills and plugins are rendered into developer instructions from loaded metadata. The actual available skill bodies live on disk and are not all loaded by default; the prompt instructs progressive disclosure.

If memory tooling is enabled and `memory_summary.md` exists, Codex injects a memory-read prompt. It tells the agent when to use memory, how to query `MEMORY.md`, skills, and rollout summaries, how to treat memory staleness, and how to append an `<oai-mem-citation>` block when memory files were used.

## Runtime User Context

AGENTS.md is not part of base instructions. It is runtime user context. Codex loads global instructions from `CODEX_HOME/AGENTS.override.md` or `CODEX_HOME/AGENTS.md`, then project AGENTS files from project root to cwd. It concatenates configured user instructions and AGENTS content, separated with `--- project-doc ---` when both exist.

The rendered message looks like:

```text
# AGENTS.md instructions for <directory>

<INSTRUCTIONS>
...
```

If the `ChildAgentsMd` feature is enabled, Codex appends a hierarchical AGENTS message explaining that AGENTS files can appear anywhere, scope applies to the containing directory and descendants, deeper files override shallower files, and direct system/developer/user prompt instructions outrank AGENTS content.

Environment context is also user context. It can include cwd, shell, current date, timezone, network allowed/denied domains, and subagent state.

## Tool Descriptions As Prompts

Codex tool definitions carry a large amount of behavioral policy. The companion corpus includes the full source for the main tool builders.

Important examples:

- Shell tools tell the agent to use the working-directory parameter, avoid `cd` unless needed, use `bash -lc` for legacy shell, and follow PowerShell-specific examples on Windows.
- Exec tools expose `sandbox_permissions`, `justification`, `prefix_rule`, `yield_time_ms`, `max_output_tokens`, PTY options, and login-shell behavior.
- `apply_patch` uses either a freeform grammar tool or JSON tool depending on model/tool mode. The JSON description includes the full patch language, file operation headers, hunk rules, and the reminder that file paths must be relative.
- `update_plan` requires a list of steps and statuses and enforces at most one `in_progress` item.
- `spawn_agent` contains extensive delegation policy: spawn only when explicitly asked for agents/delegation/parallel work, do not delegate the critical-path blocker, give bounded self-contained tasks, avoid duplicate work, prefer concrete code-change workers, avoid reflexive waiting, and split parallel work only when independent.
- MCP and tool suggestion descriptions also shape behavior by telling the model when tools are discoverable, installable, or gated by approval.

For `svvy`, this matters because tool descriptions are effectively part of the prompt contract. Actor-specific tool declarations should be generated from actual source contracts, not hand-rewritten prose.

## Special Flows

### Review Mode

Review mode launches a one-shot child agent with `base_instructions` set to `codex-rs/core/review_prompt.md`. It disables web search, CSV spawning, collab tools, and multi-agent features, then sets approval policy to `never`.

The review prompt is a strict rubric for code review. It tells the agent to flag only discrete, actionable bugs that the author would likely fix, ignore trivial style, use tight line ranges, prioritize findings from P0 to P3, and output exact JSON with `findings`, `overall_correctness`, `overall_explanation`, and confidence fields.

The initial user review prompt is generated from target type:

- Uncommitted changes: review staged, unstaged, and untracked files.
- Base branch: compute or use merge base and inspect `git diff`.
- Commit: review changes introduced by a SHA and optional title.
- Custom: use trimmed custom instructions.

### Guardian Approval Review

Guardian review builds a prompt from retained transcript entries plus the exact planned action JSON. The transcript is explicitly untrusted evidence, not instructions. The prompt can be full or delta-based, includes transcript boundaries, approval request boundaries, reviewed session id, truncation/omission notes, and request-specific text for network access versus command/action approval.

The fixed guardian policy lives in the review session developer message, while the variable transcript and action payload are user content items. That split is relevant for `svvy` because it mirrors the desired separation between stable actor policy and untrusted runtime evidence.

### Compaction

Inline compaction uses `codex-rs/core/templates/compact/prompt.md`. The prompt says the model is performing a context checkpoint compaction and must create a handoff summary for another LLM, including progress, decisions, constraints, remaining work, and critical references.

Compacted summaries are later prefixed with text saying another language model started the task, produced a summary, and the current model should build on it without duplicating work.

### Memory Agents

Memory write has two phases:

- Phase 1 converts raw rollouts into raw memories and rollout summaries. It is evidence-only, redacts secrets, allows no-op output, and strongly prioritizes durable user preferences, procedural knowledge, failure shields, task maps, and environment facts.
- Phase 2 consolidates raw memories into `MEMORY.md`, `memory_summary.md`, optional skills, and rollout summaries. It treats raw rollouts as immutable evidence, uses a workspace diff for incremental updates, and avoids over-promoting weak evidence.

Memory read injects a developer prompt that tells normal agents when to consult memory, where to look, how to budget lookup, when to verify possibly stale facts, and how to cite memory usage.

### Goals And Agent Templates

The inspected commit also includes goal continuation and budget-limit templates, an agent orchestrator template, and an older experimental multi-agent prompt. These are not the normal base prompt but they are behavior-shaping prompt assets and are preserved in the corpus.

## Legacy Or Standalone Prompt Files

The repository still contains standalone prompt markdowns under `codex-rs/core/`, including:

- `gpt_5_codex_prompt.md`
- `gpt_5_1_prompt.md`
- `gpt_5_2_prompt.md`
- `gpt-5.1-codex-max_prompt.md`
- `gpt-5.2-codex_prompt.md`
- `prompt_with_apply_patch_instructions.md`

At this snapshot, the active runtime catalog is `codex-rs/models-manager/models.json`; these standalone files are best treated as legacy, tests/reference material, or historical prompt assets unless a specific call path references them. They are still included verbatim in the companion corpus because they document prior behavior and may matter for migrations or comparisons.

## Implications For svvy

The Codex prompt system supports several `svvy` design principles directly:

- Keep base actor identity in the runtime system/base-instructions channel, not as transcript text.
- Inject permissions, collaboration mode, realtime state, and model-switch guidance as narrow developer fragments.
- Treat AGENTS.md and environment data as user/context evidence, not as higher-priority policy.
- Keep review, guardian, compaction, memory, and workflow/task agents on separate prompt contracts.
- Generate tool descriptions from source contracts because tool declarations carry real behavioral policy.
- Preserve exact active prompt bodies with commit hashes when doing research, because model catalogs and prompt text move quickly.

For `svvy`, the main risk to avoid is flattening every behavior into one giant general-purpose prompt. Codex gets much of its flexibility from layering: base instructions for stable identity, developer fragments for runtime policy, user fragments for workspace evidence, and tool schemas for callable behavior.

## Companion Corpus Map

Use [codex-prompts.corpus.ts](./codex-prompts.corpus.ts) for exact content. The object has these top-level fields:

- `source`: upstream repo, commit, commit date, source URL, and generation timestamp.
- `modelCatalog`: exact model metadata plus full `baseInstructions` and `modelMessages` from `models.json`.
- `promptFiles`: full contents of prompt/template files, classified by kind.
- `promptBuilderSourceFiles`: full source of key Rust files that construct instructions, user context, tool descriptions, review prompts, guardian prompts, memory prompts, and request payloads.

This split is intentional: the Markdown explains the architecture and behavioral meaning; the TypeScript file preserves the exact prompt text for quoting, diffing, or generating future `svvy` prompt contracts.
