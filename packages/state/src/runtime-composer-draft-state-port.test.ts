import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeComposerDraftStatePort,
  type QueueItemId,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeComposerDraftStatePort } from "./index";
import { layerStructuredSessionState, StructuredSessionState } from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_composer_draft_state_port" as WorkspaceId,
  cwd: "/tmp/svvy-runtime-composer-draft-state-port",
  label: "Runtime composer draft state port",
};

const workspaceSessionId = "session-runtime-composer-draft-state-port" as WorkspaceSessionId;
const surfacePiSessionId = "surface-runtime-composer-draft-state-port" as SurfacePiSessionId;

describe("RuntimeComposerDraftStatePort", () => {
  it("clears submitted composer drafts through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime composer draft state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const port = yield* RuntimeComposerDraftStatePort;
          const setResult = yield* port.setDraft({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId,
            },
            text: "queued draft",
            attachments: [],
            snippetMentions: [],
          });
          const persisted = yield* state.getComposerDraft(surfacePiSessionId);
          expect(persisted?.text).toBe("queued draft");
          expect(setResult.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "surface", ids: [surfacePiSessionId] },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "sessionNavigation" },
            },
          ]);

          const result = yield* port.clearSubmittedDraft({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId,
            },
            queuedMessageId: "queue-runtime-composer-draft-state-port" as QueueItemId,
          });
          const draft = yield* state.getComposerDraft(surfacePiSessionId);

          expect(draft).toBeNull();
          expect(result).toEqual({
            value: undefined,
            afterCommit: [
              {
                scope: "workspace",
                workspaceId: workspace.id,
                invalidation: {
                  model: "surface",
                  ids: [surfacePiSessionId],
                },
              },
              {
                scope: "workspace",
                workspaceId: workspace.id,
                invalidation: { model: "sessionNavigation" },
              },
            ],
          });
        }).pipe(
          Effect.provide(
            layerRuntimeComposerDraftStatePort.pipe(
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
