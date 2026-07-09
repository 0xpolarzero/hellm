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

function chromeLayout(surfacePiSessionId = "surface-1", threadId?: string): StateReadModelResult {
  return {
    kind: "workspaceChromeLayout",
    value: {
      activeWorkspaceTabId: "tab-1" as WorkspaceTabId,
      tabs: [
        {
          workspaceTabId: "tab-1" as WorkspaceTabId,
          workspaceId,
          cwd: "/tmp/workspace",
          openedAt: "2026-07-09T00:00:00.000Z",
          activeLayoutId: "A",
        },
      ],
      knownWorkspaces: [],
      layouts: [
        {
          workspaceId,
          layoutId: "A",
          initialized: true,
          snapshotJson: null,
          focusedPaneId: "primary" as WorkspacePaneId,
          panelMetadata: [
            {
              paneId: "primary",
              kind: "surface",
              surfacePiSessionId,
              ...(threadId ? { threadId } : {}),
              localStateJson: null,
            } as never,
          ],
        },
      ],
    },
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
        fetchStateReadModel: async () => chromeLayout("surface-current"),
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
      fetchStateReadModel: async () => chromeLayout("surface-1"),
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
        fetchStateReadModel: async () => chromeLayout(),
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
