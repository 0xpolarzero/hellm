import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeEpisodeStatePort,
  RuntimeArtifactStatePort,
  StateContractError,
  type ArtifactId,
  type CommandId,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeArtifactStatePort, layerRuntimeEpisodeStatePort } from "./index";
import { layerStructuredSessionState, StructuredSessionState } from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_episode_state_port",
  cwd: "/tmp/svvy-runtime-episode-state-port",
  label: "Runtime episode state port",
  artifactDir: join(tmpdir(), `svvy-runtime-episode-state-port-artifacts-${process.pid}`),
};

const workspaceSessionId = "session-runtime-episode-state-port" as WorkspaceSessionId;
const workspaceId = workspace.id as WorkspaceId;
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

describe("RuntimeEpisodeStatePort", () => {
  it("records handler-thread episodes and concludes the thread when an outcome is present", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime episode state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId: "surface-orchestrator-runtime-episode",
            requestSummary: "Delegate episode recording.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-runtime-episode",
            title: "Record episode",
            objective: "Persist the handler report through a runtime state port.",
          });
          const command = yield* state.createCommand({
            turnId: turn.id,
            surfacePiSessionId: thread.surfacePiSessionId,
            threadId: thread.id,
            toolName: "thread_report",
            executor: "handler",
            visibility: "surface",
            title: "Thread report",
            summary: "Record a thread report.",
          });
          const artifactState = yield* RuntimeArtifactStatePort;
          const artifact = (
            yield* artifactState.recordArtifactMetadata({
              workspaceSessionId,
              threadId: thread.id as ThreadId,
              sourceCommandId: command.id as CommandId,
              kind: "text",
              name: `${command.id}.md`,
              storedPath: join(
                workspace.artifactDir,
                workspaceSessionId,
                `${command.id}.md`,
              ) as never,
              mimeType: "text/markdown",
              byteSize: Buffer.byteLength("# Runtime episode report\n"),
              sha256: testDigest.sha256Hex("# Runtime episode report\n"),
              immutable: false,
              materializationStatus: "ready",
            })
          ).value;
          const artifactId = artifact.artifactId as ArtifactId;
          void artifactId;

          const port = yield* RuntimeEpisodeStatePort;
          const episodeResult = yield* port.recordHandlerThreadEpisode({
            scope: "handler-thread",
            workspaceSessionId,
            threadId: thread.id as ThreadId,
            threadGroupId: thread.threadGroupId as ThreadGroupId,
            sourceCommandId: command.id as CommandId,
            kind: "conclusion",
            summary: "The handler completed the delegated work.",
            body: "Detailed completion report.",
            outcome: "completed",
            notifyOrchestrator: true,
            relatedCommandIds: [command.id as CommandId],
            relatedArtifactIds: [artifact.artifactId as ArtifactId],
          });
          const episode = episodeResult.value;
          const snapshot = yield* state.getSessionState(workspaceSessionId);

          expect(episodeResult.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "surface",
                ids: ["surface-handler-runtime-episode" as SurfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "handlerThreadInspector",
                ids: [thread.id as ThreadId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ]);
          expect(episode).toMatchObject({
            sessionId: workspaceSessionId,
            threadId: thread.id,
            threadGroupId: thread.threadGroupId,
            sourceCommandId: command.id,
            kind: "conclusion",
            title: "The handler completed the delegated work.",
            summary: "The handler completed the delegated work.",
            body: "Detailed completion report.",
          });
          expect(snapshot.episodes).toEqual([
            expect.objectContaining({
              id: episode.id,
              threadId: thread.id,
              sourceCommandId: command.id,
              kind: "conclusion",
            }),
          ]);
          expect(snapshot.threads).toEqual([
            expect.objectContaining({
              id: thread.id,
              objectiveState: "concluded",
              status: "completed",
              wait: null,
            }),
          ]);
        }).pipe(
          Effect.provide(
              layerRuntimeEpisodeStatePort.pipe(
                Layer.provideMerge(
                  layerRuntimeArtifactStatePort.pipe(
                    Layer.provideMerge(
                      layerStructuredSessionState({
                  workspace,
                  digest: testDigest,
                      }),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ),
    );
  });

  it("rejects handler episode requests for the wrong thread group", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime episode state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId: "surface-orchestrator-runtime-episode",
            requestSummary: "Delegate episode recording.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-runtime-episode",
            title: "Record episode",
            objective: "Persist the handler report through a runtime state port.",
          });

          const port = yield* RuntimeEpisodeStatePort;
          const error = yield* port
            .recordHandlerThreadEpisode({
              scope: "handler-thread",
              workspaceSessionId,
              threadId: thread.id as ThreadId,
              threadGroupId: "thread_group_runtime_episode_wrong" as ThreadGroupId,
              kind: "report",
              summary: "This should fail before creating an episode.",
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(StateContractError);
          expect(error).toMatchObject({
            reason: "invalid-input",
            message: `Thread ${thread.id} does not belong to thread group thread_group_runtime_episode_wrong.`,
          });
          const snapshot = yield* state.getSessionState(workspaceSessionId);
          expect(snapshot.episodes).toEqual([]);
        }).pipe(
          Effect.provide(
            layerRuntimeEpisodeStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("rejects handler episode requests with non-durable related command ids", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime episode state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId: "surface-orchestrator-runtime-episode",
            requestSummary: "Delegate episode recording.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-runtime-episode",
            title: "Record episode",
            objective: "Persist the handler report through a runtime state port.",
          });

          const port = yield* RuntimeEpisodeStatePort;
          const error = yield* port
            .recordHandlerThreadEpisode({
              scope: "handler-thread",
              workspaceSessionId,
              threadId: thread.id as ThreadId,
              threadGroupId: thread.threadGroupId as ThreadGroupId,
              kind: "report",
              summary: "This should fail before creating an episode.",
              relatedCommandIds: ["cmd_runtime_episode_missing" as CommandId],
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(StateContractError);
          expect(error).toMatchObject({
            reason: "invalid-input",
            message:
              "thread_report related command is not durable or inspectable: cmd_runtime_episode_missing",
          });
          const snapshot = yield* state.getSessionState(workspaceSessionId);
          expect(snapshot.episodes).toEqual([]);
        }).pipe(
          Effect.provide(
            layerRuntimeEpisodeStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("rejects handler episode requests with non-durable related artifact ids", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime episode state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId: "surface-orchestrator-runtime-episode",
            requestSummary: "Delegate episode recording.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-runtime-episode",
            title: "Record episode",
            objective: "Persist the handler report through a runtime state port.",
          });

          const port = yield* RuntimeEpisodeStatePort;
          const error = yield* port
            .recordHandlerThreadEpisode({
              scope: "handler-thread",
              workspaceSessionId,
              threadId: thread.id as ThreadId,
              threadGroupId: thread.threadGroupId as ThreadGroupId,
              kind: "report",
              summary: "This should fail before creating an episode.",
              relatedArtifactIds: ["artifact_runtime_episode_missing" as ArtifactId],
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(StateContractError);
          expect(error).toMatchObject({
            reason: "invalid-input",
            message:
              "thread_report related artifact is not durable or inspectable: artifact_runtime_episode_missing",
          });
          const snapshot = yield* state.getSessionState(workspaceSessionId);
          expect(snapshot.episodes).toEqual([]);
        }).pipe(
          Effect.provide(
            layerRuntimeEpisodeStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });
});
