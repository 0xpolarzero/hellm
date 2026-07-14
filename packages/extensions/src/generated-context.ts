import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import {
  ExtensionError,
  type AbsolutePath,
  type BuildGeneratedContextInput,
  type ExtensionId,
  type ExtensionRegistryObservationResult,
  type GeneratedContext,
  type GeneratedContextExternalInstructionBlock,
  type GeneratedContextPreviewExtension,
  type GeneratedContextPromptBlock,
  type RequestInputVariant,
  type SourceDiagnostic,
  type SourceFingerprint,
} from "@svvy/core";
import { buildExecuteTypescriptFacadeDeclarations } from "./execute-typescript-facade-declarations";
import { nativeToolDeclarationsForExtensions } from "./native-tool-catalog";
import { getRequestUserInputVariantInstructions } from "./request-user-input-variant-instructions";

const operation = "extensions.generatedContext.build";

interface GeneratedContextSourceContributorBase {
  readonly contributorId: string;
  readonly sourceRecordId: string;
  readonly sourceVersion: SourceFingerprint;
  readonly sourcePath: AbsolutePath;
  readonly sourceFingerprint: SourceFingerprint;
  readonly bypassed: boolean;
  readonly text: string;
}

export type GeneratedContextSourceContributor =
  | (GeneratedContextSourceContributorBase & {
      readonly extensionId: ExtensionId;
      readonly kind: "minimal" | "instruction" | "svvyx-guidance";
    })
  | (GeneratedContextSourceContributorBase & {
      readonly kind: "external-instruction";
    });

export interface BuildGeneratedContextSources {
  readonly registry: ExtensionRegistryObservationResult;
  readonly contributors: readonly GeneratedContextSourceContributor[];
  readonly contextReadyExtensionIds: readonly ExtensionId[];
  readonly requestInputVariant: RequestInputVariant;
  readonly diagnostics?: readonly SourceDiagnostic[];
}

export interface GeneratedContextBuildArtifacts {
  readonly generatedContext: GeneratedContext;
  readonly systemPrompt: string;
  readonly extensions: readonly GeneratedContextPreviewExtension[];
}

export function buildGeneratedContext(
  input: BuildGeneratedContextInput,
  sources: BuildGeneratedContextSources,
): Effect.Effect<GeneratedContext, ExtensionError, Crypto.Crypto> {
  return buildGeneratedContextArtifacts(input, sources).pipe(
    Effect.map((artifacts) => artifacts.generatedContext),
  );
}

