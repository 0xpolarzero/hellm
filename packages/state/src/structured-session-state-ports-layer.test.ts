import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionStatePort,
  GeneratedContextPreviewSubjectStatePort,
  RuntimeExternalInstructionStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeTranscriptStatePort,
  RuntimeWorkspaceStatePort,
  type AbsolutePath,
  type RuntimeOwnerId,
  type WorkspaceId,
} from "@svvy/core";
import { runTestEffect } from "./effect.test-support";
import { structuredSessionStatePortsLayer } from "./structured-session-state-ports-layer";
import { layerStructuredSessionState } from "./structured-session-state";

const workspace = {
  id: "workspace_state_ports_layer" as WorkspaceId,
  label: "State ports layer",
  cwd: "/tmp/svvy-state-ports-layer-workspace" as AbsolutePath,
  artifactDir: "/tmp/svvy-state-ports-layer-artifacts" as AbsolutePath,
};

const owner = {
  ownerId: "runtime_owner_state_ports_layer" as RuntimeOwnerId,
  kind: "test",
} as const;

describe("structured session state ports layer", () => {
  it("provides structured-session-backed runtime ports from one acquired state graph", async () => {
    const result = await runTestEffect(
      Effect.gen(function* () {
        const workspaces = yield* RuntimeWorkspaceStatePort;
        const surfaces = yield* RuntimeSurfaceLifecycleStatePort;
        const promptDefaults = yield* RuntimePromptDefaultsStatePort;
        const transcripts = yield* RuntimeTranscriptStatePort;
        const extensions = yield* ExtensionStatePort;
        const previewSubjects = yield* GeneratedContextPreviewSubjectStatePort;
        const externalInstructions = yield* RuntimeExternalInstructionStatePort;

        const acquired = yield* workspaces.acquireWorkspace({
          cwd: workspace.cwd,
          owner,
          openReason: "test",
        });
        const created = yield* surfaces.createOrchestratorSurface({
          workspaceId: acquired.value.workspaceId,
          title: "Runtime state ports layer",
        });
        const opened = yield* surfaces.openSurface({
          workspaceId: acquired.value.workspaceId,
          target: {
            workspaceSessionId: created.value.workspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: created.value.surfacePiSessionId,
          },
        });

        const defaultsExit = yield* Effect.exit(
          promptDefaults.resolvePromptDefaults({
            target: {
              workspaceSessionId: created.value.workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: created.value.surfacePiSessionId,
            },
          }),
        );
        const missingSourceFingerprint = yield* extensions.records.readSourceFingerprint({
          sourceRoot: "/tmp/svvy-state-ports-layer-missing-extension" as AbsolutePath,
        });

        const transcript = yield* transcripts.readSurfaceTranscript({
          surfacePiSessionId: created.value.surfacePiSessionId,
        });
        const externalInstructionProjection = yield* externalInstructions.readExternalInstructions({
          workspaceId: workspace.id,
        });

        return {
          acquired,
          created,
          opened,
          defaultsExit,
          missingSourceFingerprint,
          transcript,
          externalInstructionProjection,
          hasPreviewSubjectReader: typeof previewSubjects.readSubject === "function",
        };
      }).pipe(
        Effect.provide(
          structuredSessionStatePortsLayer.pipe(
            Layer.provide(
              layerStructuredSessionState({
                workspace,
                now: () => "2026-06-28T12:00:00.000Z",
              }),
            ),
          ),
        ),
      ),
    );

    expect(result.acquired.value.workspaceId).toBe(workspace.id);
    expect(result.created.value.target.workspaceSessionId).toBe(
      result.created.value.workspaceSessionId,
    );
    expect(result.opened.value.target.surfacePiSessionId).toBe(
      result.created.value.surfacePiSessionId,
    );
    expect(result.defaultsExit).toMatchObject({
      _tag: "Success",
      value: {
        provider: "zai",
        model: "glm-5-turbo",
        reasoningEffort: "medium",
      },
    });
    expect(result.missingSourceFingerprint).toBe(null);
    expect(result.hasPreviewSubjectReader).toBe(true);
    expect(result.transcript).toEqual({
      surfacePiSessionId: result.created.value.surfacePiSessionId,
      messages: [],
      activeAssistantMessage: null,
      streamCursor: null,
    });
    expect(result.externalInstructionProjection).toMatchObject({
      workspaceId: workspace.id,
      sources: [],
      diagnostics: [],
      observedAt: null,
      revision: 0,
    });
    expect(result.created.afterCommit).toContainEqual({
      scope: "workspace",
      workspaceId: workspace.id,
      invalidation: { model: "surface", ids: [result.created.value.surfacePiSessionId] },
    });
  });

  it("can project ports from an already constructed structured-session layer", async () => {
    const result = await runTestEffect(
      Effect.gen(function* () {
        const workspaces = yield* RuntimeWorkspaceStatePort;
        return yield* workspaces.acquireDefaultWorkspace({
          owner,
          openReason: "test",
        });
      }).pipe(
        Effect.provide(
          structuredSessionStatePortsLayer.pipe(
            Layer.provide(
              layerStructuredSessionState({
                workspace,
                now: () => "2026-06-28T12:00:00.000Z",
              }),
            ),
          ),
        ),
      ),
    );

    expect(result.value.workspaceId).toBe(workspace.id);
  });
});
