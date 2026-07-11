import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import type { StateReadModelResult } from "@svvy/state";
import type {
  CommandId,
  IsoDateTimeString,
  QueueItemId,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  StateRevision,
  SubmitMessageInput,
  SurfacePiSessionId,
  WorkspaceId,
  WorkspacePaneId,
  WorkspaceSessionId,
  WorkspaceTabId,
  WriteCommandStdinInput,
} from "@svvy/core";
import { RuntimeContractError } from "@svvy/core";
import {
  isDesktopBridgeErrorContract,
  normalizeUnknownDesktopBridgeFailure,
  submitPromptFromDesktop,
  writeCommandStdinFromDesktop,
} from "./desktop-bridge-requests";

const workspaceId = "workspace-desktop-bridge" as WorkspaceId;
const orchestratorTarget = {
  workspaceSessionId: "session-1" as WorkspaceSessionId,
  surface: "orchestrator" as const,
  surfacePiSessionId: "surface-1" as SurfacePiSessionId,
};

function panelStateFetch(surfacePiSessionId = "surface-1", threadId?: string) {
  return async (
    request:
      | { readonly kind: "workspaceChrome" }
      | { readonly kind: "workspaceLayout"; readonly workspaceId: WorkspaceId },
  ): Promise<StateReadModelResult> => {
    if (request.kind === "workspaceChrome") {
      return {
        kind: "workspaceChrome",
        value: {
          activeWorkspaceTabId: "tab-1" as WorkspaceTabId,
          tabs: [
            {
              workspaceTabId: "tab-1" as WorkspaceTabId,
              workspaceId,
              cwd: "/tmp/workspace" as never,
              workspaceLabel: "Workspace",
              kind: "user",
              openedAt: "2026-07-09T00:00:00.000Z" as never,
              activeLayoutId: "A",
            },
          ],
          knownWorkspaces: [],
        },
      };
    }
    return {
      kind: "workspaceLayout",
      value: {
        workspaceId: request.workspaceId,
        slots: [
          {
            workspaceId: request.workspaceId,
            layoutId: "A",
            initialized: true,
            dockviewJson: null,
            focusedPaneId: "primary" as WorkspacePaneId,
            panes: [
              {
                paneId: "primary" as WorkspacePaneId,
                target: threadId
                  ? {
                      surface: "handler",
                      workspaceSessionId: "session-1" as WorkspaceSessionId,
                      surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
                      threadId: threadId as never,
                    }
                  : {
                      surface: "orchestrator",
                      workspaceSessionId: "session-1" as WorkspaceSessionId,
                      surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
                    },
                localState: { scroll: null, timelineDensity: "comfortable" },
                fallbackChrome: null,
                placement: null,
                restore: { kind: "ready" },
              },
            ],
            compactSurfaces: [],
            updatedAt: "2026-07-09T00:00:00.000Z" as never,
          },
          ...(["B", "C"] as const).map((layoutId) => ({
            workspaceId: request.workspaceId,
            layoutId,
            initialized: false,
            dockviewJson: null,
            focusedPaneId: null,
            panes: [],
            compactSurfaces: [],
            updatedAt: "2026-07-09T00:00:00.000Z" as never,
          })),
        ],
      },
    };
  };
}

