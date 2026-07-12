import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  GeneratedContextPreviewSubjectStatePort,
  RuntimeExternalInstructionStatePort,
  RuntimeRequestStatePort,
  type AbsolutePath,
  type ExtensionId,
  type ExternalInstructionSourceId,
  type GeneratedContextPreviewSubjectRecord,
  type PreviewGeneratedContextInput,
  type SourceFingerprint,
  type StateRevision,
  type WorkspaceId,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";

import {
  RuntimeGeneratedContextPreviewService,
  layerRuntimeGeneratedContextPreviewService,
} from "./runtime-generated-context-preview-service";
import { RuntimeExternalInstructionScanInputPort } from "./runtime-source-invalidation-service";

const workspaceId = "workspace_preview" as WorkspaceId;
const sourceFingerprint = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const contextFingerprint =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const outputFingerprint = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

describe("RuntimeGeneratedContextPreviewService", () => {
  it.effect(
    "previews orchestrator ordering, bypass, selected external instructions, and readiness",
    () => {
      const reads: string[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeGeneratedContextPreviewService;
        const result = yield* service.preview({
          workspaceId,
          subject: {
            kind: "configured-profile",
            actorKind: "orchestrator",
            profileId: "profile_orchestrator" as never,
          },
        });

        assert.deepStrictEqual(
          result.generatedContext.promptBlocks.map((block) => block.contributorId),
          ["shell#instruction/main.mdx"],
        );
        assert.deepStrictEqual(
          result.generatedContext.svvyxGuidanceBlocks.map((block) => block.contributorId),
          ["artifacts#generated-instruction/instructions%2Ffull%2Fgenerated.md"],
        );
        assert.match(result.systemPrompt, /Shell full/);
        assert.notMatch(result.systemPrompt, /Bypassed/);
        assert.match(result.systemPrompt, /Profile external/);
        assert.notMatch(result.systemPrompt, /Actor-default disabled/);
        assert.isAbove(result.tokenEstimate, 0);
        assert.isAbove(
          result.extensions.find((row) => row.extensionId === "shell")?.tokenEstimate ?? 0,
          0,
        );
        const available = result.extensions.find((row) => row.extensionId === "notes");
        assert.isAbove(available?.tokenEstimate ?? 0, 0);
        assert.isAbove(available?.loadedTokenEstimate ?? 0, 0);
        assert.match(result.generatedContext.fingerprint, /^sha256:[0-9a-f]{64}$/);
        assert.deepStrictEqual(
          result.extensions.map((row) => [row.extensionId, row.state]),
          [
            ["shell", "loaded"],
            ["artifacts", "loaded"],
            ["notes", "available"],
          ],
        );
        assert.deepStrictEqual(reads, [
          "shell#minimal",
          "shell#instruction/main.mdx",
          "shell#instruction/bypassed.mdx",
          "artifacts#minimal",
          "artifacts#generated-instruction/instructions%2Ffull%2Fgenerated.md",
          "notes#minimal",
          "notes#instruction/main.mdx",
          "external:profile",
        ]);
      }).pipe(Effect.provide(testLayer({ reads })));
    },
  );

  it.effect("previews handler and workflow subjects, including workflow inline instructions", () =>
    Effect.gen(function* () {
      const service = yield* RuntimeGeneratedContextPreviewService;
      const handler = yield* service.preview({
        workspaceId,
        subject: {
          kind: "configured-profile",
          actorKind: "handler",
          profileId: "profile_handler" as never,
        },
      });
      assert.strictEqual(handler.actorBinding.actorKind, "handler");
      assert.strictEqual(handler.subject.kind, "configured-profile");
      assert.match(handler.systemPrompt, /Shell full/);

      const workflow = yield* service.preview({
        workspaceId,
        subject: { kind: "workflow-agent", actorKind: "workflow-task", sourceId: "reviewer" },
      });
      assert.strictEqual(workflow.actorBinding.actorKind, "workflow-task");
      assert.strictEqual(workflow.subject.kind, "workflow-agent");
      assert.match(workflow.systemPrompt, /^Review only the requested files\./);
      assert.strictEqual(
        workflow.generatedContext.promptBlocks[0]?.contributorId,
        "workflow-task-inline-instructions",
      );
    }).pipe(Effect.provide(testLayer({ reads: [] }))),
  );

  it.effect(
    "returns a diagnostic preview when a loaded generated contributor build is not ready",
    () =>
      Effect.gen(function* () {
        const service = yield* RuntimeGeneratedContextPreviewService;
        const result = yield* service.preview({
          workspaceId,
          subject: {
            kind: "configured-profile",
            actorKind: "orchestrator",
            profileId: "profile_orchestrator" as never,
          },
        });
        assert.isAbove(result.tokenEstimate, 0);
        assert.notMatch(result.systemPrompt, /generated\.md/);
        assert.deepStrictEqual(result.generatedContext.diagnostics, [
          {
            severity: "warning",
            code: "extension.context_build_not_ready",
            message:
              "Loaded extension artifacts has no current context-ready build and is omitted from this preview.",
          },
        ]);
      }).pipe(Effect.provide(testLayer({ reads: [], staleRequiredBuild: true }))),
  );
});

