import { existsSync } from "node:fs";
import {
  createSessionHeader,
  reconstructSessionState,
  type SessionJsonlEntry,
  type SessionState,
} from "@hellm/session-model";
import {
  createHellmRuntime,
  type HellmOrchestratorOverrides,
} from "@hellm/tui";

interface CapturedNotification {
  level?: "error" | "info" | "success" | "warning";
  message: string;
}

interface CapturedWidgetUpdate {
  lines: string[];
  options?: Record<string, unknown>;
}

export interface InteractiveTuiSessionHarness {
  readonly cwd: string;
  readonly notifications: CapturedNotification[];
  readonly statuses: Array<{ id: string; value?: string }>;
  readonly titles: string[];
  readonly widgets: Map<string, CapturedWidgetUpdate>;
  appendStructuredEntry(kind: string, data: unknown): void;
  dispose(): Promise<void>;
  emitInput(text: string): Promise<{ action: string; text?: string }>;
  readState(): SessionState;
  runCommand(name: string, args?: string): Promise<void>;
  sessionId(): string;
  widgetLines(id: string): string[];
  widgetText(id: string): string;
}

export async function createInteractiveTuiSessionHarness(input: {
  cwd: string;
  orchestratorOverrides?: HellmOrchestratorOverrides;
}): Promise<InteractiveTuiSessionHarness> {
  const originalCwd = process.cwd();
  const notifications: CapturedNotification[] = [];
  const statuses: Array<{ id: string; value?: string }> = [];
  const titles: string[] = [];
  const widgets = new Map<string, CapturedWidgetUpdate>();
  const runtime = await createHellmRuntime({
    cwd: input.cwd,
    ...(input.orchestratorOverrides
      ? { orchestratorOverrides: input.orchestratorOverrides }
      : {}),
  });
  const runner = runtime.session.extensionRunner;

  if (!runner) {
    await runtime.dispose();
    throw new Error("Expected pi extension runner to be available.");
  }

  runner.setUIContext({
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: (message: string, level?: CapturedNotification["level"]) => {
      notifications.push({ message, ...(level ? { level } : {}) });
    },
    onTerminalInput: () => () => {},
    setStatus: (id: string, value?: string) => {
      statuses.push({ id, ...(value !== undefined ? { value } : {}) });
    },
    setWorkingMessage: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: (
      id: string,
      lines: string[],
      options?: Record<string, unknown>,
    ) => {
      widgets.set(id, {
        lines: [...lines],
        ...(options ? { options } : {}),
      });
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: (title: string) => {
      titles.push(title);
    },
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    setEditorComponent: () => {},
    get theme() {
      return {} as never;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "UI not available" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } as never);

  function readState(): SessionState {
    const sessionManager = runtime.session.sessionManager;
    return reconstructSessionState([
      createSessionHeader({
        id: sessionManager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: runtime.cwd,
      }),
      ...(sessionManager.getEntries() as unknown as SessionJsonlEntry[]),
    ]);
  }

  return {
    cwd: input.cwd,
    notifications,
    statuses,
    titles,
    widgets,
    appendStructuredEntry(kind, data) {
      runtime.session.sessionManager.appendCustomEntry(`hellm/${kind}`, data);
    },
    async dispose() {
      await runtime.dispose();
      if (process.cwd() !== originalCwd && existsSync(originalCwd)) {
        process.chdir(originalCwd);
      }
    },
    async emitInput(text) {
      return runner.emitInput(text, undefined, "interactive");
    },
    readState,
    async runCommand(name, args = "") {
      const command = runner.getCommand(name);
      if (!command) {
        throw new Error(`Expected command "${name}" to be registered.`);
      }
      await command.handler(args, runner.createContext());
    },
    sessionId() {
      return runtime.session.sessionManager.getSessionId();
    },
    widgetLines(id) {
      return [...(widgets.get(id)?.lines ?? [])];
    },
    widgetText(id) {
      return widgets.get(id)?.lines.join("\n") ?? "";
    },
  };
}
