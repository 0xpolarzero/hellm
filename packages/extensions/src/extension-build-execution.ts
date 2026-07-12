import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionError,
  type BuildExtensionInput,
  type BuildExtensionResult,
  type ExtensionBuildExpectedOutput,
  type ExtensionBuildFileEvidence,
  type ExtensionBuildOutputFingerprint,
  type ExtensionContextFingerprint,
  type ExtensionCurrentBuildManifest,
  type ExtensionSourceFingerprint,
  type ExtensionRegistryObservation,
  type AbsolutePath,
  type SvvyxCommandManifest,
} from "@svvy/core";

import { ExtensionBuildProcessPort } from "./extension-build-process-port";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import { fingerprintExtensionSource } from "./extension-source-fingerprint";
import {
  APP_NATIVE_SVVYX_METADATA,
  appNativeSvvyxMetadataFingerprintInput,
  renderSvvyxCommandManifest,
  renderSvvyxTypescriptDeclaration,
} from "./svvyx-build-metadata";

const operation = "extensions.builds.build";
const actorFacingRoles = new Set<ExtensionBuildFileEvidence["role"]>([
  "minimal-instruction",
  "full-instruction",
  "command-manifest",
  "typescript-declaration",
]);

export type ExtensionBuildExecutionServices =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
  | ExtensionBuildProcessPort;

