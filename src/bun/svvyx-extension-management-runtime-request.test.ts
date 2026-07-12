import { describe, expect, it } from "bun:test";

import { parseSvvyxExtensionManagementRuntimeRequest } from "./svvyx-extensions-command";
import { applyExtensionManagementRuntimeRequestForTransport } from "./svvy-direct-tools";

describe("Extension Managing Runtime request parsing", () => {
  const clientRequestId = "runtime-client:svvyx:test" as never;

  it("cuts explicit build and every snapshot command into typed Runtime requests", () => {
    expect(
      [
        "svvyx extensions build notes --json",
        "svvyx extensions snapshots list --json",
        'svvyx extensions snapshots save --name "Before refactor" --json',
        'svvyx extensions snapshots rename extension-snapshot:one --name "After" --json',
        "svvyx extensions snapshots delete extension-snapshot:one --json",
        "svvyx extensions snapshots load extension-snapshot:one --json",
        "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state loaded --json",
        "svvyx extensions revert extension-usage-change:one --json",
      ].map(
        (command) =>
          parseSvvyxExtensionManagementRuntimeRequest({ command, clientRequestId })?.operation,
      ),
    ).toEqual([
      "build",
      "snapshots.list",
      "snapshots.save",
      "snapshots.rename",
      "snapshots.delete",
      "snapshots.load",
      "usage.set",
      "usage.revert",
    ]);
  });

  it("cuts inspect into a state-backed parent request and leaves unrelated lifecycle parsing alone", () => {
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx extensions inspect notes --json",
        clientRequestId,
      }),
    ).toEqual({ operation: "inspect", input: { extensionId: "notes" } });
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx extensions defaults reset-order --json",
        clientRequestId,
      }),
    ).toBeNull();
  });

  it("uses the parent response and redacts rejected Runtime details", async () => {
    const request = parseSvvyxExtensionManagementRuntimeRequest({
      command: "svvyx extensions build notes --json",
      clientRequestId,
    })!;
    const accepted = await applyExtensionManagementRuntimeRequestForTransport(
      request,
      async () => ({
        output: { ok: true, extensionId: "notes" },
        commandFacts: { extensionBuildOk: true },
      }),
    );
    expect(accepted).toEqual({
      output: { ok: true, extensionId: "notes" },
      commandFacts: { extensionBuildOk: true },
    });

    const rejected = await applyExtensionManagementRuntimeRequestForTransport(request, async () => {
      throw new Error("secret path /private/keychain/item and sha256:private");
    });
    expect(JSON.stringify(rejected)).not.toContain("/private/keychain");
    expect(rejected).toEqual({
      output: {
        ok: false,
        error: {
          code: "EXTENSION_BUILD_FAILED",
          message:
            "The extension build did not complete. Inspect Extensions readiness for details.",
        },
      },
      commandFacts: {
        extensionManagementRuntimeRequest: "build",
        extensionManagementRuntimeOk: false,
      },
    });
  });
});
