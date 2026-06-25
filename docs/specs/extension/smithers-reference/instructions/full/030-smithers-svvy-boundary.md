# Smithers In Svvy

Work in the workspace `.smithers/` package when authoring or running Smithers workflows.

Use official `bunx smithers-orchestrator ...` commands through Shell for workflow initialization,
execution, resume, inspection, approval, and debugging flows. Use `bunx smithers-orchestrator init`,
`bunx smithers-orchestrator workflow run`, `bunx smithers-orchestrator ps`, and
`bunx smithers-orchestrator inspect` as ordinary shell commands when Smithers work is the right unit.

Use `svvyx workflows ...` only for reusable source-library operations owned by the Workflows
extension.

Reusable svvy workflow assets are Workflows-extension material imported from generated
`@svvyx/workflows` package exports. Runtime task-agent handoff is only the narrow generated
`runTaskAgent` bridge.