export function buildExtension(
  input: BuildExtensionInput,
): Effect.Effect<BuildExtensionResult, ExtensionError, ExtensionBuildExecutionServices> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const processPort = yield* ExtensionBuildProcessPort;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templates = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const registry = input.registryObservation.observations.find(
      (entry) => entry.extensionId === input.extensionId,
    );
    if (!registry) return yield* fail(input.extensionId, "Extension is absent from the registry.");
    yield* validateBuildIdentity(input, registry);

    const sourceRoot =
      registry.svvyxImplementation?.kind === "app-native"
        ? path.resolve(templates.builtinExtensionsRoot, registry.extensionId)
        : path.resolve(
            roots.extensionsRoot,
            "sources",
            registry.category === "builtin" ? "builtin" : "user",
            registry.extensionId,
          );
    const sourceFingerprint = (
      registry.svvyxImplementation?.kind === "app-native"
        ? (registry.sourceFingerprint as typeof input.sourceObservation.sourceFingerprint)
        : yield* fingerprintExtensionSource({
            extensionId: registry.extensionId,
            root: sourceRoot,
            declaredFiles: sourceFingerprintInputs(registry),
          })
    ) as ExtensionSourceFingerprint;
    if (sourceFingerprint !== input.sourceObservation.sourceFingerprint) {
      return yield* fail(
        input.extensionId,
        "Extension source changed after its canonical source observation.",
      );
    }

    const buildRoot = path.resolve(
      roots.extensionsRoot,
      "builds",
      "extensions",
      registry.extensionId,
    );
    const stagingParent = path.resolve(buildRoot, "staging");
    yield* fs.makeDirectory(stagingParent, { recursive: true }).pipe(mapFs(input.extensionId));
    const runBytes = yield* crypto.randomBytes(16).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionError({
            extensionId: input.extensionId,
            operation,
            reason: "execution-failed",
            message: "Failed to allocate an extension build staging id.",
            cause,
          }),
      ),
    );
    const runId = Array.from(runBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const stagingRoot = path.resolve(stagingParent, runId);
    yield* assertContained(path, stagingParent, stagingRoot, input.extensionId);
    yield* fs.makeDirectory(stagingRoot, { recursive: true }).pipe(mapFs(input.extensionId));

    const expectedOutputs = expectedBuildOutputs(registry);
    const expectedProcessOutputs = processExpectedOutputs(registry);
    const generators = yield* Effect.try({
      try: () => generatorInvocations(registry, path, sourceRoot, stagingRoot),
      catch: (cause) =>
        cause instanceof ExtensionError
          ? cause
          : new ExtensionError({
              extensionId: input.extensionId,
              operation,
              reason: "invalid-input",
              message: "Extension generator paths are invalid.",
              cause,
            }),
    });
    const cleanup = fs
      .remove(stagingRoot, { recursive: true, force: true })
      .pipe(Effect.catchCause(() => Effect.void));
    return yield* Effect.gen(function* () {
      const processEvidence = yield* processPort.run({
        extensionId: registry.extensionId,
        sourceRoot: sourceRoot as AbsolutePath,
        stagingRoot: stagingRoot as AbsolutePath,
        generators,
        expectedProcessOutputs,
        svvyxRuntime:
          registry.svvyxImplementation?.kind === "source-runtime"
            ? {
                sourcePath: path.resolve(sourceRoot, "source", "index.ts") as AbsolutePath,
                runtimeOutputPath: path.resolve(stagingRoot, "runtime", "index.js") as AbsolutePath,
              }
            : null,
        timeoutMs: 30_000,
        maxStdoutBytes: 16_384,
        maxStderrBytes: 16_384,
      });
      if (processEvidence.status !== "completed") {
        return yield* fail(
          input.extensionId,
          `Extension build process ${processEvidence.status}.`,
          processEvidence.status === "timed-out" ? "timed-out" : "process-failed",
        );
      }
      if (processEvidence.exitCode !== 0) {
        return yield* fail(
          input.extensionId,
          `Extension build process exited with code ${processEvidence.exitCode}.`,
          "process-failed",
        );
      }
      yield* validateStagedFiles({
        fs,
        path,
        stagingRoot,
        expectedOutputs: expectedProcessOutputs,
        evidence: processEvidence.stagedFiles,
        extensionId: input.extensionId,
      });
      yield* stageStaticOutputs({ fs, path, registry, sourceRoot, stagingRoot });
      const commandManifest = yield* resolveCommandManifest({
        registry,
        processCommandManifest: processEvidence.commandManifest,
      });
      if (commandManifest) {
        yield* fs
          .writeFileString(
            path.resolve(stagingRoot, "commands.json"),
            renderSvvyxCommandManifest(commandManifest),
          )
          .pipe(mapFs(input.extensionId));
        if (registry.capabilities.typescriptApiEnabled) {
          yield* fs
            .writeFileString(
              path.resolve(stagingRoot, "index.d.ts"),
              renderSvvyxTypescriptDeclaration({
                extensionId: registry.extensionId,
                commandManifest,
              }),
            )
            .pipe(mapFs(input.extensionId));
        }
      }
      const generatedFiles = yield* collectFinalEvidence({
        fs,
        path,
        stagingRoot,
        expectedOutputs,
        extensionId: input.extensionId,
      });
      const outputFingerprint = yield* fingerprintEvidence(
        "svvy-extension-output-v1",
        generatedFiles,
      );
      const contextFingerprint = yield* fingerprintEvidence(
        "svvy-extension-context-v1",
        generatedFiles.filter((file) => actorFacingRoles.has(file.role)),
      );
      const manifest: ExtensionCurrentBuildManifest = {
        schemaVersion: 1,
        buildId:
          `extension-build:${input.extensionId}:${outputFingerprint.slice("sha256:".length)}` as ExtensionCurrentBuildManifest["buildId"],
        extensionId: input.extensionId,
        interfaceKind: registry.interfaceKind,
        sourceFingerprint,
        contextFingerprint: contextFingerprint as ExtensionContextFingerprint,
        outputFingerprint: outputFingerprint as ExtensionBuildOutputFingerprint,
        contextReady: true,
        generatedFiles,
        builtAt: input.builtAt,
      };
      yield* fs
        .writeFileString(
          path.resolve(stagingRoot, "manifest.json"),
          `${JSON.stringify(manifest)}\n`,
        )
        .pipe(mapFs(input.extensionId));
      yield* promoteCurrent({ fs, path, buildRoot, stagingRoot, extensionId: input.extensionId });
      return {
        registryAggregateFingerprint: input.registryObservation.aggregateFingerprint,
        manifest,
      };
    }).pipe(Effect.ensuring(cleanup));
  });
}

