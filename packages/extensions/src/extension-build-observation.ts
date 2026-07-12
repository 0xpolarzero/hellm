import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  decodeUnknownExtensionCurrentBuildManifestEffect,
  ExtensionError,
  type ExtensionBuildFileEvidence,
  type ExtensionBuildOutputFingerprint,
  type ExtensionContextFingerprint,
  type ExtensionCurrentBuildManifest,
  type ExtensionSourceBuildObservation,
  type ExtensionSourceFingerprint,
  type ObserveExtensionSourceBuildsInput,
  type ObserveExtensionSourceBuildsResult,
} from "@svvy/core";

import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { fingerprintExtensionSource } from "./extension-source-fingerprint";

const operation = "extensions.builds.observe-current";
const actorFacingRoles = new Set<ExtensionBuildFileEvidence["role"]>([
  "minimal-instruction",
  "full-instruction",
  "command-manifest",
  "typescript-declaration",
]);

export type ExtensionBuildObservationServices =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort;

export function observeCurrentExtensionBuilds(
  input: ObserveExtensionSourceBuildsInput,
): Effect.Effect<
  ObserveExtensionSourceBuildsResult,
  ExtensionError,
  ExtensionBuildObservationServices
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const buildsRoot = path.resolve(roots.extensionsRoot, "builds", "extensions");
    const observations: ExtensionSourceBuildObservation[] = [];

    for (const registry of input.registryObservation.observations.toSorted((left, right) =>
      left.extensionId.localeCompare(right.extensionId),
    )) {
      const appNative = registry.svvyxImplementation?.kind === "app-native";
      const sourceStatus =
        registry.capabilities.materializationRequired && !appNative
          ? ("unmaterialized" as const)
          : ("materialized" as const);
      const fingerprintResult = appNative
        ? { ok: true as const, value: registry.sourceFingerprint as ExtensionSourceFingerprint }
        : sourceStatus === "materialized"
          ? yield* fingerprintExtensionSource({
              extensionId: registry.extensionId,
              root: path.resolve(
                roots.extensionsRoot,
                "sources",
                registry.category === "builtin" ? "builtin" : "user",
                registry.extensionId,
              ),
              declaredFiles: sourceFingerprintInputs(registry),
            }).pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catch((cause) => Effect.succeed({ ok: false as const, cause })),
            )
          : null;
      if (fingerprintResult && !fingerprintResult.ok) {
        observations.push({
          extensionId: registry.extensionId,
          category: registry.category,
          buildRequirement: registry.buildRequirement,
          sourceStatus: "invalid",
          sourceFingerprint: null,
          currentBuildStatus: registry.buildRequirement === "required" ? "invalid" : "not-required",
          currentBuild: null,
          buildRequired: registry.buildRequirement === "required",
          diagnostics: [fingerprintResult.cause.message],
        });
        continue;
      }
      const canonicalSourceFingerprint = fingerprintResult?.ok ? fingerprintResult.value : null;
      if (registry.buildRequirement === "not-required") {
        observations.push({
          extensionId: registry.extensionId,
          category: registry.category,
          buildRequirement: "not-required",
          sourceStatus,
          sourceFingerprint: canonicalSourceFingerprint,
          currentBuildStatus: "not-required",
          currentBuild: null,
          buildRequired: false,
          diagnostics: [],
        });
        continue;
      }
      if (sourceStatus !== "materialized") {
        observations.push({
          extensionId: registry.extensionId,
          category: registry.category,
          buildRequirement: "required",
          sourceStatus,
          sourceFingerprint: null,
          currentBuildStatus: "missing",
          currentBuild: null,
          buildRequired: true,
          diagnostics: ["Required extension source must be materialized before build."],
        });
        continue;
      }

      const sourceFingerprint = canonicalSourceFingerprint!;
      const currentRoot = path.resolve(buildsRoot, registry.extensionId, "current");
      const manifestPath = path.resolve(currentRoot, "manifest.json");
      const inspected = yield* inspectCurrentBuild({
        fs,
        path,
        currentRoot,
        manifestPath,
        extensionId: registry.extensionId,
        interfaceKind: registry.interfaceKind,
        sourceFingerprint,
      }).pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            status: "invalid" as const,
            manifest: null,
            diagnostics: [cause.message],
          }),
        ),
      );
      observations.push({
        extensionId: registry.extensionId,
        category: registry.category,
        buildRequirement: "required",
        sourceStatus: "materialized",
        sourceFingerprint,
        currentBuildStatus: inspected.status,
        currentBuild: inspected.manifest,
        buildRequired: inspected.status !== "current",
        diagnostics: inspected.diagnostics,
      });
    }

    return {
      registryAggregateFingerprint: input.registryObservation.aggregateFingerprint,
      observations,
    };
  });
}