export function buildGeneratedContextArtifacts(
  input: BuildGeneratedContextInput,
  sources: BuildGeneratedContextSources,
): Effect.Effect<GeneratedContextBuildArtifacts, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    yield* validateBinding(input);
    const observations = new Map(
      sources.registry.observations.map((observation) => [observation.extensionId, observation]),
    );
    const ready = new Set(sources.contextReadyExtensionIds);
    const loaded = new Set(input.actorBinding.loadedExtensionIds);
    const available = new Set(input.actorBinding.availableExtensionIds);

    for (const extensionId of [...loaded, ...available]) {
      if (!observations.has(extensionId)) {
        return yield* fail(
          extensionId,
          "not-found",
          `Extension is absent from the registry: ${extensionId}`,
        );
      }
    }
    for (const extensionId of loaded) {
      if (!ready.has(extensionId)) {
        return yield* fail(
          extensionId,
          "dependency-not-ready",
          `Loaded extension ${extensionId} is not ready for generated context.`,
        );
      }
    }

    const compiled = new Map<GeneratedContextSourceContributor, string>();
    for (const contributor of sources.contributors) {
      compiled.set(contributor, yield* compilePromptSource(contributor));
    }

    const order = extensionOrder(input);
    const loadedInstructionSources = sources.contributors
      .filter(
        (
          contributor,
        ): contributor is Extract<GeneratedContextSourceContributor, { kind: "instruction" }> =>
          contributor.kind === "instruction" &&
          !contributor.bypassed &&
          loaded.has(contributor.extensionId),
      )
      .toSorted((left, right) => compareContributors(left, right, order));
    const svvyxSources = sources.contributors
      .filter(
        (
          contributor,
        ): contributor is Extract<GeneratedContextSourceContributor, { kind: "svvyx-guidance" }> =>
          contributor.kind === "svvyx-guidance" &&
          !contributor.bypassed &&
          loaded.has(contributor.extensionId),
      )
      .toSorted((left, right) => compareContributors(left, right, order));

    const inlineBlock = input.workflowTaskInlineInstructions
      ? [
          promptBlock({
            extensionId: "base-workflow-task" as ExtensionId,
            contributorId: "workflow-task-inline-instructions",
            sourceRecordId: input.workflowTaskInlineInstructions.sourceRecordId,
            sourceVersion: input.workflowTaskInlineInstructions.sourceVersion,
            sourcePath:
              `/workflow-agents/${input.workflowTaskInlineInstructions.sourceRecordId}` as AbsolutePath,
            sourceFingerprint: input.workflowTaskInlineInstructions.sourceVersion,
            text: normalizePromptText(input.workflowTaskInlineInstructions.text),
          }),
        ]
      : [];
    const promptBlocks = [
      ...inlineBlock,
      ...loadedInstructionSources.map((source) =>
        promptBlockFromSource(source, compiled.get(source)!),
      ),
    ];
    const externalInstructionBlocks = sources.contributors
      .filter(
        (
          source,
        ): source is Extract<GeneratedContextSourceContributor, { kind: "external-instruction" }> =>
          source.kind === "external-instruction" && !source.bypassed,
      )
      .toSorted((left, right) => left.contributorId.localeCompare(right.contributorId))
      .map((source) => externalInstructionBlockFromSource(source, compiled.get(source)!));
    const svvyxGuidanceBlocks = svvyxSources.map((source) =>
      promptBlockFromSource(source, compiled.get(source)!),
    );
    const nativeRecords = input.actorBinding.loadedExtensionIds.flatMap((extensionId) => {
      const observation = observations.get(extensionId);
      return observation
        ? [
            {
              id: observation.extensionId,
              title: observation.title,
              description: observation.description,
              category: observation.category,
              interface: observation.interfaceKind,
            },
          ]
        : [];
    });
    const nativeToolDeclarations = yield* Effect.try({
      try: () => nativeToolDeclarationsForExtensions(nativeRecords, sources.requestInputVariant),
      catch: (cause) =>
        new ExtensionError({
          operation,
          reason: "invalid-input",
          message: "Loaded native-tool declarations are incomplete.",
          cause,
        }),
    });
    const executeTypescriptFacadeDeclarations = buildExecuteTypescriptFacadeDeclarations({
      actorKind: input.actorKind,
      actorBinding: input.actorBinding,
    });
    const requestInputVariantInstructions = nativeRecords.some(
      (record) => record.id === "request-user-input",
    )
      ? normalizePromptText(getRequestUserInputVariantInstructions(sources.requestInputVariant))
      : "";
    const promptSections = [
      ...promptBlocks.map((block) => block.text),
      ...externalInstructionBlocks.map((block) => block.text),
      ...svvyxGuidanceBlocks.map((block) => block.text),
      requestInputVariantInstructions,
      executeTypescriptFacadeDeclarations.text,
    ].filter((text) => text.trim().length > 0);
    const systemPrompt = promptSections.join("\n\n");
    const sourceFingerprints = Object.fromEntries(
      [...promptBlocks, ...externalInstructionBlocks, ...svvyxGuidanceBlocks].map((block) => [
        block.sourceRecordId,
        block.sourceFingerprint,
      ]),
    );
    const fingerprint = (yield* sha256(
      JSON.stringify({
        actorKind: input.actorKind,
        target: input.target,
        actorBinding: input.actorBinding,
        promptBlocks,
        externalInstructionBlocks,
        nativeToolDeclarations,
        requestInputVariantInstructions,
        svvyxGuidanceBlocks,
        executeTypescriptFacadeDeclarations,
        sourceFingerprints,
      }),
    )) as GeneratedContext["fingerprint"];
    const diagnostics = [...sources.registry.diagnostics, ...(sources.diagnostics ?? [])];
    const generatedContext: GeneratedContext = {
      fingerprint,
      promptBlocks,
      externalInstructionBlocks,
      nativeToolDeclarations,
      svvyxGuidanceBlocks,
      executeTypescriptFacadeDeclarations,
      tokenEstimate: estimateTokens(systemPrompt),
      sourceFingerprints,
      diagnostics,
    };
    return {
      generatedContext,
      systemPrompt,
      extensions: buildPreviewRows({ input, sources, observations, compiled }),
    };
  });
}

