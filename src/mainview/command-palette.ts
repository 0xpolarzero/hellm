import type {
  ConfiguredAgentProfileReadModelRecord,
  PromptTarget,
  WorkspacePaneSurfaceTarget,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
  WorkspaceKind,
  WorkspaceWorkflowTaskAttemptSummary,
} from "../shared/workspace-contract";
import type { ChatRuntime } from "./chat-runtime";
import type { DockviewTabGroupPlacementTarget } from "./pane-layout";
import { getShortcutReadable } from "../shared/shortcut-registry";
import { configuredAgentProfileReasoningEffort } from "./configured-agent-profile";

export type CommandPaletteMode = "commands" | "search";

export const COMMAND_PALETTE_COMMAND_PREFIX = ">";

export type CommandActionCategory =
  | "workspace"
  | "session"
  | "surface"
  | "handler-thread"
  | "workflows"
  | "pane"
  | "settings"
  | "agents";

export type CommandAvailability =
  | { kind: "available" }
  | { kind: "disabled"; reason: string }
  | { kind: "hidden" };

export type CommandPlacement = "new-panel" | "focused-panel";
type PanePlacementAction =
  | "duplicate-right"
  | "duplicate-below"
  | "place-left"
  | "place-right"
  | "place-above"
  | "place-below"
  | "place-edge-left"
  | "place-edge-right"
  | "place-edge-top"
  | "place-edge-bottom"
  | "place-floating"
  | "place-popout"
  | "place-tab"
  | "close";

