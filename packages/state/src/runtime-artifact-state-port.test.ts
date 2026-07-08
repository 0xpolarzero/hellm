import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeArtifactStatePort,
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
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

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
          const turn = yield* state.startTurn({
            sessionId,
            surfacePiSessionId: "surface-runtime-artifact-layer",
            requestSummary: "Create artifact.",
          });
          const command = yield* state.createCommand({
            turnId: turn.id,
            surfacePiSessionId: "surface-runtime-artifact-layer",
            toolName: "exec_command",
            executor: "orchestrator",
            visibility: "surface",
            title: "Create artifact",
            summary: "Create artifact.",
          });

          const port = yield* RuntimeArtifactStatePort;
          const createdResult = yield* port.recordArtifactMetadata({
            workspaceSessionId: sessionId,
            sourceCommandId: command.id as CommandId,
            kind: "text",
            name: "layer.md",
            storedPath: join(artifactDir, sessionId, "layer.md") as never,
            mimeType: "text/markdown",
            byteSize: 5,
            sha256: testDigest.sha256Hex("layer"),
            immutable: false,
            materializationStatus: "ready",
          });
          const created = createdResult.value;
          const listed = yield* port.listArtifacts({ workspaceSessionId: sessionId });

          expect(created.name).toBe("layer.md");
          expect(listed.map((artifact) => artifact.artifactId)).toEqual([created.artifactId]);
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
                  digest: testDigest,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("records, reads, lists, and marks artifact metadata deleted through an Effect service", async () => {
    const { artifactDir, commandId, port, sessionId, workspaceCwd } = createFixture();
    const workspaceId = workspaceCwd as WorkspaceId;
    const storedPath = join(artifactDir, sessionId, "immutable", "handoff.md");

    const createdResult = await runTestEffect(
      port.recordArtifactMetadata({
        workspaceSessionId: sessionId,
        sourceCommandId: commandId,
        kind: "text",
        name: "handoff.md",
        storedPath: storedPath as never,
        mimeType: "text/markdown",
        byteSize: "handoff body".length,
        sha256: "4f7af4d83d10ee9be864a76e2fe30c8c5197350d38805efddba3d8a12e2b8d8c",
        immutable: true,
        materializationStatus: "ready",
      }),
    );
    const created = createdResult.value;

    const createdArtifactId = created.artifactId;
    expect(createdArtifactId).toMatch(/^artifact-/);
    expect(created).toMatchObject({
      artifactId: createdArtifactId,
      workspaceSessionId: sessionId,
      sourceCommandId: commandId,
      name: "handoff.md",
      storedPath,
      mimeType: "text/markdown",
      byteSize: "handoff body".length,
      sha256: "4f7af4d83d10ee9be864a76e2fe30c8c5197350d38805efddba3d8a12e2b8d8c",
      immutable: true,
      materializationStatus: "ready",
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

    const inspected = await runTestEffect(
      port.inspectArtifact({
        workspaceSessionId: sessionId,
        artifactId: createdArtifactId,
      }),
    );
    const listed = await runTestEffect(
      port.listArtifacts({
        workspaceSessionId: sessionId,
      }),
    );
    const deletedResult = await runTestEffect(
      port.markArtifactMetadataDeleted({
        workspaceSessionId: sessionId,
        artifactId: createdArtifactId,
      }),
    );
    const deleted = deletedResult.value;
    const deletedAgain = await runTestEffect(
      port.markArtifactMetadataDeleted({
        workspaceSessionId: sessionId,
        artifactId: createdArtifactId,
      }),
    );
    const afterDelete = await runTestEffect(
      port.listArtifacts({
        workspaceSessionId: sessionId,
      }),
    );

    expect(inspected).toEqual(created);
    expect(listed.map((artifact) => artifact.artifactId)).toEqual([created.artifactId]);
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect(deleted.materializationStatus).toBe("deleted");
    expect(deletedAgain.value.deletedAt).toBe(deleted.deletedAt);
    expect(deletedResult.afterCommit).toEqual(createdResult.afterCommit);
    expect(afterDelete).toEqual([]);
  });

  it("maps artifact store errors to typed state contract reasons without hiding command prefixes", async () => {
    const { artifactDir, commandId, port, sessionId } = createFixture();
    await runTestEffect(
      port.recordArtifactMetadata({
        workspaceSessionId: sessionId,
        sourceCommandId: commandId,
        kind: "text",
        name: "duplicate.md",
        storedPath: join(artifactDir, sessionId, "duplicate.md") as never,
        mimeType: "text/markdown",
        byteSize: 0,
        sha256: testDigest.sha256Hex(""),
        immutable: false,
        materializationStatus: "ready",
      }),
    );

    await expect(
      runTestEffect(
        port.recordArtifactMetadata({
          workspaceSessionId: sessionId,
          sourceCommandId: commandId,
          kind: "text",
          name: "duplicate.md",
          storedPath: join(artifactDir, sessionId, "duplicate-again.md") as never,
          mimeType: "text/markdown",
          byteSize: 0,
          sha256: testDigest.sha256Hex(""),
          immutable: false,
          materializationStatus: "ready",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.record-metadata",
      reason: "conflict",
      message: expect.stringContaining("ARTIFACT_EXISTS:"),
    });

    await expect(
      runTestEffect(
        port.inspectArtifact({
          workspaceSessionId: sessionId,
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
        port.recordArtifactMetadata({
          workspaceSessionId: sessionId,
          sourceCommandId: commandId,
          kind: "file",
          name: "missing.txt",
          storedPath: join(artifactDirFor(sessionId), "missing.txt") as never,
          mimeType: "text/plain",
          byteSize: 0,
          sha256: testDigest.sha256Hex(""),
          immutable: false,
          materializationStatus: "ready",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "runtime-artifact.record-metadata",
      reason: "invalid-input",
      message: expect.stringContaining("INVALID_ARGUMENT:"),
    });
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
    digest: testDigest,
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
