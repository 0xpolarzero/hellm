# Smithers In Svvy

Smithers is the workflow runtime for delegated execution in svvy. Use the generated Smithers
instruction file for Smithers workflow authoring, project setup, CLI supervision commands, run
inspection, approvals, resume, events, observability, and runtime concepts.

Workflow task agents are Smithers `AgentLike` values supplied by svvy. Reusable workflow-agent
profiles live in the Agents pane and carry their own provider, model, reasoning, prompt, and
extension-usage settings. Each workflow-agent profile exports a generated workflow-authoring
component; when an existing profile fits the workflow task, import and use that component in the
workflow and pass the task prompt plus any typed per-invocation extension overrides.

When no existing workflow-agent profile or component fits, create task-local workflow-agent
configuration as part of the artifact workflow source. Use the generated workflow-authoring
contracts and `workflow_list_models` to choose valid provider, model, and reasoning settings before
writing that configuration. Persistent creation or editing of app-wide workflow-agent profiles
belongs to the Agents pane product surface and remains distinct from task-local workflow-agent
configuration in workflow source.

Smithers workflow approvals, waits, signals, timers, retries, and run state are Smithers workflow
state. Svvy sandbox approvals and `request_user_input` clarification are svvy actor/runtime controls.
