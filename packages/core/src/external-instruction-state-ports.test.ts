import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import {
  ExternalInstructionsProjectionSchema,
  ReconcileExternalInstructionsInputSchema,
} from "./external-instruction-state-ports";
import { StateInvalidationDescriptorSchema } from "./runtime-invalidation-contracts";

describe("external instruction state contracts", () => {
  it("keeps discovery defaults separate from state-owned actor usage", () => {
    const projection = Schema.decodeUnknownSync(ExternalInstructionsProjectionSchema)({
      workspaceId: "workspace_external_contract",
      sources: [
        {
          id: "external:agents",
          source: { sourceKind: "external-instruction", sourceId: "external:agents" },
          fileName: "AGENTS.md",
          title: "AGENTS.md",
          canonicalPath: "/workspace/AGENTS.md",
          sourceGroup: "workspace_chain",
          order: 0,
          defaultControl: {
            enabled: true,
            eligibleActors: ["orchestrator", "handler", "workflow-task"],
          },
          readOnly: true,
          contentHash: "sha256:content",
          fingerprint: "sha256:fingerprint",
          readStatus: { status: "readable" },
          content: "# Instructions",
        },
      ],
      diagnostics: [],
      actorUsage: [
        {
          actor: "workflow-task",
          profileId: null,
          sourceId: "external:agents",
          usage: "loaded",
        },
      ],
      observedAt: "2026-07-12T10:00:00.000Z",
      revision: 1,
    } as unknown);

    expect(projection.sources[0]?.defaultControl.enabled).toBe(true);
    expect(projection.actorUsage).toHaveLength(1);
    expect(projection.actorUsage[0]?.actor).toBe("workflow-task");
    expect(projection.actorUsage[0]?.profileId).toBe(null);
    expect(projection.actorUsage[0]?.sourceId as string).toBe("external:agents");
    expect(projection.actorUsage[0]?.usage).toBe("loaded");
  });

  it("decodes reconcile snapshots and exact workspace invalidations", () => {
    const reconcile = Schema.decodeUnknownSync(ReconcileExternalInstructionsInputSchema)({
      workspaceId: "workspace_external_contract",
      scan: { sources: [], contents: [], diagnostics: [] },
    } as unknown);
    expect(reconcile.workspaceId as string).toBe("workspace_external_contract");
    expect(reconcile.scan).toEqual({ sources: [], contents: [], diagnostics: [] });
    const invalidation = Schema.decodeUnknownSync(StateInvalidationDescriptorSchema)({
      scope: "workspace",
      workspaceId: "workspace_external_contract",
      invalidation: { model: "externalInstructions" },
    } as unknown);
    expect(invalidation.scope).toBe("workspace");
    expect("workspaceId" in invalidation ? (invalidation.workspaceId as string) : null).toBe(
      "workspace_external_contract",
    );
    expect(invalidation.invalidation.model).toBe("externalInstructions");
  });
});
