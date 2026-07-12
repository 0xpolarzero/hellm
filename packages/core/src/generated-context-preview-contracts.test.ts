import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import {
  GeneratedContextPreviewResultSchema,
  GeneratedContextPreviewSubjectStatePort,
  decodeUnknownPreviewGeneratedContextInputExit,
} from "./generated-context-preview-contracts";

describe("generated-context preview contracts", () => {
  it("accepts exact configured-profile and workflow-agent subjects", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownPreviewGeneratedContextInputExit({
          workspaceId: "workspace_01",
          subject: {
            kind: "configured-profile",
            actorKind: "orchestrator",
            profileId: "profile_01",
          },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownPreviewGeneratedContextInputExit({
          workspaceId: "workspace_01",
          subject: {
            kind: "workflow-agent",
            actorKind: "workflow-task",
            sourceId: "reviewerAgent",
          },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownPreviewGeneratedContextInputExit({
          workspaceId: "workspace_01",
          subject: {
            kind: "configured-profile",
            actorKind: "workflow-task",
            profileId: "profile_01",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects renderer-owned fields and exposes one narrow state read port", () => {
    expect(
      Exit.isFailure(
        decodeUnknownPreviewGeneratedContextInputExit({
          workspaceId: "workspace_01",
          subject: {
            kind: "workflow-agent",
            actorKind: "workflow-task",
            sourceId: "reviewerAgent",
          },
          expanded: true,
        }),
      ),
    ).toBe(true);
    expect(GeneratedContextPreviewSubjectStatePort.key).toBe(
      "@svvy/core/GeneratedContextPreviewSubjectStatePort",
    );
    expect(GeneratedContextPreviewResultSchema.ast).toBeDefined();
  });
});
