import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

describe("retired desktop integration RPC paths", () => {
  it("keeps increment-5 state command/read-model RPC groups off retired direct stores", async () => {
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const chatStorageSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-storage.ts`,
    ).text();
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
    expect(chatStorageSource).not.toContain("ProviderKeysStore");
    expect(chatStorageSource).not.toContain("provider-keys");
    expect(chatWorkspaceSource).not.toContain("requireProviderAccess");
    expect(chatRuntimeSource).not.toContain(
      'setAppCache("appPreferences", await rpcClient.request.getAppPreferences())',
    );

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

  it("keeps production code from calling the file-backed appPreferences setter", () => {
    const root = join(import.meta.dir, "..");
    const allowed = new Set([
      "bun/agent-settings-store.ts",
      "bun/agent-settings-store.test.ts",
      "bun/session-catalog.test.ts",
    ]);
    const violations = listSourceFiles(root)
      .filter((file) => !allowed.has(relative(root, file)))
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes(".setAppPreferences(")
          ? [`${relative(root, file)} calls setAppPreferences`]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it("pins increment-6 legacy renderer RPC channels until pane migration retires them", async () => {
    const backendSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const chatRuntimeSource = await Bun.file(
      `${import.meta.dir}/../mainview/chat-runtime.ts`,
    ).text();
    const sharedContractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const legacyChannels = [
      { channel: "getAgentSettings", retirementIncrement: "Increment 8" },
      { channel: "updateAgentProfile", retirementIncrement: "Increment 10" },
      { channel: "deleteAgentProfile", retirementIncrement: "Increment 10" },
      { channel: "reorderOrchestratorAgents", retirementIncrement: "Increment 10" },
      { channel: "setAgentProfileExtensionUsage", retirementIncrement: "Increment 10" },
      { channel: "setExtensionEnvSecret", retirementIncrement: "Increment 10" },
      { channel: "removeExtensionEnvSecret", retirementIncrement: "Increment 10" },
      { channel: "setExtensionEnvOverride", retirementIncrement: "Increment 10" },
      { channel: "removeExtensionEnvOverride", retirementIncrement: "Increment 10" },
      { channel: "getExtensionsInventory", retirementIncrement: "Increment 8" },
      { channel: "getWorkflowsGenerated", retirementIncrement: "Increment 8" },
      { channel: "getSnippets", retirementIncrement: "Increment 8" },
      { channel: "createManagedSnippet", retirementIncrement: "Increment 10" },
      { channel: "updateManagedSnippet", retirementIncrement: "Increment 10" },
      { channel: "deleteManagedSnippet", retirementIncrement: "Increment 10" },
      { channel: "setSnippetEnabled", retirementIncrement: "Increment 10" },
      { channel: "openSnippetExternalSourceInEditor", retirementIncrement: "Increment 10" },
      { channel: "listSessions", retirementIncrement: "Increment 8" },
      { channel: "getCommandInspector", retirementIncrement: "Increment 8" },
    ] as const;

    expect(
      legacyChannels.every((entry) => entry.retirementIncrement.startsWith("Increment ")),
    ).toBe(true);
    for (const { channel } of legacyChannels) {
      expect(sharedContractSource).toContain(`${channel}: {`);
      expect(chatRuntimeSource).toContain(`rpcClient.request.${channel}`);
      expect(backendSource).toContain(`${channel}:`);
    }

    for (const channel of [
      "getHandlerThreadInspector",
      "recordSessionOpened",
      "revertExtensionChange",
      "reorderExtensionInstructionFiles",
      "setArchivedGroupCollapsed",
    ]) {
      expect(sharedContractSource).not.toContain(`${channel}: {`);
      expect(chatRuntimeSource).not.toContain(`rpcClient.request.${channel}`);
      expect(backendSource).not.toContain(`${channel}:`);
    }
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