function testLayer(input: { reads: string[]; staleRequiredBuild?: boolean }) {
  return layerRuntimeGeneratedContextPreviewService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(GeneratedContextPreviewSubjectStatePort, {
          readSubject: (request) => Effect.succeed(subjectRecord(request)),
        }),
        Layer.succeed(RuntimeExternalInstructionStatePort, {
          reconcileExternalInstructions: () => Effect.die("preview must not reconcile state"),
          readExternalInstructions: () =>
            Effect.succeed({
              workspaceId,
              sources: [externalSource("external:profile", 0), externalSource("external:actor", 1)],
              diagnostics: [],
              actorUsage: [
                {
                  actor: "orchestrator" as const,
                  profileId: "profile_orchestrator" as never,
                  sourceId: "external:profile" as ExternalInstructionSourceId,
                  usage: "loaded" as const,
                },
                {
                  actor: "orchestrator" as const,
                  profileId: null,
                  sourceId: "external:actor" as ExternalInstructionSourceId,
                  usage: "unavailable" as const,
                },
              ],
              observedAt: null,
              revision: 1 as StateRevision,
            }),
        }),
        Layer.succeed(RuntimeExternalInstructionScanInputPort, {
          resolve: () =>
            Effect.succeed({
              workspaceId,
              workspaceRoot: "/workspace" as AbsolutePath,
              cwd: "/workspace" as AbsolutePath,
              homeDirectory: "/home/test" as AbsolutePath,
              settings: { globalRoots: [], globalControls: {}, workspaceControls: {} },
            }),
        }),
        Layer.succeed(RuntimeRequestStatePort, {
          readRequestInputSettings: () =>
            Effect.succeed({
              mode: "blocking" as const,
              blockingTimeout: { enabled: true, durationMs: 300_000 as never },
            }),
        } as never),
        Layer.succeed(Extensions, extensions(input)),
        Layer.succeed(Crypto.Crypto, crypto),
      ),
    ),
  );
}

function subjectRecord(input: PreviewGeneratedContextInput): GeneratedContextPreviewSubjectRecord {
  const actorKind = input.subject.actorKind;
  const profileId =
    input.subject.kind === "workflow-agent"
      ? input.subject.sourceId
      : (input.subject.profileId as string);
  return {
    workspaceId,
    subject: input.subject,
    profileId,
    profileName: profileId,
    providerId: "openai" as never,
    modelId: "gpt-5" as never,
    reasoningEffort: "high",
    actorBinding: {
      actorKind,
      loadedExtensionIds: ["shell", "artifacts"] as ExtensionId[],
      availableExtensionIds: ["notes"] as ExtensionId[],
      unavailableExtensionIds: [],
      instructionOrder: ["shell", "artifacts", "notes"] as ExtensionId[],
      source: input.subject.kind === "workflow-agent" ? "workflow-agent-source" : "profile-default",
    },
    ...(input.subject.kind === "workflow-agent"
      ? {
          workflowTaskInlineInstructions: {
            sourceRecordId: "workflow-agent:reviewer",
            sourceVersion: sourceFingerprint as SourceFingerprint,
            text: "Review only the requested files.",
          },
        }
      : {}),
  };
}

