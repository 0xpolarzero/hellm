import { describe, expect, it } from "bun:test";
import type { AgentProfileSettings } from "../shared/agent-settings";
import type {
  PromptTarget,
  WorkspaceHandlerThreadSummary,
  WorkspacePaneSurfaceTarget,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";
import {
  buildCommandRegistry,
  executeCommandAction,
  executePaletteFallbackPrompt,
  filterCommandActions,
  getCommandActionPlacementHints,
  getCommandActionShortcutHints,
  getCommandExecutionPaneId,
  getCommandPaletteInitialInput,
  getCommandPaletteInputState,
  getCommandPalettePlacement,
  groupCommandActions,
  type CommandRuntime,
} from "./command-palette";
import {
  getShortcut,
  getShortcutHotkey,
  getShortcutReadable,
  isAppMenuAction,
  shouldShortcutIgnoreInputs,
} from "../shared/shortcut-registry";

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
    isUnread: false,
    unreadAt: null,
    unreadReason: null,
    lastReadAt: null,
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
    latestWorkflowRun: options.latestWorkflowRun ?? null,
    latestEpisode: options.latestEpisode ?? null,
    workflowTaskAttempts: options.workflowTaskAttempts,
  };
}

function orchestratorProfile(
  id: string,
  name: string,
  input: Partial<AgentProfileSettings> = {},
): AgentProfileSettings {
  return {
    id,
    kind: "orchestrator",
    name,
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-5.4",
    reasoningEffort: input.reasoningEffort ?? "medium",
    systemPrompt: input.systemPrompt ?? "Own strategy.",
    extensionUsage: input.extensionUsage ?? {},
    updateFromComposer: input.updateFromComposer ?? false,
    builtin: input.builtin ?? false,
    locked: input.locked ?? false,
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

function formatOpenTarget(target: unknown): string {
  return typeof target === "string" ? target : JSON.stringify(target);
}

function createRuntime(): CommandRuntime & {
  calls: string[];
  createRequests: unknown[];
  paneTarget: WorkspacePaneSurfaceTarget | null;
} {
  const runtime = {
    calls: [] as string[],
    createRequests: [] as unknown[],
    paneTarget: null as WorkspacePaneSurfaceTarget | null,
    getPane: (paneId: string) => ({
      id: paneId,
      target: runtime.paneTarget,
      scroll: null,
      timelineDensity: "comfortable" as const,
      chrome: null,
      restore: null,
    }),
    createSession: async (request = {}, paneId: unknown = "primary") => {
      runtime.calls.push(`create:${paneId}`);
      runtime.createRequests.push(request);
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
    openSurface: async (target: WorkspacePaneSurfaceTarget, paneId: unknown = "primary") => {
      const targetId =
        target.surface === "orchestrator" || target.surface === "thread"
          ? target.surfacePiSessionId
          : target.surface;
      runtime.calls.push(`surface:${targetId}:${formatOpenTarget(paneId)}`);
      runtime.paneTarget = target;
    },
    splitPane: async (
      paneId: string,
      direction: "left" | "right" | "above" | "below",
      options: { duplicateBinding?: boolean } = {},
    ) => {
      runtime.calls.push(
        `split:${paneId}:${direction}:${options.duplicateBinding ? "duplicate" : "empty"}`,
      );
      return "new-panel";
    },
    focusPane: (paneId: string) => {
      runtime.calls.push(`focus:${paneId}`);
    },
    closePane: async (paneId: string) => {
      runtime.calls.push(`close:${paneId}`);
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
  it("sources palette chords and display strings from the product shortcut registry", () => {
    expect(getShortcutHotkey("commandPalette.open")).toBe("Mod+Shift+P");
    expect(getShortcutReadable("commandPalette.open")).toBe("Cmd+Shift+P");
    expect(getShortcut("commandPalette.open")).toMatchObject({
      scope: "global",
      inputPolicy: "allow-while-typing",
      commandActionId: "commandPalette.open",
    });
    expect(getShortcutHotkey("quickOpen.open")).toBe("Mod+P");
    expect(getShortcutReadable("quickOpen.open")).toBe("Cmd+P");
    expect(getShortcut("quickOpen.open").inputPolicy).toBe("allow-while-typing");
    expect(getShortcutHotkey("workspace.open")).toBe("Mod+O");
    expect(getShortcutReadable("workspace.open")).toBe("Cmd+O");
    expect(getShortcut("workspace.open")).toMatchObject({
      label: "Open Workspace...",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
      accelerator: "CommandOrControl+O",
      commandActionId: "workspace.open",
    });
    expect(getShortcutHotkey("workspace.newTab")).toBe("Mod+T");
    expect(getShortcutReadable("workspace.newTab")).toBe("Cmd+T");
    expect(getShortcut("workspace.newTab")).toMatchObject({
      label: "New Tab",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
      accelerator: "CommandOrControl+T",
      commandActionId: "workspace.newTab",
    });
    expect(getShortcutHotkey("workspace.openInNewTab")).toBe("Mod+Shift+O");
    expect(getShortcutReadable("workspace.openInNewTab")).toBe("Cmd+Shift+O");
    expect(getShortcut("workspace.openInNewTab")).toMatchObject({
      label: "Open Workspace in New Tab...",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
      accelerator: "CommandOrControl+Shift+O",
      commandActionId: "workspace.openInNewTab",
    });
    expect(getShortcutHotkey("session.new")).toBe("Mod+N");
    expect(getShortcutReadable("session.new")).toBe("Cmd+N");
    expect(getShortcut("session.new")).toMatchObject({
      label: "New orchestrator",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
      accelerator: "CommandOrControl+N",
      commandActionId: "session.new",
    });
    expect(getShortcutHotkey("session.newPane")).toBe("Mod+Shift+N");
    expect(getShortcutReadable("session.newPane")).toBe("Cmd+Shift+N");
    expect(getShortcut("session.newPane")).toMatchObject({
      label: "New orchestrator in new pane",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
      accelerator: "CommandOrControl+Shift+N",
    });
    expect(getShortcutHotkey("surface.logs.open")).toBe("Mod+Shift+1");
    expect(getShortcutReadable("surface.agents.open")).toBe("Cmd+Shift+2");
    expect(getShortcutReadable("surface.extensions.open")).toBe("Cmd+Shift+3");
    expect(getShortcut("surface.extensions.open")).toMatchObject({
      label: "Open Extensions",
      readableShortcut: "Cmd+Shift+3",
      scope: "workspace-shell",
      inputPolicy: "allow-while-typing",
    });
    expect(getShortcutReadable("surface.workflows.open")).toBe("Cmd+Shift+4");
  });

  it("keeps app launcher and shell command chords active while text inputs are focused", () => {
    expect(shouldShortcutIgnoreInputs("commandPalette.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("quickOpen.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("workspace.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("workspace.newTab")).toBe(false);
    expect(shouldShortcutIgnoreInputs("workspace.openInNewTab")).toBe(false);
    expect(shouldShortcutIgnoreInputs("session.new")).toBe(false);
    expect(shouldShortcutIgnoreInputs("session.newPane")).toBe(false);
    expect(shouldShortcutIgnoreInputs("sidebar.toggle")).toBe(false);
    expect(shouldShortcutIgnoreInputs("surface.logs.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("surface.workflows.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("surface.agents.open")).toBe(false);
    expect(shouldShortcutIgnoreInputs("surface.extensions.open")).toBe(false);
  });

  it("exposes workspace actions through the typed app menu action path", () => {
    expect(isAppMenuAction("workspace.open")).toBe(true);
    expect(isAppMenuAction("workspace.newTab")).toBe(true);
    expect(isAppMenuAction("workspace.openInNewTab")).toBe(true);
  });

  it("uses the VS Code-style command prefix to derive live palette mode", () => {
    expect(getCommandPaletteInitialInput("commands")).toBe(">");
    expect(getCommandPaletteInitialInput("search")).toBe("");
    expect(getCommandPaletteInputState("")).toEqual({ mode: "search", commandQuery: "" });
    expect(getCommandPaletteInputState("Open Session")).toEqual({
      mode: "search",
      commandQuery: "",
    });
    expect(getCommandPaletteInputState(">")).toEqual({ mode: "commands", commandQuery: "" });
    expect(getCommandPaletteInputState("> Open Session")).toEqual({
      mode: "commands",
      commandQuery: "Open Session",
    });
    expect(getCommandPaletteInputState(">Open Logs")).toEqual({
      mode: "commands",
      commandQuery: "Open Logs",
    });
  });

  it("uses new panels by default and focused panel for Cmd+Enter", () => {
    expect(
      getCommandExecutionPaneId({
        placement: getCommandPalettePlacement(keyEvent({ key: "Enter" })),
        focusedPanelId: "primary",
        now: 1,
      }),
    ).toBe("command-palette-1");
    expect(
      getCommandExecutionPaneId({
        placement: getCommandPalettePlacement(keyEvent({ key: "Enter", metaKey: true })),
        focusedPanelId: "primary",
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
    ).toEqual(["Cmd+N", "Enter", "Cmd+Enter"]);
    expect(
      getCommandActionShortcutHints(
        actions.find((action) => action.id === "session.open.session-1")!,
      ),
    ).toEqual(["Enter", "Cmd+Enter"]);
  });

  it("labels and groups visible actions by product category", () => {
    const actions = filterCommandActions(
      buildCommandRegistry({
        sessions: [session("session-1", "Parser Fix")],
        focusedSessionId: "session-1",
      }),
      "",
    );

    const groups = groupCommandActions(actions);

    expect(actions[0]?.id).toBe("workspace.open");
    expect(groups.map((group) => group.category)).toEqual([
      "workspace",
      "session",
      "surface",
      "workflows",
      "agents",
      "pane",
      "settings",
    ]);
    expect(
      groups.find((group) => group.category === "session")?.actions.map((action) => action.id),
    ).toContain("session.open.session-1");
  });

  it("adds explicit placement labels for pane-opening actions only", () => {
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
    });

    expect(
      getCommandActionPlacementHints(
        actions.find((action) => action.id === "session.open.session-1")!,
      ),
    ).toEqual([
      { shortcut: "Enter", label: "New pane" },
      { shortcut: "Cmd+Enter", label: "Focused pane" },
    ]);
    expect(
      getCommandActionPlacementHints(
        actions.find((action) => action.id === "pane.duplicate-right")!,
      ),
    ).toEqual([]);
    expect(
      getCommandActionPlacementHints(actions.find((action) => action.id === "workflows.open")!),
    ).toEqual([
      { shortcut: "Enter", label: "New pane" },
      { shortcut: "Cmd+Enter", label: "Focused pane" },
    ]);
    expect(
      getCommandActionPlacementHints(actions.find((action) => action.id === "agents.open")!),
    ).toEqual([
      { shortcut: "Enter", label: "New pane" },
      { shortcut: "Cmd+Enter", label: "Focused pane" },
    ]);
    expect(
      getCommandActionPlacementHints(actions.find((action) => action.id === "settings.open")!),
    ).toEqual([
      { shortcut: "Enter", label: "New pane" },
      { shortcut: "Cmd+Enter", label: "Focused pane" },
    ]);
  });
});

describe("buildCommandRegistry", () => {
  it("builds session, navigation, settings, and handler-thread actions without Project CI", () => {
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
              contextBudget: null,
            },
          ],
        }),
      ],
    });

    expect(actions.map((action) => action.id)).toContain("session.new");
    expect(actions.map((action) => action.id)).toContain("workspace.open");
    expect(actions.map((action) => action.id)).toContain("workspace.newTab");
    expect(actions.map((action) => action.id)).toContain("workspace.openInNewTab");
    expect(actions.map((action) => action.id)).toContain("settings.open");
    expect(actions.map((action) => action.id)).toContain("workflows.open");
    expect(actions.map((action) => action.id)).toContain("agents.open");
    expect(actions.map((action) => action.id)).toContain("extensions.open");
    expect(actions.map((action) => action.id)).toContain("extensions.generatedContextPreview");
    expect(actions.map((action) => action.id)).toContain("snippets.open");
    expect(actions.map((action) => action.id)).toContain("surface.logs.open");
    expect(actions.map((action) => action.id)).toContain("pane.duplicate-right");
    expect(actions.map((action) => action.id)).toContain("pane.duplicate-below");
    expect(actions.map((action) => action.id)).toContain("pane.place-left");
    expect(actions.map((action) => action.id)).toContain("pane.place-right");
    expect(actions.map((action) => action.id)).toContain("pane.place-above");
    expect(actions.map((action) => action.id)).toContain("pane.place-below");
    expect(actions.map((action) => action.id)).toContain("pane.place-edge-left");
    expect(actions.map((action) => action.id)).toContain("pane.place-edge-right");
    expect(actions.map((action) => action.id)).toContain("pane.place-edge-top");
    expect(actions.map((action) => action.id)).toContain("pane.place-edge-bottom");
    expect(actions.map((action) => action.id)).toContain("pane.place-floating");
    expect(actions.map((action) => action.id)).toContain("pane.place-popout");
    expect(actions.map((action) => action.id)).not.toContain("pane.split-right");
    expect(actions.map((action) => action.id)).not.toContain("pane.split-below");
    expect(actions.map((action) => action.id)).not.toContain("project-ci.run");
    expect(actions.map((action) => action.id)).not.toContain("project-ci.configure");
    expect(actions.map((action) => action.id)).not.toContain("thread.resume.thread-1");
    expect(actions.map((action) => action.id)).not.toContain("thread.handoff.thread-1");
    expect(actions.map((action) => action.id)).not.toContain("request-context.open");
    expect(actions.map((action) => action.id)).not.toContain("runtime.current");
    expect(actions.map((action) => action.id).some((id) => id.startsWith("smithers."))).toBe(false);
    for (const removedWorkflowPrefix of [
      "workflow.run",
      "workflow.resume",
      "workflow.approve",
      "workflow.inspect",
      "workflow.debug",
      "workflow.install",
      "workflow.retrieve",
      "workflow.promote",
    ]) {
      expect(
        actions.map((action) => action.id).some((id) => id.startsWith(removedWorkflowPrefix)),
      ).toBe(false);
    }
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
    ).toBe("Workflow Task-Agent");
    expect(actions.find((action) => action.id === "session.pin.session-2")?.availability.kind).toBe(
      "disabled",
    );
    expect(actions.find((action) => action.id === "workspace.open")?.shortcut).toBe("Cmd+O");
    expect(actions.find((action) => action.id === "workspace.newTab")?.shortcut).toBe("Cmd+T");
    expect(actions.find((action) => action.id === "workspace.openInNewTab")?.shortcut).toBe(
      "Cmd+Shift+O",
    );
    expect(actions.find((action) => action.id === "agents.open")?.shortcut).toBe("Cmd+Shift+2");
    expect(actions.find((action) => action.id === "extensions.open")?.shortcut).toBe("Cmd+Shift+3");
    expect(actions.find((action) => action.id === "surface.logs.open")?.shortcut).toBe(
      "Cmd+Shift+1",
    );
    expect(filterCommandActions(actions, "generated context")[0]?.id).toBe(
      "extensions.generatedContextPreview",
    );
  });

  it("adds profile-specific New orchestrator actions carrying agent profile ids", () => {
    const actions = buildCommandRegistry({
      sessions: [],
      orchestratorProfiles: [
        orchestratorProfile("default-orchestrator", "Default orchestrator", {
          locked: true,
          builtin: true,
        }),
        orchestratorProfile("research-orchestrator", "Research orchestrator", {
          provider: "anthropic",
          model: "claude-sonnet-4",
          reasoningEffort: "high",
        }),
      ],
    });

    expect(actions.find((action) => action.id === "session.new")?.execute).toEqual({
      kind: "create-session",
    });
    expect(
      actions.find((action) => action.id === "session.new.profile.default-orchestrator"),
    ).toMatchObject({
      category: "agents",
      label: "New orchestrator: Default orchestrator",
      execute: { kind: "create-session", agentProfileId: "default-orchestrator" },
      badge: "Profile",
    });
    expect(
      actions.find((action) => action.id === "session.new.profile.research-orchestrator"),
    ).toMatchObject({
      category: "agents",
      label: "New orchestrator: Research orchestrator",
      execute: { kind: "create-session", agentProfileId: "research-orchestrator" },
      targetName: "anthropic/claude-sonnet-4 · high",
      badge: "Profile",
    });
  });

  it("keeps the workflow library action workspace-scoped", () => {
    const action = buildCommandRegistry({
      sessions: [],
      focusedSessionId: undefined,
    }).find((candidate) => candidate.id === "workflows.open");

    expect(action).toMatchObject({
      availability: { kind: "available" },
      execute: { kind: "open-workflows" },
    });
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
      action: actions.find((action) => action.id === "workflows.open")!,
      paneId: "pane-c",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "agents.open")!,
      paneId: "pane-d",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "extensions.open")!,
      paneId: "pane-e",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "snippets.open")!,
      paneId: "pane-snippets",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "surface.logs.open")!,
      paneId: "pane-f",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "extensions.generatedContextPreview")!,
      paneId: "pane-g",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "settings.open")!,
      paneId: "pane-h",
    });

    expect(runtime.calls).toEqual([
      "open:session-1:pane-a",
      "pin:session-1",
      "surface:workflows:pane-c",
      "surface:agents:pane-d",
      "surface:extensions:pane-e",
      "surface:snippets:pane-snippets",
      "surface:app-logs:pane-f",
      "surface:extensions:pane-g",
      "surface:settings:pane-h",
    ]);
    expect(runtime.paneTarget).toEqual({
      surface: "settings",
    });
  });

  it("passes agent profile ids when executing profile-specific New orchestrator actions", async () => {
    const runtime = createRuntime();
    const action = buildCommandRegistry({
      sessions: [],
      orchestratorProfiles: [orchestratorProfile("review-orchestrator", "Review orchestrator")],
    }).find((candidate) => candidate.id === "session.new.profile.review-orchestrator")!;

    await executeCommandAction({ runtime, action, paneId: "pane-a" });

    expect(runtime.calls).toEqual(["create:pane-a"]);
    expect(runtime.createRequests).toEqual([{ agentProfileId: "review-orchestrator" }]);
  });

  it("routes workspace command actions through shell callbacks", async () => {
    const runtime = createRuntime();
    const shellActions: string[] = [];
    const actions = buildCommandRegistry({
      sessions: [],
      focusedSessionId: undefined,
    });

    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "workspace.open")!,
      paneId: "pane-a",
      onWorkspaceAction: (action) => {
        shellActions.push(action);
      },
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "workspace.newTab")!,
      paneId: "pane-a",
      onWorkspaceAction: (action) => {
        shellActions.push(action);
      },
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "workspace.openInNewTab")!,
      paneId: "pane-a",
      onWorkspaceAction: (action) => {
        shellActions.push(action);
      },
    });

    expect(shellActions).toEqual(["open", "new-tab", "open-in-new-tab"]);
    expect(runtime.calls).toEqual([]);
  });

  it("routes pane actions to focused pane layout operations", async () => {
    const runtime = createRuntime();
    const target = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } satisfies PromptTarget;
    runtime.paneTarget = target;
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
      focusedPaneExists: true,
      focusedSurfaceTarget: target,
      paneTabGroups: [{ groupId: "group-1", label: "Tab", panelIds: ["primary", "secondary"] }],
    });

    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "pane.duplicate-right")!,
      paneId: "focused-panel",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "pane.duplicate-below")!,
      paneId: "focused-panel",
    });
    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "pane.close")!,
      paneId: "focused-panel",
    });

    expect(runtime.calls).toEqual([
      "split:focused-panel:right:duplicate",
      "focus:new-panel",
      "split:focused-panel:below:duplicate",
      "focus:new-panel",
      "close:focused-panel",
    ]);
  });

  it("routes pane placement commands through current pane bindings", async () => {
    const runtime = createRuntime();
    const target = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } satisfies PromptTarget;
    runtime.paneTarget = target;
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
      focusedPaneExists: true,
      focusedSurfaceTarget: target,
      paneTabGroups: [{ groupId: "group-1", label: "Tab", panelIds: ["primary", "secondary"] }],
    });

    for (const actionId of [
      "pane.place-left",
      "pane.place-right",
      "pane.place-above",
      "pane.place-below",
      "pane.place-edge-left",
      "pane.place-edge-right",
      "pane.place-edge-top",
      "pane.place-edge-bottom",
      "pane.place-floating",
      "pane.place-popout",
      "pane.place-tab.group-1",
    ]) {
      await executeCommandAction({
        runtime,
        action: actions.find((action) => action.id === actionId)!,
        paneId: "focused-panel",
      });
    }

    expect(runtime.calls).toEqual([
      'surface:session-1:{"kind":"split","panelId":"focused-panel","direction":"left"}',
      'surface:session-1:{"kind":"split","panelId":"focused-panel","direction":"right"}',
      'surface:session-1:{"kind":"split","panelId":"focused-panel","direction":"above"}',
      'surface:session-1:{"kind":"split","panelId":"focused-panel","direction":"below"}',
      'surface:session-1:{"kind":"edge","direction":"left"}',
      'surface:session-1:{"kind":"edge","direction":"right"}',
      'surface:session-1:{"kind":"edge","direction":"above"}',
      'surface:session-1:{"kind":"edge","direction":"below"}',
      'surface:session-1:{"kind":"floating"}',
      'surface:session-1:{"kind":"popout"}',
      'surface:session-1:{"kind":"tab","groupId":"group-1"}',
    ]);
  });

  it("generates tab-group placement commands from Dockview group summaries", () => {
    const target = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } satisfies PromptTarget;
    const actions = buildCommandRegistry({
      sessions: [session("session-1", "Parser Fix")],
      focusedSessionId: "session-1",
      focusedPaneExists: true,
      focusedSurfaceTarget: target,
      paneTabGroups: [
        { groupId: "group-1", label: "Tab", panelIds: ["primary", "secondary"] },
        { groupId: "group-2", label: "Tab group 2", panelIds: ["logs"] },
      ],
    });

    expect(actions.find((action) => action.id === "pane.place-tab.group-1")).toMatchObject({
      label: "Open Pane in Tab",
      category: "pane",
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "place-tab", groupId: "group-1" },
      targetName: "primary, secondary",
    });
    expect(actions.find((action) => action.id === "pane.place-tab.group-2")).toMatchObject({
      label: "Open Pane in Tab group 2",
      targetName: "logs",
    });
  });

  it("wires pane command availability to actual runtime pane state in ChatWorkspace", async () => {
    const workspaceSource = await Bun.file(
      new URL("./ChatWorkspace.svelte", import.meta.url),
    ).text();

    expect(workspaceSource).toContain("focusedPaneExists: !!runtime.paneLayout.focusedPanelId");
    expect(workspaceSource).toContain("getDockviewTabGroupPlacementTargets(runtime.paneLayout)");
    expect(workspaceSource).not.toContain("syncArtifactsFromRuntime");
  });

  it("does not place an unbound pane", async () => {
    const runtime = createRuntime();
    const actions = buildCommandRegistry({ sessions: [], focusedPaneExists: true });

    await executeCommandAction({
      runtime,
      action: actions.find((action) => action.id === "pane.place-floating")!,
      paneId: "focused-panel",
    });

    expect(runtime.calls).toEqual([]);
  });

  it("disables pane placement commands until a focused pane surface exists", () => {
    const actions = buildCommandRegistry({ sessions: [] });

    expect(actions.find((action) => action.id === "pane.close")?.availability).toEqual({
      kind: "disabled",
      reason: "Focus a pane before using pane placement commands.",
    });
    expect(actions.find((action) => action.id === "pane.place-floating")?.availability).toEqual({
      kind: "disabled",
      reason: "Focus a pane before using pane placement commands.",
    });
  });

  it("allows close but not placement when the focused pane has no bound surface", () => {
    const actions = buildCommandRegistry({ sessions: [], focusedPaneExists: true });

    expect(actions.find((action) => action.id === "pane.close")?.availability).toEqual({
      kind: "available",
    });
    expect(actions.find((action) => action.id === "pane.duplicate-right")?.availability).toEqual({
      kind: "disabled",
      reason: "The focused pane has no surface to place.",
    });
    expect(actions.find((action) => action.id === "pane.place-popout")?.availability).toEqual({
      kind: "disabled",
      reason: "The focused pane has no surface to place.",
    });
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
              contextBudget: null,
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
    expect(runtime.createRequests).toEqual([{}]);
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
