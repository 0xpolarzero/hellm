# Handler Thread History Default Research

Date: 2026-06-04

## Purpose

This note records the research behind the `thread_start.threads[].history` default for delegated
handler threads.

The concrete API question is whether a new handler thread should default to:

- `history: "isolated"`: the handler starts without inherited orchestrator conversation history and
  receives only its handler prompt, tools, extension binding, and delegated objective.
- `history: "forked"`: the handler receives a product-filtered inherited-history block from the
  current orchestrator conversation before the delegated objective.

The decision affects ordinary coding-agent reliability, context cost, bias, review quality, and
handoff ergonomics.

## Conclusion

Default handler starts should use `history: "isolated"`.

`forked` should be an explicit, conservative opt-in for conversational continuity, not the normal
delegation path.

The practical rule is:

- use `isolated` for ordinary implementation, review, testing, source-driven research, independent
  critique, security review, and tasks fully specified by durable files, specs, tests, handoff docs,
  or objective text
- use `forked` only when the prior conversation contains critical accepted decisions or unresolved
  user intent that is not yet captured in durable form, when the user explicitly asks to continue the
  conversation context in another handler, or when re-explaining the background would be materially
  lossy

This is a conservative coding-agent default. A missing-context failure in an isolated handler is
often more observable and recoverable through clarification or follow-up. A polluted-context failure
in a forked handler can be silent: stale assumptions, abandoned assistant reasoning, and irrelevant
turns may bias the handler while looking like continuity.

## Evidence

### Long Context Is Not Uniformly Reliable

Nelson Liu et al. found that language models often use information at the beginning or end of long
inputs better than information in the middle, even when the model supports long contexts. The result
matters for inherited conversation history because the relevant decision may sit in the least
reliable part of the prompt rather than the most recent turn.

Source: [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)

Amazon Science reported that, across math, QA, and coding tasks, performance can degrade as input
length grows even when retrieval of relevant information is perfect. This weakens the argument that
forking is safe as long as the important facts are somewhere in the inherited context.

