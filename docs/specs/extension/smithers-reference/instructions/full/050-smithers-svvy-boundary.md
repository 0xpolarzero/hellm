# Smithers In Svvy

Work in the workspace `.smithers/` package when authoring or running Smithers workflows.

Use official Smithers CLI commands through Shell. Do not look for svvy workflow wrapper tools.

Reusable svvy workflow material is imported from `@svvy/workflows`:

```ts
import { Agents, Components, Prompts, Workflows } from "@svvy/workflows";
```

Use `svvyx workflows models list --json` when choosing provider, model, and reasoning values for
reusable task-agent parameters.

Use `svvyx workflows save --from <path> --kind agent|prompt|component|workflow --as <exportName>
--json` when saving reusable material to the app-global Workflows source library.

Use `svvyx workflows build --json` after editing Workflows source directly.

Generated Workflows output and `.smithers/node_modules/@svvy/workflows` are read-only package
plumbing. Edit source and rebuild instead.