export type CommandExecutionTarget =
  | { kind: "create-session"; agentProfileId?: string; initialPrompt?: string }
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
  | { kind: "open-workflows" }
  | { kind: "open-agents"; view?: "profiles" | "generated-context-preview" }
  | { kind: "open-extensions"; view?: "inventory" | "generated-context-preview" }
  | { kind: "open-snippets" }
  | { kind: "open-app-logs" }
  | { kind: "start-orchestrator-turn"; workspaceSessionId: string; prompt: string }
  | { kind: "open-settings" }
  | { kind: "workspace-action"; action: "open" | "new-tab" | "open-in-new-tab" }
  | {
      kind: "pane-action";
      action: PanePlacementAction;
      groupId?: string;
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

export type CommandActionGroup = {
  category: CommandActionCategory;
  label: string;
  actions: CommandAction[];
};

export type CommandActionPlacementHint = {
  shortcut: string;
  label: string;
};

export type CommandRegistryInput = {
  sessions: WorkspaceSessionSummary[];
  workspaceKind?: WorkspaceKind;
  focusedSessionId?: string;
  focusedPaneExists?: boolean;
  focusedSurfaceTarget?: PromptTarget | null;
  paneTabGroups?: DockviewTabGroupPlacementTarget[];
  orchestratorProfiles?: readonly ConfiguredAgentProfileReadModelRecord[];
  handlerThreads?: WorkspaceHandlerThreadSummary[];
};

export type CommandRuntime = Pick<
  ChatRuntime,
  | "createSession"
  | "closePane"
  | "getPane"
  | "openSession"
  | "pinSession"
  | "unpinSession"
  | "archiveSession"
  | "unarchiveSession"
  | "focusPane"
  | "splitPane"
  | "sendPromptToTarget"
> & {
  openSurface: (
    target: WorkspacePaneSurfaceTarget,
    openTarget?: Parameters<ChatRuntime["openSurface"]>[1],
  ) => Promise<void>;
};

function isPromptTarget(target: WorkspacePaneSurfaceTarget | null): target is PromptTarget {
  return target?.surface === "orchestrator" || target?.surface === "handler";
}

export const COMMAND_PALETTE_NEW_PANE_PREFIX = "command-palette";
const PRIMARY_COMMAND_PANE_ID = "primary";

const COMMAND_ACTION_CATEGORY_LABELS: Record<CommandActionCategory, string> = {
  workspace: "Workspace",
  session: "Sessions",
  surface: "Surfaces",
  "handler-thread": "Handler Threads",
  workflows: "Workflows",
  pane: "Panes",
  settings: "Settings",
  agents: "Agents",
};

const COMMAND_ACTION_CATEGORY_ORDER: CommandActionCategory[] = [
  "workspace",
  "session",
  "handler-thread",
  "surface",
  "workflows",
  "agents",
  "pane",
  "settings",
];

export function getCommandPaletteInitialInput(mode: CommandPaletteMode): string {
  return mode === "commands" ? COMMAND_PALETTE_COMMAND_PREFIX : "";
}

export function getCommandPaletteInputState(input: string): {
  mode: CommandPaletteMode;
  commandQuery: string;
} {
  if (!input.startsWith(COMMAND_PALETTE_COMMAND_PREFIX)) {
    return { mode: "search", commandQuery: "" };
  }

  return {
    mode: "commands",
    commandQuery: input.slice(COMMAND_PALETTE_COMMAND_PREFIX.length).trimStart(),
  };
}

export function createCommandPalettePaneId(now = Date.now()): string {
  return `${COMMAND_PALETTE_NEW_PANE_PREFIX}-${now.toString(36)}`;
}

export function getCommandPalettePlacement(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
): CommandPlacement {
  return event.metaKey || event.ctrlKey ? "focused-panel" : "new-panel";
}

export function getCommandExecutionPaneId(input: {
  placement: CommandPlacement;
  focusedPanelId?: string | null;
  now?: number;
}): string {
  if (input.placement === "focused-panel") {
    return input.focusedPanelId ?? PRIMARY_COMMAND_PANE_ID;
  }

  return createCommandPalettePaneId(input.now);
}

export function buildCommandRegistry(input: CommandRegistryInput): CommandAction[] {
  const duplicatePaneAvailability = getPaneCommandAvailability(input, "duplicate");
  const placementPaneAvailability = getPaneCommandAvailability(input, "placement");
  const closePaneAvailability = getPaneCommandAvailability(input, "close");
  const actions: CommandAction[] = [
    {
      id: "workspace.open",
      label: "Open Workspace...",
      category: "workspace",
      aliases: ["open folder", "open repository", "retarget tab", "choose workspace"],
      shortcut: getShortcutReadable("workspace.open"),
      availability: { kind: "available" },
      execute: { kind: "workspace-action", action: "open" },
    },
    {
      id: "workspace.newTab",
      label: "New Tab",
      category: "workspace",
      aliases: ["new workspace tab", "default workspace tab"],
      shortcut: getShortcutReadable("workspace.newTab"),
      availability: { kind: "available" },
      execute: { kind: "workspace-action", action: "new-tab" },
    },
    {
      id: "workspace.openInNewTab",
      label: "Open Workspace in New Tab...",
      category: "workspace",
      aliases: ["open folder in new tab", "open repository in new tab", "new workspace"],
      shortcut: getShortcutReadable("workspace.openInNewTab"),
      availability: { kind: "available" },
      execute: { kind: "workspace-action", action: "open-in-new-tab" },
    },
    {
      id: "session.new",
      label: "New orchestrator",
      category: "session",
      aliases: ["create session", "new chat", "new orchestrator session"],
      shortcut: getShortcutReadable("session.new"),
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
      execute: { kind: "open-settings" },
    },
    {
      id: "workflows.open",
      label: "Open Workflows",
      category: "workflows",
      aliases: ["generated workflows", "workflow exports", "@svvyx/workflows", "workflow library"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "open-workflows" },
    },
    {
      id: "extensions.open",
      label: "Open Extensions",
      category: "surface",
      aliases: ["extension inventory", "loaded extensions", "available extensions"],
      shortcut: getShortcutReadable("surface.extensions.open"),
      availability: { kind: "available" },
      execute: { kind: "open-extensions" },
    },
    {
      id: "extensions.generatedContextPreview",
      label: "Open Generated Context Preview",
      category: "surface",
      aliases: [
        "agent context",
        "generated agent context",
        "context preview",
        "system prompt preview",
        "extension preview",
      ],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "open-extensions", view: "generated-context-preview" },
    },
    {
      id: "snippets.open",
      label: "Open Snippets",
      category: "surface",
      aliases: ["prompt macros", "snippet library", "claude commands", "pi prompts"],
      shortcut: null,
      availability: { kind: "available" },
      execute: { kind: "open-snippets" },
    },
    {
      id: "surface.logs.open",
      label: "Open Logs",
      category: "surface",
      aliases: ["app logs", "runtime logs", "log pane"],
      shortcut: getShortcutReadable("surface.logs.open"),
      availability: { kind: "available" },
      execute: { kind: "open-app-logs" },
    },
    {
      id: "agents.open",
      label: "Open Agents",
      category: "agents",
      aliases: ["agent profiles", "orchestrator profiles", "thread handler profile"],
      shortcut: getShortcutReadable("surface.agents.open"),
      availability: { kind: "available" },
      execute: { kind: "open-agents" },
    },
    ...buildProfileNewOrchestratorActions(input.orchestratorProfiles ?? []),
    {
      id: "pane.duplicate-right",
      label: "Duplicate Pane Right",
      category: "pane",
      aliases: ["duplicate current pane", "clone pane right"],
      shortcut: null,
      availability: duplicatePaneAvailability,
      execute: { kind: "pane-action", action: "duplicate-right" },
    },
    {
      id: "pane.duplicate-below",
      label: "Duplicate Pane Below",
      category: "pane",
      aliases: ["duplicate current pane below", "clone pane below"],
      shortcut: null,
      availability: duplicatePaneAvailability,
      execute: { kind: "pane-action", action: "duplicate-below" },
    },
    {
      id: "pane.place-left",
      label: "Open Pane Left",
      category: "pane",
      aliases: ["split current pane left", "place pane left"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-left" },
    },
    {
      id: "pane.place-right",
      label: "Open Pane Right",
      category: "pane",
      aliases: ["split current pane right", "place pane right"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-right" },
    },
    {
      id: "pane.place-above",
      label: "Open Pane Above",
      category: "pane",
      aliases: ["split current pane above", "place pane above"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-above" },
    },
    {
      id: "pane.place-below",
      label: "Open Pane Below",
      category: "pane",
      aliases: ["split current pane below", "place pane below"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-below" },
    },
    {
      id: "pane.place-edge-left",
      label: "Open Pane in Left Edge",
      category: "pane",
      aliases: ["root edge left", "edge group left", "dock pane left edge"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-edge-left" },
    },
    {
      id: "pane.place-edge-right",
      label: "Open Pane in Right Edge",
      category: "pane",
      aliases: ["root edge right", "edge group right", "dock pane right edge"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-edge-right" },
    },
    {
      id: "pane.place-edge-top",
      label: "Open Pane in Top Edge",
      category: "pane",
      aliases: ["root edge top", "edge group top", "dock pane top edge"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-edge-top" },
    },
    {
      id: "pane.place-edge-bottom",
      label: "Open Pane in Bottom Edge",
      category: "pane",
      aliases: ["root edge bottom", "edge group bottom", "dock pane bottom edge"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-edge-bottom" },
    },
    {
      id: "pane.place-floating",
      label: "Open Pane Floating",
      category: "pane",
      aliases: ["floating pane", "floating group", "detach pane"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-floating" },
    },
    {
      id: "pane.place-popout",
      label: "Open Pane Popout",
      category: "pane",
      aliases: ["popout pane", "external window", "pop out pane"],
      shortcut: null,
      availability: placementPaneAvailability,
      execute: { kind: "pane-action", action: "place-popout" },
    },
    ...buildPaneTabGroupActions(input.paneTabGroups ?? [], placementPaneAvailability),
    {
      id: "pane.close",
      label: "Close Pane",
      category: "pane",
      aliases: ["remove pane", "detach pane"],
      shortcut: null,
      availability: closePaneAvailability,
      execute: { kind: "pane-action", action: "close" },
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
          surface: "handler",
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

function buildPaneTabGroupActions(
  tabGroups: readonly DockviewTabGroupPlacementTarget[],
  availability: CommandAvailability,
): CommandAction[] {
  return tabGroups.map((group) => ({
    id: `pane.place-tab.${group.groupId}`,
    label: `Open Pane in ${group.label}`,
    category: "pane",
    aliases: [
      "tab placement",
      "tab group placement",
      "open pane as tab",
      group.groupId,
      ...group.panelIds,
    ],
    shortcut: null,
    availability,
    execute: { kind: "pane-action", action: "place-tab", groupId: group.groupId },
    targetName: group.panelIds.join(", "),
  }));
}

function getPaneCommandAvailability(
  input: CommandRegistryInput,
  command: "duplicate" | "placement" | "close",
): CommandAvailability {
  const hasFocusedPane = input.focusedPaneExists ?? input.focusedSurfaceTarget != null;
  if (!hasFocusedPane) {
    return { kind: "disabled", reason: "Focus a pane before using pane placement commands." };
  }
  if (command === "close") {
    return { kind: "available" };
  }
  if (!input.focusedSurfaceTarget) {
    return { kind: "disabled", reason: "The focused pane has no surface to place." };
  }
  return { kind: "available" };
}

function buildProfileNewOrchestratorActions(
  profiles: readonly ConfiguredAgentProfileReadModelRecord[],
): CommandAction[] {
  return profiles.map((profile) => ({
    id: `session.new.profile.${profile.profileId}`,
    label: `New orchestrator: ${profile.name}`,
    category: "agents",
    aliases: [
      "new orchestrator profile",
      "agent profile",
      "orchestrator profile",
      profile.providerId,
      profile.modelId,
      configuredAgentProfileReasoningEffort(profile),
    ],
    shortcut: null,
    availability: { kind: "available" },
    execute: { kind: "create-session", agentProfileId: profile.profileId },
    targetName: `${profile.providerId}/${profile.modelId} · ${configuredAgentProfileReasoningEffort(profile)}`,
    badge: "Profile",
  }));
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
    badge: "Workflow Task-Agent",
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
  if (!query.trim()) {
    return getVisibleCommandActions(actions);
  }

  return getVisibleCommandActions(actions)
    .map((action) => ({ action, score: scoreCommandAction(action, query) }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score || left.action.label.localeCompare(right.action.label),
    )
    .map((entry) => entry.action);
}

export function getCommandActionCategoryLabel(category: CommandActionCategory): string {
  return COMMAND_ACTION_CATEGORY_LABELS[category];
}

export function groupCommandActions(actions: CommandAction[]): CommandActionGroup[] {
  const grouped = new Map<CommandActionCategory, CommandAction[]>();
  for (const action of actions) {
    const categoryActions = grouped.get(action.category) ?? [];
    categoryActions.push(action);
    grouped.set(action.category, categoryActions);
  }

  return COMMAND_ACTION_CATEGORY_ORDER.flatMap((category) => {
    const categoryActions = grouped.get(category) ?? [];
    if (categoryActions.length === 0) return [];
    return [
      {
        category,
        label: getCommandActionCategoryLabel(category),
        actions: categoryActions,
      },
    ];
  });
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
    case "open-workflows":
    case "open-agents":
    case "open-extensions":
    case "open-app-logs":
    case "open-settings":
    case "start-orchestrator-turn":
      return action.shortcut
        ? [
            action.shortcut,
            getShortcutReadable("commandPalette.submit"),
            getShortcutReadable("commandPalette.submitFocusedPane"),
          ]
        : [
            getShortcutReadable("commandPalette.submit"),
            getShortcutReadable("commandPalette.submitFocusedPane"),
          ];
    case "workspace-action":
      return action.shortcut ? [action.shortcut, getShortcutReadable("commandPalette.submit")] : [];
    default:
      return action.shortcut ? [action.shortcut] : [];
  }
}

export function getCommandActionPlacementHints(
  action: CommandAction,
): CommandActionPlacementHint[] {
  if (action.availability.kind !== "available") {
    return [];
  }

  switch (action.execute.kind) {
    case "create-session":
    case "open-session":
    case "open-surface":
    case "open-workflows":
    case "open-agents":
    case "open-extensions":
    case "open-app-logs":
    case "open-settings":
    case "start-orchestrator-turn":
      return [
        { shortcut: getShortcutReadable("commandPalette.submit"), label: "New pane" },
        {
          shortcut: getShortcutReadable("commandPalette.submitFocusedPane"),
          label: "Focused pane",
        },
      ];
    default:
      return [];
  }
}

export async function executeCommandAction(input: {
  runtime: CommandRuntime;
  action: CommandAction;
  paneId: string;
  onWorkspaceAction?: (action: "open" | "new-tab" | "open-in-new-tab") => Promise<void> | void;
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
      await runtime.createSession(
        target.agentProfileId ? { agentProfileId: target.agentProfileId } : {},
        paneId,
      );
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
    case "open-workflows":
      await runtime.openSurface({ surface: "workflows" }, paneId);
      return;
    case "open-agents":
      await runtime.openSurface({ surface: "agents", view: target.view }, paneId);
      return;
    case "open-extensions":
      await runtime.openSurface({ surface: "extensions", view: target.view }, paneId);
      return;
    case "open-snippets":
      await runtime.openSurface({ surface: "snippets" }, paneId);
      return;
    case "open-app-logs":
      await runtime.openSurface({ surface: "app-logs" }, paneId);
      return;
    case "start-orchestrator-turn":
      await runtime.openSession(target.workspaceSessionId, paneId);
      await executeInitialPrompt({ runtime, paneId, prompt: target.prompt });
      return;
    case "open-settings":
      await runtime.openSurface({ surface: "settings" }, paneId);
      return;
    case "workspace-action":
      await input.onWorkspaceAction?.(target.action);
      return;
    case "pane-action":
      if (target.action === "duplicate-right") {
        const nextPanelId = await runtime.splitPane(paneId, "right", { duplicateBinding: true });
        if (nextPanelId) runtime.focusPane(nextPanelId);
        return;
      }
      if (target.action === "duplicate-below") {
        const nextPanelId = await runtime.splitPane(paneId, "below", { duplicateBinding: true });
        if (nextPanelId) runtime.focusPane(nextPanelId);
        return;
      }
      if (target.action === "close") {
        await runtime.closePane(paneId);
        return;
      }
      await executePanePlacementAction({
        runtime,
        paneId,
        action: target.action,
        groupId: target.groupId,
      });
      return;
  }
}

async function executePanePlacementAction(input: {
  runtime: CommandRuntime;
  paneId: string;
  action: Exclude<PanePlacementAction, "duplicate-right" | "duplicate-below" | "close">;
  groupId?: string;
}): Promise<void> {
  const target = input.runtime.getPane(input.paneId)?.target ?? null;
  if (!target) {
    return;
  }

  switch (input.action) {
    case "place-left":
      await input.runtime.openSurface(target, {
        kind: "split",
        panelId: input.paneId,
        direction: "left",
      });
      return;
    case "place-right":
      await input.runtime.openSurface(target, {
        kind: "split",
        panelId: input.paneId,
        direction: "right",
      });
      return;
    case "place-above":
      await input.runtime.openSurface(target, {
        kind: "split",
        panelId: input.paneId,
        direction: "above",
      });
      return;
    case "place-below":
      await input.runtime.openSurface(target, {
        kind: "split",
        panelId: input.paneId,
        direction: "below",
      });
      return;
    case "place-edge-left":
      await input.runtime.openSurface(target, { kind: "edge", direction: "left" });
      return;
    case "place-edge-right":
      await input.runtime.openSurface(target, { kind: "edge", direction: "right" });
      return;
    case "place-edge-top":
      await input.runtime.openSurface(target, { kind: "edge", direction: "above" });
      return;
    case "place-edge-bottom":
      await input.runtime.openSurface(target, { kind: "edge", direction: "below" });
      return;
    case "place-floating":
      await input.runtime.openSurface(target, { kind: "floating" });
      return;
    case "place-popout":
      await input.runtime.openSurface(target, { kind: "popout" });
      return;
    case "place-tab":
      if (!input.groupId) return;
      await input.runtime.openSurface(target, { kind: "tab", groupId: input.groupId });
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
  const target = pane?.target ?? null;
  if (isPromptTarget(target)) {
    await input.onCreatedTarget?.(target);
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
  const target = pane?.target ?? null;
  if (!isPromptTarget(target)) {
    throw new Error("Expected a newly opened command palette target before sending a prompt.");
  }

  await input.runtime.sendPromptToTarget(target, input.prompt);
}
