<script lang="ts">
  import { onMount } from "svelte";
  import type {
    WorkspaceArtifactPreview,
    WorkspaceCommandInspector,
    WorkspaceProjectCiCheckSummary,
    StaticInspectorPaneTarget,
    WorkspaceWorkflowTaskAttemptInspector,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import { getCommandInspectorSections, getWorkspaceCommandStatusPresentation } from "./command-inspector";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";
  import Badge from "./ui/Badge.svelte";

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

  function isCommandInspector(value: unknown): value is WorkspaceCommandInspector {
    return Boolean(value) && typeof value === "object" && "commandId" in value && "toolName" in value;
  }

  function isArtifactPreview(value: unknown): value is WorkspaceArtifactPreview {
    return Boolean(value) && typeof value === "object" && "artifactId" in value && "missingFile" in value;
  }

  function isProjectCiCheck(value: unknown): value is WorkspaceProjectCiCheckSummary {
    return Boolean(value) && typeof value === "object" && "checkResultId" in value && "checkId" in value;
  }

  function commandTone(status: WorkspaceCommandInspector["status"]) {
    return getWorkspaceCommandStatusPresentation(status).tone;
  }

  function commandLabel(status: WorkspaceCommandInspector["status"]) {
    return getWorkspaceCommandStatusPresentation(status).label;
  }

  function artifactPreviewMode(artifact: WorkspaceArtifactPreview): "metadata" | "text" {
    if (artifact.missingFile || artifact.kind === "file") return "metadata";
    return "text";
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
  {:else if isCommandInspector(content)}
    <article class="inspector-summary">
      <div>
        <strong>{content.title}</strong>
        <p>{content.summary}</p>
      </div>
      <Badge tone={commandTone(content.status)}>{commandLabel(content.status)}</Badge>
    </article>
    <div class="metadata-grid">
      <span>Tool</span>
      <code>{content.toolName}</code>
      <span>Updated</span>
      <code>{content.updatedAt}</code>
      {#if content.workflowRunId}
        <span>Workflow</span>
        <code>{content.workflowRunId}</code>
      {/if}
      {#if content.workflowTaskAttemptId}
        <span>Task attempt</span>
        <code>{content.workflowTaskAttemptId}</code>
      {/if}
    </div>
    {#if content.error}
      <p class="callout danger">{content.error}</p>
    {/if}
    {#if content.artifacts.length > 0}
      <section class="inspector-section">
        <h4>Artifacts</h4>
        {#each content.artifacts as artifact (artifact.artifactId)}
          <div class="artifact-row">
            <div>
              <strong>{artifact.name}</strong>
              <span>{artifact.kind}{artifact.path ? ` · ${artifact.path}` : ""}</span>
            </div>
            {#if artifact.missingFile}<Badge tone="warning">missing</Badge>{/if}
          </div>
        {/each}
      </section>
    {/if}
    {#each getCommandInspectorSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        {#each section.children as child (child.commandId)}
          <article class="child-row">
            <div>
              <strong>{child.title}</strong>
              <span>{child.toolName}</span>
            </div>
            <Badge tone={commandTone(child.status)}>{commandLabel(child.status)}</Badge>
          </article>
        {/each}
      </section>
    {/each}
    {#if content.facts}
      <section class="inspector-section">
        <h4>Raw Detail</h4>
        <pre>{formatContent(content.facts)}</pre>
      </section>
    {/if}
  {:else if isArtifactPreview(content)}
    <article class="inspector-summary">
      <div>
        <strong>{content.name}</strong>
        <p>{content.path ?? content.artifactId}</p>
      </div>
      <Badge tone={content.missingFile ? "warning" : "info"}>{content.kind}</Badge>
    </article>
    <div class="metadata-grid">
      <span>Created</span>
      <code>{content.createdAt}</code>
      {#if content.workflowName}
        <span>Workflow</span>
        <code>{content.workflowName}</code>
      {/if}
      {#if content.producerLabel}
        <span>Producer</span>
        <code>{content.producerLabel}</code>
      {/if}
    </div>
    {#if content.missingFile}
      <p class="callout warning">The artifact record exists, but the backing file is not available.</p>
    {:else if artifactPreviewMode(content) === "text"}
      <section class="inspector-section">
        <h4>Preview</h4>
        <pre>{content.content}</pre>
      </section>
    {:else}
      <section class="inspector-section">
        <h4>Metadata</h4>
        <pre>{formatContent(content)}</pre>
      </section>
    {/if}
  {:else if isProjectCiCheck(content)}
    <article class="inspector-summary">
      <div>
        <strong>{content.label}</strong>
        <p>{content.summary}</p>
      </div>
      <Badge tone={content.status === "passed" ? "success" : content.status === "failed" ? "danger" : "warning"}>
        {content.status}
      </Badge>
    </article>
    <div class="metadata-grid">
      <span>Kind</span>
      <code>{content.kind}</code>
      <span>Required</span>
      <code>{content.required ? "yes" : "no"}</code>
      {#if content.command}
        <span>Command</span>
        <code>{content.command.join(" ")}</code>
      {/if}
    </div>
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

  .inspector-summary,
  .artifact-row,
  .child-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    min-width: 0;
    margin: 0.78rem 1rem 0;
    padding: 0.72rem 0.76rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 76%, transparent);
  }

  .inspector-summary div,
  .artifact-row div,
  .child-row div {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .inspector-summary strong,
  .artifact-row strong,
  .child-row strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ui-text-primary);
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .inspector-summary p,
  .artifact-row span,
  .child-row span {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--ui-text-secondary);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .metadata-grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.34rem 0.65rem;
    margin: 0.78rem 1rem 0;
    padding: 0.64rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
    font-size: 0.7rem;
  }

  .metadata-grid span {
    color: var(--ui-text-secondary);
  }

  .metadata-grid code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .inspector-section {
    display: grid;
    gap: 0.48rem;
    margin: 0.78rem 1rem 0;
  }

  .inspector-section h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.64rem;
    text-transform: uppercase;
  }

  .inspector-section pre {
    padding: 0.75rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
    font-size: 0.72rem;
  }

  .artifact-row,
  .child-row {
    margin: 0;
  }

  .callout {
    margin: 0.78rem 1rem 0;
    padding: 0.66rem 0.72rem;
    border-radius: var(--ui-radius-sm);
    font-size: 0.72rem;
    line-height: 1.5;
  }

  .callout.warning {
    border: 1px solid color-mix(in oklab, var(--ui-warning) 34%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-warning-soft) 62%, var(--ui-surface));
    color: color-mix(in oklab, var(--ui-warning) 86%, var(--ui-text-primary));
  }

  .callout.danger {
    border: 1px solid color-mix(in oklab, var(--ui-danger) 34%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-danger-soft) 62%, var(--ui-surface));
    color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
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