function buildPreviewRows(input: {
  readonly input: BuildGeneratedContextInput;
  readonly sources: BuildGeneratedContextSources;
  readonly observations: ReadonlyMap<
    ExtensionId,
    BuildGeneratedContextSources["registry"]["observations"][number]
  >;
  readonly compiled: ReadonlyMap<GeneratedContextSourceContributor, string>;
}): readonly GeneratedContextPreviewExtension[] {
  const order = extensionOrder(input.input);
  const rows = [
    ...input.input.actorBinding.loadedExtensionIds.map((extensionId) => ({
      extensionId,
      state: "loaded" as const,
    })),
    ...input.input.actorBinding.availableExtensionIds.map((extensionId) => ({
      extensionId,
      state: "available" as const,
    })),
  ];
  return rows.map(({ extensionId, state }) => {
    const observation = input.observations.get(extensionId)!;
    const instructionSources = input.sources.contributors
      .filter(
        (
          source,
        ): source is Exclude<GeneratedContextSourceContributor, { kind: "external-instruction" }> =>
          source.kind !== "external-instruction" &&
          source.extensionId === extensionId &&
          !source.bypassed &&
          (state === "loaded"
            ? source.kind === "instruction" || source.kind === "svvyx-guidance"
            : source.kind === "minimal"),
      )
      .toSorted((left, right) => compareContributors(left, right, order));
    const loadedSources = input.sources.contributors
      .filter(
        (
          source,
        ): source is Exclude<GeneratedContextSourceContributor, { kind: "external-instruction" }> =>
          source.kind !== "external-instruction" &&
          source.extensionId === extensionId &&
          !source.bypassed &&
          (source.kind === "instruction" || source.kind === "svvyx-guidance"),
      )
      .toSorted((left, right) => compareContributors(left, right, order));
    const instruction = instructionSources
      .map((source) => input.compiled.get(source)!)
      .filter(Boolean)
      .join("\n\n");
    const loadedInstruction =
      state === "available"
        ? loadedSources
            .map((source) => input.compiled.get(source)!)
            .filter(Boolean)
            .join("\n\n")
        : null;
    return {
      extensionId,
      title: observation.title,
      description: observation.description,
      state,
      instruction,
      tokenEstimate: instruction.trim() ? estimateTokens(instruction) : null,
      loadedInstruction,
      loadedTokenEstimate: loadedInstruction?.trim() ? estimateTokens(loadedInstruction) : null,
      sourcePath: instructionSources[0]?.sourcePath ?? null,
    };
  });
}

function validateBinding(input: BuildGeneratedContextInput): Effect.Effect<void, ExtensionError> {
  if (input.actorBinding.actorKind !== input.actorKind) {
    return fail(
      undefined,
      "invalid-input",
      "Actor binding kind does not match generated-context actor kind.",
    );
  }
  const all = [
    ...input.actorBinding.loadedExtensionIds,
    ...input.actorBinding.availableExtensionIds,
    ...input.actorBinding.unavailableExtensionIds,
  ];
  if (new Set(all).size !== all.length) {
    return fail(undefined, "invalid-input", "Actor binding extension states overlap.");
  }
  return Effect.void;
}

