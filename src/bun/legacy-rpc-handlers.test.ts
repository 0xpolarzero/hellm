import { describe, expect, it } from "bun:test";
import type { ChatRPCSchema } from "../shared/workspace-contract";

type ChatRpcRequestName = Extract<keyof ChatRPCSchema["bun"]["requests"], string>;

const DESKTOP_LIFECYCLE_REQUESTS = [
  "rendererReady",
] as const satisfies readonly ChatRpcRequestName[];

const FACADE_BACKED_REQUESTS = [
  "fetchStateReadModel",
  "refetchStateReadModels",
  "refetchStateReadModelInvalidation",
  "rebaselineStateReadModels",
  "stateAppLogsMarkRead",
  "stateWorkspaceChromeSetTabs",
  "stateWorkspaceChromeSelectTab",
  "stateWorkspaceChromeSelectLayoutSlot",
  "stateWorkspaceLayoutSaveSlot",
  "stateSessionNavigationSetPinned",
  "stateSessionNavigationSetArchived",
  "stateSessionNavigationMarkRead",
  "stateSessionNavigationMarkUnread",
  "stateSessionNavigationSetSectionState",
  "stateAppPreferencesUpdate",
  "stateAgentProfilesUpdateOrchestrator",
  "stateAgentProfilesUpdateThreadHandler",
  "stateAgentProfilesDeleteOrchestrator",
  "stateAgentProfilesReorderOrchestrators",
  "stateAgentProfilesSetExtensionUsage",
  "stateAgentProfilesPromoteExtensionDefault",
  "stateAgentProfilesResetExtensionDefaults",
  "stateAgentProfilesSetExternalInstructionUsage",
  "previewGeneratedContext",
  "listModelMetadata",
  "getExtensionSnapshots",
  "saveExtensionSnapshot",
  "renameExtensionSnapshot",
  "deleteExtensionSnapshot",
  "loadExtensionSnapshot",
  "stateSnippetsCreateManaged",
  "stateSnippetsUpdateManaged",
  "stateSnippetsDeleteManaged",
  "stateSnippetsSetEnabled",
  "openSnippetSourceInEditor",
  "openWorkflowsGeneratedExportInEditor",
  "openSourceEdit",
  "saveSourceEdit",
  "createWorkflowAgentSource",
  "duplicateWorkflowAgentSource",
  "deleteWorkflowAgentSource",
  "openSourceInEditor",
  "configureExtensionTypescriptApi",
  "buildExtension",
  "createExtension",
  "duplicateExtension",
  "deleteExtension",
  "resetExtension",
  "addExtensionInstructionFile",
  "removeExtensionInstructionFile",
  "configureExtensionInstructionFile",
  "writeCommandStdin",
  "sendPrompt",
  "deleteQueuedSurfaceMessage",
  "steerQueuedSurfaceMessage",
  "answerRequestUserInput",
  "answerRuntimeApprovalRequest",
  "setRequestUserInputTimerPaused",
  "setRequestInputVariant",
  "setRequestInputBlockingTimeout",
  "cancelPrompt",
  "listProviderAuths",
  "setProviderApiKey",
  "startOAuth",
  "removeProviderAuth",
  "openSurface",
  "closeSurface",
  "stateExtensionEnvSetOverride",
  "stateExtensionEnvRemoveOverride",
  "stateExtensionEnvSetSecret",
  "stateExtensionEnvRemoveSecret",
  "createOrchestratorSurface",
  "openWorkspace",
  "getDefaultWorkspace",
  "closeWorkspace",
  "listWorkspaceBranches",
  "switchWorkspaceBranch",
  "getArtifactPreview",
  "listWorkspacePaths",
  "pickWorkspaceAttachments",
  "importComposerAttachments",
  "openWorkspacePath",
  "openExternalInstructionSourceInEditor",
  "updateComposerDraft",
  "editCommittedUserMessage",
  "editQueuedSurfaceMessage",
  "reorderQueuedSurfaceMessage",
  "recordRendererTelemetry",
  "setSurfaceModel",
  "setSurfaceThoughtLevel",
  "setSurfaceExtensionUsage",
  "renameSession",
  "forkSession",
  "deleteSession",
] as const satisfies readonly ChatRpcRequestName[];

const HOST_BACKED_REQUESTS = [
  "writeClipboardText",
] as const satisfies readonly ChatRpcRequestName[];

const LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10 =
  [] as const satisfies readonly ChatRpcRequestName[];

