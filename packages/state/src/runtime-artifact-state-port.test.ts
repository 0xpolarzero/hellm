import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeArtifactStatePort,
  StateContractError,
  type AbsolutePath,
  type ArtifactId,
  type CommandId,
  type RuntimeArtifactStatePortService,
  type WorkspaceSessionId,
  type WorkspaceId,
} from "@svvy/core";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
  StructuredSessionState,
} from "./structured-session-state";
import type { StructuredSessionStateStore } from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";
import {
  layerRuntimeArtifactStatePort,
  runtimeArtifactStatePortFromStore,
} from "./runtime-artifact-state-port";

const tempDirs: string[] = [];
const stores: StructuredSessionStateStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runtime artifact state port", () => {
  it("resolves through the structured session state layer", async () => {
    const workspaceCwd = mkdtempTracked("svvy-runtime-artifact-layer-");
    const artifactDir = join(workspaceCwd, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const sessionId = "session-runtime-artifact-layer" as WorkspaceSessionId;

    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId,
            title: "Runtime artifact layer",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          });

          const port = yield* RuntimeArtifactStatePort;
          const createdResult = yield* port.createArtifact({
            sessionId,
            kind: "text",
            name: "layer.md",
            content: "layer",
          });
          const created = createdResult.value;
          const listed = yield* port.listArtifacts({ sessionId });

          expect(created.name).toBe("layer.md");
          expect(listed.map((artifact) => artifact.id)).toEqual([created.id]);
        }).pipe(
          Effect.provide(
            layerRuntimeArtifactStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace: {
                    id: workspaceCwd,
                    label: "svvy",
                    cwd: workspaceCwd,
                    artifactDir,
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("creates, reads, lists, and deletes artifact metadata through an Effect service", async () => {
    const { artifactDir, commandId, port, sessionId, workspaceCwd } = createFixture();
    const workspaceId = workspaceCwd as WorkspaceId;

    const createdResult = await runTestEffect(
      port.createArtifact({
        sessionId,
        sourceCommandId: commandId,
        kind: "text",
        name: "handoff.md",
        content: "handoff body",
        immutable: true,
      }),
    );
    const created = createdResult.value;

    const createdArtifactId = created.id;
    expect(createdArtifactId).toMatch(/^artifact-/);
    expect(created).toMatchObject({
      id: createdArtifactId,
      sessionId,
      sourceCommandId: commandId,
      kind: "text",
      name: "handoff.md",
      path: join(artifactDir, sessionId, "immutable", "handoff.md"),
      mimeType: "text/markdown",
      bytes: "handoff body".length,
      sha256: "4f7af4d83d10ee9be864a76e2fe30c8c5197350d38805efddba3d8a12e2b8d8c",
      immutable: true,
      deletedAt: null,
    });
    expect(createdResult.afterCommit).toEqual([
      {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "sessionNavigation" },
      },
      {
        scope: "workspace",
        workspaceId,
        invalidation: {
          model: "commandInspector",
          ids: [commandId],
        },
      },
    ]);
    expect(existsSync(created.path!)).toBeTrue();

    const inspected = await runTestEffect(
      port.inspectArtifact({
        sessionId,
        artifactId: createdArtifactId,
      }),
    );
    const listed = await runTestEffect(
      port.listArtifacts({
        sessionId,
      }),
    );
    const deletedResult = await runTestEffect(
      port.deleteArtifact({
        sessionId,
        artifactId: createdArtifactId,
      }),
    );
    const deleted = deletedResult.value;
    const afterDelete = await runTestEffect(
      port.listArtifacts({
        sessionId,
      }),
    );

    expect(inspected).toEqual(created);
    expect(listed.map((artifact) => artifact.id)).toEqual([created.id]);
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect(deletedResult.afterCommit).toEqual(createdResult.afterCommit);
    expect(existsSync(created.path!)).toBeFalse();
    expect(afterDelete).toEqual([]);
  });

  it("maps artifact store errors to typed state contract reasons without hiding command prefixes", async () => {
    const { commandId, port, sessionId } = createFixture();
    await runTestEffect(
      port.createArtifact({
        sessionId,
        sourceCommandId: commandId,
        kind: "text",
        name: "duplicate.md",
        content: "",
      }),
    );

    await expect(
      runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "text",
          name: "duplicate.md",
          content: "",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.create",
      reason: "conflict",
      message: expect.stringContaining("ARTIFACT_EXISTS:"),
    });

    await expect(
      runTestEffect(
        port.inspectArtifact({
          sessionId,
          artifactId: "artifact_missing" as ArtifactId,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.inspect",
      reason: "not-found",
      message: "ARTIFACT_NOT_FOUND: artifact_missing",
    });

    await expect(
      runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "file",
          name: "missing.txt",
          path: join(artifactDirFor(sessionId), "missing.txt") as AbsolutePath,
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
    await expect(
      runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "file",
          name: "missing.txt",
          path: join(artifactDirFor(sessionId), "missing.txt") as AbsolutePath,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.create",
      reason: "invalid-input",
      message: expect.stringContaining("SOURCE_NOT_FOUND:"),
    });
  });

  it("maps artifact materialization failures to transaction-failed", async () => {
    const { artifactDir, commandId, port, sessionId } = createFixture();
    rmSync(artifactDir, { recursive: true, force: true });
    writeFileSync(artifactDir, "not a directory\n");

    await expect(
      runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "text",
          name: "blocked.md",
          content: "",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.create",
      reason: "transaction-failed",
      message: expect.stringContaining("COPY_FAILED:"),
    });
  });

  it("maps artifact deletion failures to transaction-failed without tombstoning", async () => {
    const { commandId, port, sessionId } = createFixture();
    const artifact = (
      await runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "text",
          name: "blocked.md",
          content: "blocked\n",
        }),
      )
    ).value;
    rmSync(artifact.path!);
    mkdirSync(artifact.path!);

    await expect(
      runTestEffect(
        port.deleteArtifact({
          sessionId,
          artifactId: artifact.id,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.delete",
      reason: "transaction-failed",
      message: expect.stringContaining("DELETE_FAILED:"),
    });
    await expect(
      runTestEffect(
        port.inspectArtifact({
          sessionId,
          artifactId: artifact.id,
        }),
      ),
    ).resolves.toMatchObject({
      deletedAt: null,
    });
  });

  it("copies source files into the artifact store without exposing source path ownership", async () => {
    const { commandId, port, sessionId, workspaceCwd } = createFixture();
    const sourcePath = join(workspaceCwd, "report.json");
    writeFileSync(sourcePath, '{"ok":true}');

    const artifact = (
      await runTestEffect(
        port.createArtifact({
          sessionId,
          sourceCommandId: commandId,
          kind: "json",
          path: sourcePath as AbsolutePath,
        }),
      )
    ).value;

    expect(artifact).toMatchObject({
      sessionId,
      sourceCommandId: commandId,
      kind: "json",
      name: "report.json",
      mimeType: "application/json",
      bytes: '{"ok":true}'.length,
    });
    expect(artifact.path).not.toBe(sourcePath);
    expect(existsSync(artifact.path!)).toBeTrue();
  });
});

