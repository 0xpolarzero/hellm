import { describe, expect, it } from "bun:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  PiSessionReferencePort,
  type CreateRuntimeOrchestratorSurfaceStateInput,
  type PiSessionReference,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import { runTestEffect } from "./effect.test-support";
import {
  layerPiSessionReferencePort,
  piSessionReferencePortFromStore,
} from "./pi-session-reference-port";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";

const workspace = {
  id: "workspace_pi_session_reference_port",
  cwd: "/tmp/svvy-pi-session-reference-port",
  label: "Pi session reference port",
};

const surfacePiSessionId = "session-pi-reference" as SurfacePiSessionId;

function orchestratorStateInput(title: string): CreateRuntimeOrchestratorSurfaceStateInput {
  return {
    workspaceId: workspace.id as WorkspaceId,
    title,
    profileId: "default-orchestrator" as never,
    provider: "zai" as never,
    model: "glm-5-turbo" as never,
    reasoningEffort: "medium",
    loadedExtensionIds: ["extension-loading" as never],
    availableExtensionIds: [],
  };
}

const reference: PiSessionReference = {
  surfacePiSessionId,
  referenceFingerprint: "ref-fingerprint-1",
  adapterKind: "pi",
  adapterVersion: "4.2.0",
  storageLocator: "pi://sessions/session-pi-reference",
  piSessionId: "pi-native-session-1",
  metadata: {
    storage: "opaque",
  },
};

describe("PiSessionReferencePort", () => {
  it("saves, reads, validates, and deletes opaque pi session references", async () => {
    const store = createStore();
    try {
      seedOrchestratorSurface(store);
      const port = piSessionReferencePortFromStore(store);

      const saved = await runTestEffect(
        port.savePiSessionReference({
          surfacePiSessionId,
          reference,
        }),
      );
      const read = await runTestEffect(port.getPiSessionReference({ surfacePiSessionId }));
      const valid = await runTestEffect(
        port.validatePiSessionReference({
          workspaceId: workspace.id as WorkspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          reference,
        }),
      );
      const deleted = await runTestEffect(port.deletePiSessionReference({ surfacePiSessionId }));
      const afterDelete = await runTestEffect(port.getPiSessionReference({ surfacePiSessionId }));
      const validationAfterDelete = await runTestEffect(
        port.validatePiSessionReference({
          workspaceId: workspace.id as WorkspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          reference,
        }),
      );

      expect(saved.value).toEqual(reference);
      expect(saved.afterCommit).toEqual([
        {
          scope: "workspace",
          workspaceId: workspace.id as WorkspaceId,
          invalidation: { model: "surface", ids: [surfacePiSessionId] },
        },
        {
          scope: "workspace",
          workspaceId: workspace.id as WorkspaceId,
          invalidation: { model: "sessionNavigation" },
        },
      ]);
      expect(read).toEqual(reference);
      expect(valid).toEqual({
        valid: true,
        reference,
        referenceFingerprint: reference.referenceFingerprint,
      });
      expect(deleted.value).toEqual({ surfacePiSessionId });
      expect(afterDelete).toBeUndefined();
      expect(validationAfterDelete).toEqual({ valid: false, reason: "not-found" });
    } finally {
      store.close();
    }
  });

  it("returns validation mismatches without rewriting the saved reference", async () => {
    const store = createStore();
    try {
      seedOrchestratorSurface(store);
      const port = piSessionReferencePortFromStore(store);
      await runTestEffect(port.savePiSessionReference({ surfacePiSessionId, reference }));

      const workspaceMismatch = await runTestEffect(
        port.validatePiSessionReference({
          workspaceId: "other-workspace" as WorkspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          reference,
        }),
      );
      const actorMismatch = await runTestEffect(
        port.validatePiSessionReference({
          workspaceId: workspace.id as WorkspaceId,
          surfacePiSessionId,
          actorKind: "handler",
          reference,
        }),
      );
      const adapterMismatch = await runTestEffect(
        port.validatePiSessionReference({
          workspaceId: workspace.id as WorkspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          reference: { ...reference, adapterVersion: "4.3.0" },
        }),
      );

      expect(workspaceMismatch).toEqual({
        valid: false,
        reason: "workspace-mismatch",
        referenceFingerprint: reference.referenceFingerprint,
      });
      expect(actorMismatch).toEqual({
        valid: false,
        reason: "actor-mismatch",
        referenceFingerprint: reference.referenceFingerprint,
      });
      expect(adapterMismatch).toEqual({
        valid: false,
        reason: "adapter-version-mismatch",
        referenceFingerprint: reference.referenceFingerprint,
      });
      expect(await runTestEffect(port.getPiSessionReference({ surfacePiSessionId }))).toEqual(
        reference,
      );
    } finally {
      store.close();
    }
  });

  it("maps missing delete references to PiSessionReferencePortError", async () => {
    const store = createStore();
    try {
      const port = piSessionReferencePortFromStore(store);
      const exit = await runTestEffect(
        Effect.exit(port.deletePiSessionReference({ surfacePiSessionId })),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(failure?._tag).toBe("PiSessionReferencePortError");
        expect(failure?.operation).toBe("pi-session-reference.delete");
        expect(failure?.reason).toBe("reference-not-found");
      }
    } finally {
      store.close();
    }
  });

  it("provides the Effect service through the package layer", async () => {
    const result = await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.createOrchestratorSurface(orchestratorStateInput("Layer pi reference"));
          const port = yield* PiSessionReferencePort;
          return yield* port.savePiSessionReference({
            surfacePiSessionId: "session_000001" as SurfacePiSessionId,
            reference: {
              ...reference,
              surfacePiSessionId: "session_000001" as SurfacePiSessionId,
              storageLocator: "pi://sessions/session_000001",
            },
          });
        }).pipe(
          Effect.provide(layerPiSessionReferencePort),
          Effect.provide(
            layerStructuredSessionState({
              workspace,
              idFactory: (prefix) => `${prefix}_000001`,
              now: () => "2026-06-29T10:00:00.000Z",
            }),
          ),
        ),
      ),
    );

    expect(result.value).toMatchObject({
      surfacePiSessionId: "session_000001",
      referenceFingerprint: reference.referenceFingerprint,
      storageLocator: "pi://sessions/session_000001",
    });
  });
});

function seedOrchestratorSurface(store: StructuredSessionStateStore): void {
  store.createOrchestratorSurface(orchestratorStateInput("Pi reference"));
}

function createStore(): StructuredSessionStateStore {
  return createStructuredSessionStateStore({
    workspace,
    idFactory: (prefix) =>
      prefix === "session" ? surfacePiSessionId : `${prefix}-pi-reference-test`,
  });
}