function sourceFingerprintInputs(
  registry: ObserveExtensionSourceBuildsInput["registryObservation"]["observations"][number],
) {
  const inputs: {
    role: "manifest" | "minimal-instruction" | "full-instruction" | "generator-script";
    relativePath: string;
  }[] = [
    { role: "manifest", relativePath: "manifest.json" },
    { role: "minimal-instruction", relativePath: "instructions/minimal.mdx" },
  ];
  for (const contributor of registry.contributors) {
    if (contributor.kind === "instruction") {
      inputs.push({
        role: "full-instruction",
        relativePath: `instructions/full/${contributor.name}`,
      });
    } else if (contributor.kind === "script") {
      inputs.push({ role: "generator-script", relativePath: contributor.name });
    }
  }
  return inputs;
}

function inspectCurrentBuild(input: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly currentRoot: string;
  readonly manifestPath: string;
  readonly extensionId: string;
  readonly interfaceKind: "instructions" | "native_tool" | "svvyx";
  readonly sourceFingerprint: ExtensionSourceFingerprint;
}): Effect.Effect<
  {
    status: "current" | "missing" | "stale" | "invalid";
    manifest: ExtensionCurrentBuildManifest | null;
    diagnostics: readonly string[];
  },
  ExtensionError,
  Crypto.Crypto
> {
  return Effect.gen(function* () {
    if (!(yield* fileExists(input.fs, input.manifestPath, input.extensionId))) {
      return { status: "missing" as const, manifest: null, diagnostics: [] };
    }
    yield* assertContained(input.path, input.currentRoot, input.manifestPath, input.extensionId);
    const manifestText = yield* readFileString(input.fs, input.manifestPath, input.extensionId);
    const decoded = yield* Effect.try({
      try: () => JSON.parse(manifestText) as unknown,
      catch: (cause) =>
        invalid(input.extensionId, "Current build manifest is not valid JSON.", cause),
    });
    const manifest = yield* decodeUnknownExtensionCurrentBuildManifestEffect(decoded).pipe(
      Effect.mapError((cause) =>
        invalid(input.extensionId, "Current build manifest does not match its schema.", cause),
      ),
    );
    if (
      manifest.extensionId !== input.extensionId ||
      manifest.interfaceKind !== input.interfaceKind
    ) {
      return {
        status: "invalid" as const,
        manifest,
        diagnostics: ["Current build manifest identity does not match the registry."],
      };
    }
    if (manifest.sourceFingerprint !== input.sourceFingerprint) {
      return {
        status: "stale" as const,
        manifest,
        diagnostics: ["Current build source fingerprint is stale."],
      };
    }
    const evidence = manifest.generatedFiles.toSorted((left, right) =>
      `${left.role}\0${left.relativePath}`.localeCompare(`${right.role}\0${right.relativePath}`),
    );
    if (new Set(evidence.map((file) => file.relativePath)).size !== evidence.length) {
      return {
        status: "invalid" as const,
        manifest,
        diagnostics: ["Current build manifest contains duplicate generated file paths."],
      };
    }
    for (const file of evidence) {
      if (!isCanonicalRelativePath(file.relativePath)) {
        return {
          status: "invalid" as const,
          manifest,
          diagnostics: [`Generated file path is not canonical: ${file.relativePath}`],
        };
      }
      const generatedPath = input.path.resolve(input.currentRoot, file.relativePath);
      yield* assertContained(input.path, input.currentRoot, generatedPath, input.extensionId);
      if (!(yield* fileExists(input.fs, generatedPath, input.extensionId))) {
        return {
          status: "invalid" as const,
          manifest,
          diagnostics: [`Generated file is missing: ${file.relativePath}`],
        };
      }
      const bytes = yield* readFile(input.fs, generatedPath, input.extensionId);
      if (bytes.byteLength !== file.byteSize || (yield* sha256(bytes)) !== file.contentHash) {
        return {
          status: "invalid" as const,
          manifest,
          diagnostics: [`Generated file evidence does not match: ${file.relativePath}`],
        };
      }
    }
    const outputFingerprint = yield* fingerprintEvidence("svvy-extension-output-v1", evidence);
    const contextFingerprint = yield* fingerprintEvidence(
      "svvy-extension-context-v1",
      evidence.filter((file) => actorFacingRoles.has(file.role)),
    );
    const expectedBuildId = `extension-build:${input.extensionId}:${outputFingerprint.slice("sha256:".length)}`;
    if (
      manifest.outputFingerprint !== outputFingerprint ||
      manifest.contextFingerprint !== contextFingerprint ||
      manifest.buildId !== expectedBuildId
    ) {
      return {
        status: "invalid" as const,
        manifest,
        diagnostics: ["Current build aggregate evidence does not match its generated files."],
      };
    }
    return { status: "current" as const, manifest, diagnostics: [] };
  });
}