describe("legacy RPC handler seam", () => {
  it("exhaustively classifies current ChatRPCSchema requests and Bun handlers", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const schemaBody = extractObjectBody(contractSource, "export interface ChatRPCSchema");
    const bunSchemaBody = extractObjectBody(schemaBody, "bun:");
    const schemaRequests = topLevelPropertyNames(extractObjectBody(bunSchemaBody, "requests:"));
    const normalizedHandlers = extractObjectBody(
      indexSource,
      "return normalizeDesktopBridgeHandlers<ElectrobunRpcHandlers>(",
    );
    const handlerRequests = topLevelPropertyNames(
      extractObjectBody(normalizedHandlers, "requests:"),
    );
    const classifiedRequests: readonly string[] = [
      ...DESKTOP_LIFECYCLE_REQUESTS,
      ...FACADE_BACKED_REQUESTS,
      ...HOST_BACKED_REQUESTS,
      ...LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10,
    ];

    expect(duplicates(classifiedRequests)).toEqual([]);
    expect([...classifiedRequests].toSorted()).toEqual([...schemaRequests].toSorted());
    expect([...handlerRequests].toSorted()).toEqual([...schemaRequests].toSorted());
  });

  it("carries no legacy requests", () => {
    expect(LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10).toEqual([]);
  });

  it("routes exact generated-context preview DTOs through the Runtime facade", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const rendererSource = await Bun.file(`${import.meta.dir}/../mainview/chat-runtime.ts`).text();
    const catalogSource = await Bun.file(`${import.meta.dir}/session-catalog.ts`).text();

    expect(contractSource).toContain("params: PreviewGeneratedContextInput;");
    expect(contractSource).toContain("response: GeneratedContextPreviewResult;");
    expect(indexSource).toContain(
      "previewGeneratedContext: (input) => facades.runtime.generatedContext.preview(input)",
    );
    expect(rendererSource).toContain("rpcClient.request.previewGeneratedContext(scoped(request))");
    expect(contractSource).not.toContain("getAgentContextPreview:");
    expect(indexSource).not.toContain("getAgentContextPreview:");
    expect(rendererSource).not.toContain("getAgentContextPreview:");
    expect(catalogSource).not.toContain("getAgentContextPreview(");
  });

  it("routes extension build receipts through the runtime facade instead of legacy inventory", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const rendererSource = await Bun.file(`${import.meta.dir}/../mainview/chat-runtime.ts`).text();
    const paneSource = await Bun.file(
      `${import.meta.dir}/../mainview/ExtensionsPane.svelte`,
    ).text();

    expect(contractSource).toContain("params: BuildRuntimeExtensionInput;");
    expect(contractSource).toContain("response: BuildRuntimeExtensionResult;");
    expect(contractSource).not.toContain("interface BuildExtensionRequest");
    expect(indexSource).toContain(
      "buildExtension: (input) => facades.runtime.extensions.build(input)",
    );
    expect(rendererSource).toContain(
      "buildExtension: (input) => rpcClient.request.buildExtension(input)",
    );
    expect(paneSource).toContain("extensions = await runtime.getExtensions();");
    expect(paneSource).not.toContain("applyExtensionInventoryMutation(runtime.buildExtension");
  });

  it("routes snapshot summaries and mutations through the Runtime facade", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const rendererSource = await Bun.file(`${import.meta.dir}/../mainview/chat-runtime.ts`).text();
    const paneSource = await Bun.file(
      `${import.meta.dir}/../mainview/ExtensionsPane.svelte`,
    ).text();

    expect(contractSource).toContain("params: RuntimeListExtensionSnapshotsInput;");
    expect(contractSource).toContain("response: ExtensionSnapshotsReadModel;");
    expect(contractSource).toContain("params: RuntimeSaveExtensionSnapshotInput;");
    expect(contractSource).toContain("params: RuntimeRenameExtensionSnapshotInput;");
    expect(contractSource).toContain("params: RuntimeDeleteExtensionSnapshotInput;");
    expect(contractSource).toContain("params: RuntimeLoadExtensionSnapshotInput;");
    expect(indexSource).toContain(
      "getExtensionSnapshots: (input) => facades.runtime.extensions.snapshots.list(input)",
    );
    expect(indexSource).toContain(
      "loadExtensionSnapshot: (input) => facades.runtime.extensions.snapshots.load(input)",
    );
    expect(indexSource).not.toContain("runWorkspaceExtensionsCommand");
    expect(rendererSource).toContain("extension-snapshot-cleanup:");
    expect(rendererSource).toContain("extension-snapshot-restore:");
    expect(rendererSource).toContain("expectedRevision: snapshot.revision");
    expect(paneSource).toContain('snapshot.secretState === "captured"');
    expect(paneSource).toContain('result.status !== "completed"');
  });

  it("keeps retired sync messages in their dedicated boundary test", async () => {
    const syncSeamSource = await Bun.file(`${import.meta.dir}/legacy-sync-seam.test.ts`).text();

    expect(syncSeamSource).toContain('not.toContain("sendAppMenuAction")');
    expect(syncSeamSource).toContain('not.toContain("sendArtifactOpen")');
    expect(syncSeamSource).not.toContain('channel: "sendSurfaceSync"');
    expect(syncSeamSource).not.toContain('channel: "sendWorkspaceSync"');
  });
});

function extractObjectBody(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Missing object marker: ${marker}`);
  }
  const openBraceIndex = source.indexOf("{", markerIndex + marker.length);
  if (openBraceIndex < 0) {
    throw new Error(`Missing opening brace after marker: ${marker}`);
  }
  let depth = 1;
  for (let index = openBraceIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(openBraceIndex + 1, index);
    }
  }
  throw new Error(`Missing closing brace after marker: ${marker}`);
}

function topLevelPropertyNames(objectBody: string): string[] {
  return [...objectBody.matchAll(/^      ([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]!);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].toSorted();
}
