import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

describe("retired desktop integration RPC paths", () => {
  it("keeps workspace chrome and layouts on exact state facade contracts", async () => {
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const bootstrapSource = await Bun.file(`${import.meta.dir}/app-runtime-bootstrap.ts`).text();
    const registrySource = await Bun.file(
      `${import.meta.dir}/workspace-runtime-registry.ts`,
    ).text();
    const notificationSource = await Bun.file(
      `${import.meta.dir}/desktop-notification-bridge.ts`,
    ).text();

    for (const retiredName of [
      "getAppWorkspaceTabs",
      "setAppWorkspaceTabs",
      "getWorkspaceUiRestore",
      "setWorkspaceUiRestore",
      "workspaceChromeLayout",
    ]) {
      expect(indexSource).not.toContain(retiredName);
      expect(bootstrapSource).not.toContain(retiredName);
      expect(registrySource).not.toContain(retiredName);
      expect(notificationSource).not.toContain(retiredName);
    }
    for (const commandName of [
      "stateWorkspaceChromeSetTabs",
      "stateWorkspaceChromeSelectTab",
      "stateWorkspaceChromeSelectLayoutSlot",
      "stateWorkspaceLayoutSaveSlot",
    ]) {
      expect(indexSource).toContain(`${commandName}:`);
    }
    expect(indexSource).not.toContain("setActiveWorkspace:");
    expect(bootstrapSource).not.toContain("workspaceChromeSeed");
    expect(registrySource).toContain("store.readWorkspaceChrome()");
    expect(notificationSource).toContain('event.invalidation.model === "workspaceChrome"');
    expect(existsSync(`${import.meta.dir}/app-workspace-tabs-store.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/app-workspace-tabs-store.test.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/app-workspace-ui-restore-store.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/app-workspace-ui-restore-store.test.ts`)).toBe(false);
  });

  it("keeps increment-5 state command/read-model RPC groups off retired direct stores", async () => {
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const chatStoragePath = `${import.meta.dir}/../mainview/chat-storage.ts`;
    const chatWorkspaceSource = await Bun.file(
      `${import.meta.dir}/../mainview/ChatWorkspace.svelte`,
    ).text();
    const sessionCatalogSource = await Bun.file(`${import.meta.dir}/session-catalog.ts`).text();
    const directToolsSource = await Bun.file(`${import.meta.dir}/svvy-direct-tools.ts`).text();

    expect(indexSource).not.toContain("catalog.updateAppPreferences(preferences)");
    expect(indexSource).not.toContain("appLogs.markSeen(throughSeq)");
    expect(indexSource).not.toContain("appLogs.query(stripWorkspaceId(query))");
    expect(indexSource).toContain("facades.commands.state.appPreferences.update");
    expect(indexSource).toContain("stateCommands.providerAuth.recordStatus");
    expect(indexSource).toContain("facades.commands.state.appLogs.markRead(request)");

    expect(chatRuntimeSource).toContain("rpcClient.request.fetchStateReadModel");
    expect(chatRuntimeSource).not.toContain("rpcClient.request.getAppLogs(scoped");
    expect(chatRuntimeSource).not.toContain("rpcClient.request.getAppLogSummary(scoped");
    expect(chatRuntimeSource).not.toContain("rpcClient.request.markAppLogsSeen");
    expect(sharedContractSource).not.toContain("getAppLogs: {");
    expect(sharedContractSource).not.toContain("getAppLogSummary: {");
    expect(sharedContractSource).not.toContain("markAppLogsSeen: {");
    expect(sharedContractSource).not.toContain("getAppPreferences: {");
    expect(sharedContractSource).not.toContain("updateAppPreferences: {");
    expect(sharedContractSource).not.toContain("getProviderAuthState: {");
    expect(chatRuntimeSource).not.toContain("rpcClient.request.getProviderAuthState");
    expect(chatRuntimeSource).not.toContain("requireProviderAccess");
    expect(existsSync(chatStoragePath)).toBe(false);
    expect(chatWorkspaceSource).not.toContain("requireProviderAccess");
    expect(indexSource).toContain(
      "const fallbacks = await listProviderAuthSummaries({ refreshOAuth: false });",
    );
    expect(indexSource).toContain(
      'source: "startup_scan",\n      stateCommands: facades.rendererStateCommands,',
    );
    expect(chatRuntimeSource).not.toContain(
      'setAppCache("appPreferences", await rpcClient.request.getAppPreferences())',
    );
    expect(chatRuntimeSource).toContain('kind: "requestInput"');
    expect(chatRuntimeSource).toContain('kind: "approvals"');
    expect(sharedContractSource).not.toContain(
      "navigation: WorkspaceSessionNavigationReadModel;\n  requestUserInputRequests:",
    );
    expect(sessionCatalogSource).not.toContain("buildWorkspaceRequestUserInputRequests");
    expect(sessionCatalogSource).not.toContain("buildWorkspaceRuntimeApprovalRequests");
    expect(sessionCatalogSource).not.toContain("getRequestInputSurfaceMutationResponse");
    expect(sessionCatalogSource).not.toContain("afterRuntimeApprovalAnswered");

    expect(sharedContractSource).toContain("StateReadModelInvalidationRefetchRequest");
    expect(sharedContractSource).toContain("StateInvalidationDescriptor");
    expect(sharedContractSource).toContain("StateReadModelRefetchRequest");

    expect(sessionCatalogSource).not.toContain(
      "this.agentSettingsStore.setAppPreferences(preferences)",
    );
    expect(sessionCatalogSource).toContain(
      "this.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences)",
    );
    expect(directToolsSource).not.toContain("store.setAppPreferences(nextState.appPreferences)");
    expect(directToolsSource).toContain(
      "store.hydrateStateOwnedAppPreferences(nextState.appPreferences)",
    );
  });

  it("keeps file-backed app preferences read-only", () => {
    const root = join(import.meta.dir, "..");
    const violations = listSourceFiles(root)
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes(".setAppPreferences(")
          ? [`${relative(root, file)} calls setAppPreferences`]
          : [];
      });

    expect(violations).toEqual([]);
    expect(readFileSync(join(root, "bun/agent-settings-store.ts"), "utf8")).not.toContain(
      "setAppPreferences",
    );
  });

  it("keeps production off retired catalog surface snapshots and direct request-input mutations", () => {
    const root = join(import.meta.dir, "..");
    const retiredSurfaceSymbols = [
      "ConversationSurfaceSnapshot",
      "SurfaceSyncMessage",
      "buildSurfaceSnapshot",
      "setSurfaceSyncListener",
      "listOpenSurfaceSnapshots",
    ] as const;
    const violations = listSourceFiles(root)
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return retiredSurfaceSymbols
          .filter((symbol) => source.includes(symbol))
          .map((symbol) => `${relative(root, file)} retains ${symbol}`);
      });
    const catalogSource = readFileSync(join(import.meta.dir, "session-catalog.ts"), "utf8");
    for (const retiredCatalogMethod of [
      "answerRequestUserInput",
      "afterRequestInputAnswered",
      "setRequestUserInputTimerPaused",
    ]) {
      if (catalogSource.includes(retiredCatalogMethod)) {
        violations.push(`bun/session-catalog.ts retains ${retiredCatalogMethod}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps live pi session metadata out of structured-session write authority", async () => {
    const catalogSource = await Bun.file(`${import.meta.dir}/session-catalog.ts`).text();
    const catalogMutationsSource = await Bun.file(
      `${import.meta.dir}/../../packages/state/src/structured-session-catalog-mutations.ts`,
    ).text();

    expect(catalogSource).not.toContain("syncStructuredPiSessionFromOrchestratorSession");
    expect(catalogSource).not.toContain("syncGeneratedAgentContextBindingForTarget");
    expect(catalogSource).not.toContain("commitSurfaceMetadata");
    expect(catalogSource.match(/catalogStateMutations\.upsertPiSession/g) ?? []).toHaveLength(1);
    expect(catalogSource).toContain("resolveStateBackedPromptDefaults");
    expect(catalogSource).not.toContain("updateOrchestratorPromptDefaults");
    expect(catalogSource).not.toContain("setOrchestratorGeneratedAgentContextFingerprint");
    expect(catalogMutationsSource).not.toContain("updateOrchestratorPromptDefaults");
  });

  it("keeps snippets on state read and command facades with identity-only source opens", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const bootstrapSource = await Bun.file(`${import.meta.dir}/app-runtime-bootstrap.ts`).text();
    const registrySource = await Bun.file(
      `${import.meta.dir}/workspace-runtime-registry.ts`,
    ).text();
    const catalogSource = await Bun.file(`${import.meta.dir}/session-catalog.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const sharedSnippetsSource = await Bun.file(`${import.meta.dir}/../shared/snippets.ts`).text();
    const openHandlerSource = backendSource
      .split("openSnippetSourceInEditor:")[1]
      ?.split("openSourceEdit:")[0];

    for (const channel of [
      "stateSnippetsCreateManaged",
      "stateSnippetsUpdateManaged",
      "stateSnippetsDeleteManaged",
      "stateSnippetsSetEnabled",
      "openSnippetSourceInEditor",
    ]) {
      expect(sharedContractSource).toContain(`${channel}: {`);
      expect(chatRuntimeSource).toContain(`rpcClient.request.${channel}`);
      expect(backendSource).toContain(`${channel}:`);
    }
    expect(backendSource).toContain("facades.commands.state.snippets.createManaged(request)");
    expect(backendSource).toContain("facades.commands.state.snippets.updateManaged(request)");
    expect(backendSource).toContain("facades.commands.state.snippets.deleteManaged(request)");
    expect(backendSource).toContain("facades.commands.state.snippets.setEnabled(request)");
    expect(openHandlerSource).toContain('kind: "snippets"');
    expect(openHandlerSource).toContain("snippetId: input.snippetId");
    expect(openHandlerSource).not.toContain("input.path");
    expect(chatRuntimeSource).toContain('case "snippets":');
    expect(chatRuntimeSource).toContain("workspaceCache.snippets = null");
    expect(catalogSource).not.toContain("SnippetStore");
    expect(catalogSource).not.toContain("snippet-library");
    expect(catalogSource).not.toContain("getSnippets()");
    expect(bootstrapSource).not.toContain("snippetsSeed");
    expect(registrySource).not.toContain("snippetsSeed");
    expect(sharedSnippetsSource).not.toContain("scope:");
    expect(sharedSnippetsSource).not.toContain("readOnly:");
    expect(sharedSnippetsSource).not.toContain("createdAt:");
    expect(sharedSnippetsSource).not.toContain("updatedAt:");
    expect(existsSync(`${import.meta.dir}/snippet-library.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/snippet-library.test.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/snippet-store.ts`)).toBe(false);
    expect(existsSync(`${import.meta.dir}/snippet-store.test.ts`)).toBe(false);
  });

  it("keeps the Workflows renderer feed state-backed with identity-only export opens", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const workflowLibrarySource = await Bun.file(
      `${import.meta.dir}/smithers-runtime/workflow-library.ts`,
    ).text();
    const workflowsCliSource = await Bun.file(
      `${import.meta.dir}/svvyx-workflows-command.ts`,
    ).text();
    const openHandlerSource = backendSource
      .split("openWorkflowsGeneratedExportInEditor:")[1]
      ?.split("openExternalInstructionSourceInEditor:")[0];

    expect(sharedContractSource).toContain("openWorkflowsGeneratedExportInEditor: {");
    expect(chatRuntimeSource).toContain("rpcClient.request.openWorkflowsGeneratedExportInEditor");
    expect(backendSource).toContain("openWorkflowsGeneratedExportInEditor:");
    expect(openHandlerSource).toContain('kind: "workflowsGenerated"');
    expect(openHandlerSource).toContain("candidate.qualifiedName === input.qualifiedName");
    expect(openHandlerSource).toContain('input.target === "source"');
    expect(openHandlerSource).not.toContain("input.path");
    expect(chatRuntimeSource).toContain('fetchStateReadModel({ kind: "workflowsGenerated" })');
    expect(chatRuntimeSource).toContain('case "workflowsGenerated":');
    expect(chatRuntimeSource).toContain("appReadModelCache.workflowsGenerated = null");
    expect(sharedContractSource).toContain("workflowAgentId: string | null;");
    expect(sharedContractSource).toContain('packageName: "@svvyx/workflows";');
    expect(backendSource).toContain('fact.packageName === "@svvyx/workflows"');
    expect(backendSource).not.toContain("readWorkflowsGeneratedReadModel");
    expect(workflowLibrarySource).toContain(
      "export async function readWorkflowsGeneratedReadModel",
    );
    expect(workflowLibrarySource).toContain("const workflowAgentId =");
    expect(workflowLibrarySource).not.toContain("agentProfileId:");
    expect(workflowsCliSource).toContain("readWorkflowsGeneratedReadModel");
    expect(workflowsCliSource).toContain("workflowAgentId: item.workflowAgentId");
  });

  it("routes agent profile state commands and file-backed source edits through injected facades", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();

    for (const channel of [
      "stateAgentProfilesUpdateOrchestrator",
      "stateAgentProfilesUpdateThreadHandler",
      "stateAgentProfilesDeleteOrchestrator",
      "stateAgentProfilesReorderOrchestrators",
      "stateAgentProfilesSetExtensionUsage",
      "stateAgentProfilesPromoteExtensionDefault",
      "stateAgentProfilesResetExtensionDefaults",
      "stateAgentProfilesSetExternalInstructionUsage",
      "openSourceEdit",
      "saveSourceEdit",
      "setRequestInputVariant",
      "setRequestInputBlockingTimeout",
      "stateExtensionEnvSetOverride",
      "stateExtensionEnvRemoveOverride",
      "stateExtensionEnvSetSecret",
      "stateExtensionEnvRemoveSecret",
      "createOrchestratorSurface",
    ]) {
      expect(sharedContractSource).toContain(`${channel}: {`);
      expect(backendSource).toContain(`${channel}:`);
    }
    expect(backendSource).toContain("facades.commands.state.agentProfiles.updateOrchestrator");
    expect(backendSource).toContain("facades.commands.state.agentProfiles.updateThreadHandler");
    expect(backendSource).toContain("facades.commands.state.agentProfiles.deleteOrchestrator");
    expect(backendSource).toContain("facades.commands.state.agentProfiles.reorderOrchestrators");
    expect(backendSource).toContain("facades.runtime.sourceEdits.open(input)");
    expect(backendSource).toContain("facades.runtime.sourceEdits.save(input)");
    expect(backendSource).not.toContain("updateExtensionInstructionFile:");
    expect(backendSource).not.toContain("openExtensionInstructionFileInEditor:");
    expect(sharedContractSource).not.toContain("updateExtensionInstructionFile:");
    expect(sharedContractSource).not.toContain("openExtensionInstructionFileInEditor:");
    expect(backendSource).toContain("facades.runtime.requestInput.setVariant(input)");
    expect(backendSource).toContain("facades.runtime.requestInput.setBlockingTimeout(input)");
    expect(backendSource).toContain("facades.commands.state.extensionEnv.setOverride");
    expect(backendSource).toContain("facades.commands.state.extensionEnv.removeOverride");
    expect(backendSource).toContain("stateCommands.extensionEnv.setSecret");
    expect(backendSource).toContain("stateCommands.extensionEnv.removeSecret");
    expect(backendSource).toContain("workspaceRuntimeRegistry.getStateCommandsFacade()");
    expect(backendSource).toContain(
      'secretValue: Redacted.make(value, { label: "extension-env-secret" })',
    );
    expect(backendSource).not.toContain("extensionEnvSecretStore.set(");
    expect(backendSource).not.toContain("extensionEnvSecretStore.remove(");
    expect(backendSource).toContain("facades.runtime.surfaces.createOrchestrator");
    expect(backendSource).toContain("facades.hostActions.clipboard.writeText(input)");
  });

  it("routes workspace file authority through app actions and native effects through host actions", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const handlerSource = backendSource
      .split("listWorkspacePaths:")[1]
      ?.split("openWorkflowsGeneratedExportInEditor:")[0];

    expect(handlerSource).toContain("facades.appActions.workspaceFiles.listPaths(input)");
    expect(handlerSource).toContain("facades.appActions.workspaceFiles.getRoot(input)");
    expect(handlerSource).toContain("facades.hostActions.dialogs.pickFiles");
    expect(handlerSource).toContain(
      "facades.appActions.workspaceFiles.materializeSelectedAttachments",
    );
    expect(handlerSource).toContain("facades.appActions.workspaceFiles.importComposerAttachments");
    expect(handlerSource).toContain("facades.appActions.workspaceFiles.resolvePathTarget(input)");
    expect(handlerSource).toContain("facades.hostActions.paths.reveal");
    expect(handlerSource).toContain("facades.hostActions.paths.open");
    expect(handlerSource).not.toContain("Utils.openFileDialog");
    expect(handlerSource).not.toContain("Utils.openPath");
    expect(handlerSource).not.toContain("Utils.showItemInFolder");
    expect(handlerSource).not.toContain("getWorkspaceRuntime(input)");
  });

  it("routes generated workflow export editor launches through typed host actions", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const handlerSource = backendSource
      .split("openWorkflowsGeneratedExportInEditor:")[1]
      ?.split("openExternalInstructionSourceInEditor:")[0];

    expect(handlerSource).toContain(
      "openPathInPreferredEditor(runtime, facades.hostActions, path)",
    );
    expect(handlerSource).not.toContain("Utils.openPath");
    expect(handlerSource).not.toContain("spawn(");
  });

  it("resolves external-instruction editor paths from current state identity", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const registrySource = await Bun.file(
      `${import.meta.dir}/workspace-runtime-registry.ts`,
    ).text();
    const handlerSource = backendSource
      .split("openExternalInstructionSourceInEditor:")[1]
      ?.split("writeCommandStdin:")[0];
    const requestContract = sharedContractSource
      .split("interface OpenExternalInstructionSourceInEditorRequest")[1]
      ?.split("}")[0];

    expect(requestContract).toContain("sourceId: string");
    expect(requestContract).not.toContain("path:");
    expect(chatRuntimeSource).toContain("scoped({ sourceId })");
    expect(handlerSource).toContain(
      "facades.appActions.externalInstructions.resolveEditorTarget(input)",
    );
    expect(handlerSource).toContain("facades.hostActions.editor.open");
    expect(handlerSource).toContain("facades.appActions.externalInstructions.recordEditorResult");
    expect(handlerSource).not.toContain("getWorkspaceRuntime(input)");
    expect(registrySource).toContain('kind: "externalInstructions"');
    expect(registrySource).toContain("candidate.id === sourceId");
    expect(registrySource).toContain('source.readStatus.status !== "readable"');
    expect(registrySource).toContain("source.canonicalPath");
    expect(handlerSource).not.toContain("input.path");
    expect(registrySource).not.toContain("getGeneratedAgentContextExternalSources");
  });

  it("routes renderer telemetry persistence through the typed app action", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const handlerSource = backendSource
      .split("recordRendererTelemetry:")[1]
      ?.split("updateComposerDraft:")[0];

    expect(handlerSource).toContain("facades.appActions.telemetry.recordRenderer(payload)");
    expect(handlerSource).not.toContain("getWorkspaceRuntime(payload)");
    expect(handlerSource).not.toContain('runtime.appLog.error("renderer"');
  });

  it("retires the aggregate extension inventory renderer RPC", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const sessionCatalogSource = await Bun.file(`${import.meta.dir}/session-catalog.ts`).text();

    expect(sharedContractSource).not.toContain("getExtensionsInventory: {");
    expect(chatRuntimeSource).not.toContain("rpcClient.request.getExtensionsInventory");
    expect(backendSource).not.toContain("getExtensionsInventory:");
    expect(sharedContractSource).toContain("getExtensionSnapshots: {");
    expect(chatRuntimeSource).toContain("rpcClient.request.getExtensionSnapshots");
    expect(backendSource).toContain("getExtensionSnapshots:");

    for (const retiredChannel of ["setExtensionEnvSecret", "removeExtensionEnvSecret"] as const) {
      expect(sharedContractSource).not.toContain(`${retiredChannel}: {`);
      expect(chatRuntimeSource).not.toContain(`rpcClient.request.${retiredChannel}`);
      expect(backendSource).not.toContain(`${retiredChannel}:`);
    }

    for (const channel of [
      "getHandlerThreadInspector",
      "getCommandInspector",
      "listHandlerThreads",
      "getSnippets",
      "createManagedSnippet",
      "updateManagedSnippet",
      "deleteManagedSnippet",
      "setSnippetEnabled",
      "openSnippetExternalSourceInEditor",
      "getWorkflowsGenerated",
      "openWorkspaceSourceInEditor",
      "recordSessionOpened",
      "revertExtensionChange",
      "reorderExtensionInstructionFiles",
      "setArchivedGroupCollapsed",
      "updateAgentProfile",
      "deleteAgentProfile",
      "reorderOrchestratorAgents",
      "updateWorkflowAgent",
      "deleteWorkflowAgent",
      "openWorkflowAgentSourceInEditor",
      "setAgentProfileExtensionUsage",
      "updateRequestUserInputSettings",
      "setExtensionEnvOverride",
      "removeExtensionEnvOverride",
      "createSession",
      "getWorkspaceInfo",
      "setExtensionDefaultUsage",
      "setExtensionContextAutoUpdate",
    ]) {
      expect(sharedContractSource).not.toContain(`${channel}: {`);
      expect(chatRuntimeSource).not.toContain(`rpcClient.request.${channel}(`);
      expect(backendSource).not.toContain(`${channel}:`);
    }

    for (const channel of [
      "listSessions",
      "pinSession",
      "unpinSession",
      "archiveSession",
      "unarchiveSession",
      "markSessionUnread",
      "markSessionRead",
      "recordFocusedSession",
      "setSessionNavigationSectionState",
    ]) {
      expect(sharedContractSource).not.toContain(`${channel}: {`);
      expect(backendSource).not.toContain(`${channel}:`);
    }
    expect(sharedContractSource).toContain(
      "SessionNavigationSummary as CoreSessionNavigationSummary",
    );
    expect(sharedContractSource).not.toContain("sessionFile?:");
    expect(sharedContractSource).not.toContain("sendArtifactOpen");
    expect(sharedContractSource).not.toContain("sendWorkspaceSync");
    expect(chatRuntimeSource).toContain('kind: "sessionNavigation"');
    expect(sessionCatalogSource).not.toContain("setArtifactOpenListener");
    expect(sessionCatalogSource).not.toContain("emitArtifactOpen");
    expect(sessionCatalogSource).not.toContain("emitWorkspaceSync");
    expect(sessionCatalogSource).not.toContain("async listSessions(");
  });

  it("reads external instruction sources from authoritative state without a dedicated RPC", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();

    expect(sharedContractSource).not.toContain("getGeneratedAgentContextExternalSources: {");
    expect(backendSource).not.toContain("getGeneratedAgentContextExternalSources: async");
    expect(chatRuntimeSource).not.toContain(
      "rpcClient.request.getGeneratedAgentContextExternalSources",
    );
    expect(chatRuntimeSource).toContain('kind: "externalInstructions"');
    expect(chatRuntimeSource).toContain("source.defaultControl.enabled");
    expect(chatRuntimeSource).toContain("source.defaultControl.eligibleActors");
  });

  it("keeps the Extensions pane on state and snapshot read models", async () => {
    const agentsPaneSource = await Bun.file(
      `${import.meta.dir}/../mainview/AgentsPane.svelte`,
    ).text();
    const extensionsPaneSource = await Bun.file(
      `${import.meta.dir}/../mainview/ExtensionsPane.svelte`,
    ).text();
    const usageHelperSource = await Bun.file(
      `${import.meta.dir}/../mainview/agents-pane-extension-usage.ts`,
    ).text();

    expect(agentsPaneSource).toContain("runtime.getAgentExtensionsCatalog()");
    expect(agentsPaneSource).not.toContain("runtime.getExtensionsInventory()");
    expect(agentsPaneSource).not.toContain("runtime.extensionsInventorySnapshot");
    expect(extensionsPaneSource).toContain("runtime.getExtensionSnapshots()");
    expect(extensionsPaneSource).toContain("runtime.extensionSnapshotsSnapshot");
    expect(extensionsPaneSource).not.toContain("runtime.getExtensionsInventory()");
    expect(extensionsPaneSource).not.toContain("runtime.extensionsInventorySnapshot");
    expect(usageHelperSource).not.toContain("ExtensionInventoryItemReadModel");
    expect(usageHelperSource).toContain("AgentExtensionCatalogItem");
  });
});

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (entry === "node_modules") return [];
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    return path.endsWith(".ts") || path.endsWith(".svelte") ? [path] : [];
  });
}
