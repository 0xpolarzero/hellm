import type {
  PromptTarget,
  WorkspaceHandlerThreadSummary,
  WorkspaceProjectCiStatusPanel,
  WorkspaceSessionSummary,
  WorkspaceWorkflowTaskAttemptSummary,
} from "./chat-rpc";
import type { ChatRuntime } from "./chat-runtime";

export type CommandPaletteMode = "actions" | "quick-open";

export type CommandActionCategory =
  | "session"
  | "surface"
  | "project-ci"
  | "handler-thread"
  | "workflow-inspector"
  | "pane"
  | "settings"
  | "runtime-profile";

export type CommandAvailability =
  | { kind: "available" }
  | { kind: "disabled"; reason: string }
  | { kind: "hidden" };

export type CommandPlacement = "new-pane" | "focused-pane";

export type CommandExecutionTarget =
  | { kind: "create-session"; initialPrompt?: string }
  | { kind: "open-session"; workspaceSessionId: string }
  | {
      kind: "open-workflow-task-attempt";
      workspaceSessionId: string;
      workflowTaskAttemptId: string;
    }
  | {
      kind: "update-session-navigation";
      workspaceSessionId: string;
      action: "pin" | "unpin" | "archive" | "unarchive";
    }
  | { kind: "open-surface"; surface: PromptTarget }
  | { kind: "start-orchestrator-turn"; workspaceSessionId: string; prompt: string }
  | { kind: "open-settings"; target: string }
  | {
      kind: "pane-action";
      action:
        | "split-right"
        | "split-below"
        | "duplicate-right"
        | "duplicate-below"
        | "close"
        | "span-top"
        | "span-bottom";
    };

export type CommandAction = {
  id: string;
  label: string;
  category: CommandActionCategory;
  aliases: string[];
  shortcut: string | null;
  availability: CommandAvailability;
  execute: CommandExecutionTarget;
  targetName?: string;
  badge?: string;
};

export type CommandRegistryInput = {
  sessions: WorkspaceSessionSummary[];
  focusedSessionId?: string;
  focusedSurfaceTarget?: PromptTarget | null;
  handlerThreads?: WorkspaceHandlerThreadSummary[];
  projectCiStatus?: WorkspaceProjectCiStatusPanel | null;
};

export type CommandRuntime = Pick<
  ChatRuntime,
  | "createSession"
  | "closePane"
  | "getPane"
  | "movePaneToSpanningRow"
  | "openSession"
  | "openSurface"
  | "pinSession"
  | "unpinSession"
  | "archiveSession"
  | "unarchiveSession"
  | "splitPane"
  | "sendPromptToTarget"
>;

export const COMMAND_PALETTE_NEW_PANE_PREFIX = "command-palette";
const PRIMARY_COMMAND_PANE_ID = "primary";

export function isCommandPaletteShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "p"
  );
}

export function isQuickOpenShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "p"
  );
}

export function createCommandPalettePaneId(now = Date.now()): string {
  return `${COMMAND_PALETTE_NEW_PANE_PREFIX}-${now.toString(36)}`;
}

export function getCommandPalettePlacement(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
): CommandPlacement {
  return event.metaKey || event.ctrlKey ? "focused-pane" : "new-pane";
}

export function getCommandExecutionPaneId(input: {
  placement: CommandPlacement;
  focusedPaneId?: string | null;
  now?: number;
}): string {
  if (input.placement === "focused-pane") {
    return input.focusedPaneId ?? PRIMARY_COMMAND_PANE_ID;
  }

  return createCommandPalettePaneId(input.now);
}

