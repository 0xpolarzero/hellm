import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ArtifactMetadataRecordSchema } from "./artifact-contracts";
import { AppLogWritePort } from "./app-log-contracts";
import { isPublicSchemaAnnotationKey, strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  BuildExecuteTypescriptFacadeDeclarationsInputSchema,
  BuildGeneratedContextInputSchema,
  ExecuteTypescriptFacadeDeclarationsSchema,
  ExtensionHandlerResultSchema,
  GeneratedContextSchema,
} from "./extension-contracts";
import { ExtensionStatePort } from "./extension-state-ports";
import { ExtensionSnapshotStatePort } from "./extension-snapshot-contracts";
import { RuntimeEffectRequestSchema } from "./runtime-effect-requests";
import { SecretStoreMutationPort, SecretStorePort } from "./secret-store-ports";
import { SourceReconcileRequestSchema } from "./runtime-source-invalidation";
import {
  RunTaskAgentInputSchema,
  RunTaskAgentSourceInputSchema,
} from "./workflow-task-agent-bridge-contracts";

describe("@svvy/core public contract modules", () => {
  it("exposes target module names for split contract groups", () => {
    expect(ArtifactMetadataRecordSchema.ast).toBeDefined();
    expect(ExtensionHandlerResultSchema.ast).toBeDefined();
    expect(BuildGeneratedContextInputSchema.ast).toBeDefined();
    expect(BuildExecuteTypescriptFacadeDeclarationsInputSchema.ast).toBeDefined();
    expect(ExecuteTypescriptFacadeDeclarationsSchema.ast).toBeDefined();
    expect(GeneratedContextSchema.ast).toBeDefined();
    expect(RuntimeEffectRequestSchema.ast).toBeDefined();
    expect(SourceReconcileRequestSchema.ast).toBeDefined();
    expect(RunTaskAgentSourceInputSchema.ast).toBeDefined();
    expect(RunTaskAgentInputSchema.ast).toBeDefined();
  });

  it("keeps app-log, parse-option, and extension-state contracts in their target modules", () => {
    expect(AppLogWritePort.key).toBe("@svvy/core/AppLogWritePort");
    expect(strictBoundaryParseOptions).toEqual({
      errors: "all",
      onExcessProperty: "error",
    });
    expect(isPublicSchemaAnnotationKey("svvy.internal")).toBe(false);
    expect(isPublicSchemaAnnotationKey("description")).toBe(false);
    expect(ExtensionStatePort.key).toBe("@svvy/core/ExtensionStatePort");
    expect(ExtensionSnapshotStatePort.key).toBe("@svvy/core/ExtensionSnapshotStatePort");
    expect(SecretStorePort.key).toBe("@svvy/core/SecretStorePort");
    expect(SecretStoreMutationPort.key).toBe("@svvy/core/SecretStoreMutationPort");
    expect(existsSync(join(import.meta.dir, "app-log-ports.ts"))).toBe(false);
  });

  it("keeps strict schema boundary behavior exact and fail-closed", () => {
    const BoundaryInputSchema = Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
    });
    const decodeBoundaryInput = Schema.decodeUnknownSync(
      BoundaryInputSchema,
      strictBoundaryParseOptions,
    );

    expect(decodeBoundaryInput({ name: "default extension" })).toEqual({
      name: "default extension",
    });
    expect(() =>
      decodeBoundaryInput({ name: "default extension", description: undefined }),
    ).toThrow();
    expect(() =>
      decodeBoundaryInput({ name: "default extension", rendererPanelId: "panel_01" }),
    ).toThrow();

    const SecretSchema = Schema.toCodecJson(
      Schema.Redacted(Schema.String, {
        label: "provider-api-key",
        disallowJsonEncode: true,
      }),
    );
    expect(() =>
      Schema.encodeSync(SecretSchema)(Redacted.make("sk-secret", { label: "provider-api-key" })),
    ).toThrow("Cannot serialize Redacted");
  });

  it("schema-backs generated context contracts without renderer or state duplicates", () => {
    const decodeBuildInput = Schema.decodeUnknownSync(
      BuildGeneratedContextInputSchema,
      strictBoundaryParseOptions,
    );
    const buildInput = decodeBuildInput({
      actorKind: "handler",
      target: {
        kind: "handler",
        workspaceSessionId: "workspace-session-01",
        threadId: "thread-01",
      },
      actorBinding: {
        actorKind: "handler",
        loadedExtensionIds: ["base-handler"],
        availableExtensionIds: ["web"],
        unavailableExtensionIds: [],
        instructionOrder: ["base-handler"],
        source: "surface-binding",
      },
      workflowTaskInlineInstructions: {
        sourceRecordId: "workflow-agent:reviewer",
        sourceVersion: "sha256:workflow-agent-01",
        text: "Use the workflow task instructions.",
      },
      reason: "surface-dispatch",
    });
    expect(buildInput.actorKind).toBe("handler");
    expect(buildInput.target.kind).toBe("handler");
    if (buildInput.target.kind === "handler") {
      expect(String(buildInput.target.workspaceSessionId)).toBe("workspace-session-01");
      expect(String(buildInput.target.threadId)).toBe("thread-01");
    }
    expect(buildInput.actorBinding.loadedExtensionIds.map(String)).toEqual(["base-handler"]);
    expect(buildInput.actorBinding.availableExtensionIds.map(String)).toEqual(["web"]);
    expect(buildInput.actorBinding.instructionOrder.map(String)).toEqual(["base-handler"]);
    expect(buildInput.workflowTaskInlineInstructions).toMatchObject({
      sourceRecordId: "workflow-agent:reviewer",
      sourceVersion: "sha256:workflow-agent-01",
      text: "Use the workflow task instructions.",
    });
    expect(buildInput.reason).toBe("surface-dispatch");
    expect(() =>
      decodeBuildInput({
        actorKind: "workflow-task",
        target: {
          kind: "workflow-task",
          workspaceSessionId: "workspace-session-01",
          workflowTaskAttemptId: "workflow-task-attempt-01",
        },
        actorBinding: {
          actorKind: "workflow-task",
          loadedExtensionIds: ["base-workflow-task"],
          availableExtensionIds: [],
          unavailableExtensionIds: [],
          instructionOrder: ["base-workflow-task"],
          source: "workflow-agent-source",
        },
        workflowTaskInlineInstructions: "plain hidden prompt text",
        reason: "surface-dispatch",
      }),
    ).toThrow();
    expect(() =>
      decodeBuildInput({
        actorKind: "handler",
        target: {
          kind: "handler",
          workspaceSessionId: "workspace-session-01",
          threadId: "thread-01",
          rendererPanelId: "panel-01",
        },
        actorBinding: {
          actorKind: "handler",
          loadedExtensionIds: ["base-handler"],
          availableExtensionIds: [],
          unavailableExtensionIds: [],
          instructionOrder: ["base-handler"],
          source: "surface-binding",
        },
        reason: "surface-dispatch",
      }),
    ).toThrow();

    const decodeGeneratedContext = Schema.decodeUnknownSync(
      GeneratedContextSchema,
      strictBoundaryParseOptions,
    );
    expect(
      decodeGeneratedContext({
        fingerprint: "generated-context-fingerprint-01",
        promptBlocks: [
          {
            extensionId: "base-handler",
            contributorId: "instructions",
            sourceRecordId: "builtin:base-handler:instructions",
            sourceVersion: "sha256:base-handler-01",
            sourcePath:
              "/Users/example/.config/svvy/extensions/sources/builtin/base-handler/instructions.mdx",
            sourceFingerprint: "sha256:base-handler-01",
            text: "You are a handler.",
            tokenEstimate: 5,
          },
        ],
        externalInstructionBlocks: [],
        nativeToolDeclarations: [
          {
            name: "thread_report",
            label: "Thread Report",
            description: "Report handler progress.",
            parameters: { type: "object", additionalProperties: false },
          },
        ],
        svvyxGuidanceBlocks: [],
        executeTypescriptFacadeDeclarations: {
          text: "",
          emittedExtensionIds: [],
        },
        tokenEstimate: 5,
        sourceFingerprints: {
          "builtin:base-handler:instructions": "sha256:base-handler-01",
        },
        diagnostics: [
          {
            severity: "info",
            message: "Generated context built.",
          },
        ],
      }),
    ).toMatchObject({
      fingerprint: "generated-context-fingerprint-01",
      tokenEstimate: 5,
    });
    expect(() =>
      decodeGeneratedContext({
        fingerprint: "generated-context-fingerprint-01",
        promptBlocks: [],
        externalInstructionBlocks: [],
        nativeToolDeclarations: [],
        svvyxGuidanceBlocks: [],
        executeTypescriptFacadeDeclarations: {
          text: "",
          emittedExtensionIds: [],
        },
        tokenEstimate: 0,
        sourceFingerprints: {
          "": "sha256:empty-key",
        },
        diagnostics: [],
      }),
    ).toThrow();
    expect(() =>
      decodeGeneratedContext({
        fingerprint: "generated-context-fingerprint-01",
        promptBlocks: [],
        externalInstructionBlocks: [],
        nativeToolDeclarations: [],
        svvyxGuidanceBlocks: [],
        executeTypescriptFacadeDeclarations: {
          text: "",
          emittedExtensionIds: [],
        },
        tokenEstimate: 0,
        sourceFingerprints: {},
        diagnostics: [],
        rendererPreview: "must not cross core boundary",
      }),
    ).toThrow();
    expect(() =>
      decodeGeneratedContext({
        fingerprint: "generated-context-fingerprint-01",
        promptBlocks: [],
        externalInstructionBlocks: [],
        nativeToolDeclarations: [],
        svvyxGuidanceBlocks: [],
        executeTypescriptFacadeDeclarations: {
          text: "",
          emittedExtensionIds: [],
        },
        tokenEstimate: 0,
        sourceFingerprints: {},
        diagnostics: [],
        secretValues: { OPENAI_API_KEY: "sk-secret" },
      }),
    ).toThrow();

    const decodeFacadeDeclarationsInput = Schema.decodeUnknownSync(
      BuildExecuteTypescriptFacadeDeclarationsInputSchema,
      strictBoundaryParseOptions,
    );
    const decodeFacadeDeclarations = Schema.decodeUnknownSync(
      ExecuteTypescriptFacadeDeclarationsSchema,
      strictBoundaryParseOptions,
    );
    expect(
      decodeFacadeDeclarationsInput({
        actorKind: "orchestrator",
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: ["artifacts"],
          availableExtensionIds: ["workflows"],
          unavailableExtensionIds: [],
          instructionOrder: ["artifacts"],
          source: "surface-binding",
        },
      }).actorBinding.loadedExtensionIds.map(String),
    ).toEqual(["artifacts"]);
    expect(
      decodeFacadeDeclarations({
        text: "interface LoadedExtensionsFacade {}",
        emittedExtensionIds: ["artifacts"],
      }).emittedExtensionIds.map(String),
    ).toEqual(["artifacts"]);
  });
});
