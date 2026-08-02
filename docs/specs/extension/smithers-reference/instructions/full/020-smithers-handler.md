# Smithers Handler Work

Use Smithers from handler-thread workflow work when a workflow is the right unit of execution.

Work in the workspace `.smithers/` package.

Use official `bunx smthrs ...` commands through Shell for workflow initialization,
execution, resume, inspection, approval, and debugging flows.

Use `svvyx workflows ...` only for reusable source-library operations owned by the Workflows
extension.

Reusable svvy workflow assets are Workflows-extension material imported from generated
`@svvyx/workflows` package exports. Smithers `.smithers/agents/**` files are workspace-local
Smithers configuration, not svvy reusable task-agent parameter storage. Svvy reusable task-agent
parameters come from generated `@svvyx/workflows` `Agents.*` exports. Smithers task-agent handoff
happens only by using generated `@svvyx/workflows` helpers such as `Agents.defineTaskAgent(...)` in
Smithers workflow source.

Do not use `workflow.*`, `svvyx smithers`, Smithers runtime-control APIs, loopback runtime-control
tools, direct task-agent bridge calls, bridge payload construction, or broad bridge helpers.
Smithers workflow code may use generated `@svvyx/workflows` task-agent helpers; all runtime handoff
plumbing behind those helpers is internal to svvy and exposes only task-agent handoff.

Do not use package-level runtime creation or per-request Effect layer graphs.