export function buildCommandRegistry(input: CommandRegistryInput): CommandAction[] {
  const focusedSession = input.focusedSessionId
    ? input.sessions.find((session) => session.id === input.focusedSessionId)
    : null;
  const hasFocusedSession = !!focusedSession;
  const actions: CommandAction[] = [
    {
      id: "session.new",
      label: "New Session",
      category: "session",
      aliases: ["create session", "new chat", "new orchestrator session"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "create-session" },
    },
    {
      id: "settings.open",
      label: "Open Settings",
      category: "settings",
      aliases: ["providers", "api keys", "preferences"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "open-settings", target: "root" },
    },
    {
      id: "pane.split-right",
      label: "Split Pane Right",
      category: "pane",
      aliases: ["pane right", "new pane right", "split column"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "split-right" },
    },
    {
      id: "pane.split-below",
      label: "Split Pane Below",
      category: "pane",
      aliases: ["pane below", "new pane below", "split row"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "split-below" },
    },
    {
      id: "pane.duplicate-right",
      label: "Duplicate Pane Right",
      category: "pane",
      aliases: ["duplicate current pane", "clone pane right"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "duplicate-right" },
    },
    {
      id: "pane.duplicate-below",
      label: "Duplicate Pane Below",
      category: "pane",
      aliases: ["duplicate current pane below", "clone pane below"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "duplicate-below" },
    },
    {
      id: "pane.close",
      label: "Close Pane",
      category: "pane",
      aliases: ["remove pane", "detach pane"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "close" },
    },
    {
      id: "pane.span-top",
      label: "Move Pane To Full-Width Top Row",
      category: "pane",
      aliases: ["span top", "full width top", "move pane top"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "span-top" },
    },
    {
      id: "pane.span-bottom",
      label: "Move Pane To Full-Width Bottom Row",
      category: "pane",
      aliases: ["span bottom", "full width bottom", "move pane bottom"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "pane-action", action: "span-bottom" },
    },
    {
      id: "project-ci.run",
      label: "Run Project CI",
      category: "project-ci",
      aliases: ["ci", "checks", "test project"],
      shortcut: null,
      availability: hasFocusedSession
        ? { kind: "available" }
        : { kind: "disabled", reason: "Open a session before running Project CI." },
      execute: {
        kind: "start-orchestrator-turn",
        workspaceSessionId: input.focusedSessionId ?? "",
        prompt: "Run Project CI for this workspace.",
      },
      targetName: input.projectCiStatus ? input.projectCiStatus.summary : undefined,
    },
    {
      id: "project-ci.configure",
      label: "Configure Project CI",
      category: "project-ci",
      aliases: ["setup ci", "edit project ci", "ci configuration"],
      shortcut: null,
      availability: hasFocusedSession
        ? { kind: "available" }
        : { kind: "disabled", reason: "Open a session before configuring Project CI." },
      execute: {
        kind: "start-orchestrator-turn",
        workspaceSessionId: input.focusedSessionId ?? "",
        prompt: "Configure Project CI for this workspace.",
      },
      targetName: input.projectCiStatus ? input.projectCiStatus.summary : undefined,
    },
  ];

  for (const session of input.sessions) {
    actions.push({
      id: `session.open.${session.id}`,
      label: `Open Session: ${session.title}`,
      category: "session",
      aliases: ["switch session", "show session", "orchestrator session", session.preview],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "open-session", workspaceSessionId: session.id },
      targetName: session.title,
      badge: "Orchestrator",
    });

    actions.push({
      id: `session.${session.isPinned ? "unpin" : "pin"}.${session.id}`,
      label: `${session.isPinned ? "Unpin" : "Pin"} Session: ${session.title}`,
      category: "session",
      aliases: [session.isPinned ? "remove pinned session" : "pin session", session.preview],
      shortcut: null,
      availability: session.isArchived
        ? { kind: "disabled", reason: "Unarchive the session before pinning it." }
        : { kind: "available" },
      execute: {
        kind: "update-session-navigation",
        workspaceSessionId: session.id,
        action: session.isPinned ? "unpin" : "pin",
      },
      targetName: session.title,
    });

    actions.push({
      id: `session.${session.isArchived ? "unarchive" : "archive"}.${session.id}`,
      label: `${session.isArchived ? "Unarchive" : "Archive"} Session: ${session.title}`,
      category: "session",
      aliases: [session.isArchived ? "restore session" : "hide session", session.preview],
      shortcut: null,
      availability: { kind: "available" },
      execute: {
        kind: "update-session-navigation",
        workspaceSessionId: session.id,
        action: session.isArchived ? "unarchive" : "archive",
      },
      targetName: session.title,
    });
  }

  for (const thread of input.handlerThreads ?? []) {
    if (!input.focusedSessionId) {
      continue;
    }
    actions.push({
      id: `session.open.thread.${thread.threadId}`,
      label: `Open Session: ${thread.title}`,
      category: "session",
      aliases: [
        "handler thread",
        "delegated thread",
        "thread session",
        thread.objective,
        thread.latestEpisode?.summary ?? "",
      ],
      shortcut: null,
      availability: { kind: "available" },
      execute: {
        kind: "open-surface",
        surface: {
          workspaceSessionId: input.focusedSessionId,
          surface: "thread",
          surfacePiSessionId: thread.surfacePiSessionId,
          threadId: thread.threadId,
        },
      },
      targetName: thread.title,
      badge: "Thread",
    });

    for (const workflowTaskAttempt of thread.workflowTaskAttempts ?? []) {
      actions.push(
        buildWorkflowTaskAttemptAction(input.focusedSessionId, thread, workflowTaskAttempt),
      );
    }
  }

  return actions;
}

