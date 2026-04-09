import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createGlobalVerificationState,
  createSessionHeader,
  createSessionWorktreeAlignment,
  createThread,
  createVerificationRecord,
  reconstructSessionState,
  type ThreadSnapshot,
} from "@hellm/session-model";
import {
  createHellmRuntime,
  projectThreadSnapshot,
  renderProjection,
} from "@hellm/tui";
import {
  FakeVerificationRunner,
  runBunModule,
  withTempWorkspace,
} from "../../../test-support/index.ts";

const TUI_ENTRY = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");
const TIMESTAMP = "2026-04-08T09:00:00.000Z";

function assertNoRichSlashSurface(lines: readonly string[]): void {
  const rendered = lines.join("\n");
  expect(rendered).not.toContain("/threads");
  expect(rendered).not.toContain("/reconcile");
}

function createCapturingUiContext() {
  const notifications: string[] = [];
  const widgets = new Map<string, string[]>();

  return {
    notifications,
    widgets,
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: (message: string) => {
        notifications.push(message);
      },
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (id: string, lines: string[]) => {
        widgets.set(id, [...lines]);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
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
    },
  };
}

function readRuntimeState(runtime: Awaited<ReturnType<typeof createHellmRuntime>>) {
  return reconstructSessionState([
    createSessionHeader({
      id: runtime.session.sessionManager.getSessionId(),
      timestamp: TIMESTAMP,
      cwd: runtime.cwd,
    }),
    ...(runtime.session.sessionManager.getEntries() as Record<string, unknown>[]),
  ]);
}

const RICH_SLASH_COMMAND_SURFACE_PENDING_CONTRACTS = [
  "renders /threads output deterministically (ordering, grouping, and truncation) across viewport resizes in the virtual terminal harness",
  "resolves /threads against file-backed branched session JSONL history so resume/fork flows expose the correct active thread set",
  "provides discoverable slash-command help that includes at least /threads and /reconcile without requiring headless mode",
  "surfaces slash-command help and command output from the interactive TUI process boundary, not just projection helpers",
  "handles unknown slash commands with deterministic non-mutating feedback and preserves the active thread/worktree selection",
  "records slash-command-triggered state transitions through the same session-backed JSONL entries used by non-command orchestration flows",
] as const;

describe("@hellm/tui rich slash command surface contracts", () => {
  it("keeps projection helpers free of fake slash-command help", () => {
    const snapshot: ThreadSnapshot = {
      thread: createThread({
        id: "thread-rich-slash-contract",
        kind: "direct",
        objective: "Render baseline orchestration state.",
        status: "completed",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }),
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    };

    const projection = projectThreadSnapshot(snapshot);
    assertNoRichSlashSurface(renderProjection(projection));
  });

  it("registers baseline hellm slash commands on the pi runtime", async () => {
    await withTempWorkspace(async (workspace) => {
      const originalCwd = process.cwd();
      const runtime = await createHellmRuntime({
        cwd: workspace.root,
      });

      try {
        const commands = runtime.session.extensionRunner
          ?.getRegisteredCommands()
          .map((command) => `/${command.invocationName}`);

        expect(commands).toEqual(
          expect.arrayContaining(["/threads", "/reconcile", "/verify"]),
        );
      } finally {
        await runtime.dispose();
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    });
  });

  it("lists persisted threads through the /threads command using pi session-backed state", async () => {
    await withTempWorkspace(async (workspace) => {
      const originalCwd = process.cwd();
      const runtime = await createHellmRuntime({
        cwd: workspace.root,
      });

      try {
        const runner = runtime.session.extensionRunner;
        expect(runner).toBeDefined();

        const ui = createCapturingUiContext();
        runner!.setUIContext(ui.ui as never);

        const thread = createThread({
          id: "thread-rich-slash-runtime",
          kind: "smithers-workflow",
          objective: "List persisted threads from the pi session store.",
          status: "running",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
          worktreePath: "/repo/worktrees/feature-a",
        });
        runtime.session.sessionManager.appendCustomEntry("hellm/thread", thread);

        const command = runner!.getCommand("threads");
        expect(command).toBeDefined();

        await command!.handler("", runner!.createContext());

        expect(ui.notifications.at(-1)).toContain(
          "thread-rich-slash-runtime [smithers-workflow] running",
        );
      } finally {
        await runtime.dispose();
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    });
  });

  it("routes interactive verification input through the pi-hosted extension path and persists structured state", async () => {
    await withTempWorkspace(async (workspace) => {
      const originalCwd = process.cwd();
      const verificationRunner = new FakeVerificationRunner();
      let entryCounter = 0;
      const artifact = createArtifact({
        id: "artifact-verify-log",
        kind: "log",
        description: "Verification output",
        path: "/tmp/verify.log",
        createdAt: TIMESTAMP,
      });
      const verificationRecord = createVerificationRecord({
        id: "verification-build-pass",
        kind: "build",
        status: "passed",
        summary: "Build verification passed.",
        artifactIds: [artifact.id],
        createdAt: TIMESTAMP,
      });

      verificationRunner.enqueueResult({
        status: "passed",
        records: [verificationRecord],
        artifacts: [artifact],
      });

      const runtime = await createHellmRuntime({
        cwd: workspace.root,
        orchestratorOverrides: {
          verificationRunner,
          clock: () => TIMESTAMP,
          idGenerator: () => `hellm-test-id-${++entryCounter}`,
        },
      });

      try {
        const runner = runtime.session.extensionRunner;
        expect(runner).toBeDefined();

        const ui = createCapturingUiContext();
        runner!.setUIContext(ui.ui as never);

        const inputResult = await runner!.emitInput(
          "verify the current workspace state",
          undefined,
          "interactive",
        );
        const state = readRuntimeState(runtime);

        expect(inputResult.action).toBe("handled");
        expect(verificationRunner.calls).toHaveLength(1);
        expect(state.threads).toHaveLength(1);
        expect(state.threads[0]?.kind).toBe("verification");
        expect(state.episodes).toHaveLength(1);
        expect(state.episodes[0]?.source).toBe("verification");
        expect(state.verification.byKind.build?.status).toBe("passed");
        expect(ui.widgets.get("hellm-state")?.join("\n")).toContain("[verification]");
      } finally {
        await runtime.dispose();
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    });
  });

  it("advertises baseline hellm slash commands from the real TUI entrypoint in init-only mode", async () => {
    await withTempWorkspace(async (workspace) => {
      const result = runBunModule({
        entryPath: TUI_ENTRY,
        cwd: REPO_ROOT,
        args: ["--init-only"],
        env: {
          HELLM_CWD: workspace.root,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain(
        "[hellm/tui] hellm-commands /threads,/reconcile,/verify",
      );
    });
  });

  for (const contract of RICH_SLASH_COMMAND_SURFACE_PENDING_CONTRACTS) {
    test.todo(contract, () => {});
  }
});
