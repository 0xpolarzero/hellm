import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const tool = createExecuteTypescriptTool({
      cwd: createWorkspaceRoot(),
      runtime: { current: null },
      store: createStore("session-no-runtime", createWorkspaceRoot()),
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
    const runCommand = mock(async () => {
      throw new Error("api.exec.run should not execute when typecheck fails");
    });
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      runCommand,
    });

    const result = await tool.execute("tool-call-2", {
      typescriptCode: "const title: string = 42;",
    });

    expect(runCommand).toHaveBeenCalledTimes(0);
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

  it("runs a scripted task through injected api namespaces and records nested command traces", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeFileSync(join(workspaceCwd, "notes.txt"), "alpha\nbeta\n", "utf8");

    const store = createStore("session-success", workspaceCwd);
    const runtime = createRuntime(store, "session-success", "Inspect a file and persist a summary");
    const runCommand = mock(async () => ({
      exitCode: 0,
      stdout: "clean\n",
      stderr: "",
    }));
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      runCommand,
    });

    const result = await tool.execute("tool-call-3", {
      typescriptCode: [
        'const file = await api.repo.readFile({ path: "notes.txt" });',
        'const status = await api.exec.run({ command: "git", args: ["status", "--short"] });',
        "const artifact = await api.artifact.writeText({",
        '  name: "summary.md",',
        '  text: `${file.text.split("\\n")[0]}:${status.stdout.trim()}`',
        "});",
        'console.log("artifact", artifact.path);',
        "return { firstLine: file.text.split('\\n')[0], exitCode: status.exitCode, artifactId: artifact.artifactId };",
      ].join("\n"),
    });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      success: true,
      result: {
        firstLine: "alpha",
        exitCode: 0,
      },
    });

    const snapshot = store.getSessionState("session-success");
    expect(snapshot.turns[0]?.turnDecision).toBe("execute_typescript");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand).toMatchObject({
      toolName: "execute_typescript",
      status: "succeeded",
    });
    expect(parentCommand?.summary).toContain("Read 1 file");
    expect(parentCommand?.summary).toContain("Created 1 artifact");
    expect(childCommands).toEqual([
      expect.objectContaining({
        parentCommandId: parentCommand!.id,
        toolName: "repo.readFile",
        executor: "execute_typescript",
        visibility: "trace",
        status: "succeeded",
        facts: {
          path: "notes.txt",
          bytesRead: 11,
        },
      }),
      expect.objectContaining({
        parentCommandId: parentCommand!.id,
        toolName: "exec.run",
        executor: "execute_typescript",
        visibility: "trace",
        status: "succeeded",
        facts: expect.objectContaining({
          command: "git",
          exitCode: 0,
        }),
      }),
      expect.objectContaining({
        parentCommandId: parentCommand!.id,
        toolName: "artifact.writeText",
        executor: "execute_typescript",
        visibility: "summary",
        status: "succeeded",
        facts: expect.objectContaining({
          name: "summary.md",
          bytesWritten: 11,
        }),
      }),
    ]);
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      "execute-typescript.ts",
      "summary.md",
      "execute-typescript.logs.log",
    ]);
    const summaryArtifact = snapshot.artifacts.find((artifact) => artifact.name === "summary.md");
    expect(summaryArtifact?.path).toBeDefined();
    expect(readFileSync(summaryArtifact!.path!, "utf8")).toBe("alpha:clean");
    expect(snapshot.episodes).toEqual([]);
  });

  it("keeps runtime failures in command state instead of emitting episodes", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-runtime-failure", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-runtime-failure",
      "Run execute_typescript and keep the failure on the command",
    );
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-runtime-failure", {
      typescriptCode: 'throw new Error("boom");',
    });

    expect(result.details).toMatchObject({
      success: false,
      error: {
        message: "boom",
        stage: "runtime",
      },
    });

    const snapshot = store.getSessionState("session-runtime-failure");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "execute_typescript",
        status: "failed",
        error: "boom",
      }),
    ]);
    expect(snapshot.episodes).toEqual([]);
  });

  it("supports the fs-style repo surface and records normalized facts for each child command", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeFileSync(join(workspaceCwd, "notes.txt"), "needle\nbeta\n", "utf8");
    writeFileSync(join(workspaceCwd, "data.json"), JSON.stringify({ ok: true }), "utf8");
    writeFileSync(join(workspaceCwd, "keep.txt"), "keep\n", "utf8");

    const store = createStore("session-repo-surface", workspaceCwd);
    const runtime = createRuntime(store, "session-repo-surface", "Exercise the repo api surface");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-4", {
      typescriptCode: [
        'const files = await api.repo.readFiles({ paths: ["notes.txt", "data.json"] });',
        'const json = await api.repo.readJson<{ ok: boolean }>({ path: "data.json" });',
        'await api.repo.writeJson({ path: "nested/out.json", value: { ok: json.value.ok }, createDirectories: true });',
        'const listed = await api.repo.glob({ pattern: "nested/**/*" });',
        'const grep = await api.repo.grep({ pattern: "needle", glob: "**/*.txt" });',
        'const statBeforeDelete = await api.repo.stat({ path: "keep.txt" });',
        'await api.repo.unlink({ path: "keep.txt" });',
        'const statAfterDelete = await api.repo.stat({ path: "keep.txt" });',
        "return {",
        "  fileCount: files.files.length,",
        "  ok: json.value.ok,",
        "  listed: listed.paths,",
        "  grepCount: grep.matches.length,",
        "  beforeKind: statBeforeDelete.kind,",
        "  afterKind: statAfterDelete.kind,",
        "};",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        fileCount: 2,
        ok: true,
        listed: ["nested/out.json"],
        grepCount: 1,
        beforeKind: "file",
        afterKind: "missing",
      },
    });

    const snapshot = store.getSessionState("session-repo-surface");
    const childCommands = snapshot.commands.slice(1);
    expect(childCommands.map((command) => command.toolName)).toEqual([
      "repo.readFiles",
      "repo.readJson",
      "repo.writeJson",
      "repo.glob",
      "repo.grep",
      "repo.stat",
      "repo.unlink",
      "repo.stat",
    ]);

    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "repo.readFiles",
          facts: {
            paths: ["notes.txt", "data.json"],
            fileCount: 2,
            totalBytesRead: 23,
          },
        }),
        expect.objectContaining({
          toolName: "repo.readJson",
          facts: {
            path: "data.json",
          },
        }),
        expect.objectContaining({
          toolName: "repo.writeJson",
          visibility: "summary",
          facts: {
            path: "nested/out.json",
            bytesWritten: 16,
          },
        }),
        expect.objectContaining({
          toolName: "repo.glob",
          facts: {
            pattern: "nested/**/*",
            resultCount: 1,
          },
        }),
        expect.objectContaining({
          toolName: "repo.grep",
          facts: {
            pattern: "needle",
            glob: "**/*.txt",
            matchCount: 1,
            pathCount: 1,
          },
        }),
        expect.objectContaining({
          toolName: "repo.unlink",
          visibility: "summary",
          facts: {
            path: "keep.txt",
            deleted: true,
          },
        }),
      ]),
    );
  });

  it("supports read-only git commands and records normalized git facts", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-git-readonly", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-git-readonly",
      "Inspect git state through code mode",
    );
    const diffText = "diff --git a/notes.txt b/notes.txt\n";
    const runCommand = mock(async (input) => {
      if (input.command !== "git") {
        throw new Error(`Unexpected command: ${input.command}`);
      }
      switch (input.args?.[0]) {
        case "status":
          return {
            exitCode: 0,
            stdout: [
              "# branch.oid abc1234",
              "# branch.head main",
              "# branch.ab +2 -1",
              "1 .M N... 100644 100644 100644 abc abc notes.txt",
              "? new.txt",
            ].join("\n"),
            stderr: "",
          };
        case "diff":
          return { exitCode: 0, stdout: diffText, stderr: "" };
        case "log":
          return {
            exitCode: 0,
            stdout: [
              "abc123\u001ffix: parser\u001fAda\u001f2026-04-16T10:00:00.000Z",
              "def456\u001ftest: cover parser\u001fGrace\u001f2026-04-15T09:00:00.000Z",
            ].join("\n"),
            stderr: "",
          };
        case "show":
          return { exitCode: 0, stdout: "alpha\n", stderr: "" };
        case "branch":
          return {
            exitCode: 0,
            stdout: ["*\u001fmain\u001forigin/main", " \u001ffeature\u001forigin/feature"].join(
              "\n",
            ),
            stderr: "",
          };
        case "merge-base":
          return { exitCode: 0, stdout: "feedface\n", stderr: "" };
        default:
          throw new Error(`Unexpected git args: ${input.args?.join(" ")}`);
      }
    });
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      runCommand,
    });

    const result = await tool.execute("tool-call-5", {
      typescriptCode: [
        "const status = await api.git.status({});",
        'const diff = await api.git.diff({ cached: true, paths: ["notes.txt"] });',
        'const log = await api.git.log({ ref: "origin/main", limit: 2 });',
        'const show = await api.git.show({ ref: "HEAD~1", path: "notes.txt" });',
        "const branch = await api.git.branch({ all: true });",
        'const mergeBase = await api.git.mergeBase({ baseRef: "main", headRef: "feature" });',
        "return {",
        "  branch: status.branch,",
        "  changedFileCount: status.files.length,",
        "  diffBytes: diff.text.length,",
        "  commitCount: log.commits.length,",
        "  showBytes: show.text.length,",
        "  currentBranch: branch.current,",
        "  mergeBase: mergeBase.sha,",
        "};",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        branch: "main",
        changedFileCount: 2,
        diffBytes: diffText.length,
        commitCount: 2,
        showBytes: 6,
        currentBranch: "main",
        mergeBase: "feedface",
      },
    });

    const snapshot = store.getSessionState("session-git-readonly");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand?.summary).toContain("Git: branch main, 2 changed files");
    expect(childCommands.map((command) => command.toolName)).toEqual([
      "git.status",
      "git.diff",
      "git.log",
      "git.show",
      "git.branch",
      "git.mergeBase",
    ]);
    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "git.status",
          facts: {
            branch: "main",
            changedFileCount: 2,
            ahead: 2,
            behind: 1,
          },
        }),
        expect.objectContaining({
          toolName: "git.diff",
          facts: {
            paths: ["notes.txt"],
            cached: true,
            diffBytes: diffText.length,
          },
        }),
        expect.objectContaining({
          toolName: "git.log",
          facts: {
            ref: "origin/main",
            limit: 2,
            commitCount: 2,
          },
        }),
        expect.objectContaining({
          toolName: "git.show",
          facts: {
            ref: "HEAD~1",
            path: "notes.txt",
            bytesRead: 6,
          },
        }),
        expect.objectContaining({
          toolName: "git.branch",
          facts: {
            current: "main",
            branchCount: 2,
          },
        }),
        expect.objectContaining({
          toolName: "git.mergeBase",
          facts: {
            baseRef: "main",
            headRef: "feature",
            sha: "feedface",
          },
        }),
      ]),
    );
  });

  it("supports command-shaped git mutators and records summary-vs-trace facts", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-git-mutating", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-git-mutating",
      "Perform git updates through code mode",
    );
    const commitSha = "abc1234567890def";
    const runCommand = mock(async (input) => {
      if (input.command !== "git") {
        throw new Error(`Unexpected command: ${input.command}`);
      }
      const [subcommand, second] = input.args ?? [];
      switch (subcommand) {
        case "fetch":
        case "pull":
        case "add":
        case "switch":
        case "checkout":
        case "restore":
        case "rebase":
        case "cherry-pick":
        case "push":
          return { exitCode: 0, stdout: `${subcommand}\n`, stderr: "" };
        case "commit":
          return { exitCode: 0, stdout: `[main abc1234] chore: update notes\n`, stderr: "" };
        case "rev-parse":
          return { exitCode: 0, stdout: `${commitSha}\n`, stderr: "" };
        case "stash":
          return { exitCode: 0, stdout: `${second ?? "push"}\n`, stderr: "" };
        case "tag":
          return { exitCode: 0, stdout: `${second ?? "create"}\n`, stderr: "" };
        default:
          throw new Error(`Unexpected git args: ${input.args?.join(" ")}`);
      }
    });
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      runCommand,
    });

    const result = await tool.execute("tool-call-6", {
      typescriptCode: [
        'await api.git.fetch({ remote: "origin", refspecs: ["main"], prune: true });',
        'await api.git.pull({ remote: "origin", branch: "main", rebase: true });',
        'await api.git.add({ paths: ["notes.txt"], update: true });',
        'const commit = await api.git.commit({ message: "chore: update notes", amend: true });',
        'await api.git.switch({ branch: "feature/runtime", create: true, startPoint: "origin/main" });',
        'await api.git.checkout({ ref: "HEAD~1", paths: ["notes.txt"] });',
        'await api.git.restore({ paths: ["notes.txt"], source: "HEAD", staged: true, worktree: false });',
        'await api.git.rebase({ upstream: "origin/main", branch: "feature/runtime" });',
        'await api.git.cherryPick({ commits: ["abc111", "def222"], noCommit: true });',
        'await api.git.stash({ subcommand: "list" });',
        'await api.git.stash({ subcommand: "push", message: "wip", includeUntracked: true });',
        'await api.git.tag({ list: true, pattern: "v*" });',
        'await api.git.tag({ name: "v1.2.3", target: "HEAD", annotate: true, message: "release" });',
        'await api.git.push({ remote: "origin", branch: "main", setUpstream: true, forceWithLease: true, tags: true });',
        "return { sha: commit.sha };",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        sha: commitSha,
      },
    });

    const snapshot = store.getSessionState("session-git-mutating");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand?.summary).toContain("Git: committed abc1234 and pushed origin/main");
    expect(childCommands.map((command) => command.toolName).toSorted()).toEqual([
      "git.add",
      "git.checkout",
      "git.cherryPick",
      "git.commit",
      "git.fetch",
      "git.pull",
      "git.push",
      "git.rebase",
      "git.restore",
      "git.stash",
      "git.stash",
      "git.switch",
      "git.tag",
      "git.tag",
    ]);
    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "git.fetch",
          visibility: "summary",
          facts: {
            remote: "origin",
            refspecCount: 1,
            prune: true,
          },
        }),
        expect.objectContaining({
          toolName: "git.pull",
          facts: {
            remote: "origin",
            branch: "main",
            rebase: true,
          },
        }),
        expect.objectContaining({
          toolName: "git.add",
          facts: {
            paths: ["notes.txt"],
            all: false,
            update: true,
          },
        }),
        expect.objectContaining({
          toolName: "git.commit",
          facts: {
            messageSummary: "chore: update notes",
            sha: commitSha,
            all: false,
            allowEmpty: false,
            amend: true,
          },
        }),
        expect.objectContaining({
          toolName: "git.switch",
          facts: {
            branch: "feature/runtime",
            create: true,
            startPoint: "origin/main",
          },
        }),
        expect.objectContaining({
          toolName: "git.checkout",
          facts: {
            ref: "HEAD~1",
            paths: ["notes.txt"],
          },
        }),
        expect.objectContaining({
          toolName: "git.restore",
          facts: {
            paths: ["notes.txt"],
            source: "HEAD",
            staged: true,
            worktree: false,
          },
        }),
        expect.objectContaining({
          toolName: "git.rebase",
          facts: {
            upstream: "origin/main",
            branch: "feature/runtime",
            mode: "start",
          },
        }),
        expect.objectContaining({
          toolName: "git.cherryPick",
          facts: {
            commitCount: 2,
            noCommit: true,
            mode: "start",
          },
        }),
        expect.objectContaining({
          toolName: "git.stash",
          visibility: "trace",
          facts: {
            subcommand: "list",
          },
        }),
        expect.objectContaining({
          toolName: "git.stash",
          visibility: "summary",
          facts: {
            subcommand: "push",
            message: "wip",
          },
        }),
        expect.objectContaining({
          toolName: "git.tag",
          visibility: "trace",
          facts: {
            annotate: false,
            delete: false,
            list: true,
            pattern: "v*",
          },
        }),
        expect.objectContaining({
          toolName: "git.tag",
          visibility: "summary",
          facts: {
            name: "v1.2.3",
            target: "HEAD",
            annotate: true,
            delete: false,
            list: false,
          },
        }),
        expect.objectContaining({
          toolName: "git.push",
          facts: {
            remote: "origin",
            branch: "main",
            setUpstream: true,
            forceWithLease: true,
            tags: true,
          },
        }),
      ]),
    );
  });

  it("records web access, artifact creation, and non-zero exec runs as normalized child commands", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeFileSync(join(workspaceCwd, "report.txt"), "ready\n", "utf8");

    const store = createStore("session-web-exec", workspaceCwd);
    const runtime = createRuntime(store, "session-web-exec", "Search, fetch, and persist outputs");
    const runCommand = mock(async () => ({
      exitCode: 2,
      stdout: "fatal\n",
      stderr: "command failed\n",
    }));
    const webSearch = mock(async () => ({
      results: [
        { title: "One", url: "https://example.com/one", snippet: "first" },
        { title: "Two", url: "https://example.com/two", snippet: "second" },
      ],
    }));
    const fetchText = mock(async () => ({
      url: "https://example.com/spec",
      text: "hello world",
    }));
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      runCommand,
      webSearch,
      fetchText,
    });

    const result = await tool.execute("tool-call-7", {
      typescriptCode: [
        'const search = await api.web.search({ query: "svvy execute typescript", maxResults: 2 });',
        'const fetched = await api.web.fetchText({ url: "https://example.com/spec" });',
        'const execResult = await api.exec.run({ command: "git", args: ["status", "--short"], cwd: ".", timeoutMs: 5000 });',
        'const jsonArtifact = await api.artifact.writeJson({ name: "search.json", value: { count: search.results.length } });',
        'const attached = await api.artifact.attachFile({ path: "report.txt" });',
        "return {",
        "  resultCount: search.results.length,",
        "  bytesRead: fetched.text.length,",
        "  exitCode: execResult.exitCode,",
        "  jsonArtifactId: jsonArtifact.artifactId,",
        "  attachedArtifactId: attached.artifactId,",
        "};",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        resultCount: 2,
        bytesRead: 11,
        exitCode: 2,
      },
    });

    const snapshot = store.getSessionState("session-web-exec");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand?.summary).toContain("Created 2 artifacts");
    expect(parentCommand?.summary).toContain("Ran 1 subprocess (1 failed)");
    expect(childCommands.map((command) => command.toolName)).toEqual([
      "web.search",
      "web.fetchText",
      "exec.run",
      "artifact.writeJson",
      "artifact.attachFile",
    ]);
    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "web.search",
          facts: {
            query: "svvy execute typescript",
            resultCount: 2,
          },
        }),
        expect.objectContaining({
          toolName: "web.fetchText",
          facts: {
            url: "https://example.com/spec",
            bytesRead: 11,
          },
        }),
        expect.objectContaining({
          toolName: "exec.run",
          visibility: "summary",
          status: "failed",
          facts: expect.objectContaining({
            command: "git",
            args: ["status", "--short"],
            exitCode: 2,
            stdoutBytes: 6,
            stderrBytes: 15,
            timeoutMs: 5000,
          }),
        }),
        expect.objectContaining({
          toolName: "artifact.writeJson",
          visibility: "summary",
          facts: expect.objectContaining({
            name: "search.json",
            bytesWritten: JSON.stringify({ count: 2 }, null, 2).length,
          }),
        }),
        expect.objectContaining({
          toolName: "artifact.attachFile",
          visibility: "summary",
          facts: expect.objectContaining({
            name: "report.txt",
          }),
        }),
      ]),
    );
  });

  it("lists workflow authoring assets with spec-aligned metadata and filters", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/workflows/definitions/create-implement-review-verify.ts",
      [
        "/**",
        " * @svvyAssetKind definition",
        " * @svvyId create_implement_review_verify",
        " * @svvyTitle Create Implement Review Verify",
        " * @svvySummary Reusable workflow factory for implement, review, and verification stages.",
        " * @svvyTags sequential, coding, review, verification",
        " * @svvyExports implementReviewVerifyLaunchSchema, createImplementReviewVerifyWorkflow",
        " */",
        "export const implementReviewVerifyLaunchSchema = {};",
        "export function createImplementReviewVerifyWorkflow() {}",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/workflows/prompts/review-base.mdx",
      [
        "---",
        "svvyAssetKind: prompt",
        "svvyId: review_base",
        "title: Review Base",
        "summary: Base review instructions reusable across review-oriented workflows.",
        "tags:",
        "  - review",
        "  - reusable",
        "variables:",
        "  - objective",
        "---",
        "",
        "Review the implementation against the stated objective.",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/workflows/components/reviewer-profile.ts",
      [
        "/**",
        " * @svvyAssetKind component",
        " * @svvyId saved_reviewer_profile",
        " * @svvyTitle Saved Reviewer Profile",
        " * @svvySummary Reusable reviewer profile for generic code review.",
        " * @svvySubtype agent-profile",
        " * @svvyTags review, reusable",
        " * @svvyExports reviewerProfile",
        " * @svvyProviderModelSummary openai/gpt-5.4-mini",
        " * @svvyToolsetSummary execute_typescript",
        " */",
        "export const reviewerProfile = {};",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/workflows/entries/implement-review.entry.ts",
      [
        "export const workflowId = 'implement_review_verify';",
        "export const label = 'Implement Review Verify';",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/artifacts/workflows/wf-oauth-review/components/oauth-security-profile.ts",
      [
        "/**",
        " * @svvyAssetKind component",
        " * @svvyId oauth_security_reviewer",
        " * @svvyTitle OAuth Security Reviewer",
        " * @svvySummary Focused reviewer profile for OAuth-sensitive changes.",
        " * @svvySubtype agent-profile",
        " * @svvyTags review, oauth",
        " * @svvyExports oauthSecurityReviewer",
        " * @svvyProviderModelSummary openai/gpt-5.4",
        " * @svvyToolsetSummary execute_typescript",
        " */",
        "export const oauthSecurityReviewer = {};",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/artifacts/workflows/wf-oauth-review/entries/oauth-review.entry.ts",
      [
        "export const workflowId = 'oauth_review_draft';",
        "export const label = 'OAuth Review Draft';",
      ].join("\n"),
    );
    writeWorkspaceFile(
      workspaceCwd,
      ".svvy/artifacts/workflows/wf-oauth-review/metadata.json",
      JSON.stringify({ artifactWorkflowId: "wf-oauth-review" }, null, 2),
    );

    const store = createStore("session-workflow-assets", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-workflow-assets",
      "Discover reusable workflow assets before authoring",
    );
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-workflow-assets", {
      typescriptCode: [
        "const definitions = await api.workflow.listAssets({",
        '  kind: "definition",',
        '  scope: "saved",',
        '  exports: ["createImplementReviewVerifyWorkflow"],',
        "});",
        "const prompts = await api.workflow.listAssets({",
        '  kind: "prompt",',
        '  scope: "saved",',
        '  tags: ["review"],',
        "});",
        "const oauthProfiles = await api.workflow.listAssets({",
        '  kind: "component",',
        '  subtype: "agent-profile",',
        '  scope: "both",',
        '  tags: ["oauth"],',
        "});",
        "const savedLibrary = await api.workflow.listAssets({",
        '  scope: "saved",',
        '  pathPrefix: ".svvy/workflows/",',
        "});",
        "return {",
        "  definitionIds: definitions.map((asset) => asset.id),",
        "  promptVariables: prompts[0]?.variables ?? [],",
        "  oauthProfile: oauthProfiles[0] ?? null,",
        "  savedLibraryPaths: savedLibrary.map((asset) => asset.path),",
        "};",
      ].join("\n"),
    });

    expect(result.details).toMatchObject({
      success: true,
      result: {
        definitionIds: ["create_implement_review_verify"],
        promptVariables: ["objective"],
        oauthProfile: {
          id: "oauth_security_reviewer",
          scope: "artifact",
          providerModelSummary: "openai/gpt-5.4",
          toolsetSummary: "execute_typescript",
        },
        savedLibraryPaths: [
          ".svvy/workflows/components/reviewer-profile.ts",
          ".svvy/workflows/definitions/create-implement-review-verify.ts",
          ".svvy/workflows/prompts/review-base.mdx",
        ],
      },
    });

    const snapshot = store.getSessionState("session-workflow-assets");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand?.summary).toContain("Discovered 6 workflow assets");
    expect(childCommands.map((command) => command.toolName)).toEqual([
      "workflow.listAssets",
      "workflow.listAssets",
      "workflow.listAssets",
      "workflow.listAssets",
    ]);
    expect(childCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "workflow.listAssets",
          facts: {
            kind: "definition",
            scope: "saved",
            exports: ["createImplementReviewVerifyWorkflow"],
            assetCount: 1,
          },
        }),
        expect.objectContaining({
          toolName: "workflow.listAssets",
          facts: {
            kind: "prompt",
            scope: "saved",
            tags: ["review"],
            assetCount: 1,
          },
        }),
        expect.objectContaining({
          toolName: "workflow.listAssets",
          facts: {
            kind: "component",
            subtype: "agent-profile",
            scope: "both",
            tags: ["oauth"],
            assetCount: 1,
          },
        }),
        expect.objectContaining({
          toolName: "workflow.listAssets",
          facts: {
            scope: "saved",
            pathPrefix: ".svvy/workflows/",
            assetCount: 3,
          },
        }),
      ]),
    );
  });

  it("lists workflow models from the shared discovery surface and records normalized facts", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-workflow-models", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-workflow-models",
      "Inspect workflow model options before creating a new agent profile",
    );
    const workflowLibrary = createWorkflowLibrary(workspaceCwd, {
      getProviders: (() => ["openai", "anthropic"]) as any,
      getModels: ((providerId: string) =>
        providerId === "openai"
          ? [{ id: "gpt-5.4", api: "openai-responses", reasoning: true, input: ["text", "image"] }]
          : [
              {
                id: "claude-sonnet-4",
                api: "anthropic-messages",
                reasoning: false,
                input: ["text"],
              },
            ]) as any,
      resolveAuthState: ((providerId: string) =>
        providerId === "openai"
          ? { connected: true, keyType: "oauth" }
          : { connected: false, keyType: "none" }) as any,
      getProviderEnvVar: ((providerId: string) =>
        providerId === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY") as any,
    });
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      workflowLibrary,
    });

    const result = await tool.execute("tool-call-workflow-models", {
      typescriptCode: [
        "const models = await api.workflow.listModels();",
        "return {",
        "  count: models.length,",
        "  providerIds: models.map((model) => model.providerId),",
        "  first: models[0] ?? null,",
        "  last: models[models.length - 1] ?? null,",
        "};",
      ].join("\n"),
    });

    expect(result.details.success).toBe(true);
    expect(result.details.result).toEqual({
      count: 2,
      providerIds: ["anthropic", "openai"],
      first: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4",
        authAvailable: false,
        authSource: "missing:ANTHROPIC_API_KEY",
        capabilityFlags: ["tool-calling"],
      },
      last: {
        providerId: "openai",
        modelId: "gpt-5.4",
        authAvailable: true,
        authSource: "oauth",
        capabilityFlags: ["reasoning", "vision", "tool-calling"],
      },
    });

    const snapshot = store.getSessionState("session-workflow-models");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand?.summary).toContain("Listed 2 workflow models");
    expect(childCommands).toEqual([
      expect.objectContaining({
        toolName: "workflow.listModels",
        facts: {
          modelCount: 2,
          providerCount: 2,
          authAvailableCount: 1,
        },
      }),
    ]);
  });

  it("logs clean workflow validation after writing saved workflow files", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-workflow-write-validate", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-workflow-write-validate",
      "Write a reusable saved workflow component",
    );
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-workflow-write-validate", {
      typescriptCode: [
        "await api.repo.writeFile({",
        '  path: ".svvy/workflows/components/oauth-security-reviewer.ts",',
        "  text: `/**\\n * @svvyAssetKind component\\n * @svvyId oauth_security_reviewer\\n * @svvyTitle OAuth Security Reviewer\\n * @svvySummary Reusable OAuth security reviewer profile.\\n * @svvySubtype agent-profile\\n * @svvyProviderModelSummary openai/gpt-5.4\\n * @svvyToolsetSummary execute_typescript\\n */\\nexport const oauthSecurityReviewer = {};`,",
        "  createDirectories: true,",
        "});",
        "return { ok: true };",
      ].join("\n"),
    });

    expect(result.details.success).toBe(true);
    expect(result.details.logs).toEqual(
      expect.arrayContaining([
        "Workflow validation passed after writing .svvy/workflows/components/oauth-security-reviewer.ts.",
      ]),
    );
    expect(
      existsSync(join(workspaceCwd, ".svvy/workflows/components/oauth-security-reviewer.ts")),
    ).toBe(true);

    const snapshot = store.getSessionState("session-workflow-write-validate");
    const [, ...childCommands] = snapshot.commands;
    expect(childCommands).toEqual([
      expect.objectContaining({
        toolName: "repo.writeFile",
        status: "succeeded",
        facts: expect.objectContaining({
          path: ".svvy/workflows/components/oauth-security-reviewer.ts",
          workflowValidationChecked: true,
          workflowValidationOk: true,
          workflowValidationDiagnosticCount: 0,
        }),
      }),
    ]);
  });

  it("logs workflow validation errors after writing invalid saved workflow files", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-workflow-write-validate-fail", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-workflow-write-validate-fail",
      "Write an invalid reusable saved workflow component",
    );
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-workflow-write-validate-fail", {
      typescriptCode: [
        "await api.repo.writeFile({",
        '  path: ".svvy/workflows/components/broken-reviewer.ts",',
        '  text: `/**\\n * @svvyAssetKind component\\n * @svvyId broken_reviewer\\n * @svvyTitle Broken Reviewer\\n * @svvySummary Broken reusable reviewer profile.\\n */\\nconst broken: number = \\\"oops\\\";\\nexport const brokenReviewer = broken;`,',
        "  createDirectories: true,",
        "});",
        "return { ok: true };",
      ].join("\n"),
    });

    expect(result.details.success).toBe(true);
    expect(result.details.logs).toEqual(
      expect.arrayContaining([
        "[error] Workflow validation reported 1 error after writing .svvy/workflows/components/broken-reviewer.ts.",
        expect.stringContaining(".svvy/workflows/components/broken-reviewer.ts"),
      ]),
    );
    expect(existsSync(join(workspaceCwd, ".svvy/workflows/components/broken-reviewer.ts"))).toBe(
      true,
    );

    const snapshot = store.getSessionState("session-workflow-write-validate-fail");
    const [, ...childCommands] = snapshot.commands;
    expect(childCommands).toEqual([
      expect.objectContaining({
        toolName: "repo.writeFile",
        status: "succeeded",
        facts: expect.objectContaining({
          path: ".svvy/workflows/components/broken-reviewer.ts",
          workflowValidationChecked: true,
          workflowValidationOk: false,
          workflowValidationDiagnosticCount: 1,
        }),
      }),
    ]);
  });
});
