import { describe, expect, it } from "bun:test";

import { parseSvvyxExtensionManagementRuntimeRequest } from "./svvyx-extensions-command";
import { applyExtensionManagementRuntimeRequestForTransport } from "./svvy-direct-tools";

const rejectWithSensitiveRuntimeFailure = async () => {
  throw new Error("secret path /private/keychain/item and sha256:private");
};

describe("Extension Managing Runtime request parsing", () => {
  const clientRequestId = "runtime-client:svvyx:test" as never;
  const workspaceId = "workspace-test" as never;
  const mutationId =
    "extension-source-mutation:notes:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("parses every shipped command into the exact response-bearing operation", () => {
    expect(
      [
        "svvyx extensions inspect notes --json",
        "svvyx extensions build notes --json",
        'svvyx extensions create --id notes --title "Notes" --description "Project notes" --interface instructions --json',
        'svvyx extensions duplicate --from notes --id notes-copy --title "Notes Copy" --json',
        "svvyx extensions delete notes --json",
        "svvyx extensions reset smithers --scope instructions --json",
        "svvyx extensions instructions add notes --name 020-guide.mdx --json",
        "svvyx extensions instructions remove notes --name 020-guide.mdx --json",
        "svvyx extensions instructions configure notes --file 020-guide.mdx --bypassed true --json",
        "svvyx extensions instructions rename notes --from 020-guide.mdx --to 030-guide.mdx --json",
        "svvyx extensions instructions reorder notes --file 010-notes.mdx --file 020-guide.mdx --json",
        `svvyx extensions revert ${mutationId} --json`,
        "svvyx extensions configure --extension notes --typescript-api true --json",
        "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state loaded --json",
        "svvyx extensions revert extension-usage-change:one --json",
        "svvyx extensions snapshots list --json",
        'svvyx extensions snapshots save --name "Before refactor" --json',
        'svvyx extensions snapshots rename extension-snapshot:one --name "After" --json',
        "svvyx extensions snapshots delete extension-snapshot:one --json",
        "svvyx extensions snapshots load extension-snapshot:one --json",
      ].map(
        (command) =>
          parseSvvyxExtensionManagementRuntimeRequest({
            command,
            clientRequestId,
            workspaceId,
          })?.operation,
      ),
    ).toEqual([
      "inspect",
      "build",
      "create",
      "duplicate",
      "delete",
      "reset",
      "instructions.add",
      "instructions.remove",
      "instructions.configure",
      "instructions.rename",
      "instructions.reorder",
      "source.revert",
      "typescript-api.configure",
      "usage.set",
      "usage.revert",
      "snapshots.list",
      "snapshots.save",
      "snapshots.rename",
      "snapshots.delete",
      "snapshots.load",
    ]);
  });

  it("preserves exact lifecycle DTO field names", () => {
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command:
          'svvyx extensions create --id linear --title "Linear" --description "Linear issues" --interface svvyx --typescript-api true --json',
        clientRequestId,
        workspaceId,
      }) as unknown,
    ).toEqual({
      operation: "create",
      input: {
        id: "linear",
        title: "Linear",
        description: "Linear issues",
        interfaceKind: "svvyx",
        typescriptApiEnabled: true,
      },
    });
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx extensions configure --extension notes --typescript-api false --json",
        clientRequestId,
        workspaceId,
      }) as unknown,
    ).toEqual({
      operation: "typescript-api.configure",
      input: { workspaceId, extensionId: "notes", enabled: false },
    });
  });

  it("allows generated contributor bypass configuration without granting source edits", () => {
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command:
          "svvyx extensions instructions configure smithers --file 010-smithers-core.generated.md --bypassed true --json",
        clientRequestId,
        workspaceId,
      }) as unknown,
    ).toEqual({
      operation: "instructions.configure",
      input: {
        extensionId: "smithers",
        name: "010-smithers-core.generated.md",
        bypassed: true,
      },
    });

    for (const command of [
      "svvyx extensions instructions add smithers --name 010-smithers-core.generated.md --json",
      "svvyx extensions instructions remove smithers --name 010-smithers-core.generated.md --json",
      "svvyx extensions instructions rename smithers --from 010-smithers-core.generated.md --to 020-core.mdx --json",
      "svvyx extensions instructions reorder smithers --file 010-smithers-core.generated.md --json",
      "svvyx extensions instructions configure smithers --file instructions/010-smithers-core.generated.md --bypassed true --json",
      "svvyx extensions instructions configure smithers --file guide.md --bypassed true --json",
    ]) {
      expect(() =>
        parseSvvyxExtensionManagementRuntimeRequest({ command, clientRequestId, workspaceId }),
      ).toThrow();
    }
  });

  it("rejects invalid lifecycle syntax before emitting a parent request", () => {
    for (const command of [
      'svvyx extensions create --id extensions --title "Reserved" --description "Reserved" --interface instructions --json',
      "svvyx extensions instructions add notes --name guide.md --json",
      "svvyx extensions instructions reorder notes --json",
      "svvyx extensions instructions configure notes --file 020-guide.mdx --bypassed maybe --json",
      "svvyx extensions revert extension-source-mutation:notes:not-a-digest --json",
      "svvyx extensions revert extension-usage-change: --json",
      "svvyx extensions delete notes --json; echo unsafe",
      "svvyx extensions delete notes --json\nprintf unsafe",
      "svvyx extensions delete notes --json\rprintf unsafe",
    ]) {
      expect(() =>
        parseSvvyxExtensionManagementRuntimeRequest({ command, clientRequestId, workspaceId }),
      ).toThrow();
    }
  });

  it("requires workspace authority for TypeScript API configuration", () => {
    expect(() =>
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx extensions configure --extension notes --typescript-api true --json",
        clientRequestId,
      }),
    ).toThrow(
      "Extension TypeScript configuration requires the scoped workspace runtime authority.",
    );
  });

  it("returns null for commands outside the shipped Extension Managing surface", () => {
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx workflows list --json",
        clientRequestId,
        workspaceId,
      }),
    ).toBeNull();
    expect(
      parseSvvyxExtensionManagementRuntimeRequest({
        command: "svvyx extensions defaults reset-order --json",
        clientRequestId,
        workspaceId,
      }),
    ).toBeNull();
  });

  it("redacts Runtime failures with operation-family-correct Extension Managing errors", async () => {
    const cases = [
      {
        request: {
          operation: "build",
          input: { extensionId: "notes", clientRequestId },
        },
        code: "EXTENSION_BUILD_FAILED",
        message: "The extension build did not complete. Inspect Extensions readiness for details.",
      },
      {
        request: { operation: "snapshots.list", input: {} },
        code: "EXTENSION_SNAPSHOT_FAILED",
        message: "The extension snapshot operation did not complete. Refresh snapshots and retry.",
      },
      {
        request: {
          operation: "create",
          input: {
            id: "notes",
            title: "Notes",
            description: "Project notes",
            interfaceKind: "instructions",
            typescriptApiEnabled: false,
          },
        },
        code: "EXTENSION_MANAGEMENT_FAILED",
        message:
          "The Extension Managing operation did not complete. Refresh extension state and retry.",
      },
      {
        request: {
          operation: "typescript-api.configure",
          input: { workspaceId, extensionId: "notes", enabled: true },
        },
        code: "EXTENSION_MANAGEMENT_FAILED",
        message:
          "The Extension Managing operation did not complete. Refresh extension state and retry.",
      },
    ] as const;

    for (const item of cases) {
      const result = await applyExtensionManagementRuntimeRequestForTransport(
        item.request as never,
        rejectWithSensitiveRuntimeFailure,
      );
      expect(result).toEqual({
        output: { ok: false, error: { code: item.code, message: item.message } },
        commandFacts: {
          extensionManagementRuntimeRequest: item.request.operation,
          extensionManagementRuntimeOk: false,
        },
      });
      expect(JSON.stringify(result)).not.toContain("/private/keychain");
      expect(JSON.stringify(result)).not.toContain("sha256:private");
    }
  });
});