function validateBuildIdentity(input: BuildExtensionInput, registry: ExtensionRegistryObservation) {
  if (
    registry.buildRequirement !== "required" ||
    input.sourceObservation.extensionId !== input.extensionId ||
    input.sourceObservation.category !== registry.category ||
    input.sourceObservation.buildRequirement !== "required" ||
    input.sourceObservation.sourceStatus !== "materialized" ||
    input.sourceObservation.sourceFingerprint === null
  ) {
    return fail(
      input.extensionId,
      "Extension build input is not a materialized required canonical source observation.",
    );
  }
  return Effect.void;
}

function sourceFingerprintInputs(registry: ExtensionRegistryObservation): ReadonlyArray<{
  role: "manifest" | "minimal-instruction" | "full-instruction" | "generator-script";
  relativePath: string;
}> {
  const inputs: Array<{
    role: "manifest" | "minimal-instruction" | "full-instruction" | "generator-script";
    relativePath: string;
  }> = [
    { role: "manifest" as const, relativePath: "manifest.json" },
    { role: "minimal-instruction" as const, relativePath: "instructions/minimal.mdx" },
  ];
  for (const item of registry.contributors) {
    if (item.kind === "instruction")
      inputs.push({ role: "full-instruction", relativePath: `instructions/full/${item.name}` });
    if (item.kind === "script") inputs.push({ role: "generator-script", relativePath: item.name });
  }
  return inputs;
}

function expectedBuildOutputs(
  registry: ExtensionRegistryObservation,
): ExtensionBuildExpectedOutput[] {
  const outputs: ExtensionBuildExpectedOutput[] = [
    { role: "minimal-instruction", relativePath: "instructions/minimal.mdx" },
  ];
  for (const contributor of registry.contributors) {
    if (contributor.kind === "instruction")
      outputs.push({
        role: "full-instruction",
        relativePath: `instructions/full/${contributor.name}`,
      });
    if (contributor.kind === "generated-instruction")
      outputs.push({ role: "full-instruction", relativePath: contributor.name });
  }
  for (const item of registry.tooling) {
    if (item.kind === "command-schema" || item.kind === "native-tool-schema")
      outputs.push({ role: "command-manifest", relativePath: item.name });
    if (item.kind === "typescript-api-declaration")
      outputs.push({ role: "typescript-declaration", relativePath: item.name });
    if (item.kind === "svvyx-source")
      outputs.push({ role: "runtime-module", relativePath: "runtime/index.js" });
  }
  return outputs.toSorted(compareEvidence);
}

function processExpectedOutputs(
  registry: ExtensionRegistryObservation,
): ExtensionBuildExpectedOutput[] {
  const outputs: ExtensionBuildExpectedOutput[] = [];
  for (const contributor of registry.contributors) {
    if (contributor.kind === "generated-instruction")
      outputs.push({ role: "full-instruction", relativePath: contributor.name });
  }
  if (registry.svvyxImplementation?.kind === "source-runtime")
    outputs.push({ role: "runtime-module", relativePath: "runtime/index.js" });
  return outputs.toSorted(compareEvidence);
}

function stageStaticOutputs(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  registry: ExtensionRegistryObservation;
  sourceRoot: string;
  stagingRoot: string;
}) {
  return Effect.gen(function* () {
    const staticOutputs = expectedBuildOutputs(input.registry).filter(
      (output) =>
        output.role === "minimal-instruction" ||
        (output.role === "full-instruction" &&
          !input.registry.contributors.some(
            (item) => item.kind === "generated-instruction" && item.name === output.relativePath,
          )),
    );
    for (const output of staticOutputs) {
      const target = input.path.resolve(input.stagingRoot, output.relativePath);
      yield* input.fs
        .makeDirectory(input.path.dirname(target), { recursive: true })
        .pipe(mapFs(input.registry.extensionId));
      const source = input.path.resolve(input.sourceRoot, output.relativePath);
      const bytes = yield* input.fs.readFile(source).pipe(mapFs(input.registry.extensionId));
      yield* input.fs.writeFile(target, bytes).pipe(mapFs(input.registry.extensionId));
    }
  });
}