function extensionOrder(input: BuildGeneratedContextInput): ReadonlyMap<ExtensionId, number> {
  const result = new Map<ExtensionId, number>();
  for (const [index, extensionId] of input.actorBinding.instructionOrder.entries()) {
    if (!result.has(extensionId)) result.set(extensionId, index);
  }
  return result;
}

function compareContributors(
  left: Exclude<GeneratedContextSourceContributor, { kind: "external-instruction" }>,
  right: Exclude<GeneratedContextSourceContributor, { kind: "external-instruction" }>,
  order: ReadonlyMap<ExtensionId, number>,
): number {
  const leftOrder = order.get(left.extensionId) ?? Number.MAX_SAFE_INTEGER - 1;
  const rightOrder = order.get(right.extensionId) ?? Number.MAX_SAFE_INTEGER - 1;
  return (
    leftOrder - rightOrder ||
    left.extensionId.localeCompare(right.extensionId) ||
    left.contributorId.localeCompare(right.contributorId)
  );
}

function promptBlockFromSource(
  source: Exclude<GeneratedContextSourceContributor, { kind: "external-instruction" }>,
  text: string,
): GeneratedContextPromptBlock {
  return promptBlock({
    extensionId: source.extensionId,
    contributorId: source.contributorId,
    sourceRecordId: source.sourceRecordId,
    sourceVersion: source.sourceVersion,
    sourcePath: source.sourcePath,
    sourceFingerprint: source.sourceFingerprint,
    text,
  });
}

function externalInstructionBlockFromSource(
  source: Extract<GeneratedContextSourceContributor, { kind: "external-instruction" }>,
  text: string,
): GeneratedContextExternalInstructionBlock {
  return {
    sourceRecordId: source.sourceRecordId,
    sourceVersion: source.sourceVersion,
    sourcePath: source.sourcePath,
    sourceFingerprint: source.sourceFingerprint,
    text,
    tokenEstimate: estimateTokens(text),
  };
}

function promptBlock(
  input: Omit<GeneratedContextPromptBlock, "tokenEstimate">,
): GeneratedContextPromptBlock {
  return { ...input, tokenEstimate: estimateTokens(input.text) };
}

function compilePromptSource(
  source: GeneratedContextSourceContributor,
): Effect.Effect<string, ExtensionError> {
  const text = normalizePromptText(source.text);
  if (text.includes("\0")) {
    return fail(
      source.kind === "external-instruction" ? undefined : source.extensionId,
      "invalid-input",
      `Prompt source contains a NUL byte: ${source.sourceRecordId}`,
    );
  }
  if (source.sourcePath.endsWith(".mdx")) {
    const executableLine = text.match(/^\s*(?:import|export)\s/m);
    const jsxElement = text.match(/<\/?[A-Z][A-Za-z0-9.]*(?:\s|>|\/)/);
    if (executableLine || jsxElement) {
      return fail(
        source.kind === "external-instruction" ? undefined : source.extensionId,
        "invalid-input",
        `Prompt MDX contains executable imports, exports, or components: ${source.sourceRecordId}`,
      );
    }
  }
  return Effect.succeed(text);
}

function normalizePromptText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

function sha256(text: string): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const bytes = new TextEncoder().encode(text);
    const digest = yield* (yield* Crypto.Crypto).digest("SHA-256", bytes).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionError({
            operation,
            reason: "execution-failed",
            message: "Failed to fingerprint generated context.",
            cause,
          }),
      ),
    );
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}

function fail(
  extensionId: string | undefined,
  reason: "invalid-input" | "not-found" | "dependency-not-ready",
  message: string,
): Effect.Effect<never, ExtensionError> {
  return Effect.fail(
    new ExtensionError({ ...(extensionId ? { extensionId } : {}), operation, reason, message }),
  );
}
