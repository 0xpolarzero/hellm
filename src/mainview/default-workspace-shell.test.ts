import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
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

  it("restores saved workspace tabs by visual tab id and falls back failed restores to default tabs", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).toContain(
      "const tabsToRestore = restoreState?.tabs.length ? restoreState.tabs : [];",
    );
    expect(appSource).toContain('savedTab.kind === "default"');
    expect(appSource).toContain("await rpc.request.getDefaultWorkspace()");
    expect(appSource).toContain(
      "await rpc.request.openWorkspace({ cwd: savedTab.cwd, workspaceTabId: savedTab.workspaceTabId })",
    );
    expect(appSource).toContain(
      "toWorkspaceTabInfo(workspaceInfo, savedTab.openedAt, savedTab.workspaceTabId)",
    );
    expect(appSource).toContain(
      "toWorkspaceTabInfo(fallback, savedTab.openedAt, savedTab.workspaceTabId)",
    );
    expect(appSource).toContain("let restoreErrorsByWorkspaceTabId = $state");
    expect(appSource).toContain('if (savedTab.kind === "default") throw error;');
    expect(appSource).toContain('throw new Error("Workspace did not resolve.");');
    expect(appSource).toContain("[savedTab.workspaceTabId]: `Unable to restore");
    expect(appSource).toContain("openWorkspaceError={activeOpenWorkspaceError}");
    expect(appSource).toContain("restoreState?.activeWorkspaceTabId");
    expect(appSource).toContain(
      "tabsToRestore.findIndex((tab) => tab.workspaceTabId === restoreState.activeWorkspaceTabId)",
    );
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

  it("keeps Open Workspace RPC placement visual-only while Bun resolves the runtime", async () => {
    const contractSource = await readFile(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const bunSource = await readFile(new URL("../bun/index.ts", import.meta.url), "utf8");

    expect(contractSource).toContain(
      'export type OpenWorkspacePlacement = "current-tab" | "new-tab";',
    );
    expect(contractSource).toContain("export interface OpenWorkspaceRequest");
    expect(contractSource).toContain("cwd?: string;");
    expect(contractSource).toContain("workspaceTabId?: string;");
    expect(contractSource).toContain("placement?: OpenWorkspacePlacement;");
    expect(appSource).toContain('await rpc.request.openWorkspace({ placement: "current-tab" })');
    expect(appSource).toContain('await rpc.request.openWorkspace({ placement: "new-tab" })');
    expect(bunSource).toContain("openWorkspace: async (input: OpenWorkspaceRequest = {})");
    expect(bunSource).toContain("const { cwd } = input;");
    expect(bunSource).toContain(
      "const runtime = workspaceRuntimeRegistry.acquireWorkspace(selectedCwd);",
    );
  });

  it("retargets Open Workspace into the current visual tab without cancelling prior running work", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).toContain(
      'const tab = await createWorkspaceTab(workspaceForTab, placement === "current-tab" ? activeWorkspaceTabId ?? undefined : undefined);',
    );
    expect(appSource).toContain(
      "const { [tab.workspace.workspaceTabId]: _clearedRestoreError, ...remainingRestoreErrors }",
    );
    expect(appSource).toContain(
      "candidate.workspace.workspaceTabId === activeWorkspaceTabId ? tab : candidate",
    );
    expect(appSource).toContain("if (oldTab) releaseVisualWorkspaceTab(oldTab);");
    expect(appSource).toContain("function retainDetachedWorkspaceRuntime");
    expect(appSource).toContain("tab.counts.running > 0");
    expect(appSource).toContain("!hasVisibleWorkspaceReference(tab.workspace.workspaceId)");
    expect(appSource).toContain("releaseDetachedWorkspaceRuntime(tab.workspace.workspaceId)");
    expect(appSource).toContain("await setActiveWorkspace(tab.workspace.workspaceTabId);");
  });

  it("creates default New Tab entries after the active tab and keeps them ephemeral", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");

    expect(appSource).toContain("async function createDefaultWorkspaceTab()");
    expect(appSource).toContain("const defaultInfo = await rpc.request.getDefaultWorkspace();");
    expect(appSource).toContain("...tabs.slice(0, activeIndex + 1)");
    expect(appSource).toContain("...tabs.slice(activeIndex + 1)");
    expect(appSource).toContain("await setActiveWorkspace(tab.workspace.workspaceTabId);");
    expect(runtimeSource).toContain(
      'const durableLayoutEnabled = workspaceInfo.kind !== "default"',
    );
    expect(runtimeSource).toContain('} else if (workspaceInfo.kind === "default")');
    expect(runtimeSource).toContain('{ surface: "open-workspace" }');
  });

  it("creates Open Workspace in New Tab entries without focusing an existing same-cwd tab", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).toContain('await rpc.request.openWorkspace({ placement: "new-tab" })');
    expect(appSource).toContain('if (placement === "new-tab" || !activeWorkspaceTabId)');
    expect(appSource).toContain("tabs = [");
    expect(appSource).toContain("...tabs.slice(0, activeIndex + 1)");
    expect(appSource).toContain("tab,");
    expect(appSource).toContain("...tabs.slice(activeIndex + 1)");
    expect(appSource).not.toContain("focusExistingWorkspaceTab");
    expect(appSource).not.toContain("dedupeWorkspaceTab");
  });

  it("creates a replacement default tab when closing the last workspace tab", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");

    expect(appSource).toContain("if (tabs.length === 1)");
    expect(appSource).toContain("const defaultInfo = await rpc.request.getDefaultWorkspace();");
    expect(appSource).toContain("tabs = [replacementTab];");
    expect(appSource).toContain("activeWorkspaceTabId = replacementTab.workspace.workspaceTabId;");
    expect(appSource).toContain(
      "await setActiveWorkspace(replacementTab.workspace.workspaceTabId);",
    );
  });

  it("renders workspace tabs as draggable horizontally scrolling chrome tabs with compact controls", async () => {
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const tabStripSource = await readFile(
      new URL("./WorkspaceTabStrip.svelte", import.meta.url),
      "utf8",
    );

    expect(workspaceSource).toContain('class="workspace-titlebar-tabs"');
    expect(workspaceSource).toContain("<WorkspaceTabStrip");
    expect(workspaceSource).toContain("onReorderWorkspace?.(workspaceTabId, beforeWorkspaceTabId)");
    expect(appSource).toContain("reorderWorkspaceTabs(tabs, workspaceTabId, beforeWorkspaceTabId)");
    expect(tabStripSource).toContain('aria-label="Workspace tabs"');
    expect(tabStripSource).toContain('class="workspace-tabs-scroll');
    expect(tabStripSource).toContain("overflow-x: auto");
    expect(tabStripSource).toContain("onpointerdown");
    expect(tabStripSource).toContain("onpointermove");
    expect(tabStripSource).toContain("onReorderWorkspace?.(workspaceTabId, beforeWorkspaceTabId)");
    expect(tabStripSource).toContain("getVisibleWorkspaceTabCounts(tab.counts)");
    expect(tabStripSource).toContain('class="workspace-tab-add');
    expect(tabStripSource).toContain('aria-label="New tab"');
    expect(tabStripSource).toContain("PlusIcon");
    expect(tabStripSource).toContain('class="workspace-tab-close');
    expect(tabStripSource).toContain("XIcon");
  });

  it("routes workspace-scoped renderer APIs through explicit workspace ids", async () => {
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const contractSource = await readFile(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );
    const routingSource = await readFile(
      new URL("../bun/workspace-rpc-routing.ts", import.meta.url),
      "utf8",
    );
    const bunIndexSource = await readFile(new URL("../bun/index.ts", import.meta.url), "utf8");

    expect(runtimeSource).toContain(
      "const scoped = <T extends object>(request?: T): T & { workspaceId: string } => ({",
    );
    expect(runtimeSource).toContain("workspaceId: workspaceInfo.workspaceId");
    expect(runtimeSource).toContain("rpcClient.request.getWorkspaceUiRestore(scoped())");
    expect(runtimeSource).toContain("getAppLogs: refreshAppLogs");
    expect(runtimeSource).toContain("rpcClient.request.getWorkflowsGenerated(scoped())");
    expect(runtimeSource).toContain("rpcClient.request.getGeneratedAgentContext(scoped())");
    expect(runtimeSource).toContain(
      "rpcClient.request.updateGeneratedAgentContext(scoped(request))",
    );
    expect(runtimeSource).toContain("rpcClient.request.getSnippets(scoped())");
    expect(runtimeSource).toContain("rpcClient.request.listSessions(scoped())");
    expect(runtimeSource).toContain("rpcClient.request.getAppPreferences()");
    expect(runtimeSource).not.toContain("getAppPreferences(scoped");
    expect(runtimeSource).not.toContain("getAppWorkspaceTabs(scoped");
    expect(runtimeSource).not.toContain("setAppWorkspaceTabs(scoped");

    expect(contractSource).toContain("export interface WorkspaceScopedRequest");
    expect(contractSource).toContain("workspaceId: string;");
    expect(contractSource).toContain("getAppPreferences: {\n        params: undefined;");
    expect(contractSource).toContain("updateAppPreferences: {\n        params: AppPreferences;");
    expect(contractSource).toContain("getAppWorkspaceTabs: {\n        params: undefined;");
    expect(contractSource).toContain(
      "setAppWorkspaceTabs: {\n        params: AppWorkspaceTabsState;",
    );
    expect(contractSource).toContain(
      "getGeneratedAgentContext: {\n        params: WorkspaceScopedRequest;",
    );
    expect(contractSource).toContain(
      "updateGeneratedAgentContext: {\n        params: WorkspaceScoped<UpdateGeneratedAgentContextRequest>;",
    );
    expect(contractSource).toContain(
      "getWorkflowsGenerated: {\n        params: WorkspaceScopedRequest;",
    );
    expect(contractSource).toContain(
      "getAppLogs: {\n        params: WorkspaceScoped<AppLogQuery>;",
    );
    expect(contractSource).not.toContain("params: WorkspaceScoped<AppLogQuery> | undefined;");
    expect(contractSource).toContain("listSessions: {\n        params: WorkspaceScopedRequest;");

    expect(routingSource).toContain("return registry.getRuntime(input.workspaceId);");
    expect(routingSource).not.toContain("getActiveRuntime");
    expect(routingSource).not.toContain("process.cwd");
    expect(bunIndexSource).toContain(
      "getWorkspaceRuntime(query).appLogStore.query(stripWorkspaceId(query))",
    );
    expect(bunIndexSource).not.toContain("workspaceRuntimeRegistry.getActiveRuntime()");
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

  it("shows compact shortcut hints and keycap tooltip chips for sidebar shell actions", async () => {
    const sidebarSource = await readFile(
      new URL("./SessionSidebar.svelte", import.meta.url),
      "utf8",
    );
    const tooltipSource = await readFile(new URL("./ui/Tooltip.svelte", import.meta.url), "utf8");

    expect(sidebarSource).toContain("sidebar-action-shortcut");
    expect(sidebarSource).toContain(".sidebar-action-row:hover :global(.sidebar-action-shortcut)");
    expect(sidebarSource).toContain(
      ".sidebar-action-row:focus-visible :global(.sidebar-action-shortcut)",
    );
    expect(sidebarSource).toContain("newSessionDisplayShortcut");
    expect(sidebarSource).toContain("commandPaletteDisplayShortcut");
    expect(sidebarSource).toContain("appLogsDisplayShortcut");
    expect(sidebarSource).toContain("agentsDisplayShortcut");
    expect(sidebarSource).toContain("extensionsDisplayShortcut");
    expect(sidebarSource).toContain("workflowsDisplayShortcut");
    expect(sidebarSource).toContain("paneOpenTooltipDetails");
    expect(tooltipSource).toContain("ui-tooltip-shortcut");
    expect(tooltipSource).toContain("appendKeyboardShortcutParts");
  });

  it("keeps session unread and context-menu actions on the sidebar row contract", async () => {
    const sidebarSource = await readFile(
      new URL("./SessionSidebar.svelte", import.meta.url),
      "utf8",
    );
    const sessionItemSource = await readFile(
      new URL("./SessionListItem.svelte", import.meta.url),
      "utf8",
    );

    expect(sidebarSource).toContain('id: "read-state"');
    expect(sidebarSource).toContain('session.isUnread ? "Mark as Read" : "Mark as Unread"');
    expect(sidebarSource).toContain(
      "session.isUnread ? onMarkSessionRead(session) : onMarkSessionUnread(session)",
    );
    expect(sidebarSource).toContain('id: "pin-state"');
    expect(sidebarSource).toContain('session.isPinned ? "Unpin" : "Pin"');
    expect(sidebarSource).toContain('id: "rename"');
    expect(sidebarSource).toContain('id: "archive-state"');
    expect(sidebarSource).toContain('session.isArchived ? "Unarchive" : "Archive"');
    expect(sidebarSource).toContain('id: "delete"');
    expect(sidebarSource).toContain(
      'confirmingDeleteSessionId === session.id ? "Confirm" : "Delete"',
    );
    expect(sidebarSource).toContain("runSessionContextAction(() => onDeleteSession(session))");

    expect(sessionItemSource).toContain('${session.isUnread ? "unread" : ""}');
    expect(sessionItemSource).toContain(
      'aria-label={`${session.isUnread ? "Unread session: " : ""}${session.title}`}',
    );
    expect(sessionItemSource).toContain("{#if session.isUnread}");
    expect(sessionItemSource).toContain('class="session-unread-dot"');
    expect(sessionItemSource).toContain("{:else if showUpdatedAt}");
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

  it("does not let Dockview restore-time active-panel events overwrite saved focus", async () => {
    const dockviewSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewSource).toContain("dockview.fromJSON(dockviewLayout");
    expect(dockviewSource).toContain("if (!applying && panel) onFocusPanel(panel.id);");
    expect(dockviewSource).toContain("const focused = nextFocusedPanelId");
    expect(dockviewSource).toContain("dockview.setActivePanel(focused);");
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
    expect(panelHostSource).toContain("unavailable-surface-panel");
    expect(panelHostSource).toContain('pane?.chrome?.kind === "unavailable"');
    expect(panelHostSource).toContain("pane.restore?.unavailableReason");
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

  it("renders workflow-agent source records in the Agents pane", async () => {
    const agentsPaneSource = await readFile(
      new URL("./AgentsPane.svelte", import.meta.url),
      "utf8",
    );
    const workflowAgentFormSource = await readFile(
      new URL("./WorkflowAgentRowForm.svelte", import.meta.url),
      "utf8",
    );
    const openExternalButtonSource = await readFile(
      new URL("./ui/OpenExternalButton.svelte", import.meta.url),
      "utf8",
    );
    const openExternalEditorSource = await readFile(
      new URL("./ui/open-external-editor.ts", import.meta.url),
      "utf8",
    );

    expect(agentsPaneSource).toContain("Workflow Agents");
    expect(agentsPaneSource).toContain("workflowAgents");
    expect(agentsPaneSource).toContain("runtime.updateWorkflowAgent");
    expect(agentsPaneSource).toContain("targetAgentProfileId");
    expect(agentsPaneSource).toContain("focusTargetAgentProfile");
    expect(agentsPaneSource).toContain("actorForProfileId(targetProfileId)");
    expect(agentsPaneSource).toContain('toggleExpanded(agent.id, "workflow-task")');
    expect(agentsPaneSource).toContain(
      'toggleExpanded(profile.id, category === "special" ? "handler" : "orchestrator")',
    );
    expect(agentsPaneSource).not.toContain("Profiles used by orchestrators");
    expect(agentsPaneSource).not.toContain("agents-header");
    expect(agentsPaneSource).toContain("{preview.actor}");
    expect(agentsPaneSource).toContain("extensionUsageItems({");
    expect(agentsPaneSource).toContain("WorkflowAgentRowForm");
    expect(workflowAgentFormSource).toContain("createForm");
    expect(workflowAgentFormSource).toContain("formApi.reset(valuesFor(saved))");
    expect(workflowAgentFormSource).toContain("Workflow agent instructions are required.");
    expect(agentsPaneSource).toContain(".agent.json");
    expect(agentsPaneSource).toContain("OpenExternalButton");
    expect(agentsPaneSource).toContain("workflow-source-button");
    expect(agentsPaneSource).toContain("workflow-source-filename");
    expect(openExternalButtonSource).toContain(
      'import ExternalLinkIcon from "@lucide/svelte/icons/external-link";',
    );
    expect(openExternalButtonSource).toContain("openExternalEditorTooltip");
    expect(openExternalEditorSource).toContain("Open in ${externalEditorLabel(editor)}");
    expect(agentsPaneSource).toContain(":global(.category-action .ui-button-content > svg)");
    expect(agentsPaneSource).toContain(":global(.category-action .ui-button-content > span)");
    expect(agentsPaneSource).not.toContain("Open external");
    expect(agentsPaneSource).not.toContain("Generates Agents.");
    expect(agentsPaneSource).not.toContain("updateWorkflowExtensions");
    expect(agentsPaneSource).not.toContain("TODO: default workflow agents");
  });

  it("uses compact Agents pane extension usage controls instead of passive summaries", async () => {
    const agentsPaneSource = await readFile(
      new URL("./AgentsPane.svelte", import.meta.url),
      "utf8",
    );
    const agentProfileFormSource = await readFile(
      new URL("./AgentProfileRowForm.svelte", import.meta.url),
      "utf8",
    );
    const workflowAgentFormSource = await readFile(
      new URL("./WorkflowAgentRowForm.svelte", import.meta.url),
      "utf8",
    );
    const extensionUsageControlSource = await readFile(
      new URL("./ExtensionUsageControl.svelte", import.meta.url),
      "utf8",
    );
    const profileExtensionEditorSource = await readFile(
      new URL("./ProfileExtensionEditor.svelte", import.meta.url),
      "utf8",
    );
    const extensionUsageHelperSource = await readFile(
      new URL("./agents-pane-extension-usage.ts", import.meta.url),
      "utf8",
    );
    const profileExtensionUsageSaveSource = agentsPaneSource.slice(
      agentsPaneSource.indexOf("async function setProfileExtensionUsage"),
      agentsPaneSource.indexOf("async function setWorkflowAgentExtensionUsage"),
    );
    const workflowExtensionUsageSaveSource = agentsPaneSource.slice(
      agentsPaneSource.indexOf("async function setWorkflowAgentExtensionUsage"),
      agentsPaneSource.indexOf("function openExtension"),
    );

    expect(agentsPaneSource).toContain("runtime.getExtensionsInventory()");
    expect(agentsPaneSource).toContain("runtime.setAgentProfileExtensionUsage");
    expect(profileExtensionUsageSaveSource).not.toContain("savingProfileId =");
    expect(workflowExtensionUsageSaveSource).not.toContain("savingWorkflowAgentKey =");
    expect(agentsPaneSource).toContain("function openExtension(extensionId: string)");
    expect(agentsPaneSource).toContain('surface: "extensions"');
    expect(agentsPaneSource).toContain("targetExtensionId: extensionId");
    expect(agentsPaneSource).toContain("extensionUsageItems({");
    expect(agentsPaneSource).toContain("ProfileExtensionEditor");
    expect(agentsPaneSource).toContain("setProfileExtensionOrder");
    expect(agentsPaneSource).toContain("resetProfileExtensionSelection");
    expect(agentsPaneSource).toContain("resetProfileExtensionOrder");
    expect(agentsPaneSource).toContain("buildExtensionUsageItems");
    expect(extensionUsageHelperSource).toContain("resolveActorExtensionState");
    expect(extensionUsageHelperSource).toContain('extension.id !== "extension-loading"');
    expect(agentProfileFormSource).toContain("ExtensionUsageControl");
    expect(workflowAgentFormSource).toContain("ExtensionUsageControl");
    expect(agentProfileFormSource).toContain("onOpenExtension={onOpenExtension}");
    expect(workflowAgentFormSource).toContain("onOpenExtension={onOpenExtension}");
    expect(agentProfileFormSource).toContain("onSetExtensionUsage(extensionId, state)");
    expect(workflowAgentFormSource).toContain("onSetExtensionUsage(extensionId, state)");
    expect(agentProfileFormSource).not.toContain("[extensionId]: state");
    expect(workflowAgentFormSource).not.toContain("[extensionId]: state");
    expect(extensionUsageControlSource).toContain('label: "Default loaded"');
    expect(extensionUsageControlSource).toContain('label: "Available"');
    expect(extensionUsageControlSource).toContain('label: "Off"');
    expect(extensionUsageControlSource).toContain(
      'import CheckCircleIcon from "@lucide/svelte/icons/check-circle";',
    );
    expect(extensionUsageControlSource).toContain(
      'import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";',
    );
    expect(extensionUsageControlSource).toContain(
      'import BanIcon from "@lucide/svelte/icons/ban";',
    );
    expect(extensionUsageControlSource).toContain(
      'import ExternalLinkIcon from "@lucide/svelte/icons/external-link";',
    );
    expect(extensionUsageControlSource).toContain("<CheckCircleIcon");
    expect(extensionUsageControlSource).toContain("<CircleDashedIcon");
    expect(extensionUsageControlSource).toContain("<BanIcon");
    expect(extensionUsageControlSource).toContain("<ExternalLinkIcon");
    expect(extensionUsageControlSource).toContain("Open extension");
    expect(extensionUsageControlSource).toContain("Open ${item.title} in Extensions");
    expect(extensionUsageControlSource).toContain('const triggerLabel = "Extensions"');
    expect(extensionUsageControlSource).toContain("{overrideCount} overrides");
    expect(extensionUsageControlSource).toContain("grid-template-columns: repeat(3, 1.54rem)");
    expect(extensionUsageControlSource).toContain(
      "grid-template-columns: minmax(7rem, 1fr) 4.4rem 1.42rem auto",
    );
    expect(extensionUsageControlSource).toContain('class="extension-usage-category"');
    expect(extensionUsageControlSource).toContain("is-fixed-usage");
    expect(extensionUsageControlSource).toContain("is-override-usage");
    expect(extensionUsageControlSource).toContain("is-default-usage");
    expect(extensionUsageControlSource).toContain(
      ".extension-usage-row.is-override-usage .extension-usage-title-text",
    );
    expect(extensionUsageControlSource).toContain(
      "background-image: linear-gradient(var(--ui-accent), var(--ui-accent));",
    );
    expect(extensionUsageControlSource).toContain("background-size: 100% 2px;");
    expect(extensionUsageControlSource).toContain("pending: false");
    expect(extensionUsageControlSource).toContain("const unavailable =");
    expect(extensionUsageControlSource).toContain("disabled={unavailable}");
    expect(extensionUsageControlSource).toContain(".extension-state-button.active:disabled");
    expect(extensionUsageControlSource).not.toContain("pendingKey === optionKey");
    expect(extensionUsageControlSource).not.toContain("is-saving");
    expect(extensionUsageControlSource).not.toContain("aria-busy");
    expect(extensionUsageControlSource).toContain("background: transparent;");
    expect(extensionUsageControlSource).toContain(
      "background: color-mix(in oklab, var(--ui-surface-subtle) 92%, var(--ui-surface-muted));",
    );
    expect(extensionUsageControlSource).not.toContain("override-active");
    expect(extensionUsageControlSource).not.toContain("state-loaded");
    expect(extensionUsageControlSource).not.toContain("state-available");
    expect(extensionUsageControlSource).not.toContain("state-off");
    expect(extensionUsageControlSource).not.toContain("var(--ui-success) 8%");
    expect(extensionUsageControlSource).not.toContain("var(--ui-info) 8%");
    expect(extensionUsageControlSource).not.toContain("var(--ui-danger) 7%");
    expect(extensionUsageControlSource).not.toContain("var(--ui-accent) 14%");
    expect(extensionUsageControlSource).not.toContain("var(--ui-accent) 76%");
    expect(extensionUsageControlSource).not.toContain("inset 2px 0 0");
    expect(extensionUsageControlSource).not.toContain('"fixed"`');
    expect(extensionUsageControlSource).toContain(
      'const MENU_OPEN_EVENT = "svvy:extension-usage-menu-open"',
    );
    expect(extensionUsageControlSource).toContain("handlePeerMenuOpen");
    expect(extensionUsageControlSource).toContain("isolation: isolate;");
    expect(extensionUsageControlSource).toContain("background: var(--ui-bg-elevated);");
    expect(extensionUsageControlSource).toContain(
      "background: color-mix(in oklab, var(--ui-surface-subtle) 70%, var(--ui-bg-elevated));",
    );
    expect(extensionUsageControlSource).not.toContain("Override");
    expect(extensionUsageControlSource).not.toContain("{option.label}</button>");
    expect(extensionUsageControlSource).not.toContain("item.description");
    expect(extensionUsageControlSource).not.toContain("explicit`");
    expect(extensionUsageControlSource).not.toContain("defaults");
    expect(extensionUsageControlSource).not.toContain('label: "Default"');
    expect(agentProfileFormSource).not.toContain("usageSummary");
    expect(workflowAgentFormSource).not.toContain("usageSummary");
    expect(profileExtensionEditorSource).toContain("Selection");
    expect(profileExtensionEditorSource).toContain("Order");
    expect(profileExtensionEditorSource).toContain('state === "unavailable"');
    expect(profileExtensionEditorSource).toContain("onOrderChange");
    expect(profileExtensionEditorSource).toContain("onResetSelection");
    expect(profileExtensionEditorSource).toContain("onResetOrder");
    expect(profileExtensionEditorSource).toContain("onOpenExtension(item.id)");
    expect(profileExtensionEditorSource).not.toContain("Generated context preview");
    expect(profileExtensionEditorSource).not.toContain("Actor:");
    expect(profileExtensionEditorSource).not.toContain("profileName");
    expect(profileExtensionEditorSource).not.toContain("reasoningEffort");
  });

  it("keeps Agents pane model edits constrained to provider metadata options", async () => {
    const agentsPaneSource = await readFile(
      new URL("./AgentsPane.svelte", import.meta.url),
      "utf8",
    );
    const agentProfileFormSource = await readFile(
      new URL("./AgentProfileRowForm.svelte", import.meta.url),
      "utf8",
    );
    const workflowAgentFormSource = await readFile(
      new URL("./WorkflowAgentRowForm.svelte", import.meta.url),
      "utf8",
    );
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const dockviewHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const chatComposerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );
    const modelPickerSource = await readFile(
      new URL("./ModelPickerDialog.svelte", import.meta.url),
      "utf8",
    );
    const chatWorkspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const contractSource = await readFile(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );
    const backendSource = await readFile(new URL("../bun/index.ts", import.meta.url), "utf8");

    expect(agentsPaneSource).toContain("runtime.getAgentModelChoices()");
    expect(agentsPaneSource).toContain("modelChoices = nextModelChoices.items");
    expect(agentsPaneSource).toContain("AgentProfileRowForm");
    expect(agentProfileFormSource).toContain("createForm");
    expect(agentProfileFormSource).toContain("!choice.providerAuthenticated");
    expect(agentProfileFormSource).toContain("supportedReasoning");
    expect(agentProfileFormSource).toContain(
      "Choose a model from the available provider metadata.",
    );
    expect(agentProfileFormSource).toContain(
      "Choose a reasoning level supported by the selected model.",
    );
    expect(agentProfileFormSource).toContain("formApi.reset(valuesFor(saved))");
    expect(workflowAgentFormSource).toContain("createForm");
    expect(workflowAgentFormSource).toContain("!choice.providerAuthenticated");
    expect(workflowAgentFormSource).toContain("supportedReasoning");
    expect(workflowAgentFormSource).toContain(
      "Choose a model from the available provider metadata.",
    );
    expect(agentsPaneSource).not.toContain("listModelComboboxOptions");
    expect(agentsPaneSource).not.toContain("listConfiguredProviders().catch");
    expect(agentsPaneSource).not.toContain("getModel(");
    expect(agentsPaneSource).not.toContain("option?.model ??");
    expect(agentsPaneSource).not.toContain("reasoning: false");
    expect(dockviewHostSource).toContain("runtime.getAgentModelChoices()");
    expect(dockviewHostSource).toContain("!choice.providerAuthenticated");
    expect(chatComposerSource).toContain("supportedThinkingLevels");
    expect(chatComposerSource).toContain("modelOptionThinkingLevels");
    expect(chatComposerSource).toContain("!supportedThinkingLevels.includes(thinkingLevel)");
    expect(chatComposerSource).not.toContain("getSupportedThinkingLevels");
    expect(modelPickerSource).toContain("modelChoices: AgentModelChoice[]");
    expect(modelPickerSource).toContain("onSelect(entry.model, entry.choice)");
    expect(modelPickerSource).toContain("choice.capabilities.reasoning");
    expect(modelPickerSource).toContain("choice.capabilities.vision");
    expect(modelPickerSource).not.toContain("discoverModels");
    expect(modelPickerSource).not.toContain("getProviders()");
    expect(modelPickerSource).not.toContain("getModels(");
    expect(chatWorkspaceSource).toContain("runtime.getAgentModelChoices()");
    expect(chatWorkspaceSource).toContain("clampThinkingLevelForModel");
    expect(chatWorkspaceSource).toContain("agent.setThinkingLevel(nextThinkingLevel)");
    expect(chatWorkspaceSource).not.toContain("listConfiguredProviders");
    expect(chatWorkspaceSource).not.toContain("allowedProviders");
    expect(runtimeSource).toContain("getAgentModelChoices: () =>");
    expect(runtimeSource).not.toContain("listConfiguredProviders");
    expect(contractSource).toContain("export interface AgentModelChoice");
    expect(contractSource).toContain("getAgentModelChoices");
    expect(contractSource).toContain("supportedReasoning: ReasoningEffort[]");
    expect(backendSource).toContain("assertAgentModelSelection");
    expect(backendSource).toContain("items: readDefaultModelCatalog().map");
    expect(existsSync(new URL("./model-options.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("./model-thinking.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("./model-discovery.ts", import.meta.url))).toBe(false);
  });

  it("keeps the Workflows pane read-only generated visibility", async () => {
    const workflowsPaneSource = await readFile(
      new URL("./WorkflowsPane.svelte", import.meta.url),
      "utf8",
    );
    const backendSource = await readFile(new URL("../bun/index.ts", import.meta.url), "utf8");
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const directToolsSource = await readFile(
      new URL("../bun/svvy-direct-tools.ts", import.meta.url),
      "utf8",
    );
    const workspaceRegistrySource = await readFile(
      new URL("../bun/workspace-runtime-registry.ts", import.meta.url),
      "utf8",
    );

    expect(workflowsPaneSource).toContain("Generated Code");
    expect(workflowsPaneSource).toContain("selectedItem.sourcePath");
    expect(workflowsPaneSource).toContain("selectedItem.generatedPath");
    expect(workflowsPaneSource).toContain("selectedItem.qualifiedName");
    expect(workflowsPaneSource).toContain("onOpenAgentProfile");
    expect(workflowsPaneSource).toContain("Customize Agent");
    expect(workflowsPaneSource).toContain("runtime.workflowsGeneratedSnapshot");
    expect(workflowsPaneSource).not.toContain("runtime.subscribeAppLogUpdate");
    expect(runtimeSource).toContain("Generated Workflows package rebuilt.");
    expect(runtimeSource).toContain("void refreshWorkflowsGenerated().catch");
    expect(backendSource).toContain("buildWorkflowsGeneratedPackage");
    expect(backendSource).toContain("workflow-agent-settings");
    expect(backendSource).toContain(
      "Workflow agent settings rejected because Workflows build failed.",
    );
    expect(backendSource).toContain("throw workflowsBuildFailedError(build.diagnostics)");
    expect(backendSource).toContain("runtime.agentSettingsStore.deleteWorkflowAgent(key)");
    expect(backendSource).not.toContain(
      "Workflow agent settings saved but Workflows build failed.",
    );
    expect(backendSource).not.toContain(
      "Workflow agent settings saved but Workflows build errored.",
    );
    expect(directToolsSource).toContain("onWorkflowsGeneratedPackageChanged");
    expect(directToolsSource).toContain("workflowBuildOk");
    expect(directToolsSource).toContain("svvyx-workflows-build");
    expect(directToolsSource).toContain("svvyx-workflows-save");
    expect(directToolsSource).toContain("workflowsWorkspaceCwds");
    expect(workspaceRegistrySource).toContain("recordWorkflowsGeneratedPackageLog");
    expect(workspaceRegistrySource).toContain("for (const runtime of this.runtimes.values())");
    expect(workspaceRegistrySource).toContain("setOpenWorkspaceCwdsReader");
    expect(workspaceRegistrySource).toContain("this.listOpenWorkspaces().map");
    expect(workflowsPaneSource).not.toContain("svvyx workflows run");
    expect(workflowsPaneSource).not.toContain("delete");
    expect(workflowsPaneSource).not.toContain("textarea");
  });

  it("wires Workflows generated agent rows to focused Agents pane records", async () => {
    const chatWorkspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const dockviewWorkspaceSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(chatWorkspaceSource).toContain("function openAgentProfile(agentProfileId: string)");
    expect(chatWorkspaceSource).toContain("targetAgentProfileId: agentProfileId");
    expect(chatWorkspaceSource).toContain("onOpenAgentProfile={openAgentProfile}");
    expect(dockviewWorkspaceSource).toContain("onOpenAgentProfile");
    expect(panelHostSource).toContain("targetAgentProfileId={pane.target.targetAgentProfileId}");
    expect(panelHostSource).toContain(
      "<WorkflowsPane {runtime} onOpenAgentProfile={onOpenAgentProfile} />",
    );
  });

  it("routes generated context preview actions into the Extensions pane preview surface", async () => {
    const commandPaletteSource = await readFile(
      new URL("./command-palette.ts", import.meta.url),
      "utf8",
    );
    const extensionsPaneSource = await readFile(
      new URL("./ExtensionsPane.svelte", import.meta.url),
      "utf8",
    );
    const dockviewSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");

    expect(commandPaletteSource).toContain('view: "generated-context-preview"');
    expect(dockviewSource).toContain("targetView={pane.target.view}");
    expect(dockviewSource).toContain("targetExtensionId={pane.target.targetExtensionId}");
    expect(runtimeSource).toContain("getAgentContextPreview");
    expect(extensionsPaneSource).toContain("Generated Context Preview");
    expect(extensionsPaneSource).toContain("runtime.getAgentContextPreview");
    expect(extensionsPaneSource).toContain("targetExtensionId");
    expect(extensionsPaneSource).toContain("data-extension-id={extension.id}");
    expect(extensionsPaneSource).toContain("target-extension-row");
    expect(extensionsPaneSource).not.toContain(
      "TODO: expanded profile prompt, extension, and generated contract preview.",
    );
  });

  it("renders CLI readiness from the Extensions inventory read model", async () => {
    const extensionsPaneSource = await readFile(
      new URL("./ExtensionsPane.svelte", import.meta.url),
      "utf8",
    );
    const extensionEnvFormSource = await readFile(
      new URL("./ExtensionEnvValueForm.svelte", import.meta.url),
      "utf8",
    );
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const contractSource = await readFile(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );

    expect(contractSource).toContain("ExtensionCliRequirementReadinessStatus");
    expect(contractSource).toContain("ExtensionEnvRequirementReadinessStatus");
    expect(contractSource).toContain("ExtensionChangeCardReadModel");
    expect(contractSource).toContain("externalInstruction?:");
    expect(contractSource).toContain("EXTERNAL_INSTRUCTION_UNREADABLE");
    expect(contractSource).toContain("getExtensionsInventory");
    expect(contractSource).toContain("revertExtensionChange");
    expect(contractSource).toContain("setExtensionEnvSecret");
    expect(contractSource).toContain("removeExtensionEnvSecret");
    expect(contractSource).toContain("setExtensionEnvOverride");
    expect(contractSource).toContain("removeExtensionEnvOverride");
    expect(runtimeSource).toContain("getExtensionsInventory");
    expect(runtimeSource).toContain("getAppPreferences");
    expect(runtimeSource).toContain("updateAppPreferences");
    expect(runtimeSource).toContain("revertExtensionChange");
    expect(runtimeSource).toContain("setExtensionEnvSecret");
    expect(runtimeSource).toContain("removeExtensionEnvSecret");
    expect(runtimeSource).toContain("setExtensionEnvOverride");
    expect(runtimeSource).toContain("removeExtensionEnvOverride");
    expect(extensionsPaneSource).toContain("runtime.getExtensionsInventory");
    expect(extensionsPaneSource).toContain("External Instructions");
    expect(extensionsPaneSource).toContain("external-instruction-readonly");
    expect(extensionsPaneSource).toContain("external-instruction-controls");
    expect(extensionsPaneSource).toContain("setExternalInstructionEnabled");
    expect(extensionsPaneSource).toContain("setExternalInstructionActor");
    expect(extensionsPaneSource).toContain("runtime.getAppPreferences");
    expect(extensionsPaneSource).toContain("runtime.updateAppPreferences");
    expect(extensionsPaneSource).toContain("openGeneratedAgentContextExternalSourceInEditor");
    expect(extensionsPaneSource).toContain("runtime.revertExtensionChange");
    expect(extensionsPaneSource).toContain("Reversible Changes");
    expect(extensionsPaneSource).toContain("runtime.setExtensionEnvSecret");
    expect(extensionsPaneSource).toContain("runtime.removeExtensionEnvSecret");
    expect(extensionsPaneSource).toContain("runtime.setExtensionEnvOverride");
    expect(extensionsPaneSource).toContain("runtime.removeExtensionEnvOverride");
    expect(extensionsPaneSource).toContain("ExtensionEnvValueForm");
    expect(extensionEnvFormSource).toContain("createForm");
    expect(extensionEnvFormSource).toContain("Unable to save extension env value.");
    expect(extensionEnvFormSource).toContain("Unable to remove extension env value.");
    expect(extensionsPaneSource).toContain("cliRequirementTone");
    expect(extensionsPaneSource).toContain("envRequirementTone");
    expect(extensionEnvFormSource).toContain('type={secret ? "password" : "text"}');
    expect(extensionsPaneSource).toContain("currentVersion");
    expect(extensionsPaneSource).toContain("detectedVersion");
    expect(extensionsPaneSource).toContain("latestVersion");
    expect(extensionsPaneSource).toContain("updateAvailable");
    expect(extensionsPaneSource).toContain("installCommand");
    expect(extensionsPaneSource).toContain("updateCommand");
    expect(extensionsPaneSource).not.toContain(
      'extension.cliRequirements.map((requirement) => requirement.binary).join(", ")}</code>',
    );
  });

  it("wires Dockview transcripts to semantic blocks and structured actions", async () => {
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");

    expect(panelHostSource).toContain("buildTranscriptSemanticBlocks");
    expect(panelHostSource).toContain("semanticBlocks={transcriptSemanticBlocks}");
    expect(panelHostSource).toContain("{workspaceMentionPaths}");
    expect(panelHostSource).not.toContain("workspaceMentionPaths={new Set()}");
    expect(panelHostSource).toContain("onInspectCommand={inspectCommandFromTranscript}");
    expect(panelHostSource).toContain("onOpenHandlerThread={openHandlerThreadFromTranscript}");
    expect(panelHostSource).toContain('surface: "thread"');
    expect(panelHostSource).toContain("surfacePiSessionId: thread.surfacePiSessionId");
    expect(panelHostSource).toContain("threadId: thread.threadId");
    expect(panelHostSource).toContain("transcriptSplitTarget()");
    expect(panelHostSource).not.toContain("onInspectWorkflow={inspectWorkflowFromTranscript}");
    expect(panelHostSource).toContain(
      "onInspectWorkflowTaskAttempt={inspectWorkflowTaskAttemptFromTranscript}",
    );
    expect(panelHostSource).toContain("onReplyToWait=");
    expect(panelHostSource).toContain("onRetryFailure=");
    expect(transcriptSource).toContain("<ThreadCard");
    expect(transcriptSource).toContain('row.block.kind === "thread"');
    expect(transcriptSource).toContain("onopen={() =>");
    expect(runtimeSource).toContain("const normalizedTarget = normalizePromptTarget(target)");
    expect(runtimeSource).toContain(
      "const existingController = surfaceControllers.get(normalizedTarget.surfacePiSessionId)",
    );
  });

  it("renders shared live tool projection details through transcript and inspector surfaces", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const inspectorSource = await readFile(
      new URL("./RelatedInspectorPane.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain("command.command.patchSnapshots");
    expect(transcriptSource).toContain("command.command.outputEvents");
    expect(transcriptSource).toContain("command.command.progressEvents");
    expect(transcriptSource).toContain("command.command.diagnostics");
    expect(transcriptSource).toContain("command.command.artifacts");
    expect(transcriptSource).toContain("command.command.facts");
    expect(transcriptSource).toContain("row.block.command.summaryChildren");
    expect(inspectorSource).toContain("getCommandDiagnosticSections(content)");
    expect(inspectorSource).toContain("getCommandPatchSections(content)");
    expect(inspectorSource).toContain("getCommandProgressSections(content)");
    expect(inspectorSource).toContain("getCommandOutputSections(content)");
    expect(inspectorSource).toContain("getCommandInspectorSections(content)");
    expect(inspectorSource).toContain("childProgressSummary(child)");
    expect(inspectorSource).toContain("<h4>Raw Detail</h4>");
  });

  it("supports committed user-message copy and edit-resubmit affordances", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const composerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain('aria-label="Copy message"');
    expect(transcriptSource).toContain('aria-label="Edit message"');
    expect(transcriptSource).toContain("onEditUserMessage?.(message, userDraftText(message))");
    expect(transcriptSource).toContain("editing-user-bubble");
    expect(panelHostSource).toContain("pendingEditMessage");
    expect(panelHostSource).toContain("Replace Composer Draft");
    expect(panelHostSource).toContain("composerBuffer.attachments.length > 0");
    expect(panelHostSource).toContain("controller.editCommittedUserMessage");
    expect(panelHostSource).toContain("The current composer draft and attachments will be cleared");
    expect(panelHostSource).not.toContain("TODO:");
    expect(composerSource).toContain("editDraft");
    expect(composerSource).toContain("moveCaretToDraftEnd(editDraft.text)");
  });

  it("renders sent attachments as transcript tiles instead of provenance prose", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain("parseComposerAttachmentTextSignature");
    expect(transcriptSource).toContain(
      'block.type === "text" && parseComposerAttachmentTextSignature(block.textSignature).length === 0',
    );
    expect(transcriptSource).toContain('aria-label="Attached files"');
    expect(transcriptSource).toContain('aria-label="Attached images"');
    expect(transcriptSource).toContain("user-image-attachment");
    expect(transcriptSource).toContain("user-file-attachment");
    expect(transcriptSource).not.toContain(
      "Attached files are available at these workspace-relative paths",
    );
  });

  it("keeps submitted prompt history workspace-scoped and records provider-blocked sends", async () => {
    const chatWorkspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const promptHistorySource = await readFile(
      new URL("./prompt-history.ts", import.meta.url),
      "utf8",
    );

    expect(runtimeSource).toContain("private async persistPromptHistoryEntry");
    expect(runtimeSource).toContain("await this.persistPromptHistoryEntry(submission.text)");
    expect(chatWorkspaceSource).toContain("if (!hasProviderAccess)");
    expect(chatWorkspaceSource).toContain("runtime.storage.promptHistory.append");
    expect(chatWorkspaceSource).toContain("workspaceId: runtime.workspaceId");
    expect(promptHistorySource).toContain("navigatePromptHistory");
    expect(promptHistorySource).toContain("draftSnapshot");
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

  it("projects the active system prompt as surface metadata instead of an inline transcript row", async () => {
    const panelHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(panelHostSource).toContain('class="surface-metadata-stack"');
    expect(panelHostSource).toContain('class="surface-prompt-metadata"');
    expect(panelHostSource).toContain("{activeSystemPrompt}");
    expect(panelHostSource).toContain('aria-label="Surface metadata"');
    expect(panelHostSource).not.toContain("systemPrompt={resolvedSystemPrompt}");
    expect(transcriptSource).not.toContain('kind: "system"');
    expect(transcriptSource).not.toContain("system-prompt");
    expect(transcriptSource).not.toContain("system-row");
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

  it("wires snippet mention chips to argument keyboard progression and typed-title commits", async () => {
    const composerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );

    expect(composerSource).toContain("commitTypedSnippetMention({");
    expect(composerSource).toContain('event.key === " "');
    expect(composerSource).toContain("data-snippet-argument=");
    expect(composerSource).toContain("handleSnippetArgumentKeydown");
    expect(composerSource).toContain("focusSnippetArgument(committed.mention.id, 0)");
  });

  it("stores sent snippet provenance as product message metadata", async () => {
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const snippetsSource = await readFile(
      new URL("../shared/snippets.ts", import.meta.url),
      "utf8",
    );

    expect(runtimeSource).toContain("message.svvyMetadata =");
    expect(runtimeSource).toContain("snippetProvenance: structuredClone(input.snippetProvenance)");
    expect(runtimeSource).not.toContain("serializeSentSnippetProvenanceTextSignature");
    expect(transcriptSource).toContain("svvyMetadata?.snippetProvenance");
    expect(transcriptSource).not.toContain("parseSentSnippetProvenanceTextSignature");
    expect(snippetsSource).not.toContain("SENT_SNIPPET_PROVENANCE_TEXT_SIGNATURE_PREFIX");
  });

  it("does not structuredClone Svelte settings state in the Settings pane", async () => {
    const settingsSource = await readFile(new URL("./Settings.svelte", import.meta.url), "utf8");
    const appPreferencesFormSource = await readFile(
      new URL("./AppPreferencesForm.svelte", import.meta.url),
      "utf8",
    );
    const appSource = await readFile(new URL("./App.svelte", import.meta.url), "utf8");
    const contractSource = await readFile(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );

    expect(settingsSource).toContain("function serializeAppPreferences");
    expect(settingsSource).toContain("function refreshExternalInstructionSources");
    expect(settingsSource).not.toContain("Workflow Agents");
    expect(settingsSource).not.toContain("function serializeWorkflowAgentSettings");
    expect(settingsSource).not.toContain("structuredClone(");
    expect(settingsSource).toContain("<AppPreferencesForm");
    expect(settingsSource).toContain("externalInstructions: preferences.externalInstructions");
    expect(settingsSource).toContain("getGeneratedAgentContextExternalSources");
    expect(settingsSource).toContain("openGeneratedAgentContextExternalSourceInEditor");
    expect(settingsSource).toContain("ambientAgentResources: preferences.ambientAgentResources");
    expect(settingsSource).toContain("runtime.appPreferencesSnapshot");
    expect(settingsSource).toContain("await runtime.getAppPreferences()");
    expect(settingsSource).toContain(
      "await runtime.updateAppPreferences(serializeAppPreferences(preferences))",
    );
    expect(settingsSource).not.toContain("rpc.request.getAppPreferences");
    expect(settingsSource).not.toContain("rpc.request.updateAppPreferences");
    expect(appPreferencesFormSource).toContain("Artifact Directory");
    expect(appPreferencesFormSource).toContain("Approval Mode");
    expect(appPreferencesFormSource).toContain("External Instructions");
    expect(appPreferencesFormSource).toContain("setGlobalRootEnabled");
    expect(appPreferencesFormSource).toContain("setExternalInstructionActor");
    expect(appPreferencesFormSource).toContain("setExternalInstructionEnabled");
    expect(appPreferencesFormSource).toContain("addCustomRoot");
    expect(appPreferencesFormSource).toContain("Ambient Agent Resources");
    expect(appPreferencesFormSource).toContain(
      'import { createForm } from "@tanstack/svelte-form";',
    );
    expect(appPreferencesFormSource).toContain("validators:");
    expect(appPreferencesFormSource).toContain("formApi.reset(copyPreferences(saved))");
    expect(appPreferencesFormSource).toContain("formState.current.isDirty");
    expect(appPreferencesFormSource).toContain("formState.current.isSubmitting");
    expect(appPreferencesFormSource).toContain("setAmbientCategory");
    const providerApiKeyFormSource = await readFile(
      new URL("./ProviderApiKeyForm.svelte", import.meta.url),
      "utf8",
    );
    expect(providerApiKeyFormSource).toContain("formState.current.isDirty");
    expect(providerApiKeyFormSource).toContain("!hasUnsavedChanges");
    expect(appSource).toContain("await rpc.request.getAppPreferences()");
    expect(appSource).not.toContain("getAppPreferences({ workspaceId:");
    expect(contractSource).toContain("getAppPreferences: {\n        params: undefined;");
    expect(contractSource).toContain("updateAppPreferences: {\n        params: AppPreferences;");
  });

  it("feeds static workspace panes from warm runtime read-model snapshots", async () => {
    const runtimeSource = await readFile(new URL("./chat-runtime.ts", import.meta.url), "utf8");
    const agentsPaneSource = await readFile(
      new URL("./AgentsPane.svelte", import.meta.url),
      "utf8",
    );
    const extensionsPaneSource = await readFile(
      new URL("./ExtensionsPane.svelte", import.meta.url),
      "utf8",
    );
    const settingsSource = await readFile(new URL("./Settings.svelte", import.meta.url), "utf8");
    const workflowsPaneSource = await readFile(
      new URL("./WorkflowsPane.svelte", import.meta.url),
      "utf8",
    );
    const snippetsPaneSource = await readFile(
      new URL("./SnippetsPane.svelte", import.meta.url),
      "utf8",
    );
    const appLogsPaneSource = await readFile(
      new URL("./AppLogsPane.svelte", import.meta.url),
      "utf8",
    );
    const dockviewHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(runtimeSource).toContain("type AppReadModelCache");
    expect(runtimeSource).toContain("type WorkspaceReadModelCache");
    expect(runtimeSource).toContain("const activeRuntimeEmitters");
    expect(runtimeSource).toContain("function notifyReadModelCachesChanged");
    expect(runtimeSource).toContain("const refreshWarmReadModels");
    expect(runtimeSource).toContain("refreshWarmReadModels();");
    expect(runtimeSource).toContain("agentModelChoicesSnapshot");
    expect(runtimeSource).toContain("providerAuthsSnapshot");
    expect(runtimeSource).toContain("externalInstructionSourcesSnapshot");
    expect(runtimeSource).toContain("getExtensionsInventory: refreshExtensionsInventory");
    expect(runtimeSource).toContain("getSnippets: refreshSnippets");
    expect(runtimeSource).toContain("getWorkflowsGenerated: refreshWorkflowsGenerated");
    expect(runtimeSource).toContain("listProviderAuths: refreshProviderAuths");

    expect(agentsPaneSource).toContain("runtime.agentSettingsSnapshot");
    expect(agentsPaneSource).toContain("runtime.agentModelChoicesSnapshot");
    expect(agentsPaneSource).toContain("runtime.extensionsInventorySnapshot");
    expect(agentsPaneSource).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(agentsPaneSource).not.toContain("rpc.request");

    expect(extensionsPaneSource).toContain("runtime.extensionsInventorySnapshot");
    expect(extensionsPaneSource).toContain("runtime.appPreferencesSnapshot");
    expect(extensionsPaneSource).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(settingsSource).toContain("runtime.providerAuthsSnapshot");
    expect(settingsSource).toContain("runtime.externalInstructionSourcesSnapshot");
    expect(settingsSource).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(settingsSource).not.toContain("rpc.request");
    expect(dockviewHostSource).toContain("<Settings\n    {runtime}");

    expect(workflowsPaneSource).toContain("runtime.workflowsGeneratedSnapshot");
    expect(workflowsPaneSource).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(workflowsPaneSource).not.toContain("subscribeAppLogUpdate");
    expect(snippetsPaneSource).toContain("runtime.snippetsSnapshot");
    expect(snippetsPaneSource).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(snippetsPaneSource).not.toContain("$effect(() => {\n    void loadSnippets();");
    expect(appLogsPaneSource).toContain("runtime.appLogsSnapshot");
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

  it("keeps default workspace product surfaces wired through the normal shell", async () => {
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const sidebarSource = await readFile(
      new URL("./SessionSidebar.svelte", import.meta.url),
      "utf8",
    );
    const dockviewHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );
    const settingsSource = await readFile(new URL("./Settings.svelte", import.meta.url), "utf8");
    const appPreferencesFormSource = await readFile(
      new URL("./AppPreferencesForm.svelte", import.meta.url),
      "utf8",
    );
    const commandPaletteSource = await readFile(
      new URL("./command-palette.ts", import.meta.url),
      "utf8",
    );

    expect(workspaceSource).toContain("runtime.storage.promptHistory.list(runtime.workspaceId)");
    expect(workspaceSource).toContain(".listWorkspacePaths()");
    expect(workspaceSource).toContain('onOpenSearch={() => openPalette("search")}');
    expect(workspaceSource).toContain('onOpenCommandPalette={() => openPalette("commands")}');
    expect(workspaceSource).toContain("onOpenAppLogs={openAppLogs}");
    expect(workspaceSource).toContain("onOpenWorkflowLibrary={openWorkflowsPane}");
    expect(workspaceSource).toContain("onOpenAgents={openAgentsPane}");
    expect(workspaceSource).toContain("onOpenExtensions={openExtensionsPane}");
    expect(workspaceSource).toContain("onOpenSnippets={openSnippetsPane}");
    expect(workspaceSource).toContain("function openSettingsPane");
    expect(workspaceSource).toContain('surface: "settings"');
    expect(workspaceSource).toContain("onOpenSettings={openSettingsPane}");
    expect(workspaceSource).not.toContain("openGeneratedAgentContext");
    expect(workspaceSource).not.toContain('surface: "generated-agent-context"');

    expect(sidebarSource).toContain("onOpenAppLogs");
    expect(sidebarSource).toContain("onOpenWorkflowLibrary");
    expect(sidebarSource).toContain("onOpenAgents");
    expect(sidebarSource).toContain("onOpenExtensions");
    expect(sidebarSource).toContain("onOpenSnippets");
    expect(sidebarSource).toContain("onOpenSettings");
    expect(sidebarSource).not.toContain('kind === "default"');
    expect(sidebarSource).not.toContain('kind !== "default"');

    expect(dockviewHostSource).toContain("<AppLogsPane {runtime} {panelId} />");
    expect(dockviewHostSource).toContain("<AgentsPane");
    expect(dockviewHostSource).toContain("<ExtensionsPane");
    expect(dockviewHostSource).toContain("<SnippetsPane");
    expect(dockviewHostSource).toContain("<Settings");
    expect(dockviewHostSource).not.toContain("<GeneratedAgentContextPane");
    expect(dockviewHostSource).not.toContain('surface === "generated-agent-context"');
    expect(dockviewHostSource).toContain("<WorkflowsPane");
    expect(dockviewHostSource).toContain('surface === "artifact"');
    expect(dockviewHostSource).toContain("<RelatedInspectorPane");

    expect(settingsSource).toContain("runtime.appPreferencesSnapshot");
    expect(settingsSource).toContain("runtime.providerAuthsSnapshot");
    expect(settingsSource).toContain("await runtime.getAppPreferences()");
    expect(settingsSource).toContain("await runtime.listProviderAuths()");
    expect(settingsSource).toContain("getGeneratedAgentContextExternalSources");
    expect(settingsSource).toContain("await runtime.setProviderApiKey");
    expect(settingsSource).toContain("throw new Error(message, { cause: err })");
    expect(settingsSource).toContain("await runtime.startOAuth");
    expect(settingsSource).toContain("<AppPreferencesForm");
    expect(settingsSource).not.toContain("<Dialog");
    expect(settingsSource).not.toContain('variant?: "dialog"');
    expect(appPreferencesFormSource).toContain("Artifact Directory");
    expect(appPreferencesFormSource).toContain("Approval Mode");
    expect(appPreferencesFormSource).toContain("External Instructions");
    expect(appPreferencesFormSource).toContain("Ambient Agent Resources");

    expect(commandPaletteSource).toContain('kind: "create-session"');
    expect(commandPaletteSource).toContain("await runtime.createSession");
    expect(commandPaletteSource).toContain('kind: "open-surface"');
    expect(commandPaletteSource).toContain('surface: "workflows"');
    expect(commandPaletteSource).toContain('surface: "snippets"');
    expect(commandPaletteSource).toContain('surface: "settings"');
    expect(commandPaletteSource).not.toContain("onOpenSettings?:");
  });

  it("keeps updating context refresh rows visible but not cancellable from the stale banner", async () => {
    const dockviewHostSource = await readFile(
      new URL("./DockviewPanelHost.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewHostSource).toContain('queuedPromptRefresh.status !== "dispatching"');
    expect(dockviewHostSource).toContain('queuedPromptRefresh.status !== "failed"');
    expect(dockviewHostSource).toContain(
      'queuedPromptRefresh?.agentContextUpdate?.state === "failed"',
    );
    expect(dockviewHostSource).toContain("Agent context update failed.");
    expect(dockviewHostSource).toContain("Retry update");
    expect(dockviewHostSource).toContain("{#if queuedPromptRefreshCancellable}");
    expect(dockviewHostSource).toContain("controller.deleteQueuedPrompt(queuedPromptRefresh.id)");
  });
});