function buildWorkflowTaskAttemptAction(
  workspaceSessionId: string,
  thread: WorkspaceHandlerThreadSummary,
  workflowTaskAttempt: WorkspaceWorkflowTaskAttemptSummary,
): CommandAction {
  return {
    id: `session.open.task-agent.${workflowTaskAttempt.workflowTaskAttemptId}`,
    label: `Open Session: ${workflowTaskAttempt.title}`,
    category: "session",
    aliases: [
      "task agent",
      "workflow task agent",
      "task-agent session",
      workflowTaskAttempt.nodeId,
      workflowTaskAttempt.smithersRunId,
      thread.title,
      thread.objective,
      workflowTaskAttempt.summary,
    ],
    shortcut: null,
    availability: { kind: "available" },
    execute: {
      kind: "open-workflow-task-attempt",
      workspaceSessionId,
      workflowTaskAttemptId: workflowTaskAttempt.workflowTaskAttemptId,
    },
    targetName: workflowTaskAttempt.summary || thread.title,
    badge: "Task Agent",
  };
}

export function getVisibleCommandActions(actions: CommandAction[]): CommandAction[] {
  return actions.filter((action) => action.availability.kind !== "hidden");
}

export function scoreCommandAction(action: CommandAction, query: string): number {
  const search = query.trim().toLowerCase();
  if (!search) {
    return 1;
  }

  const haystacks = [
    action.label,
    action.category,
    action.targetName ?? "",
    action.shortcut ?? "",
    ...action.aliases,
  ].map((value) => value.toLowerCase());

  if (haystacks.some((value) => value === search)) return 100;
  if (haystacks.some((value) => value.startsWith(search))) return 80;
  if (haystacks.some((value) => value.includes(search))) return 50;

  const chars = [...search];
  if (
    haystacks.some((value) => {
      let offset = 0;
      for (const char of chars) {
        const foundAt = value.indexOf(char, offset);
        if (foundAt === -1) return false;
        offset = foundAt + 1;
      }
      return true;
    })
  ) {
    return 15;
  }

  return 0;
}

