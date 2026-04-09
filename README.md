# hellm

`hellm` is a pi-first, context-disciplined coding harness that extends pi's interactive shell instead of replacing it.

The core idea is simple: context is the scarce resource. The main orchestrator should keep strategic context and decision authority, bounded work should be pushed into short-lived workflows or workers, useful outputs should be compressed into episodes and artifacts, and repeatable or compositional work should be externalized into code when that is more efficient than another long tool loop.

The interactive contract is non-negotiable: pi owns the terminal loop, `hellm` loads into that shell through pi's extension/runtime seam, and any snapshot-only or stdout-only path is a helper for tests or automation, not the product shell.

In practice, that means `hellm` interleaves agentic reasoning and scripting instead of forcing everything through one transcript or one rigid workflow system. It uses:

- one orchestrator to preserve high-level context
- Smithers workflows for bounded delegated work
- episodes to reuse outcomes without dragging full transcripts forward
- `execute_typescript` to let the model write short typed programs when that is the better execution mode

Start with [docs/context-discipline.md](docs/context-discipline.md) for the concise design note, then read [docs/prd.md](docs/prd.md) for the source-of-truth product spec.

## Commands

- `bun install`
- `bun run dev`
