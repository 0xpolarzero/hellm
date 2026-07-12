<script lang="ts">
  import type {
    WorkspaceArtifactPreview,
    WorkspaceCommandInspector,
    StaticInspectorPaneTarget,
    WorkspaceWorkflowTaskAttemptInspector,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import {
    getCommandArgumentSections,
    getCommandDiagnosticSections,
    getCommandInspectorSections,
    getCommandOutputSections,
    getCommandPatchSections,
    getCommandProgressSections,
    getCommandStdinOutcomeMessage,
    getCommandStdinSection,
    getWorkspaceCommandStatusPresentation,
    canWriteCommandStdin,
  } from "./command-inspector";
  import CommandOutputPanel from "./CommandOutputPanel.svelte";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import TextArea from "./ui/TextArea.svelte";

  type Props = {
    runtime: ChatRuntime;
    target: StaticInspectorPaneTarget;
  };

  let { runtime, target }: Props = $props();
  let title = $state("Inspector");
  let content = $state<unknown>(null);
  let error = $state<string | null>(null);
  let stdinDraft = $state("");
  let stdinSubmitting = $state(false);
  let stdinOutcome = $state<string | null>(null);
  let loadRevision = 0;

  $effect(() => {
    const activeRuntime = runtime;
    const activeTarget = target;
    const revision = ++loadRevision;
    content = null;
    error = null;
    stdinDraft = "";
    stdinSubmitting = false;
    stdinOutcome = null;
    title =
      activeTarget.surface === "command"
        ? "Command"
        : activeTarget.surface === "workflow-task-attempt"
          ? "Workflow Task-Agent"
          : "Artifact";
    const refresh = () => void load(activeRuntime, activeTarget, revision);
    const unsubscribe =
      activeTarget.surface === "command" || activeTarget.surface === "workflow-task-attempt"
        ? activeRuntime.subscribe(refresh)
        : undefined;
    refresh();
    return () => {
      loadRevision += 1;
      unsubscribe?.();
    };
  });

  async function load(
    activeRuntime: ChatRuntime,
    activeTarget: StaticInspectorPaneTarget,
    revision: number,
  ): Promise<void> {
    error = null;
    try {
      let nextContent: unknown = null;
      if (activeTarget.surface === "command") {
        nextContent = await activeRuntime.getCommandInspector(
          activeTarget.commandId,
          activeTarget.workspaceSessionId,
        );
      } else if (activeTarget.surface === "workflow-task-attempt") {
        nextContent = await activeRuntime.getWorkflowTaskAttemptInspector(
          activeTarget.workflowTaskAttemptId,
          activeTarget.workspaceSessionId,
        );
      } else if (activeTarget.surface === "artifact") {
        nextContent = await activeRuntime.getArtifactPreview(
          activeTarget.artifactId,
          activeTarget.workspaceSessionId,
        );
      }
      if (revision === loadRevision) content = nextContent;
    } catch (caught) {
      if (revision === loadRevision) {
        error = caught instanceof Error ? caught.message : "Unable to load inspector.";
      }
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

  function commandTone(status: WorkspaceCommandInspector["status"]) {
    return getWorkspaceCommandStatusPresentation(status).tone;
  }

  function commandLabel(status: WorkspaceCommandInspector["status"]) {
    return getWorkspaceCommandStatusPresentation(status).label;
  }

  async function submitCommandStdin(inspector: WorkspaceCommandInspector): Promise<void> {
    const text = stdinDraft;
    if (!text.trim() || stdinSubmitting || !canWriteCommandStdin(inspector)) return;

    const activeRuntime = runtime;
    const revision = loadRevision;
    stdinSubmitting = true;
    stdinOutcome = null;
    try {
      const response = await activeRuntime.writeCommandStdin({
        commandId: inspector.commandId,
        text,
        clientSubmission: { source: "command_inspector" },
      });
      if (revision !== loadRevision) return;
      stdinOutcome = getCommandStdinOutcomeMessage(response);
      if (response.status === "accepted") stdinDraft = "";
    } catch (caught) {
      if (revision === loadRevision) {
        stdinOutcome =
          caught instanceof Error ? caught.message : "Unable to write to command stdin.";
      }
    } finally {
      if (revision === loadRevision) stdinSubmitting = false;
    }
  }

  function childProgressSummary(child: WorkspaceCommandInspector["summaryChildren"][number]): string | null {
    const latest = child.progressEvents?.at(-1);
    if (!latest) {
      return null;
    }
    const detail = latest.message || [latest.family, latest.command].filter(Boolean).join(" · ");
    return [latest.phase ? `[${latest.phase}]` : "[progress]", detail].filter(Boolean).join(" ");
  }

  function artifactPreviewMode(artifact: WorkspaceArtifactPreview): "html" | "metadata" | "text" {
    if (artifact.missingFile || artifact.kind === "file") return "metadata";
    const filename = (artifact.path ?? artifact.name).toLowerCase();
    if (filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
    return "text";
  }

  function isDiffArtifact(artifact: WorkspaceArtifactPreview): boolean {
    const filename = (artifact.path ?? artifact.name).toLowerCase();
    return filename.endsWith(".diff") || filename.endsWith(".patch");
  }

  function diffLineClass(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "diff-line diff-file";
    if (line.startsWith("@@")) return "diff-line diff-hunk";
    if (line.startsWith("+")) return "diff-line diff-add";
    if (line.startsWith("-")) return "diff-line diff-remove";
    return "diff-line";
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
    {@const stdinSection = getCommandStdinSection(content)}
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
      <span>Started</span>
      <code>{content.startedAt}</code>
      <span>Updated</span>
      <code>{content.updatedAt}</code>
      <span>Finished</span>
      <code>{content.finishedAt ?? "Still running"}</code>
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
    {#if content.stdin.mode === "continuable"}
      <section class="inspector-section command-stdin-composer">
        <h4>Stdin</h4>
        <TextArea
          bind:value={stdinDraft}
          resize="vertical"
          rows={3}
          placeholder="Send input to the running command"
          aria-label="Command stdin"
          disabled={!canWriteCommandStdin(content) || stdinSubmitting}
        />
        <div class="command-stdin-actions">
          <span>{canWriteCommandStdin(content) ? "Command accepts input" : "Command stdin is unavailable"}</span>
          <Button
            size="sm"
            variant="primary"
            loading={stdinSubmitting}
            disabled={!stdinDraft.trim() || stdinSubmitting || !canWriteCommandStdin(content)}
            onclick={() => void submitCommandStdin(content)}
          >Send stdin</Button>
        </div>
        <p
          class="command-stdin-outcome"
          class:has-outcome={stdinOutcome !== null}
          aria-live="polite"
          aria-atomic="true"
        >{stdinOutcome ?? "\u00a0"}</p>
      </section>
    {/if}
    {#if stdinSection}
      <section class="inspector-section">
        <h4>Accepted stdin</h4>
        <div class="command-stdin-events">
          {#each stdinSection.events as event (event.eventId)}
            <article class="command-stdin-event">
              <div>
                <span>{event.acceptedBytes} {event.acceptedBytes === 1 ? "byte" : "bytes"}</span>
                <time datetime={event.at}>{event.at}</time>
              </div>
              <pre>{event.text}</pre>
            </article>
          {/each}
        </div>
      </section>
    {/if}
    {#each getCommandArgumentSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        <div class="argument-snapshots">
          {#each section.snapshots as snapshot (snapshot.eventId)}
            <article class="argument-snapshot">
              <div>
                <span>{snapshot.source}</span>
                <time datetime={snapshot.at}>{snapshot.at}</time>
              </div>
              <pre>{formatContent(snapshot.arguments)}</pre>
            </article>
          {/each}
        </div>
      </section>
    {/each}
    {#each getCommandDiagnosticSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        <div class="command-diagnostics">
          {#each section.snapshots as snapshot (snapshot.eventId)}
            <article class="command-diagnostic-snapshot">
              <div>
                <span>{snapshot.source}{snapshot.stage ? ` · ${snapshot.stage}` : ""}</span>
                <time datetime={snapshot.at}>{snapshot.at}</time>
              </div>
              {#each snapshot.diagnostics as diagnostic, index (`${snapshot.eventId}:${index}`)}
                <p>
                  <strong>{diagnostic.severity ?? "diagnostic"}</strong>
                  <span>{diagnostic.message}</span>
                  {#if diagnostic.file}
                    <code>{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ""}{diagnostic.column ? `:${diagnostic.column}` : ""}</code>
                  {/if}
                </p>
              {/each}
            </article>
          {/each}
        </div>
      </section>
    {/each}
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
    {#each getCommandPatchSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        <div class="patch-snapshots">
          {#each section.snapshots as snapshot (snapshot.eventId)}
            <article class="patch-snapshot">
              <div>
                <span>{snapshot.source}</span>
                <time datetime={snapshot.at}>{snapshot.at}</time>
              </div>
              {#each snapshot.files as file (file.path)}
                <p>
                  <strong>{file.changeType}</strong>
                  <code>{file.path}</code>
                  <span>+{file.additions} / -{file.deletions}</span>
                </p>
              {/each}
            </article>
          {/each}
        </div>
      </section>
    {/each}
    {#each getCommandProgressSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        <div class="command-progress-events">
          {#each section.events as event (event.eventId)}
            <article class="command-progress-event">
              <div>
                <span>{event.source}{event.phase ? ` · ${event.phase}` : ""}</span>
                <time datetime={event.at}>{event.at}</time>
              </div>
              <p>
                {event.message || [event.family, event.command].filter(Boolean).join(" · ") || "Command progress"}
              </p>
              {#if event.progress !== undefined}
                <progress max="1" value={event.progress}></progress>
              {/if}
              {#if event.facts}
                <pre>{formatContent(event.facts)}</pre>
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/each}
    {#each getCommandOutputSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        <CommandOutputPanel
          title={section.title}
          events={section.events}
          tone={content.status === "failed" ? "danger" : content.status === "succeeded" ? "success" : "neutral"}
        />
      </section>
    {/each}
    {#each getCommandInspectorSections(content) as section (section.id)}
      <section class="inspector-section">
        <h4>{section.title}</h4>
        {#each section.children as child (child.commandId)}
          <article class="child-row">
            <div>
              <strong>{child.title}</strong>
              <span>{child.toolName}</span>
              {#if childProgressSummary(child)}
                <span class="child-progress">{childProgressSummary(child)}</span>
              {/if}
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
    {:else if isDiffArtifact(content)}
      <section class="inspector-section">
        <h4>Preview</h4>
        <div class="diff-viewer" aria-label={`Diff preview for ${content.name}`}>
          {#each content.content.split("\n") as line, index (`${index}:${line}`)}
            <div class={diffLineClass(line)}>
              <span class="diff-line-number">{index + 1}</span>
              <code>{line || " "}</code>
            </div>
          {/each}
        </div>
      </section>
    {:else if artifactPreviewMode(content) === "html"}
      <section class="inspector-section">
        <h4>Preview</h4>
        <iframe
          class="artifact-html-preview"
          title={`HTML preview for ${content.name}`}
          sandbox="allow-scripts"
          srcdoc={content.content}
        ></iframe>
      </section>
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
    overflow: auto;
    background: var(--ui-surface);
    color: var(--ui-text-primary);
  }

  header {
    position: sticky;
    top: 0;
    z-index: var(--ui-z-sticky);
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    padding: 0.58rem 0.78rem;
    background: color-mix(in oklab, var(--ui-surface-subtle) 88%, transparent);
  }

  header p {
    margin: 0 0 0.14rem;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.25;
  }

  pre {
    margin: 0;
    min-height: 0;
    overflow: auto;
    padding: 0.78rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.56;
  }

  .inspector-summary,
  .artifact-row,
  .child-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    min-width: 0;
    margin: 0.62rem 0.78rem 0;
    padding: 0.56rem 0.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-sm);
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
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .inspector-summary p,
  .artifact-row span,
  .child-row span {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .child-row .child-progress {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
  }

  .metadata-grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.34rem 0.65rem;
    margin: 0.62rem 0.78rem 0;
    padding: 0.56rem 0.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
    font-size: var(--text-xs);
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
    margin: 0.62rem 0.78rem 0;
  }

  .inspector-section h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .inspector-section pre {
    padding: 0.75rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
    font-size: var(--text-sm);
  }

  .command-progress-events {
    display: grid;
    gap: 0.44rem;
  }

  .command-stdin-composer :global(.ui-textarea) {
    min-height: 4.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .command-stdin-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .command-stdin-outcome {
    min-height: 1lh;
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    opacity: 0;
  }

  .command-stdin-outcome.has-outcome {
    opacity: 1;
  }

  .command-stdin-events {
    display: grid;
    gap: 0.44rem;
  }

  .command-stdin-event {
    display: grid;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
  }

  .command-stdin-event > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.34rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .command-stdin-event pre {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .command-diagnostics {
    display: grid;
    gap: 0.44rem;
  }

  .command-diagnostic-snapshot {
    display: grid;
    gap: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-warning) 30%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
  }

  .command-diagnostic-snapshot > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.34rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .command-diagnostic-snapshot > div span,
  .command-diagnostic-snapshot > div time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-diagnostic-snapshot p {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.55rem;
    align-items: start;
    min-width: 0;
    margin: 0;
    padding: 0.42rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 38%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
  }

  .command-diagnostic-snapshot p:last-child {
    border-bottom: 0;
  }

  .command-diagnostic-snapshot code {
    grid-column: 2;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .patch-snapshots {
    display: grid;
    gap: 0.44rem;
  }

  .argument-snapshots {
    display: grid;
    gap: 0.44rem;
  }

  .argument-snapshot {
    display: grid;
    gap: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
  }

  .argument-snapshot > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.34rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .argument-snapshot > div span,
  .argument-snapshot > div time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .argument-snapshot pre {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .patch-snapshot {
    display: grid;
    gap: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
  }

  .patch-snapshot > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.34rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .patch-snapshot p {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) auto;
    gap: 0.55rem;
    align-items: center;
    min-width: 0;
    margin: 0;
    padding: 0.42rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 38%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
  }

  .patch-snapshot p:last-child {
    border-bottom: 0;
  }

  .patch-snapshot code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .command-progress-event {
    display: grid;
    gap: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-accent) 28%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
  }

  .command-progress-event > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.34rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .command-progress-event > div span,
  .command-progress-event > div time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-progress-event p {
    margin: 0;
    padding: 0.58rem 0.65rem;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
  }

  .command-progress-event progress {
    width: calc(100% - 1.3rem);
    margin: 0 0.65rem 0.58rem;
  }

  .command-progress-event pre {
    border: 0;
    border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    border-radius: 0;
    background: transparent;
  }

  .diff-viewer {
    min-height: 0;
    max-height: 24rem;
    overflow: auto;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.55;
  }

  .artifact-html-preview {
    width: 100%;
    min-height: 24rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
  }

  .diff-line {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr);
    min-width: max-content;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 38%, transparent);
    color: var(--ui-text-secondary);
  }

  .diff-line:last-child {
    border-bottom: 0;
  }

  .diff-line-number {
    padding: 0.08rem 0.58rem;
    border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 62%, transparent);
    color: var(--ui-text-tertiary);
    text-align: right;
    user-select: none;
  }

  .diff-line code {
    padding: 0.08rem 0.62rem;
    color: inherit;
    font-family: inherit;
    white-space: pre;
  }

  .diff-hunk {
    background: color-mix(in oklab, var(--ui-info-soft) 70%, transparent);
    color: color-mix(in oklab, var(--ui-info) 82%, var(--ui-text-primary));
  }

  .diff-file {
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
    color: var(--ui-text-primary);
  }

  .diff-add {
    background: color-mix(in oklab, var(--ui-success-soft) 68%, transparent);
    color: color-mix(in oklab, var(--ui-success) 82%, var(--ui-text-primary));
  }

  .diff-remove {
    background: color-mix(in oklab, var(--ui-danger-soft) 68%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .artifact-row,
  .child-row {
    margin: 0;
  }

  .callout {
    margin: 0.62rem 0.78rem 0;
    padding: 0.58rem 0.64rem;
    border-radius: var(--ui-radius-sm);
    font-size: var(--text-sm);
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
    gap: 0.55rem;
    padding: 0.62rem 0.78rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
  }

  .task-agent-summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
    font-size: var(--text-sm);
  }

  .task-agent-summary-row span {
    color: var(--ui-text-secondary);
  }

  .task-agent-summary-row strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .related-inspector-error {
    margin: 0.78rem;
    color: var(--ui-danger);
  }
</style>