function resolveCommandManifest(input: {
  registry: ExtensionRegistryObservation;
  processCommandManifest: SvvyxCommandManifest | null;
}): Effect.Effect<SvvyxCommandManifest | null, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    if (input.registry.interfaceKind !== "svvyx") return null;
    if (input.registry.svvyxImplementation?.kind === "source-runtime") {
      if (!input.processCommandManifest)
        return yield* fail(
          input.registry.extensionId,
          "Source svvyx build returned no command manifest.",
        );
      return input.processCommandManifest;
    }
    if (input.registry.svvyxImplementation?.kind === "app-native") {
      if (input.processCommandManifest)
        return yield* fail(
          input.registry.extensionId,
          "App-native svvyx build returned an unexpected process command manifest.",
        );
      const metadata = APP_NATIVE_SVVYX_METADATA.get(input.registry.extensionId);
      if (!metadata)
        return yield* fail(input.registry.extensionId, "App-native svvyx metadata is missing.");
      const fingerprint = yield* sha256(
        new TextEncoder().encode(appNativeSvvyxMetadataFingerprintInput(metadata)),
      );
      if (fingerprint !== input.registry.svvyxImplementation.metadataFingerprint)
        return yield* fail(
          input.registry.extensionId,
          "App-native svvyx metadata fingerprint is stale.",
        );
      return metadata.commandManifest;
    }
    return yield* fail(input.registry.extensionId, "Svvyx implementation declaration is missing.");
  });
}

function collectFinalEvidence(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  stagingRoot: string;
  expectedOutputs: readonly ExtensionBuildExpectedOutput[];
  extensionId: string;
}) {
  return Effect.forEach(
    input.expectedOutputs.toSorted(compareEvidence),
    (output) =>
      Effect.gen(function* () {
        const filePath = input.path.resolve(input.stagingRoot, output.relativePath);
        yield* assertContained(input.path, input.stagingRoot, filePath, input.extensionId);
        const bytes = yield* input.fs.readFile(filePath).pipe(mapFs(input.extensionId));
        return {
          ...output,
          contentHash: yield* sha256(bytes),
          byteSize: bytes.byteLength,
        } satisfies ExtensionBuildFileEvidence;
      }),
    { concurrency: 1 },
  );
}

function generatorInvocations(
  registry: ExtensionRegistryObservation,
  path: Path.Path,
  sourceRoot: string,
  stagingRoot: string,
) {
  const contributors = registry.contributors;
  return contributors.flatMap((item, index) => {
    if (item.kind !== "script") return [];
    const output = contributors
      .slice(index + 1)
      .find((candidate) => candidate.kind === "generated-instruction");
    if (!output) return [];
    const scriptPath = path.resolve(sourceRoot, item.name);
    const outputPath = path.resolve(stagingRoot, output.name);
    assertContainedSync(path, sourceRoot, scriptPath, registry.extensionId);
    assertContainedSync(path, stagingRoot, outputPath, registry.extensionId);
    const version = item.versionCliRequirementId
      ? registry.cliDeclarations.find(
          (declaration) => declaration.id === item.versionCliRequirementId,
        )?.defaultVersion
      : null;
    if (item.versionCliRequirementId && !version) {
      throw new ExtensionError({
        extensionId: registry.extensionId,
        operation,
        reason: "invalid-input",
        message: `Generated instruction CLI requirement has no pinned version: ${item.versionCliRequirementId}`,
      });
    }
    return [
      {
        scriptPath: scriptPath as AbsolutePath,
        outputPath: outputPath as AbsolutePath,
        argv: ["--output", outputPath, ...(version ? ["--version", version] : [])],
      },
    ];
  });
}