describe("desktop bridge request normalization", () => {
  it("rejects stale renderer panel bindings before runtime submit", async () => {
    const submitted: SubmitMessageInput[] = [];

    await expect(
      submitPromptFromDesktop({
        payload: {
          panelId: "primary",
          target: orchestratorTarget,
          text: "Hello",
          clientRequestId: "client-1",
        },
        workspaceId,
        fetchStateReadModel: panelStateFetch("surface-current"),
        runtimeMessages: {
          submit: async (input) => {
            submitted.push(input);
            throw new Error("should not submit");
          },
        },
      }),
    ).rejects.toMatchObject({
      reason: "invalid-panel-binding",
      operation: "desktop.sendPrompt",
    });
    expect(submitted).toEqual([]);
  });

  it("submits only target, one message, delivery, and desktop client telemetry on current binding", async () => {
    const submitted: SubmitMessageInput[] = [];
    const result = await submitPromptFromDesktop({
      payload: {
        panelId: "primary",
        target: orchestratorTarget,
        text: "Hello",
        attachments: [],
        clientRequestId: "client-1",
      },
      workspaceId,
      fetchStateReadModel: panelStateFetch("surface-1"),
      runtimeMessages: {
        submit: async (input) => {
          submitted.push(input);
          return {
            queuedMessageId: "queued-1" as QueueItemId,
            target: input.target,
            status: "queued",
            receipt: {
              clientRequestId: input.clientSubmission?.clientRequestId ?? null,
              outcome: "accepted",
              acceptedAt: "2026-07-09T00:00:00.000Z" as IsoDateTimeString,
              stateRevision: 1 as StateRevision,
            },
          } as never;
        },
      },
    });

    expect(String(result.queuedMessageId)).toBe("queued-1");
    expect(result.target).toEqual(orchestratorTarget);
    expect(result.status).toBe("queued");
    expect(result.receipt.clientRequestId).toBe("client-1");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      target: orchestratorTarget,
      message: { text: "Hello", attachments: [] },
      delivery: "enqueue-and-run",
      clientSubmission: {
        clientRequestId: "client-1",
        source: "desktop",
      },
    });
  });

  it("uses the active duplicate tab layout instead of another tab for the same workspace", async () => {
    const baseFetch = panelStateFetch();
    const submitted: SubmitMessageInput[] = [];
    const fetchStateReadModel = async (
      request:
        | { readonly kind: "workspaceChrome" }
        | { readonly kind: "workspaceLayout"; readonly workspaceId: WorkspaceId },
    ): Promise<StateReadModelResult> => {
      const result = await baseFetch(request);
      if (result.kind === "workspaceChrome") {
        const firstTab = result.value.tabs[0]!;
        return {
          kind: "workspaceChrome",
          value: {
            ...result.value,
            activeWorkspaceTabId: "tab-2" as WorkspaceTabId,
            tabs: [
              firstTab,
              {
                ...firstTab,
                workspaceTabId: "tab-2" as WorkspaceTabId,
                activeLayoutId: "B",
              },
            ],
          },
        };
      }
      if (result.kind !== "workspaceLayout") {
        throw new Error(`Expected workspaceLayout; received ${result.kind}.`);
      }
      const primary = result.value.slots.find((slot) => slot.layoutId === "A")!.panes[0]!;
      return {
        kind: "workspaceLayout",
        value: {
          ...result.value,
          slots: result.value.slots.map((slot) =>
            slot.layoutId === "A"
              ? { ...slot, initialized: false, panes: [], focusedPaneId: null }
              : slot.layoutId === "B"
                ? {
                    ...slot,
                    initialized: true,
                    panes: [primary],
                    focusedPaneId: primary.paneId,
                  }
                : slot,
          ),
        },
      };
    };

    await submitPromptFromDesktop({
      payload: {
        panelId: "primary",
        target: orchestratorTarget,
        text: "Use tab B",
        clientRequestId: "client-duplicate-tab",
      },
      workspaceId,
      fetchStateReadModel,
      runtimeMessages: {
        submit: async (input) => {
          submitted.push(input);
          return { status: "queued" } as never;
        },
      },
    });

    expect(submitted).toHaveLength(1);
  });

  it("rejects forbidden submit payload fields as invalid input", async () => {
    await expect(
      submitPromptFromDesktop({
        payload: {
          panelId: "primary",
          target: orchestratorTarget,
          text: "Hello",
          clientRequestId: "client-1",
          panelSnapshot: {},
        },
        workspaceId,
        fetchStateReadModel: panelStateFetch(),
        runtimeMessages: {
          submit: async () => {
            throw new Error("should not submit");
          },
        },
      }),
    ).rejects.toMatchObject({
      reason: "invalid-input",
      operation: "desktop.sendPrompt",
    });
  });

  it("delegates command stdin by durable command id only", async () => {
    const writes: WriteCommandStdinInput[] = [];
    const result = await writeCommandStdinFromDesktop({
      payload: {
        commandId: "command-1",
        text: "yes\n",
        clientSubmission: {
          source: "command-inspector",
          clientRequestId: "stdin-1",
        },
      },
      runtimeCommands: {
        writeStdin: async (input) => {
          writes.push(input);
          return { commandId: input.commandId, status: "accepted", acceptedBytes: 4 };
        },
      },
    });

    expect(result).toMatchObject({ commandId: "command-1", status: "accepted", acceptedBytes: 4 });
    expect(writes).toEqual([
      {
        commandId: "command-1" as CommandId,
        text: "yes\n",
        clientSubmission: {
          source: "command-inspector" as RuntimeClientSubmissionSource,
          clientRequestId: "stdin-1" as RuntimeClientRequestId,
        },
      },
    ]);
  });

  it("rejects workspace, Shell session, private process, and renderer-state identities", async () => {
    let writes = 0;
    const runtimeCommands = {
      writeStdin: async () => {
        writes += 1;
        throw new Error("should not write");
      },
    };

    for (const forbiddenFields of [
      { workspaceId },
      { session_id: 42 },
      { processHandle: { pid: 123 } },
      { rendererState: { activeCommandId: "command-1" } },
    ]) {
      await expect(
        writeCommandStdinFromDesktop({
          payload: {
            commandId: "command-1",
            text: "yes\n",
            ...forbiddenFields,
          },
          runtimeCommands,
        }),
      ).rejects.toMatchObject({
        operation: "desktop.writeCommandStdin",
        reason: "invalid-input",
      });
    }

    expect(writes).toBe(0);
  });

  it("maps typed runtime rejection distinctly from defects without leaking stacks", async () => {
    const typedFailure = runtimeFacadeFailure(
      "typed-failure",
      new RuntimeContractError({
        operation: "runtime.commands.writeStdin",
        reason: "state-conflict",
        message: "sensitive typed runtime detail",
      }),
    );
    const defectFailure = runtimeFacadeFailure("defect");

    const typed = await writeCommandStdinFromDesktop({
      payload: { commandId: "command-1", text: "yes\n" },
      runtimeCommands: {
        writeStdin: async () => {
          throw typedFailure;
        },
      },
    }).catch((error) => error);
    const defect = await writeCommandStdinFromDesktop({
      payload: { commandId: "command-1", text: "yes\n" },
      runtimeCommands: {
        writeStdin: async () => {
          throw defectFailure;
        },
      },
    }).catch((error) => error);

    expect(isDesktopBridgeErrorContract(typed)).toBe(true);
    expect(typed).toMatchObject({
      operation: "desktop.writeCommandStdin",
      reason: "runtime-facade-failed",
      message: "Runtime command stdin was rejected by the runtime.",
    });
    expect(isDesktopBridgeErrorContract(defect)).toBe(true);
    expect(defect).toMatchObject({
      operation: "desktop.writeCommandStdin",
      reason: "runtime-facade-failed",
      message: "Runtime command stdin failed unexpectedly.",
    });
    expect(JSON.stringify({ typed, defect })).not.toContain("sensitive runtime facade stack");
    expect(JSON.stringify({ typed, defect })).not.toContain("sensitive typed runtime detail");
  });

  it("maps disposed and typed runtime-shutdown failures to stable desktop shutdown", async () => {
    const failures = [
      runtimeFacadeFailure("disposed"),
      runtimeFacadeFailure(
        "typed-failure",
        new RuntimeContractError({
          operation: "runtime.commands.writeStdin",
          reason: "runtime-shutdown",
          message: "runtime is shutting down",
        }),
      ),
    ];

    for (const failure of failures) {
      await expect(
        writeCommandStdinFromDesktop({
          payload: { commandId: "command-1", text: "yes\n" },
          runtimeCommands: {
            writeStdin: async () => {
              throw failure;
            },
          },
        }),
      ).rejects.toMatchObject({
        operation: "desktop.writeCommandStdin",
        reason: "desktop-shutdown",
        message: "Runtime command stdin is unavailable after desktop shutdown.",
      });
    }
  });

  it("contains no Shell, private process, workspace routing, or renderer-state policy", () => {
    const source = readFileSync(new URL("./desktop-bridge-requests.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function writeCommandStdinFromDesktop");
    const end = source.indexOf("\nfunction decodeDesktopSubmitPromptRequest", start);
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain("runtimeCommands.writeStdin");
    expect(helperSource).not.toMatch(
      /\b(?:write_stdin|session_id|processHandle|rendererState|workspaceId|getWorkspaceRuntime)\b/,
    );
  });

  it("normalizes shutdown failures without raw stack leakage", () => {
    const error = new Error("runtime shutdown");
    error.stack = "secret stack";
    const normalized = normalizeUnknownDesktopBridgeFailure("desktop.shutdown-test", error);

    expect(isDesktopBridgeErrorContract(normalized)).toBe(true);
    expect(normalized).toMatchObject({
      operation: "desktop.shutdown-test",
      reason: "desktop-shutdown",
      message: "runtime shutdown",
    });
    expect(JSON.stringify(normalized)).not.toContain("secret stack");
  });
});

function runtimeFacadeFailure(
  reason: "typed-failure" | "defect" | "interrupted" | "aborted" | "disposed",
  error?: RuntimeContractError,
): Error & {
  readonly type: "runtime-facade-error";
  readonly reason: typeof reason;
  readonly error?: RuntimeContractError;
} {
  const failure = Object.assign(new Error("sensitive runtime facade failure"), {
    type: "runtime-facade-error" as const,
    reason,
    ...(error ? { error } : {}),
  });
  failure.stack = "sensitive runtime facade stack";
  return failure;
}
