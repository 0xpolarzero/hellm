import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import { decodeUnknownSvvyxExtensionManagementRuntimeIntentExit } from "./svvyx-extension-management-transport-contracts";

describe("svvyx Extension Managing Runtime transport", () => {
  it("decodes every exact response-bearing request", () => {
    const mutationId =
      "extension-source-mutation:notes:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for (const request of [
      { operation: "inspect", input: { extensionId: "notes" } },
      {
        operation: "build",
        input: { extensionId: "notes", clientRequestId: "runtime-client:command-1" },
      },
      { operation: "snapshots.list", input: {} },
      {
        operation: "snapshots.save",
        input: { clientRequestId: "runtime-client:snapshot-save", name: "Before refactor" },
      },
      {
        operation: "snapshots.rename",
        input: {
          clientRequestId: "runtime-client:snapshot-rename",
          snapshotId: "extension-snapshot:fixture",
          name: "After refactor",
        },
      },
      {
        operation: "snapshots.delete",
        input: {
          clientRequestId: "runtime-client:snapshot-delete",
          snapshotId: "extension-snapshot:fixture",
        },
      },
      {
        operation: "create",
        input: {
          id: "notes",
          title: "Notes",
          description: "Project notes",
          interfaceKind: "instructions",
          typescriptApiEnabled: false,
        },
      },
      {
        operation: "duplicate",
        input: {
          sourceExtensionId: "notes",
          targetExtensionId: "notes-copy",
          title: "Notes Copy",
        },
      },
      { operation: "delete", input: { extensionId: "notes" } },
      { operation: "reset", input: { extensionId: "smithers", scope: "instructions" } },
      {
        operation: "instructions.add",
        input: { extensionId: "notes", name: "020-guide.mdx" },
      },
      {
        operation: "instructions.remove",
        input: { extensionId: "notes", name: "020-guide.mdx" },
      },
      {
        operation: "instructions.configure",
        input: { extensionId: "notes", name: "020-guide.mdx", bypassed: true },
      },
      {
        operation: "instructions.rename",
        input: { extensionId: "notes", from: "020-guide.mdx", to: "030-guide.mdx" },
      },
      {
        operation: "instructions.reorder",
        input: { extensionId: "notes", order: ["010-notes.mdx", "020-guide.mdx"] },
      },
      { operation: "source.revert", input: { mutationId } },
      {
        operation: "typescript-api.configure",
        input: { workspaceId: "workspace_01", extensionId: "notes", enabled: true },
      },
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

  it("rejects unknown fields and malformed lifecycle identities", () => {
    for (const request of [
      {
        operation: "snapshots.delete",
        input: {
          snapshotId: "snapshot_fixture",
          clientRequestId: "runtime-client:command-2",
          secretPayload: "must-not-cross-transport",
        },
      },
      {
        operation: "create",
        input: {
          id: "extensions",
          title: "Reserved",
          description: "Reserved extension",
          interfaceKind: "instructions",
          typescriptApiEnabled: false,
        },
      },
      {
        operation: "instructions.add",
        input: { extensionId: "notes", name: "../guide.mdx" },
      },
      {
        operation: "source.revert",
        input: { mutationId: "extension-source-mutation:notes:not-a-digest" },
      },
      {
        operation: "usage.revert",
        input: {
          clientRequestId: "runtime-client:usage-revert",
          changeId: "extension-usage-change:",
        },
      },
      {
        operation: "typescript-api.configure",
        input: {
          workspaceId: "workspace_01",
          extensionId: "notes",
          enabled: true,
          sourcePath: "/private/source",
        },
      },
    ]) {
      expect(
        Exit.isFailure(
          decodeUnknownSvvyxExtensionManagementRuntimeIntentExit({
            id: "extension-management-runtime-request",
            kind: "extension_management.runtime_request",
            request,
          }),
        ),
      ).toBe(true);
    }
  });
});