function validateStagedFiles(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  stagingRoot: string;
  expectedOutputs: readonly ExtensionBuildExpectedOutput[];
  evidence: readonly ExtensionBuildFileEvidence[];
  extensionId: string;
}) {
  return Effect.gen(function* () {
    const expected = input.expectedOutputs.toSorted(compareEvidence);
    const evidence = input.evidence.toSorted(compareEvidence);
    if (
      JSON.stringify(expected) !==
      JSON.stringify(evidence.map(({ role, relativePath }) => ({ role, relativePath })))
    )
      return yield* fail(
        input.extensionId,
        "Build process staged an unexpected output set.",
        "output-invalid",
      );
    for (const file of evidence) {
      if (!canonicalRelative(file.relativePath))
        return yield* fail(
          input.extensionId,
          `Build output path is not canonical: ${file.relativePath}`,
          "output-invalid",
        );
      const filePath = input.path.resolve(input.stagingRoot, file.relativePath);
      yield* assertContained(input.path, input.stagingRoot, filePath, input.extensionId);
      const bytes = yield* input.fs.readFile(filePath).pipe(mapFs(input.extensionId));
      const hash = yield* sha256(bytes);
      if (bytes.byteLength !== file.byteSize || hash !== file.contentHash)
        return yield* fail(
          input.extensionId,
          `Build output evidence does not match: ${file.relativePath}`,
          "output-invalid",
        );
    }
    return evidence;
  });
}

function promoteCurrent(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  buildRoot: string;
  stagingRoot: string;
  extensionId: string;
}) {
  const current = input.path.resolve(input.buildRoot, "current");
  const previous = input.path.resolve(input.buildRoot, ".previous");
  return Effect.uninterruptible(
    Effect.gen(function* () {
      yield* input.fs
        .remove(previous, { recursive: true, force: true })
        .pipe(mapFs(input.extensionId));
      const currentExists = yield* input.fs.exists(current).pipe(mapFs(input.extensionId));
      if (currentExists) yield* input.fs.rename(current, previous).pipe(mapFs(input.extensionId));
      yield* input.fs.rename(input.stagingRoot, current).pipe(
        mapFs(input.extensionId),
        Effect.catch((cause) =>
          currentExists
            ? input.fs
                .rename(previous, current)
                .pipe(mapFs(input.extensionId), Effect.andThen(Effect.fail(cause)))
            : Effect.fail(cause),
        ),
      );
      yield* input.fs
        .remove(previous, { recursive: true, force: true })
        .pipe(mapFs(input.extensionId));
    }),
  );
}

function fingerprintEvidence(domain: string, files: readonly ExtensionBuildFileEvidence[]) {
  const framed = [
    domain,
    ...files
      .toSorted(compareEvidence)
      .flatMap((file) => [file.role, file.relativePath, file.contentHash]),
  ]
    .map((part) => `${new TextEncoder().encode(part).byteLength}:${part}`)
    .join("");
  return sha256(new TextEncoder().encode(framed));
}

function sha256(bytes: Uint8Array): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const digest = yield* (yield* Crypto.Crypto).digest("SHA-256", bytes).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionError({
            operation,
            reason: "execution-failed",
            message: "Failed to hash extension build output.",
            cause,
          }),
      ),
    );
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}

function compareEvidence(
  left: { role: string; relativePath: string },
  right: { role: string; relativePath: string },
) {
  return `${left.role}\0${left.relativePath}`.localeCompare(`${right.role}\0${right.relativePath}`);
}
function canonicalRelative(value: string) {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
function assertContained(path: Path.Path, root: string, candidate: string, extensionId: string) {
  return Effect.try({
    try: () => assertContainedSync(path, root, candidate, extensionId),
    catch: (cause) => cause as ExtensionError,
  });
}
function assertContainedSync(
  path: Path.Path,
  root: string,
  candidate: string,
  extensionId: string,
) {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(prefix))
    throw new ExtensionError({
      extensionId,
      operation,
      reason: "invalid-input",
      message: `Extension build path escapes its root: ${candidate}`,
    });
}
function mapFs(extensionId: string) {
  return Effect.mapError(
    (cause: unknown) =>
      new ExtensionError({
        extensionId,
        operation,
        reason: "execution-failed",
        message: "Extension build filesystem operation failed.",
        cause,
      }),
  );
}
function fail(
  extensionId: string,
  message: string,
  reason: "invalid-input" | "process-failed" | "timed-out" | "output-invalid" = "invalid-input",
): Effect.Effect<never, ExtensionError> {
  return Effect.fail(new ExtensionError({ extensionId, operation, reason, message }));
}
