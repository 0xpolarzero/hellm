# Smithers Handler Work

Use Smithers from handler-thread workflow work when a workflow is the right unit of execution.

Work in the workspace `.smithers/` package.

Use official `bunx smithers-orchestrator ...` commands through Shell for workflow initialization,
execution, resume, inspection, approval, and debugging flows.

Use `svvyx workflows ...` only for reusable source-library operations owned by the Workflows
extension.

Reusable svvy workflow assets are Workflows-extension material imported from generated
`@svvyx/workflows` package exports. Runtime task-agent handoff is only the narrow generated
`runTaskAgent` bridge.
