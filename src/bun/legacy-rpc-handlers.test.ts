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
  "listModelMetadata",
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
  "createOrchestratorSurface",
] as const satisfies readonly ChatRpcRequestName[];

const LEGACY_HANDLER_RETIREMENT_INCREMENT = 10 as const;

const LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10 = [
  "getGeneratedAgentContextExternalSources",
  "getAgentContextPreview",
  "getExtensionsInventory",
  "saveExtensionSnapshot",
  "renameExtensionSnapshot",
  "deleteExtensionSnapshot",
  "loadExtensionSnapshot",
  "createExtension",
  "duplicateExtension",
  "deleteExtension",
  "resetExtension",
  "buildExtension",
  "setExtensionTypescriptApi",
  "reorderExtensionDefaults",
  "addExtensionInstructionFile",
  "removeExtensionInstructionFile",
  "configureExtensionInstructionFile",
  "updateExtensionInstructionFile",
  "openExtensionInstructionFileInEditor",
  "setExtensionEnvSecret",
  "removeExtensionEnvSecret",
  "openWorkspace",
  "getDefaultWorkspace",
  "closeWorkspace",
  "listWorkspaceBranches",
  "switchWorkspaceBranch",
  "writeClipboardText",
  "listWorkspacePaths",
  "pickWorkspaceAttachments",
  "importComposerAttachments",
  "openWorkspacePath",
  "openGeneratedAgentContextExternalSourceInEditor",
  "getArtifactPreview",
  "renameSession",
  "forkSession",
  "deleteSession",
  "recordRendererTelemetry",
  "updateComposerDraft",
  "editCommittedUserMessage",
  "editQueuedSurfaceMessage",
  "reorderQueuedSurfaceMessage",
  "setExtensionContextAutoUpdate",
  "setSurfaceModel",
  "setSurfaceThoughtLevel",
  "setSurfaceExtensionUsage",
] as const satisfies readonly ChatRpcRequestName[];

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
      ...LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10,
    ];

    expect(duplicates(classifiedRequests)).toEqual([]);
    expect([...classifiedRequests].toSorted()).toEqual([...schemaRequests].toSorted());
    expect([...handlerRequests].toSorted()).toEqual([...schemaRequests].toSorted());
  });

  it("pins every carried legacy request to Increment 10", () => {
    expect(LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10.length).toBeGreaterThan(0);
    for (const requestName of LEGACY_REQUESTS_RETIRING_IN_INCREMENT_10) {
      expect({ requestName, retiresInIncrement: LEGACY_HANDLER_RETIREMENT_INCREMENT }).toEqual({
        requestName,
        retiresInIncrement: 10,
      });
    }
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
