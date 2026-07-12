import { describe, expect, test } from "bun:test";

import {
  runSvvyxExtensionsCommand,
  type SvvyxExtensionsLifecycleAdapter,
} from "./svvyx-extensions-command";

describe("svvyx extension lifecycle authority boundary", () => {
  test("translates the seven migrated JSON commands to exact typed lifecycle DTOs", async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const mutationId =
      "extension-source-mutation:notes:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const lifecycle = {
      create: async (input) => {
        calls.push({ operation: "create", input });
        return { action: "created", mutationId, extensionId: input.id, changed: true };
      },
      duplicate: async (input) => {
        calls.push({ operation: "duplicate", input });
        return {
          action: "duplicated",
          mutationId,
          sourceExtensionId: input.sourceExtensionId,
          extensionId: input.targetExtensionId,
          changed: true,
        };
      },
      delete: async (input) => {
        calls.push({ operation: "delete", input });
        return { action: "deleted", mutationId, extensionId: input.extensionId, changed: true };
      },
      reset: async (input) => {
        calls.push({ operation: "reset", input });
        return {
          source: {
            action: "reset",
            mutationId,
            extensionId: input.extensionId,
            scope: "instructions",
            changed: true,
          },
          automaticBuild: { status: "not-started", failureReason: "unknown" },
        };
      },
      addInstruction: async (input) => {
        calls.push({ operation: "addInstruction", input });
        return {
          action: "instruction-added",
          mutationId,
          extensionId: input.extensionId,
          name: input.name,
          changed: true,
        };
      },
      removeInstruction: async (input) => {
        calls.push({ operation: "removeInstruction", input });
        return {
          action: "instruction-removed",
          mutationId,
          extensionId: input.extensionId,
          name: input.name,
          changed: true,
        };
      },
      configureInstruction: async (input) => {
        calls.push({ operation: "configureInstruction", input });
        return {
          action: "instruction-configured",
          mutationId,
          extensionId: input.extensionId,
          name: input.name,
          bypassed: input.bypassed,
          changed: true,
        };
      },
    } as SvvyxExtensionsLifecycleAdapter;

    const commands = [
      'svvyx extensions create --id notes --title "Notes" --description "Project notes" --interface instructions --json',
      'svvyx extensions duplicate --from notes --id notes-copy --title "Notes Copy" --json',
      "svvyx extensions delete notes --json",
      "svvyx extensions reset workflows --scope instructions --json",
      "svvyx extensions instructions add notes --name 020-guide.mdx --json",
      "svvyx extensions instructions remove notes --name 020-guide.mdx --json",
      "svvyx extensions instructions configure notes --file 020-guide.mdx --bypassed true --json",
    ];
    const outputs = [];
    for (const command of commands) {
      outputs.push((await runSvvyxExtensionsCommand({ command, lifecycle })).output);
    }

    expect(calls).toEqual([
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
      { operation: "reset", input: { extensionId: "workflows", scope: "instructions" } },
      {
        operation: "addInstruction",
        input: { extensionId: "notes", name: "020-guide.mdx" },
      },
      {
        operation: "removeInstruction",
        input: { extensionId: "notes", name: "020-guide.mdx" },
      },
      {
        operation: "configureInstruction",
        input: { extensionId: "notes", name: "020-guide.mdx", bypassed: true },
      },
    ]);
    expect(outputs[3]).toMatchObject({
      ok: true,
      automaticBuild: { status: "not-started", failureReason: "unknown" },
    });
  });

  test("rejects legacy Markdown names before calling lifecycle authority", async () => {
    const calls: unknown[] = [];
    const lifecycle = {
      addInstruction: async (input: unknown) => {
        calls.push(input);
      },
    } as unknown as SvvyxExtensionsLifecycleAdapter;
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add notes --name guide.md --json",
        lifecycle,
      }),
    ).rejects.toThrow("must use the .mdx extension");
    expect(calls).toEqual([]);
  });
});
