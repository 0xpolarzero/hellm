import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
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
    requestSummary: promptText,
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    title: "Execute code mode task",
    objective: promptText,
  });

  return {
    current: {
      sessionId,
      turnId: turn.id,
      rootThreadId: rootThread.id,
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
});
