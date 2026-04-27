import { describe, expect, it } from "bun:test";
import type {
  PromptTarget,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
} from "./chat-rpc";
import {
  buildCommandRegistry,
  executeCommandAction,
  executePaletteFallbackPrompt,
  filterCommandActions,
  getCommandActionShortcutHints,
  getCommandExecutionPaneId,
  getCommandPalettePlacement,
  isCommandPaletteShortcut,
  isQuickOpenShortcut,
  type CommandRuntime,
} from "./command-palette";

function session(
  id: string,
  title: string,
  options: Partial<Pick<WorkspaceSessionSummary, "isPinned" | "isArchived" | "preview">> = {},
): WorkspaceSessionSummary {
  return {
    id,
    title,
    preview: options.preview ?? "",
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    messageCount: 0,
    status: "idle",
    isPinned: options.isPinned ?? false,
    pinnedAt: options.isPinned ? "2026-04-27T10:00:00.000Z" : null,
    isArchived: options.isArchived ?? false,
    archivedAt: options.isArchived ? "2026-04-27T10:00:00.000Z" : null,
    wait: null,
  };
}

function handlerThread(
  threadId: string,
  title: string,
  options: Partial<WorkspaceHandlerThreadSummary> = {},
): WorkspaceHandlerThreadSummary {
  return {
    threadId,
    surfacePiSessionId: options.surfacePiSessionId ?? `${threadId}-surface`,
    title,
    objective: options.objective ?? "Handle delegated work.",
    status: options.status ?? "completed",
    wait: options.wait ?? null,
    startedAt: options.startedAt ?? "2026-04-27T10:00:00.000Z",
    updatedAt: options.updatedAt ?? "2026-04-27T10:00:00.000Z",
    finishedAt: options.finishedAt ?? null,
    commandCount: options.commandCount ?? 0,
    workflowRunCount: options.workflowRunCount ?? 0,
    workflowTaskAttemptCount: options.workflowTaskAttemptCount ?? 0,
    episodeCount: options.episodeCount ?? 0,
    artifactCount: options.artifactCount ?? 0,
    ciRunCount: options.ciRunCount ?? 0,
    loadedContextKeys: options.loadedContextKeys ?? [],
    latestWorkflowRun: options.latestWorkflowRun ?? null,
    latestCiRun: options.latestCiRun ?? null,
    latestEpisode: options.latestEpisode ?? null,
    workflowTaskAttempts: options.workflowTaskAttempts,
  };
}

function keyEvent(input: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}) {
  return {
    key: input.key,
    metaKey: input.metaKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    shiftKey: input.shiftKey ?? false,
    altKey: input.altKey ?? false,
  };
}

function createRuntime(): CommandRuntime & {
  calls: string[];
  paneTarget: PromptTarget | null;
} {
  const runtime = {
    calls: [] as string[],
    paneTarget: null as PromptTarget | null,
    getPane: (paneId: string) => ({
      id: paneId,
      target: runtime.paneTarget,
      inspectorSelection: null,
      columnStart: 0,
      columnEnd: 1,
      rowStart: 0,
      rowEnd: 1,
      timelineDensity: "comfortable" as const,
    }),
    createSession: async (_request = {}, paneId: unknown = "primary") => {
      runtime.calls.push(`create:${paneId}`);
      runtime.paneTarget = {
        workspaceSessionId: "new-session",
        surface: "orchestrator",
        surfacePiSessionId: "new-session",
      };
    },
    openSession: async (sessionId: string, paneId: unknown = "primary") => {
      runtime.calls.push(`open:${sessionId}:${paneId}`);
      runtime.paneTarget = {
        workspaceSessionId: sessionId,
        surface: "orchestrator",
        surfacePiSessionId: sessionId,
      };
    },
    openSurface: async (target: PromptTarget, paneId: unknown = "primary") => {
      runtime.calls.push(`surface:${target.surfacePiSessionId}:${paneId}`);
      runtime.paneTarget = target;
    },
    pinSession: async (sessionId: string) => {
      runtime.calls.push(`pin:${sessionId}`);
    },
    unpinSession: async (sessionId: string) => {
      runtime.calls.push(`unpin:${sessionId}`);
    },
    archiveSession: async (sessionId: string) => {
      runtime.calls.push(`archive:${sessionId}`);
    },
    unarchiveSession: async (sessionId: string) => {
      runtime.calls.push(`unarchive:${sessionId}`);
    },
    sendPromptToTarget: async (target: PromptTarget, input: string) => {
      runtime.calls.push(`prompt:${target.surfacePiSessionId}:${input}`);
    },
  };
  return runtime;
}