function fingerprintEvidence(
  domain: string,
  files: readonly ExtensionBuildFileEvidence[],
): Effect.Effect<
  ExtensionBuildOutputFingerprint | ExtensionContextFingerprint,
  ExtensionError,
  Crypto.Crypto
> {
  const framed = [
    domain,
    ...files.flatMap((file) => [file.role, file.relativePath, file.contentHash]),
  ]
    .map((part) => `${new TextEncoder().encode(part).byteLength}:${part}`)
    .join("");
  return Effect.map(
    sha256(new TextEncoder().encode(framed)),
    (value) => value as ExtensionBuildOutputFingerprint | ExtensionContextFingerprint,
  );
}

function isCanonicalRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function assertContained(
  path: Path.Path,
  root: string,
  candidate: string,
  extensionId: string,
): Effect.Effect<void, ExtensionError> {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot)
    ? Effect.void
    : Effect.fail(invalid(extensionId, `Current build path escapes its root: ${candidate}`));
}

function fileExists(fs: FileSystem.FileSystem, path: string, extensionId: string) {
  return fs.exists(path).pipe(
    Effect.mapError((cause) =>
      invalid(extensionId, `Failed to inspect current build path: ${path}`, cause),
    ),
    Effect.flatMap((exists) =>
      exists
        ? fs.stat(path).pipe(
            Effect.map((stat) => stat.type === "File"),
            Effect.mapError((cause) =>
              invalid(extensionId, `Failed to stat current build path: ${path}`, cause),
            ),
          )
        : Effect.succeed(false),
    ),
  );
}

function readFileString(fs: FileSystem.FileSystem, path: string, extensionId: string) {
  return fs
    .readFileString(path)
    .pipe(
      Effect.mapError((cause) =>
        invalid(extensionId, `Failed to read current build file: ${path}`, cause),
      ),
    );
}

function readFile(fs: FileSystem.FileSystem, path: string, extensionId: string) {
  return fs
    .readFile(path)
    .pipe(
      Effect.mapError((cause) =>
        invalid(extensionId, `Failed to read current build file: ${path}`, cause),
      ),
    );
}

function sha256(bytes: Uint8Array): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const digest = yield* crypto
      .digest("SHA-256", bytes)
      .pipe(
        Effect.mapError((cause) =>
          invalid(undefined, "Failed to hash current build evidence.", cause),
        ),
      );
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}

function invalid(
  extensionId: string | undefined,
  message: string,
  cause?: unknown,
): ExtensionError {
  return new ExtensionError({
    ...(extensionId ? { extensionId } : {}),
    operation,
    reason: "invalid-input",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
