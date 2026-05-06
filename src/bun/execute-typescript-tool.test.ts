import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createWorkflowLibrary } from "./smithers-runtime/workflow-library";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createExecuteTypescriptTool } from "./execute-typescript-tool";

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];
const originalCxBin = process.env.SVVY_CX_BIN;

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
  if (originalCxBin === undefined) {
    delete process.env.SVVY_CX_BIN;
  } else {
    process.env.SVVY_CX_BIN = originalCxBin;
  }
});

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "svvy-execute-typescript-"));
  tempDirs.push(root);
  return root;
}

function writeWorkspaceFile(workspaceRoot: string, path: string, text: string): void {
  const filePath = join(workspaceRoot, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, "utf8");
}

function writeFakeCxBinary(workspaceRoot: string): string {
  const path = join(workspaceRoot, "fake-cx");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env bun",
      "const args = Bun.argv.slice(2);",
      "if (args[0] === 'overview') console.log(JSON.stringify([{ file: args[1] ?? '.', symbols: ['main'] }]));",
      "else if (args[0] === 'symbols') console.log(JSON.stringify([{ file: 'src/index.ts', name: 'main', kind: 'function' }]));",
      "else if (args[0] === 'definition') console.log(JSON.stringify([{ file: 'src/index.ts', line: 1, body: 'function main() {}' }]));",
      "else if (args[0] === 'references') console.log(JSON.stringify([{ file: 'src/index.ts', line: 2, caller: 'boot' }]));",
      "else if (args[0] === 'lang' && args[1] === 'list') console.log('typescript installed');",
      "else if (args[0] === 'cache' && args[1] === 'path') console.log('/tmp/cx-cache');",
      "else { console.error('unsupported fake cx command'); process.exit(2); }",
    ].join("\n"),
    "utf8",
  );
  chmodSync(path, 0o755);
  process.env.SVVY_CX_BIN = path;
  return path;
}

function createStore(sessionId: string, workspaceCwd: string): StructuredSessionStateStore {
  const store = createStructuredSessionStateStore({
    workspace: {
      id: workspaceCwd,
      label: "svvy",
      cwd: workspaceCwd,
    },
  });
  store.upsertPiSession({
    sessionId,
    title: "Execute Typescript",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createRuntime(
  store: StructuredSessionStateStore,
  sessionId: string,
  promptText = "Inspect the repository with execute_typescript",
): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: promptText,
  });

  return {
    current: {
      sessionId,
      turnId: turn.id,
      surfacePiSessionId: sessionId,
      surfaceThreadId: null,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "analysis",
      rootThreadId: null,
      promptText,
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("execute_typescript tool", () => {
  it("requires an active prompt runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime: { current: null },
      store: createStore("session-no-runtime", workspaceCwd),
    });

    await expect(
      tool.execute("tool-call-1", {
        typescriptCode: "return { ok: true };",
      }),
    ).rejects.toThrow("execute_typescript can only run during an active prompt.");
  });

  it("returns structured diagnostics and persists the submitted snippet before runtime execution", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-static-failure", workspaceCwd);
    const runtime = createRuntime(store, "session-static-failure");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-2", {
      typescriptCode: "const title: string = 42;",
    });

    expect(result.details).toMatchObject({
      success: false,
      error: {
        stage: "typecheck",
      },
    });

    const snapshot = store.getSessionState("session-static-failure");
    expect(snapshot.turns[0]?.turnDecision).toBe("execute_typescript");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "execute_typescript",
        executor: "orchestrator",
        visibility: "summary",
        status: "failed",
      }),
    ]);
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      "execute-typescript.ts",
      "execute-typescript.diagnostics.json",
    ]);
    const [snippetArtifact, diagnosticsArtifact] = snapshot.artifacts;
    expect(basename(snippetArtifact!.path!)).toBe(`${snippetArtifact!.id}-execute-typescript.ts`);
    expect(existsSync(snippetArtifact!.path!)).toBe(true);
    expect(readFileSync(snippetArtifact!.path!, "utf8")).toBe("const title: string = 42;");
    expect(existsSync(diagnosticsArtifact!.path!)).toBe(true);
    expect(snapshot.episodes).toEqual([]);
  });

  it("runs a typed composition through duplicated direct tools and records child commands", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeWorkspaceFile(workspaceCwd, "notes.txt", "alpha\nbeta\n");
    writeFakeCxBinary(workspaceCwd);
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/workflows/prompts/proof.mdx",
      "---\ntitle: Proof prompt\nsummary: Prompt proof.\n---\n",
    );

    const store = createStore("session-success", workspaceCwd);
    const runtime = createRuntime(store, "session-success", "Inspect a file and persist a summary");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      workflowLibrary: createWorkflowLibrary(workspaceCwd),
    });

    const result = await tool.execute("tool-call-3", {
      typescriptCode: [
        'const file = await api.read({ path: "notes.txt" });',
        'const overview = await api.cx.overview({ path: "." });',
        'const status = await api.bash({ command: "printf clean" });',
        'const assets = await api.workflow.list_assets({ kind: "prompt", scope: "saved" });',
        "const artifact = await api.artifact.write_text({",
        '  name: "summary.md",',
        '  text: `${file.content[0]?.type === "text" ? file.content[0].text.split("\\n")[0] : ""}:${status.content[0]?.type === "text" ? status.content[0].text.trim() : ""}`',
        "});",
        'console.log("artifact", artifact.details.path);',
        "return { assetCount: assets.details.assets.length, artifactId: artifact.details.artifactId, cxCommand: overview.details.command.join(' ') };",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        assetCount: 1,
        artifactId: expect.any(String),
        cxCommand: "cx overview . --json",
      },
    });

    const snapshot = store.getSessionState("session-success");
    expect(snapshot.turns[0]?.turnDecision).toBe("execute_typescript");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand).toMatchObject({
      toolName: "execute_typescript",
      status: "succeeded",
    });
    expect(parentCommand?.summary).toContain("Read 1 tool result");
    expect(parentCommand?.summary).toContain("Ran 1 bash command");
    expect(parentCommand?.summary).toContain("Ran 1 cx navigation call");
    expect(parentCommand?.summary).toContain("Created 1 artifact");
    expect(parentCommand?.summary).toContain("Discovered 1 workflow asset");
    expect(childCommands.map((command) => command.toolName)).toEqual([
      "read",
      "cx.overview",
      "bash",
      "workflow.list_assets",
      "artifact.write_text",
    ]);
    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parentCommandId: parentCommand!.id,
          toolName: "cx.overview",
          executor: "execute_typescript",
          visibility: "trace",
          status: "succeeded",
          facts: expect.objectContaining({
            command: ["cx", "overview", ".", "--json"],
            exitCode: 0,
            resultCount: 1,
          }),
        }),
        expect.objectContaining({
          parentCommandId: parentCommand!.id,
          toolName: "read",
          executor: "execute_typescript",
          visibility: "trace",
          status: "succeeded",
          facts: expect.objectContaining({
            path: "notes.txt",
          }),
        }),
        expect.objectContaining({
          parentCommandId: parentCommand!.id,
          toolName: "bash",
          executor: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          facts: expect.objectContaining({
            command: "printf clean",
          }),
        }),
        expect.objectContaining({
          parentCommandId: parentCommand!.id,
          toolName: "artifact.write_text",
          executor: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          facts: expect.objectContaining({
            artifactId: expect.any(String),
          }),
        }),
      ]),
    );
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      "execute-typescript.ts",
      "summary.md",
      "execute-typescript.logs.log",
    ]);
  });
});