export function filterCommandActions(actions: CommandAction[], query: string): CommandAction[] {
  return getVisibleCommandActions(actions)
    .map((action) => ({ action, score: scoreCommandAction(action, query) }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score || left.action.label.localeCompare(right.action.label),
    )
    .map((entry) => entry.action);
}

export function findSelectedCommandAction(
  actions: CommandAction[],
  query: string,
): CommandAction | null {
  return filterCommandActions(actions, query)[0] ?? null;
}

export function getCommandActionShortcutHints(action: CommandAction): string[] {
  if (action.availability.kind !== "available") {
    return action.shortcut ? [action.shortcut] : [];
  }

  switch (action.execute.kind) {
    case "create-session":
    case "open-session":
    case "open-surface":
    case "start-orchestrator-turn":
      return ["Enter", "Cmd+Enter"];
    default:
      return action.shortcut ? [action.shortcut] : [];
  }
}

export async function executeCommandAction(input: {
  runtime: CommandRuntime;
  action: CommandAction;
  paneId: string;
  onOpenSettings?: (target: string) => void;
  onOpenWorkflowTaskAttempt?: (input: {
    workspaceSessionId: string;
    workflowTaskAttemptId: string;
  }) => Promise<void> | void;
}): Promise<void> {
  const { runtime, action, paneId } = input;
  if (action.availability.kind !== "available") {
    return;
  }

  const target = action.execute;
  switch (target.kind) {
    case "create-session":
      await runtime.createSession({}, paneId);
      if (target.initialPrompt) {
        await executeInitialPrompt({ runtime, paneId, prompt: target.initialPrompt });
      }
      return;
    case "open-session":
      await runtime.openSession(target.workspaceSessionId, paneId);
      return;
    case "open-workflow-task-attempt":
      await input.onOpenWorkflowTaskAttempt?.({
        workspaceSessionId: target.workspaceSessionId,
        workflowTaskAttemptId: target.workflowTaskAttemptId,
      });
      return;
    case "update-session-navigation":
      if (target.action === "pin") await runtime.pinSession(target.workspaceSessionId);
      if (target.action === "unpin") await runtime.unpinSession(target.workspaceSessionId);
      if (target.action === "archive") await runtime.archiveSession(target.workspaceSessionId);
      if (target.action === "unarchive") await runtime.unarchiveSession(target.workspaceSessionId);
      return;
    case "open-surface":
      await runtime.openSurface(target.surface, paneId);
      return;
    case "start-orchestrator-turn":
      await runtime.openSession(target.workspaceSessionId, paneId);
      await executeInitialPrompt({ runtime, paneId, prompt: target.prompt });
      return;
    case "open-settings":
      input.onOpenSettings?.(target.target);
      return;
    case "pane-action":
      if (target.action === "split-right") await runtime.splitPane(paneId, "right");
      if (target.action === "split-below") await runtime.splitPane(paneId, "below");
      if (target.action === "duplicate-right") {
        await runtime.splitPane(paneId, "right", { duplicateBinding: true });
      }
      if (target.action === "duplicate-below") {
        await runtime.splitPane(paneId, "below", { duplicateBinding: true });
      }
      if (target.action === "close") await runtime.closePane(paneId);
      if (target.action === "span-top") runtime.movePaneToSpanningRow(paneId, "top");
      if (target.action === "span-bottom") runtime.movePaneToSpanningRow(paneId, "bottom");
      return;
  }
}

export async function executePaletteFallbackPrompt(input: {
  runtime: CommandRuntime;
  prompt: string;
  paneId: string;
  onCreatedTarget?: (target: PromptTarget) => Promise<void> | void;
}): Promise<boolean> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return false;
  }

  await input.runtime.createSession({}, input.paneId);
  const pane = input.runtime.getPane(input.paneId);
  if (pane?.target) {
    await input.onCreatedTarget?.(pane.target);
  }
  await executeInitialPrompt({ runtime: input.runtime, paneId: input.paneId, prompt });
  return true;
}

async function executeInitialPrompt(input: {
  runtime: CommandRuntime;
  paneId: string;
  prompt: string;
}): Promise<void> {
  const pane = input.runtime.getPane(input.paneId);
  if (!pane?.target) {
    throw new Error("Expected a newly opened command palette target before sending a prompt.");
  }

  await input.runtime.sendPromptToTarget(pane.target, input.prompt);
}