function extensions(input: { reads: string[]; staleRequiredBuild?: boolean }): ExtensionsService {
  const registry = {
    aggregateFingerprint: "registry-preview",
    observations: [
      observation("shell", "native_tool", "not-required", [
        contributor("minimal", "minimal.mdx", "shell#minimal"),
        contributor("instruction", "main.mdx", "shell#instruction/main.mdx"),
        {
          ...contributor("instruction", "bypassed.mdx", "shell#instruction/bypassed.mdx"),
          bypassed: true,
        },
      ]),
      observation("artifacts", "svvyx", "required", [
        contributor("minimal", "minimal.mdx", "artifacts#minimal"),
        contributor("script", "scripts/generate.ts", "artifacts#script/scripts%2Fgenerate.ts"),
        contributor(
          "generated-instruction",
          "instructions/full/generated.md",
          "artifacts#generated-instruction/instructions%2Ffull%2Fgenerated.md",
        ),
      ]),
      observation("notes", "instructions", "not-required", [
        contributor("minimal", "minimal.mdx", "notes#minimal"),
        contributor("instruction", "main.mdx", "notes#instruction/main.mdx"),
      ]),
    ],
    diagnostics: [],
  } as never;
  const text = new Map([
    ["shell#minimal", "Use shell."],
    ["shell#instruction/main.mdx", "Shell full."],
    ["shell#instruction/bypassed.mdx", "Bypassed."],
    ["artifacts#minimal", "Load artifacts."],
    ["artifacts#generated-instruction/instructions%2Ffull%2Fgenerated.md", "Use svvyx artifacts."],
    ["notes#minimal", "Load notes."],
    ["notes#instruction/main.mdx", "Notes full."],
  ]);
  return {
    registry: { observe: () => Effect.succeed(registry) },
    builds: {
      observeCurrent: () =>
        Effect.succeed({
          registryAggregateFingerprint: "registry-preview",
          observations: [
            buildObservation("shell", "not-required", "not-required", null),
            buildObservation(
              "artifacts",
              "required",
              input.staleRequiredBuild ? "stale" : "current",
              input.staleRequiredBuild ? null : currentBuild("artifacts"),
            ),
            buildObservation("notes", "not-required", "not-required", null),
          ],
        }),
    },
    sources: {
      openEditSession: (source: Parameters<ExtensionsService["sources"]["openEditSession"]>[0]) => {
        input.reads.push(source.sourceId);
        return Effect.succeed({
          ...source,
          path: `/sources/${source.sourceId}` as AbsolutePath,
          sourceVersion: sourceFingerprint,
          fingerprint: sourceFingerprint,
          text: text.get(source.sourceId) ?? "",
          diagnostics: [],
        });
      },
    },
    externalInstructions: {
      resolveSource: ({
        source,
      }: Parameters<ExtensionsService["externalInstructions"]["resolveSource"]>[0]) => {
        input.reads.push(source.sourceId);
        return Effect.succeed({
          observation: {
            id: source.sourceId,
            source,
            fileName: "AGENTS.md" as const,
            title: "AGENTS.md",
            canonicalPath: `/workspace/${source.sourceId}.md` as AbsolutePath,
            sourceGroup: "workspace_chain" as const,
            order: source.sourceId === "external:profile" ? 0 : 1,
            enabled: true,
            eligibleActors: ["orchestrator", "handler", "workflow-task"] as const,
            readOnly: true as const,
            contentHash: sourceFingerprint,
            fingerprint: sourceFingerprint,
            readStatus: { status: "readable" as const },
          },
          content:
            source.sourceId === "external:profile"
              ? "Profile external."
              : "Actor-default disabled.",
        });
      },
    },
  } as unknown as ExtensionsService;
}

function observation(
  id: string,
  interfaceKind: string,
  buildRequirement: string,
  contributors: unknown[],
) {
  return {
    extensionId: id,
    category: "builtin",
    interfaceKind,
    svvyxImplementation:
      interfaceKind === "svvyx"
        ? { kind: "app-native", namespace: id, metadataFingerprint: outputFingerprint }
        : null,
    usagePolicy: {
      canonicalOrder: 0,
      baselineUsage: { orchestrator: "loaded", handler: "loaded", "workflow-task": "loaded" },
      networkAccess: "not-required",
      configurable: true,
      fixedReason: null,
    },
    buildRequirement,
    title: id,
    description: `${id} description`,
    customized: false,
    materializationPlan: null,
    capabilities: {
      resettable: true,
      deletable: false,
      typescriptApiEnabled: false,
      materializationRequired: false,
    },
    contributors,
    tooling: [],
    cliDeclarations: [],
    envDeclarations: [],
    dependencyDeclarations: [],
    sourceFingerprint,
    diagnostics: [],
  };
}

function contributor(kind: string, name: string, sourceId: string) {
  return {
    kind,
    name,
    bypassed: false,
    editable: false,
    openable: true,
    requiresMaterialization: false,
    source: { sourceKind: "builtin-extension", sourceId },
  };
}

function buildObservation(
  extensionId: string,
  buildRequirement: string,
  currentBuildStatus: string,
  build: unknown,
) {
  return {
    extensionId,
    category: "builtin",
    buildRequirement,
    sourceStatus: "materialized",
    sourceFingerprint,
    currentBuildStatus,
    currentBuild: build,
    buildRequired: currentBuildStatus !== "current" && buildRequirement === "required",
    diagnostics: [],
  };
}

function currentBuild(extensionId: string) {
  return {
    schemaVersion: 1,
    buildId: `extension-build:${extensionId}:${"d".repeat(64)}`,
    extensionId,
    interfaceKind: "svvyx",
    sourceFingerprint,
    contextFingerprint,
    outputFingerprint,
    contextReady: true,
    generatedFiles: [],
    builtAt: "2026-07-12T09:00:00.000Z",
  };
}

function externalSource(id: string, order: number) {
  return {
    id: id as ExternalInstructionSourceId,
    source: {
      sourceKind: "external-instruction" as const,
      sourceId: id as ExternalInstructionSourceId,
    },
    fileName: "AGENTS.md" as const,
    title: "AGENTS.md",
    canonicalPath: `/workspace/${id}.md` as AbsolutePath,
    sourceGroup: "workspace_chain" as const,
    order,
    defaultControl: {
      enabled: true,
      eligibleActors: ["orchestrator", "handler", "workflow-task"] as const,
    },
    readOnly: true as const,
    contentHash: sourceFingerprint,
    fingerprint: sourceFingerprint,
    readStatus: { status: "readable" as const },
    content: "observed",
  };
}

const crypto = Crypto.make({
  digest: (_algorithm, data) => {
    const output = new Uint8Array(32);
    for (const [index, byte] of data.entries()) output[index % output.length]! ^= byte;
    return Effect.succeed(output);
  },
  randomBytes: (size) => new Uint8Array(size).fill(7),
});
