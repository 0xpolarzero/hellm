# Context-Disciplined Harness

`hellm` is built around one idea: context is the scarce resource.

A good coding harness should preserve strategic context, spend local context deliberately, and externalize whatever does not need to stay in the model's active window.

That leads to a simple operating model:

- one main orchestrator keeps high-level context, routing, and final decisions
- bounded delegated work is pushed into short-lived Smithers workflows or worker tasks
- useful results are compressed into episodes and artifacts instead of dragging full transcripts forward
- repeatable structure is scripted
- dynamic composition is pushed into `execute_typescript` when the model can write a short program more effectively than it can call many low-level tools
- raw model reasoning is reserved for ambiguity, synthesis, prioritization, and recovery

This is the middle path between two failure modes:

- transcript-heavy agents that keep too much in context and lose focus
- rigid workflow systems that over-script work and lose adaptability

`hellm` aims to interleave agentic reasoning and scripting on purpose:

- use the model where judgment matters
- use executable structure where repetition, composition, or verification matter
- move information across that boundary in compressed, reusable forms

The result should feel less like a single chat loop and less like a static automation graph. It should feel like a disciplined harness that knows what to keep in context, what to delegate, and what to turn into code.

Related docs:

- [PRD](./prd.md)
- [`execute_typescript` spec](./execute-typescript-spec.md)
