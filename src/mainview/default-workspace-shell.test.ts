import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("default workspace renderer shell", () => {
  it("renders the Open Workspace surface as a workbench panel", async () => {
    const panelSource = await readFile(
      new URL("./OpenWorkspacePanel.svelte", import.meta.url),
      "utf8",
    );
    const dockviewHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("Open Workspace");
    expect(panelSource).toContain("Choose a local repository or folder to work in.");
    expect(panelSource).toContain("Open in New Tab");
    expect(dockviewHostSource).toContain("OpenWorkspacePanel");
    expect(dockviewHostSource).toContain('surface === "open-workspace"');
  });

  it("does not keep the removed standalone no-workspace picker page", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).not.toContain('class="workspace-picker"');
    expect(appSource).not.toContain("workspace-picker-button");
    expect(appSource).not.toContain("No workspace is open.");
    expect(appSource).toContain("activeWorkspaceTabId");
    expect(appSource).toContain("workspaceTabId");
  });

  it("uses the initially opened user workspace before falling back to the default workspace", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).toContain("const openWorkspaces = await rpc.request.getOpenWorkspaces();");
    expect(appSource).toContain('openWorkspaces.find((workspace) => workspace.kind === "user")');
    expect(appSource).toContain("await rpc.request.getDefaultWorkspace()");
  });

  it("routes workspace opening commands to current-tab and new-tab flows", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('placement: "current-tab"');
    expect(appSource).toContain('placement: "new-tab"');
    expect(appSource).toContain("createDefaultWorkspaceTab");
    expect(workspaceSource).toContain('workspaceAction === "open"');
    expect(workspaceSource).toContain('workspaceAction === "new-tab"');
    expect(workspaceSource).toContain('workspaceAction === "open-in-new-tab"');
  });

  it("renders a static workspace footer when the workspace is not a git repo", async () => {
    const sidebarSource = await readFile(
      new URL("./SessionSidebar.svelte", import.meta.url),
      "utf8",
    );

    expect(sidebarSource).toContain("{#if branchControlEnabled}");
    expect(sidebarSource).toContain('<Tooltip label="Switch branch">');
    expect(sidebarSource).toContain('class="workspace-path-static"');
    expect(sidebarSource).toContain('aria-label="Workspace"');
    expect(sidebarSource).not.toContain('label={footerShowsBranch ? "Switch branch"');
    expect(sidebarSource).not.toContain("showCaret");
  });

  it("refreshes existing Dockview panel content when a pane changes surface", async () => {
    const dockviewSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewSource).toContain("getPanelRenderKey");
    expect(dockviewSource).toContain("existingPanel.update");
    expect(dockviewSource).toContain("existingPanel.setRenderer");
  });

  it("remounts workspace shell state for each active workspace tab", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain(
      "{#key `${activeTab.workspace.workspaceTabId}:${activeTab.workspace.workspaceId}`}",
    );
    expect(panelHostSource).not.toContain("Surface unavailable");
  });

  it("tracks prompt freshness banner state through Svelte state", async () => {
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(panelHostSource).toContain(
      'let promptBinding = $state<ChatSurfaceController["promptBinding"]>(undefined);',
    );
    expect(panelHostSource).toContain("promptBinding = controller.promptBinding;");
    expect(panelHostSource).toContain("{#if promptBinding?.stale}");
    expect(panelHostSource).not.toContain("{#if controller.promptBinding?.stale}");
  });

  it("wires Dockview transcripts to semantic blocks and structured actions", async () => {
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(panelHostSource).toContain("buildTranscriptSemanticBlocks");
    expect(panelHostSource).toContain("semanticBlocks={transcriptSemanticBlocks}");
    expect(panelHostSource).toContain("{workspaceMentionPaths}");
    expect(panelHostSource).not.toContain("workspaceMentionPaths={new Set()}");
    expect(panelHostSource).toContain("onInspectCommand={inspectCommandFromTranscript}");
    expect(panelHostSource).toContain("onOpenHandlerThread={openHandlerThreadFromTranscript}");
    expect(panelHostSource).toContain("onInspectWorkflow={inspectWorkflowFromTranscript}");
    expect(panelHostSource).toContain(
      "onInspectWorkflowTaskAttempt={inspectWorkflowTaskAttemptFromTranscript}",
    );
    expect(panelHostSource).toContain("onReplyToWait=");
    expect(panelHostSource).toContain("onRetryFailure=");
  });

  it("renders the live streaming assistant inside virtualized transcript rows", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const virtualListStart = transcriptSource.indexOf("{#each virtualRows as virtualRow");
    const virtualListEnd = transcriptSource.indexOf(
      '{:else if row?.kind === "message" && row.message.role === "toolResult"}',
      virtualListStart,
    );
    const streamingRowStart = transcriptSource.indexOf(
      'class="message-row virtual-row assistant-row streaming-row"',
    );

    expect(virtualListStart).toBeGreaterThanOrEqual(0);
    expect(virtualListEnd).toBeGreaterThan(virtualListStart);
    expect(streamingRowStart).toBeGreaterThan(virtualListStart);
    expect(streamingRowStart).toBeLessThan(virtualListEnd);
    expect(transcriptSource).toContain('kind: "streaming"');
    expect(transcriptSource).toContain("streamingAssistant.timestamp");
    expect(transcriptSource).not.toContain("{#if streamingAssistant}");
    expect(transcriptSource).not.toContain("scrollTranscriptToBottom");
  });

  it("uses TanStack end anchoring and a translated virtual block for transcript scrolling", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain('anchorTo: "end"');
    expect(transcriptSource).toContain(
      "scrollEndThreshold: TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX",
    );
    expect(transcriptSource).toContain("followOnAppend: transcriptFollowBehavior()");
    expect(transcriptSource).toContain("$transcriptVirtualizer.scrollToEnd");
    expect(transcriptSource).toContain("getVirtualItemForOffset(scroller.scrollTop)");
    expect(transcriptSource).toContain('class="chat-thread-virtual-block"');
    expect(transcriptSource).toContain(
      "style={`transform: translate3d(0, ${firstVirtualRowStart}px, 0); gap: ${transcriptRowGap}px;`}",
    );
    expect(transcriptSource).not.toContain("${virtualRow.start}px");
    expect(transcriptSource).not.toContain("requestAnimationFrame");
  });

  it("renders a stop control instead of the send button while a surface is streaming", async () => {
    const composerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(composerSource).toContain("{#if isStreaming}");
    expect(composerSource).toContain('aria-label="Stop agent"');
    expect(composerSource).toContain("onclick={() => void stopStreaming()}");
    expect(composerSource).not.toContain('isStreaming ? "Queue message" : "Send message"');
    expect(panelHostSource).toContain("async function stopAgent()");
    expect(panelHostSource).toContain("await controller.abort();");
    expect(panelHostSource).toContain("onStop={stopAgent}");
  });

  it("keeps non-empty transcript rows visible when virtualizer total size is temporarily zero", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain("const estimatedTranscriptSize = $derived.by");
    expect(transcriptSource).toContain(
      "totalTranscriptSize > 0 ? totalTranscriptSize : estimatedTranscriptSize",
    );
    expect(transcriptSource).toContain("style={`height: ${transcriptVirtualHeight}px;`}");
    expect(transcriptSource).not.toContain("style={`height: ${totalTranscriptSize}px;`}");
  });

  it("does not structuredClone Svelte attachment state in the composer", async () => {
    const composerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );

    expect(composerSource).toContain("function cloneComposerAttachments");
    expect(composerSource).toContain("cloneComposerAttachments(attachments)");
    expect(composerSource).not.toContain("structuredClone(attachments)");
    expect(composerSource).not.toContain("structuredClone(composerDraft.attachments)");
  });

  it("does not structuredClone Svelte settings state in the settings dialog", async () => {
    const settingsSource = await readFile(new URL("./Settings.svelte", import.meta.url), "utf8");

    expect(settingsSource).toContain("function serializeAppPreferences");
    expect(settingsSource).not.toContain("Workflow Agents");
    expect(settingsSource).not.toContain("function serializeWorkflowAgentSettings");
    expect(settingsSource).not.toContain("structuredClone(");
  });

  it("does not keep focus-global artifact or inspector surfaces in the workspace shell", async () => {
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(workspaceSource).not.toContain("showArtifactsPanel");
    expect(workspaceSource).not.toContain("showCommandInspector");
    expect(workspaceSource).not.toContain("showThreadInspector");
    expect(workspaceSource).not.toContain("showWorkflowTaskAttemptInspector");
    expect(workspaceSource).not.toContain("setPaneInspectorSelection");
    expect(workspaceSource).not.toContain("<ArtifactsPanel");
    expect(workspaceSource).toContain("runtime.openSurface");
  });

  it("mutes layout slot controls for the default workspace", async () => {
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(runtimeSource).toContain(
      'const durableLayoutEnabled = workspaceInfo.kind !== "default"',
    );
    expect(runtimeSource).toContain("get layoutSlotsEnabled()");
    expect(workspaceSource).toContain("disabled={!layoutSlotsEnabled}");
    expect(workspaceSource).toContain("Layout slots are unavailable in the default workspace");
  });
});