function createFixture(): {
  artifactDir: string;
  commandId: CommandId;
  port: RuntimeArtifactStatePortService;
  sessionId: WorkspaceSessionId;
  workspaceCwd: string;
} {
  const workspaceCwd = mkdtempTracked("svvy-runtime-artifact-port-");
  const artifactDir = join(workspaceCwd, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const sessionId = "session-runtime-artifact-port" as WorkspaceSessionId;
  const store = createStructuredSessionStateStore({
    workspace: {
      id: workspaceCwd,
      label: "svvy",
      cwd: workspaceCwd,
      artifactDir,
    },
  });
  stores.push(store);
  store.upsertPiSession({
    sessionId,
    title: "Runtime artifact state port",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 0,
    status: "idle",
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
  });
  const turn = store.startTurn({
    sessionId,
    surfacePiSessionId: "surface-runtime-artifact-port",
    requestSummary: "Create artifact.",
  });
  const command = store.createCommand({
    turnId: turn.id,
    surfacePiSessionId: "surface-runtime-artifact-port",
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "surface",
    title: "Create artifact",
    summary: "Create artifact.",
  });
  return {
    artifactDir,
    commandId: command.id as CommandId,
    port: runtimeArtifactStatePortFromStore(store),
    sessionId,
    workspaceCwd,
  };
}

function mkdtempTracked(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function artifactDirFor(sessionId: WorkspaceSessionId): string {
  return join(tmpdir(), `missing-artifact-${sessionId}`);
}