Source:
[Context length alone hurts LLM performance despite perfect retrieval](https://www.amazon.science/publications/context-length-alone-hurts-llm-performance-despite-perfect-retrieval)

### Multi-Turn Conversation History Can Degrade Task Performance

Laban et al. compared fully specified single-turn tasks with equivalent multi-turn conversations and
reported a large average performance drop in the multi-turn setting. Their analysis attributes the
drop mainly to unreliability: models make early assumptions and then over-rely on them.

Source: [LLMs Get Lost In Multi-Turn Conversation](https://arxiv.org/abs/2505.06120)

Huang et al. studied whether models benefit from prior assistant responses in multi-turn
conversations. They found many turns can preserve quality when prior assistant responses are omitted,
while also reducing context by large factors. They identify context pollution cases where prior
assistant outputs propagate errors, hallucinations, or style artifacts.

Source: [Do LLMs Benefit From Their Own Words?](https://arxiv.org/abs/2602.24287)

### Agent Research Favors Managed, Selective Context

Recent SWE-agent context-management work treats append-only history as a failure mode. "Context as a
Tool" frames long-running software-agent context as structured working memory, not raw transcript
carryover, because append-only context leads to context explosion, semantic drift, and degraded
reasoning.

Source:
[Context as a Tool: Context Management for Long-Horizon SWE-Agents](https://openreview.net/forum?id=sN3CHd0MSW)

SWE-Pruner shows task-aware pruning can reduce context tokens substantially on coding-agent tasks
while preserving or improving success. That supports explicit selection and compression of context
over automatic transcript inheritance.

Source: [SWE-Pruner: Self-Adaptive Context Pruning for Coding Agents](https://arxiv.org/abs/2601.16746)

Summarization-based context-management work for multi-turn tool-use agents improves long-horizon
agent performance by periodically compressing tool-use history into task-relevant summaries. This is
another signal that the durable product should prefer compact handoff state over raw inherited
history.

Source:
[Scaling LLM Multi-turn RL with End-to-end Summarization-based Context Management](https://arxiv.org/abs/2510.06727)

### Current Coding-Agent Products Use Isolated Subagents As The Baseline

Claude Agent SDK documents that a subagent starts with a fresh conversation and does not receive the
parent's conversation history or tool results. The only parent-to-subagent channel is the delegated
prompt string.

Source: [Claude Agent SDK Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)

Claude's agent-loop docs recommend subagents as a context-efficiency strategy: each subagent starts
fresh, does not see the parent's turns, and only the final response returns to the parent.

Source: [Claude Agent SDK Agent Loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)

Claude Code's subagent docs distinguish ordinary subagents from forks. Ordinary subagents start with
fresh isolated context. Forked subagents inherit the parent conversation and are recommended when a
subagent would need too much background to be useful or when trying several approaches from the same
starting point. This maps directionally to `isolated` as the default and `forked` as an explicit
exception, though `svvy` forked handlers are narrower than Claude Code forks because they keep the
handler prompt and tools while receiving only a product-filtered inherited-history block.

Source: [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)

VS Code Copilot describes subagents as independent focused agents that receive a specific task and
return a summary, keeping the main conversation clean. It presents subagents as useful for isolated
research and parallel analysis, not as default transcript forks.

Source: [Subagents in Visual Studio Code](https://code.visualstudio.com/docs/copilot/agents/subagents)

OpenAI's Codex usage guidance emphasizes structured prompts, file paths, component names, diffs, doc
snippets, issue-like task descriptions, AGENTS.md, and task queues. That supports explicit task
packets and durable project instructions as a grounding layer; it is not direct evidence about
subagent transcript inheritance.

Source: [How OpenAI Uses Codex](https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1a4-af0cfbd38630/how-openai-uses-codex.pdf)

## Product Interpretation For `svvy`

`svvy` handler threads are not exactly Claude Code subagents. They are user-visible, pi-backed,
multi-turn handler surfaces that can supervise Smithers workflows and receive direct follow-up.

That difference makes `forked` worth supporting. It does not make `forked` the right default.

The best model is:

1. The main orchestrator owns strategy and synthesis.
2. A handler thread owns a delegated objective.
3. Workflow task agents under that handler remain fresh, bounded workers.
4. Durable files, specs, tests, artifacts, and explicit objectives carry handoff facts.
5. `forked` is reserved for cases where the handler needs conversational continuity rather than just
   task context.

## Recommended API Semantics

The API should remain:

```ts
type ThreadStartHistoryMode = "isolated" | "forked";

type ThreadStartInput = {
  threadGroupId?: ThreadGroupId;
  threads: Array<{
    objective: string;
    history?: ThreadStartHistoryMode;
    extensions?: Partial<Record<ExtensionId, ExtensionUsageState>>;
  }>;
};
```

Rules:

- omitted `threads[].history` means `"isolated"`
- `isolated` includes no inherited orchestrator conversation history
- `forked` includes a product-filtered inherited-history block from committed orchestrator
  transcript ancestors, delivered as one product-authored context block in the handler's first start
  item
- `forked` must remain opt-in and conservative
- `history` is creation-time provenance and does not change on later `thread_followup` or
  reactivation
- thread read tools should not include `history`; handlers know forked context from the initial
  boundary note, and orchestrators do not need it for routing

## Recommended Orchestrator Instruction

The orchestrator should normally omit `history`.

When delegating, write the objective as a compact task packet:

- goal
- acceptance criteria
- relevant durable paths
- decisions already accepted by the user
- constraints
- expected output shape
- what not to do

Use `history: "forked"` only when one of these is true:

- the user explicitly asks to fork, continue, or share the current conversation context with the
  handler
- the delegated work is a continuation of an unresolved design conversation where the nuance is not
  captured in durable files and would be materially lossy to restate
- the task is to explore several approaches from the exact same conversational starting point
- the orchestrator cannot produce a compact objective without losing critical user intent, and it is
  better to preserve continuity than to force a brittle summary

Do not use `forked` for:

- ordinary implementation
- source-driven research
- test fixing
- code review
- security review
- independent critique
- verification
- tasks already specified by durable files, specs, tests, artifact handoffs, or explicit objective
  text
- cases where prior conversation includes stale plans, speculative reasoning, rejected alternatives,
  or likely bias

## Recommended Artifact Guidance

Artifacts should remain an atomic extension concern. The thread orchestration instructions should not
mention artifact APIs directly.

The Artifacts extension should teach agents that mutable Markdown artifacts are useful handoff
documents when later agents should read, reassess, or modify a bounded plan, design note, review
brief, checklist, or research summary without inheriting full conversation context.

That gives the orchestrator a durable path for context sharing while keeping `thread_start` itself
simple.

## Decision

`history: "isolated"` is the correct default.

`history: "forked"` is an important escape hatch for continuity-heavy work, but it is not the
ordinary coding-agent path.
