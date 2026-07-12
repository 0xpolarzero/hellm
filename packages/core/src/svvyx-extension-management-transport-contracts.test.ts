import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import { decodeUnknownSvvyxExtensionManagementRuntimeIntentExit } from "./svvyx-extension-management-transport-contracts";

describe("svvyx Extension Managing Runtime transport", () => {
  it("decodes exact inspect, build, and snapshot requests", () => {
    for (const request of [
      { operation: "inspect", input: { extensionId: "notes" } },
      {
        operation: "build",
        input: { extensionId: "notes", clientRequestId: "runtime-client:command-1" },
      },
      { operation: "snapshots.list", input: {} },
      {
        operation: "usage.set",
        input: {
          clientRequestId: "runtime-client:usage-1",
          extensionId: "smithers",
          agentProfile: "default-orchestrator",
          usage: "loaded",
        },
      },
      {
        operation: "usage.revert",
        input: {
          clientRequestId: "runtime-client:usage-2",
          changeId: "extension-usage-change:runtime-client:usage-1",
        },
      },
      {
        operation: "snapshots.load",
        input: {
          snapshotId: "extension-snapshot:fixture",
          clientRequestId: "runtime-client:command-2",
        },
      },
    ]) {
      expect(
        Exit.isSuccess(
          decodeUnknownSvvyxExtensionManagementRuntimeIntentExit({
            id: "extension-management-runtime-request",
            kind: "extension_management.runtime_request",
            request,
          }),
        ),
      ).toBe(true);
    }
  });

  it("rejects unknown fields and malformed snapshot identities", () => {
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxExtensionManagementRuntimeIntentExit({
          id: "extension-management-runtime-request",
          kind: "extension_management.runtime_request",
          request: {
            operation: "snapshots.delete",
            input: {
              snapshotId: "snapshot_fixture",
              clientRequestId: "runtime-client:command-2",
              secretPayload: "must-not-cross-transport",
            },
          },
        }),
      ),
    ).toBe(true);
  });
});
