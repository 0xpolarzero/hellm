import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeTranscriptStatePort,
  StateContractError,
  type CommandId,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeTranscriptStatePort } from "./index";
import { layerStructuredSessionState, StructuredSessionState } from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_transcript_state_port",
  cwd: "/tmp/svvy-runtime-transcript-state-port",
  label: "Runtime transcript state port",
};
const workspaceSessionId = "session-runtime-transcript-state-port" as WorkspaceSessionId;
const surfacePiSessionId = "surface-runtime-transcript-state-port" as SurfacePiSessionId;
const firstTimestamp = "2026-07-11T10:00:00.000Z";

describe("RuntimeTranscriptStatePort", () => {
  it("persists exact ordered transcript state and uses only boundary invalidations", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Transcript state",
            provider: "openai",
            model: "gpt-5",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: firstTimestamp,
            updatedAt: firstTimestamp,
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            requestSummary: "Inspect the workspace.",
          });
          const port = yield* RuntimeTranscriptStatePort;
          const boundaryInvalidation: readonly StateInvalidationDescriptor[] = [
            {
              scope: "workspace",
              workspaceId: workspace.id as WorkspaceId,
              invalidation: {
                model: "surface",
                ids: [surfacePiSessionId as SurfacePiSessionId],
              },
            },
          ];

          const user = yield* port.commitUserMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            queueItemId: "queue-transcript-01" as never,
            message: {
              text: "Inspect @src/main.ts",
              attachments: [
                {
                  kind: "file",
                  path: "/tmp/svvy-runtime-transcript-state-port/src/main.ts" as never,
                  workspaceRelativePath: "src/main.ts" as never,
                },
              ],
              snippetProvenance: [
                {
                  mentionId: "mention-01",
                  snippetId: "snippet-01",
                  source: "svvy",
                  title: "Inspect",
                  contentHash: "sha256:01",
                  arguments: ["src/main.ts"],
                  resolvedText: "Inspect src/main.ts",
                },
              ],
            },
            submittedAt: firstTimestamp as never,
            committedAt: firstTimestamp as never,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: null,
          });
          expect(user.afterCommit).toEqual(boundaryInvalidation);
          expect(Number(user.value.cursor.streamSequence)).toBe(1);

          const duplicateUser = yield* port.commitUserMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            queueItemId: "queue-transcript-01" as never,
            message: user.value.message.message,
            submittedAt: firstTimestamp as never,
            committedAt: firstTimestamp as never,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: null,
          });
          expect(duplicateUser.value.message.messageId).toBe(user.value.message.messageId);
          expect(duplicateUser.value.message.ordinal).toBe(0);

          const boundUser = yield* port.bindPiHistoryEntry({
            messageId: user.value.message.messageId,
            piHistoryEntry: {
              session: { surfacePiSessionId: surfacePiSessionId as never },
              entryId: "pi-user-entry-01",
              messageId: user.value.message.messageId,
            },
          });
          expect(boundUser.afterCommit).toEqual([]);
          expect(boundUser.value.piHistoryEntry?.entryId).toBe("pi-user-entry-01");

          const assistant = yield* port.beginAssistantMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            api: null,
            providerId: "openai" as never,
            modelId: "gpt-5" as never,
            startedAt: "2026-07-11T10:00:01.000Z" as never,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: user.value.cursor,
          });
          expect(assistant.afterCommit).toEqual(boundaryInvalidation);
          expect(Number(assistant.value.cursor.streamSequence)).toBe(2);

          const thinking = yield* port.appendAssistantContentDelta({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: assistant.value.cursor,
            contentIndex: 0,
            kind: "thinking",
            delta: "Check the file.",
            redacted: false,
            thinkingSignature: "thinking-signature-01",
          });
          expect(thinking.afterCommit).toEqual([]);
          expect(thinking.value.message.content[0]).toEqual({
            kind: "thinking",
            contentIndex: 0,
            thinking: "Check the file.",
            redacted: false,
            thinkingSignature: "thinking-signature-01",
          });

          const tool = yield* port.upsertAssistantToolCall({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: thinking.value.cursor,
            contentIndex: 1,
            toolCallId: "tool-call-01" as never,
            toolName: "read_file",
            argumentsJson: '{"path":"src/main.ts"}',
            argumentsStatus: "accepted",
            thoughtSignature: "tool-thought-signature-01",
          });
          expect(tool.afterCommit).toEqual([]);

          const command = yield* state.createCommand({
            turnId: turn.id,
            surfacePiSessionId,
            toolName: "read_file",
            executor: "orchestrator",
            visibility: "surface",
            title: "Read file",
            summary: "Read src/main.ts",
          });
          const linked = yield* port.linkAssistantToolCallCommand({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: tool.value.cursor,
            contentIndex: 1,
            toolCallId: "tool-call-01" as never,
            commandId: command.id as CommandId,
          });
          expect(linked.afterCommit).toEqual([]);
          expect(linked.value.message.content[1]).toMatchObject({ commandId: command.id });

          const sameLink = yield* port.linkAssistantToolCallCommand({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: linked.value.cursor,
            contentIndex: 1,
            toolCallId: "tool-call-01" as never,
            commandId: command.id as CommandId,
          });
          expect(sameLink.value.cursor).toEqual(linked.value.cursor);

          const text = yield* port.appendAssistantContentDelta({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: linked.value.cursor,
            contentIndex: 2,
            kind: "text",
            delta: "The file is valid.",
          });
          expect(text.afterCommit).toEqual([]);

          const committed = yield* port.commitAssistantMessage({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: text.value.cursor,
            content: [
              {
                kind: "thinking",
                contentIndex: 0,
                thinking: "Check the file.",
                redacted: false,
                thinkingSignature: "thinking-signature-01",
              },
              {
                kind: "tool-call",
                contentIndex: 1,
                toolCallId: "tool-call-01" as never,
                toolName: "read_file",
                argumentsJson: '{"path":"src/main.ts"}',
                argumentsStatus: "accepted",
                commandId: null,
                thoughtSignature: "tool-thought-signature-01",
              },
              { kind: "text", contentIndex: 2, text: "The file is valid." },
            ],
            api: "openai-responses",
            providerId: "openai" as never,
            modelId: "gpt-5" as never,
            responseId: "response-01",
            usage: {
              input: 100,
              output: 20,
              cacheRead: 50,
              cacheWrite: 0,
              totalTokens: 120,
              cost: {
                input: 0.1,
                output: 0.2,
                cacheRead: 0.01,
                cacheWrite: 0,
                total: 0.31,
              },
            },
            stopReason: "stop",
            errorMessage: null,
            piHistoryEntry: {
              session: { surfacePiSessionId: surfacePiSessionId as never },
              entryId: "pi-assistant-entry-01",
              messageId: assistant.value.message.messageId,
            },
            messageTimestamp: "2026-07-11T10:00:02.000Z" as never,
            finishedAt: "2026-07-11T10:00:03.000Z" as never,
          });
          expect(committed.afterCommit).toEqual(boundaryInvalidation);
          expect(committed.value.message).toMatchObject({
            status: "completed",
            api: "openai-responses",
            responseId: "response-01",
            stopReason: "stop",
          });
          expect(committed.value.message.content[1]).toMatchObject({
            commandId: command.id,
            thoughtSignature: "tool-thought-signature-01",
          });

          const secondAssistant = yield* port.beginAssistantMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            api: "openai-responses",
            providerId: "openai" as never,
            modelId: "gpt-5" as never,
            startedAt: "2026-07-11T10:00:04.000Z" as never,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: committed.value.cursor,
          });
          const failed = yield* port.failAssistantMessage({
            messageId: secondAssistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-turn-01" as never,
            expectedCursor: secondAssistant.value.cursor,
            status: "failed",
            api: "openai-responses",
            providerId: "openai" as never,
            modelId: "gpt-5" as never,
            responseId: "response-02",
            usage: null,
            stopReason: "error",
            errorMessage: "Provider failed.",
            piHistoryEntry: null,
            messageTimestamp: "2026-07-11T10:00:05.000Z" as never,
            finishedAt: "2026-07-11T10:00:05.000Z" as never,
          });
          expect(failed.afterCommit).toEqual(boundaryInvalidation);

          const transcript = yield* port.readSurfaceTranscript({ surfacePiSessionId });
          expect(transcript.messages.map((message) => message.role)).toEqual([
            "user",
            "assistant",
            "assistant",
          ]);
          expect(transcript.messages.map((message) => message.ordinal)).toEqual([0, 1, 2]);
          expect(transcript.activeAssistantMessage).toBeNull();
          expect(transcript.streamCursor).toEqual(failed.value.cursor);
          expect(transcript.messages.filter((message) => message.role === "user")).toHaveLength(1);

          const stale = yield* port
            .advanceStreamCursor({
              surfacePiSessionId,
              streamGenerationId: "stream-turn-01" as never,
              expectedCursor: committed.value.cursor,
            })
            .pipe(Effect.flip);
          expect(stale).toBeInstanceOf(StateContractError);
          expect(stale.reason).toBe("stale-state");

          const divergentTerminal = yield* port
            .failAssistantMessage({
              messageId: committed.value.message.messageId,
              surfacePiSessionId,
              streamGenerationId: "stream-turn-01" as never,
              expectedCursor: committed.value.cursor,
              status: "failed",
              api: "openai-responses",
              providerId: "openai" as never,
              modelId: "gpt-5" as never,
              responseId: "different",
              usage: null,
              stopReason: "error",
              errorMessage: "Different terminal state.",
              piHistoryEntry: null,
              messageTimestamp: "2026-07-11T10:00:06.000Z" as never,
              finishedAt: "2026-07-11T10:00:06.000Z" as never,
            })
            .pipe(Effect.flip);
          expect(divergentTerminal.reason).toBe("conflict");
        }).pipe(
          Effect.provide(
            layerRuntimeTranscriptStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });

  it("rejects command retargeting and cross-surface Pi history refs", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Transcript conflicts",
            provider: "openai",
            model: "gpt-5",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: firstTimestamp,
            updatedAt: firstTimestamp,
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            requestSummary: "Conflict checks.",
          });
          const port = yield* RuntimeTranscriptStatePort;
          const user = yield* port.commitUserMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            queueItemId: "queue-conflict" as never,
            message: { text: "conflict" },
            submittedAt: firstTimestamp as never,
            committedAt: firstTimestamp as never,
            streamGenerationId: "stream-conflict" as never,
            expectedCursor: null,
          });
          const historyError = yield* port
            .bindPiHistoryEntry({
              messageId: user.value.message.messageId,
              piHistoryEntry: {
                session: { surfacePiSessionId: "another-surface" as never },
                entryId: "pi-wrong-surface",
                messageId: user.value.message.messageId,
              },
            })
            .pipe(Effect.flip);
          expect(historyError.reason).toBe("conflict");

          const assistant = yield* port.beginAssistantMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            api: null,
            providerId: "openai" as never,
            modelId: "gpt-5" as never,
            startedAt: firstTimestamp as never,
            streamGenerationId: "stream-conflict" as never,
            expectedCursor: user.value.cursor,
          });
          const tool = yield* port.upsertAssistantToolCall({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-conflict" as never,
            expectedCursor: assistant.value.cursor,
            contentIndex: 0,
            toolCallId: "tool-conflict" as never,
            toolName: "exec_command",
            argumentsJson: "{}",
            argumentsStatus: "accepted",
          });
          const linked = yield* port.linkAssistantToolCallCommand({
            messageId: assistant.value.message.messageId,
            surfacePiSessionId,
            streamGenerationId: "stream-conflict" as never,
            expectedCursor: tool.value.cursor,
            contentIndex: 0,
            toolCallId: "tool-conflict" as never,
            commandId: "command-first" as CommandId,
          });
          const retargetError = yield* port
            .linkAssistantToolCallCommand({
              messageId: assistant.value.message.messageId,
              surfacePiSessionId,
              streamGenerationId: "stream-conflict" as never,
              expectedCursor: linked.value.cursor,
              contentIndex: 0,
              toolCallId: "tool-conflict" as never,
              commandId: "command-second" as CommandId,
            })
            .pipe(Effect.flip);
          expect(retargetError.reason).toBe("conflict");
        }).pipe(
          Effect.provide(
            layerRuntimeTranscriptStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
