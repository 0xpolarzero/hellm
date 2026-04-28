<script lang="ts">
  import { onMount } from "svelte";
  import type {
    StaticInspectorPaneTarget,
    WorkspaceWorkflowTaskAttemptInspector,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";

  type Props = {
    runtime: ChatRuntime;
    target: StaticInspectorPaneTarget;
  };

  let { runtime, target }: Props = $props();
  let title = $state("Inspector");
  let content = $state<unknown>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    error = null;
    try {
      if (target.surface === "command") {
        title = "Command";
        content = await runtime.getCommandInspector(target.commandId, target.workspaceSessionId);
      } else if (target.surface === "workflow-task-attempt") {
        title = "Task Agent";
        content = await runtime.getWorkflowTaskAttemptInspector(
          target.workflowTaskAttemptId,
          target.workspaceSessionId,
        );
      } else if (target.surface === "artifact") {
        title = "Artifact";
        content = await runtime.getArtifactPreview(target.artifactId, target.workspaceSessionId);
      } else {
        title = "Project CI Check";
        const status = await runtime.getProjectCiStatus(target.workspaceSessionId);
        content =
          status.latestRun?.checks.find((check) => check.checkResultId === target.checkResultId) ??
          { checkResultId: target.checkResultId, message: "Project CI check was not found." };
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Unable to load inspector.";
    }
  }

  function formatContent(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  function isWorkflowTaskAttemptInspector(
    value: unknown,
  ): value is WorkspaceWorkflowTaskAttemptInspector {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      "workflowTaskAttemptId" in value &&
      "contextBudget" in value
    );
  }
</script>

<section class="related-inspector-pane" aria-label={title}>
  <header>
    <p>Related Surface</p>
    <h3>{title}</h3>
  </header>
  {#if error}
    <p class="related-inspector-error">{error}</p>
  {:else if isWorkflowTaskAttemptInspector(content)}
    <div class="task-agent-summary">
      <div class="task-agent-summary-row">
        <span>Status</span>
        <strong>{content.status}</strong>
      </div>
      <div class="task-agent-summary-row">
        <span>Model</span>
        <strong>{content.agentModel ?? "Unknown"}</strong>
      </div>
      <ContextBudgetBar budget={content.contextBudget} label="Context" />
    </div>
    <pre>{formatContent(content)}</pre>
  {:else}
    <pre>{formatContent(content)}</pre>
  {/if}
</section>

<style>
  .related-inspector-pane {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    height: 100%;
    background: var(--surface);
    color: var(--text);
  }

  header {
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 1rem;
  }

  header p {
    margin: 0 0 0.2rem;
    color: var(--text-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  header h3 {
    margin: 0;
    font-size: 1rem;
  }

  pre {
    margin: 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.78rem;
  }

  .task-agent-summary {
    display: grid;
    gap: 0.65rem;
    padding: 0.78rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .task-agent-summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
    font-size: 0.76rem;
  }

  .task-agent-summary-row span {
    color: var(--text-muted);
  }

  .task-agent-summary-row strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .related-inspector-error {
    margin: 1rem;
    color: var(--danger);
  }
</style>