describe("command palette shortcuts", () => {
  it("distinguishes all-actions and quick-open shortcuts", () => {
    expect(isCommandPaletteShortcut(keyEvent({ key: "p", metaKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(isCommandPaletteShortcut(keyEvent({ key: "P", ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(isCommandPaletteShortcut(keyEvent({ key: "p", metaKey: true }))).toBe(false);
    expect(
      isCommandPaletteShortcut(keyEvent({ key: "p", metaKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);

    expect(isQuickOpenShortcut(keyEvent({ key: "p", metaKey: true }))).toBe(true);
    expect(isQuickOpenShortcut(keyEvent({ key: "p", ctrlKey: true }))).toBe(true);
    expect(isQuickOpenShortcut(keyEvent({ key: "p", metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("uses new panes by default and focused pane for Cmd+Enter", () => {
    expect(
      getCommandExecutionPaneId({
        placement: getCommandPalettePlacement(keyEvent({ key: "Enter" })),
        focusedPaneId: "primary",
        now: 1,
      }),
    ).toBe("command-palette-1");
    expect(
      getCommandExecutionPaneId({
        placement: getCommandPalettePlacement(keyEvent({ key: "Enter", metaKey: true })),
        focusedPaneId: "primary",
      }),
    ).toBe("primary");
  });

  it("shows pane execution hints on session-opening actions", () => {
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
    });

    expect(
      getCommandActionShortcutHints(actions.find((action) => action.id === "session.new")!),
    ).toEqual(["Enter", "Cmd+Enter"]);
    expect(
      getCommandActionShortcutHints(
        actions.find((action) => action.id === "session.open.session-1")!,
      ),
    ).toEqual(["Enter", "Cmd+Enter"]);
  });
});

describe("buildCommandRegistry", () => {
  it("builds session, navigation, Project CI, settings, and handler-thread actions", () => {
    const actions = buildCommandRegistry({
      sessions: [
        session("session-1", "Parser Fix", { preview: "Fix parser" }),
        session("session-2", "Archived", { isArchived: true }),
      ],
      focusedSessionId: "session-1",
      handlerThreads: [
        handlerThread("thread-1", "Implement parser fix", {
          surfacePiSessionId: "thread-surface-1",
          objective: "Patch parser handling.",
          workflowTaskAttempts: [
            {
              workflowTaskAttemptId: "task-attempt-1",
              workflowRunId: "workflow-run-1",
              smithersRunId: "smithers-run-1",
              nodeId: "codegen",
              iteration: 0,
              attempt: 1,
              title: "Generate parser patch",
              kind: "agent",
              status: "completed",
              summary: "Generated parser updates.",
              updatedAt: "2026-04-27T10:00:00.000Z",
              commandCount: 2,
              artifactCount: 1,
              transcriptMessageCount: 3,
            },
          ],
        }),
      ],
    });

    expect(actions.map((action) => action.id)).toContain("session.new");
    expect(actions.map((action) => action.id)).toContain("settings.open");
    expect(actions.map((action) => action.id)).toContain("project-ci.run");
    expect(actions.map((action) => action.id)).toContain("session.open.session-1");
    expect(actions.map((action) => action.id)).toContain("session.unarchive.session-2");
    expect(actions.map((action) => action.id)).not.toContain("surface.open-orchestrator.session-1");
    expect(actions.map((action) => action.id)).toContain("session.open.thread.thread-1");
    expect(actions.map((action) => action.id)).toContain("session.open.task-agent.task-attempt-1");
    expect(actions.find((action) => action.id === "session.open.session-1")?.badge).toBe(
      "Orchestrator",
    );
    expect(actions.find((action) => action.id === "session.open.thread.thread-1")?.badge).toBe(
      "Thread",
    );
    expect(
      actions.find((action) => action.id === "session.open.task-agent.task-attempt-1")?.badge,
    ).toBe("Task Agent");
    expect(actions.find((action) => action.id === "session.pin.session-2")?.availability.kind).toBe(
      "disabled",
    );
  });

  it("matches exact and prefix results before fuzzy results", () => {
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix"), session("session-2", "Release Audit")],
      focusedSessionId: "session-1",
    });

    expect(filterCommandActions(actions, "Open Session: Parser Fix")[0]?.id).toBe(
      "session.open.session-1",
    );
    expect(filterCommandActions(actions, "open session")[0]?.id).toBe("session.open.session-1");
    expect(filterCommandActions(actions, "open rls")[0]?.id).toBe("session.open.session-2");
  });
});

describe("executeCommandAction", () => {
  it("routes command actions through the runtime product model", async () => {
    const runtime = createRuntime();
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
    });

    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "session.open.session-1")!,
      paneId: "pane-a",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "session.pin.session-1")!,
      paneId: "pane-a",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "project-ci.run")!,
      paneId: "pane-b",
    });

    expect(runtime.calls).toEqual([
      "open:session-1:pane-a",
      "pin:session-1",
      "open:session-1:pane-b",
      "prompt:session-1:Run Project CI for this workspace.",
    ]);
  });

  it("opens workflow task-agent sessions through the task-attempt inspector callback", async () => {
    const runtime = createRuntime();
    const openedAttempts: Array<{ workspaceSessionId: string; workflowTaskAttemptId: string }> = [];
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
      handlerThreads: [
        handlerThread("thread-1", "Implement parser fix", {
          workflowTaskAttempts: [
            {
              workflowTaskAttemptId: "task-attempt-1",
              workflowRunId: "workflow-run-1",
              smithersRunId: "smithers-run-1",
              nodeId: "codegen",
              iteration: 0,
              attempt: 1,
              title: "Generate parser patch",
              kind: "agent",
              status: "completed",
              summary: "Generated parser updates.",
              updatedAt: "2026-04-27T10:00:00.000Z",
              commandCount: 2,
              artifactCount: 1,
              transcriptMessageCount: 3,
            },
          ],
        }),
      ],
    });

    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "session.open.task-agent.task-attempt-1")!,
      paneId: "pane-a",
      onOpenWorkflowTaskAttempt: (input) => {
        openedAttempts.push(input);
      },
    });

    expect(openedAttempts).toEqual([
      { workspaceSessionId: "session-1", workflowTaskAttemptId: "task-attempt-1" },
    ]);
    expect(runtime.calls).toEqual([]);
  });

  it("creates a normal session and sends unmatched text as the initial prompt", async () => {
    const runtime = createRuntime();
    const createdTargets: PromptTarget[] = [];

    await executePaletteFallbackPrompt({
      runtime,
      prompt: "Implement command palette",
      paneId: "command-palette-abc",
      onCreatedTarget: (target) => {
        createdTargets.push(target);
      },
    });

    expect(runtime.calls).toEqual([
      "create:command-palette-abc",
      "prompt:new-session:Implement command palette",
    ]);
    expect(createdTargets).toEqual([
      {
        workspaceSessionId: "new-session",
        surface: "orchestrator",
        surfacePiSessionId: "new-session",
      },
    ]);
  });

  it("does not create a fallback session for empty quick-open-style text", async () => {
    const runtime = createRuntime();

    const didRun = await executePaletteFallbackPrompt({
      runtime,
      prompt: "   ",
      paneId: "command-palette-abc",
    });

    expect(didRun).toBe(false);
    expect(runtime.calls).toEqual([]);
  });
});
