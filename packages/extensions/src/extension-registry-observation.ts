import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type ExtensionDependencyDeclarationObservation,
  type ExtensionCliDeclaration,
  type ExtensionEnvDeclarationObservation,
  ExtensionError,
  type ExtensionId,
  type ExtensionInterfaceKind,
  type ExtensionRegistryContributorObservation,
  type ExtensionRegistryObservation,
  type ExtensionRegistryObservationResult,
  type ExtensionRegistryToolingObservation,
  type OpenExtensionSourceEditInput,
} from "@svvy/core";

import {
  BUILTIN_EXTENSIONS,
  builtinExtensionRegistryUsagePolicy,
  type ExtensionRecord,
  userExtensionRegistryUsagePolicy,
} from "./extension-records";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { fingerprintExtensionSource } from "./extension-source-fingerprint";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import { extensionOwnedSourceId } from "./source-edit-sessions";
import {
  APP_NATIVE_SVVYX_METADATA,
  appNativeSvvyxMetadataFingerprintInput,
} from "./svvyx-build-metadata";

const operation = "extensions.registry.observe";
const extensionIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const interfaceKinds = new Set<ExtensionInterfaceKind>(["instructions", "native_tool", "svvyx"]);

type ManifestInstruction = { readonly file: string; readonly bypassed: boolean };
type ManifestGeneratedInstruction = {
  readonly output: string;
  readonly script: string;
  readonly versionCliRequirementId: string | null;
};
type ParsedCliDeclaration = Omit<ExtensionCliDeclaration, "requirementFingerprint">;
type ParsedManifest = {
  readonly id: string;
  readonly interfaceKind: ExtensionInterfaceKind;
  readonly title: string;
  readonly description: string;
  readonly typescriptApiEnabled: boolean;
  readonly instructionFiles: readonly ManifestInstruction[];
  readonly generatedInstructions: readonly ManifestGeneratedInstruction[];
  readonly cliDeclarations: readonly ParsedCliDeclaration[];
  readonly envDeclarations: readonly ExtensionEnvDeclarationObservation[];
  readonly dependencyDeclarations: readonly ExtensionDependencyDeclarationObservation[];
};

export type ExtensionRegistryObservationServices =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort;

export function observeExtensionRegistry(): Effect.Effect<
  ExtensionRegistryObservationResult,
  ExtensionError,
  ExtensionRegistryObservationServices
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const packagedRoots = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const extensionsRoot = path.resolve(roots.extensionsRoot);
    const builtinEditableRoot = path.resolve(extensionsRoot, "sources", "builtin");
    const userRoot = path.resolve(extensionsRoot, "sources", "user");
    const packagedBuiltinRoot = path.resolve(packagedRoots.builtinExtensionsRoot);

    const observations: ExtensionRegistryObservation[] = [];
    const registryDiagnostics: ExtensionRegistryObservationResult["diagnostics"][number][] = [];
    for (const builtin of BUILTIN_EXTENSIONS) {
      const usagePolicy = builtinExtensionRegistryUsagePolicy(builtin.id);
      const editableRoot = path.resolve(builtinEditableRoot, builtin.id);
      const packagedRoot = path.resolve(packagedBuiltinRoot, builtin.id);
      const editableManifest = path.resolve(editableRoot, "manifest.json");
      const packagedManifest = path.resolve(packagedRoot, "manifest.json");
      const packaged = (yield* existsFile(fs, packagedManifest, builtin.id))
        ? yield* observeManifestExtension({
            fs,
            path,
            category: "builtin",
            expectedId: builtin.id,
            root: packagedRoot,
            manifestPath: packagedManifest,
            customized: false,
            materialized: false,
            builtin,
            usagePolicy,
          })
        : yield* observeBuiltinFallback(builtin, usagePolicy);
      if (!(yield* existsFile(fs, packagedManifest, builtin.id))) {
        registryDiagnostics.push({
          severity: "warning",
          code: "extension.registry.packaged-template-missing",
          message: `Packaged builtin template metadata is unavailable: ${builtin.id}`,
        });
      }
      if (yield* existsFile(fs, editableManifest, builtin.id)) {
        const live = yield* observeManifestExtension({
          fs,
          path,
          category: "builtin",
          expectedId: builtin.id,
          root: editableRoot,
          manifestPath: editableManifest,
          customized: false,
          materialized: true,
          builtin,
          usagePolicy,
        });
        observations.push({
          ...live,
          customized: live.sourceFingerprint !== packaged.sourceFingerprint,
        });
      } else {
        observations.push(packaged);
      }
    }

    const userDirectories = yield* readDirectoryNames(fs, userRoot, "user extension root");
    for (const [userIndex, directory] of userDirectories.toSorted().entries()) {
      validateExtensionId(directory);
      if (BUILTIN_EXTENSIONS.some((builtin) => builtin.id === directory)) {
        return yield* fail(directory, `User extension id collides with a builtin: ${directory}`);
      }
      const sourceRoot = path.resolve(userRoot, directory);
      yield* assertContained(path, userRoot, sourceRoot, directory);
      const stat = yield* statPath(fs, sourceRoot, directory);
      if (stat.type === "SymbolicLink") {
        return yield* fail(
          directory,
          `User extension source cannot be a symbolic link: ${directory}`,
        );
      }
      if (stat.type !== "Directory") continue;
      const manifestPath = path.resolve(sourceRoot, "manifest.json");
      if (!(yield* existsFile(fs, manifestPath, directory))) {
        return yield* fail(directory, `User extension manifest is missing: ${directory}`);
      }
      observations.push(
        yield* observeManifestExtension({
          fs,
          path,
          category: "user",
          expectedId: directory,
          root: sourceRoot,
          manifestPath,
          customized: true,
          materialized: true,
          usagePolicy: userExtensionRegistryUsagePolicy(BUILTIN_EXTENSIONS.length + userIndex),
        }),
      );
    }

    observations.sort((left, right) => left.extensionId.localeCompare(right.extensionId));
    if (new Set(observations.map((entry) => entry.extensionId)).size !== observations.length) {
      return yield* fail(undefined, "Extension registry observation contains duplicate ids.");
    }
    yield* Effect.try({
      try: () => observations.forEach(validateUniqueSourceReferences),
      catch: (cause) =>
        cause instanceof ExtensionError
          ? cause
          : new ExtensionError({
              operation,
              reason: "invalid-input",
              message: "Extension registry source-reference validation failed.",
              cause,
            }),
    });
    const aggregateFingerprint = yield* sha256(JSON.stringify(observations));
    return { aggregateFingerprint, observations, diagnostics: registryDiagnostics };
  });
}

function observeBuiltinFallback(
  builtin: ExtensionRecord,
  usagePolicy: ReturnType<typeof builtinExtensionRegistryUsagePolicy>,
): Effect.Effect<ExtensionRegistryObservation, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const appNative = APP_NATIVE_SVVYX_METADATA.get(builtin.id);
    const metadataFingerprint = appNative
      ? yield* sha256(appNativeSvvyxMetadataFingerprintInput(appNative))
      : null;
    const sourceKind = "builtin-extension" as const;
    const contributors: ExtensionRegistryContributorObservation[] = [
      contributor(sourceKind, builtin.id, "minimal", "minimal.mdx", false, true, !appNative),
    ];
    const observation = observationFromParts({
      extensionId: builtin.id as ExtensionId,
      category: "builtin",
      interfaceKind: builtin.interface,
      svvyxImplementation: appNative
        ? {
            kind: "app-native" as const,
            namespace: appNative.namespace,
            metadataFingerprint: metadataFingerprint!,
          }
        : builtin.interface === "svvyx"
          ? { kind: "source-runtime" as const, sourceRelativePath: "source/index.ts" as const }
          : null,
      usagePolicy,
      buildRequirement: extensionBuildRequirement({
        interfaceKind: builtin.interface,
        generatedInstructionCount: builtin.generatedInstructions?.length ?? 0,
        typescriptApiEnabled: builtin.typescriptApiEnabled,
      }),
      title: builtin.title,
      description: builtin.description,
      customized: false,
      materializationPlan: appNative
        ? null
        : {
            kind: "scaffold-builtin" as const,
            extensionId: builtin.id as ExtensionId,
          },
      capabilities: {
        typescriptApiEnabled: builtin.typescriptApiEnabled,
        resettable: true,
        deletable: false,
        materializationRequired: !appNative,
      },
      contributors,
      tooling: toolingObservations(
        "builtin-extension",
        builtin.id,
        builtin.interface,
        builtin.typescriptApiEnabled,
        false,
        Boolean(appNative),
      ),
      cliDeclarations: yield* fingerprintCliDeclarations(
        builtin.id,
        (builtin.cliRequirements ?? []).map((item) => ({
          id: item.id,
          binary: item.binary,
          package: item.package ?? null,
          required: item.required,
          defaultVersion: item.version ?? null,
          versionCommand: item.versionCommand?.trim() || null,
          installCommand: item.installCommand ?? null,
          nodeRequirement: item.nodeRequirement ?? null,
        })),
      ),
      envDeclarations: [],
      dependencyDeclarations: [],
      sourceFingerprint: "pending",
    });
    return {
      ...observation,
      sourceFingerprint: yield* sha256(JSON.stringify(observation)),
    };
  });
}

function observeManifestExtension(input: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly category: "builtin" | "user";
  readonly expectedId: string;
  readonly root: string;
  readonly manifestPath: string;
  readonly customized: boolean;
  readonly materialized: boolean;
  readonly builtin?: ExtensionRecord;
  readonly usagePolicy: ReturnType<typeof userExtensionRegistryUsagePolicy>;
}): Effect.Effect<ExtensionRegistryObservation, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    yield* assertContained(
      input.path,
      input.path.dirname(input.manifestPath),
      input.manifestPath,
      input.expectedId,
    );
    yield* assertNoSymlinkChain(
      input.fs,
      input.path,
      input.root,
      input.manifestPath,
      input.expectedId,
    );
    const manifestText = yield* readFile(input.fs, input.manifestPath, input.expectedId);
    const manifest = yield* Effect.try({
      try: () => parseManifest(manifestText, input.expectedId, input.builtin),
      catch: (cause) =>
        cause instanceof ExtensionError
          ? cause
          : manifestError(input.expectedId, "Extension manifest validation failed.", cause),
    });
    const sourceKind = input.category === "builtin" ? "builtin-extension" : "user-extension";
    const appNative =
      input.category === "builtin" ? APP_NATIVE_SVVYX_METADATA.get(manifest.id) : undefined;
    const metadataFingerprint = appNative
      ? yield* sha256(appNativeSvvyxMetadataFingerprintInput(appNative))
      : null;
    const generatedByOutput = new Map(
      manifest.generatedInstructions.map((item) => [item.output, item]),
    );
    const referencedGeneratedOutputs = new Set<string>();
    const contributors: ExtensionRegistryContributorObservation[] = [
      contributor(
        sourceKind,
        manifest.id,
        "minimal",
        "minimal.mdx",
        false,
        true,
        !input.materialized && !appNative,
      ),
    ];
    const minimalPath = input.path.resolve(input.root, "instructions", "minimal.mdx");
    if (!(yield* existsFile(input.fs, minimalPath, manifest.id))) {
      return yield* fail(manifest.id, `Extension minimal instruction is missing: ${manifest.id}`);
    }
    yield* assertNoSymlinkChain(input.fs, input.path, input.root, minimalPath, manifest.id);

    for (const entry of manifest.instructionFiles) {
      const relative = `instructions/full/${entry.file}`;
      const sourcePath = input.path.resolve(input.root, relative);
      yield* assertContained(input.path, input.root, sourcePath, manifest.id);
      if (!(yield* existsFile(input.fs, sourcePath, manifest.id))) {
        return yield* fail(manifest.id, `Referenced instruction file is missing: ${entry.file}`);
      }
      yield* assertNoSymlinkChain(input.fs, input.path, input.root, sourcePath, manifest.id);
      const generated = generatedByOutput.get(relative);
      if (generated) {
        referencedGeneratedOutputs.add(relative);
        const scriptPath = input.path.resolve(input.root, generated.script);
        yield* assertContained(input.path, input.root, scriptPath, manifest.id);
        yield* assertNoSymlinkChain(input.fs, input.path, input.root, scriptPath, manifest.id);
        if (!(yield* existsFile(input.fs, scriptPath, manifest.id))) {
          return yield* fail(
            manifest.id,
            `Generated instruction script is missing: ${generated.script}`,
          );
        }
        contributors.push(
          contributor(
            sourceKind,
            manifest.id,
            "script",
            generated.script,
            entry.bypassed,
            true,
            !input.materialized,
            generated.versionCliRequirementId,
          ),
          contributor(
            sourceKind,
            manifest.id,
            "generated-instruction",
            generated.output,
            entry.bypassed,
            false,
            !input.materialized,
          ),
        );
      } else {
        contributors.push(
          contributor(
            sourceKind,
            manifest.id,
            "instruction",
            entry.file,
            entry.bypassed,
            true,
            !input.materialized,
          ),
        );
      }
    }
    for (const entry of manifest.generatedInstructions) {
      const outputPath = input.path.resolve(input.root, entry.output);
      yield* assertContained(input.path, input.root, outputPath, manifest.id);
      if (!referencedGeneratedOutputs.has(entry.output)) {
        return yield* fail(
          manifest.id,
          `Generated instruction output is not ordered by instructionFiles: ${entry.output}`,
        );
      }
      if (yield* existsFile(input.fs, outputPath, manifest.id))
        yield* assertNoSymlinkChain(input.fs, input.path, input.root, outputPath, manifest.id);
    }

    const editableSourceRoot = input.path.resolve(input.root, "source");
    if (manifest.interfaceKind === "svvyx" && !appNative) {
      const commandSource = input.path.resolve(editableSourceRoot, "index.ts");
      yield* assertContained(input.path, input.root, commandSource, manifest.id);
      if (!(yield* existsFile(input.fs, commandSource, manifest.id))) {
        return yield* fail(
          manifest.id,
          `svvyx extension is missing source/index.ts: ${manifest.id}`,
        );
      }
      yield* assertNoSymlinkChain(input.fs, input.path, input.root, commandSource, manifest.id);
    }
    return observationFromParts({
      extensionId: manifest.id as ExtensionId,
      category: input.category,
      interfaceKind: manifest.interfaceKind,
      svvyxImplementation: appNative
        ? {
            kind: "app-native" as const,
            namespace: appNative.namespace,
            metadataFingerprint: metadataFingerprint!,
          }
        : manifest.interfaceKind === "svvyx"
          ? { kind: "source-runtime" as const, sourceRelativePath: "source/index.ts" as const }
          : null,
      usagePolicy: input.usagePolicy,
      buildRequirement: extensionBuildRequirement({
        interfaceKind: manifest.interfaceKind,
        generatedInstructionCount: manifest.generatedInstructions.length,
        typescriptApiEnabled: manifest.typescriptApiEnabled,
      }),
      title: manifest.title,
      description: manifest.description,
      customized: input.customized,
      materializationPlan:
        input.category === "builtin" && !input.materialized && !appNative
          ? {
              kind: "scaffold-builtin" as const,
              extensionId: manifest.id as ExtensionId,
            }
          : null,
      capabilities: {
        typescriptApiEnabled: manifest.typescriptApiEnabled,
        resettable: input.category === "builtin",
        deletable: input.category === "user",
        materializationRequired: !input.materialized && !appNative,
      },
      contributors,
      tooling: toolingObservations(
        sourceKind,
        manifest.id,
        manifest.interfaceKind,
        manifest.typescriptApiEnabled,
        input.materialized,
        Boolean(appNative),
      ),
      cliDeclarations: yield* fingerprintCliDeclarations(manifest.id, manifest.cliDeclarations),
      envDeclarations: manifest.envDeclarations,
      dependencyDeclarations: manifest.dependencyDeclarations,
      sourceFingerprint: yield* fingerprintExtensionSource({
        extensionId: manifest.id,
        root: input.root,
        declaredFiles: [
          { role: "manifest", relativePath: "manifest.json" },
          { role: "minimal-instruction", relativePath: "instructions/minimal.mdx" },
          ...manifest.instructionFiles.flatMap((entry) => {
            const relativePath = `instructions/full/${entry.file}`;
            return generatedByOutput.has(relativePath)
              ? []
              : [{ role: "full-instruction" as const, relativePath }];
          }),
          ...manifest.generatedInstructions.map((entry) => ({
            role: "generator-script" as const,
            relativePath: entry.script,
          })),
        ],
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, input.fs),
        Effect.provideService(Path.Path, input.path),
      ),
    });
  });
}

function observationFromParts(
  input: Omit<ExtensionRegistryObservation, "diagnostics">,
): ExtensionRegistryObservation {
  return { ...input, diagnostics: [] };
}

function extensionBuildRequirement(input: {
  readonly interfaceKind: ExtensionInterfaceKind;
  readonly generatedInstructionCount: number;
  readonly typescriptApiEnabled: boolean;
}): "required" | "not-required" {
  return input.interfaceKind === "svvyx" ||
    input.generatedInstructionCount > 0 ||
    input.typescriptApiEnabled
    ? "required"
    : "not-required";
}

function contributor(
  sourceKind: "builtin-extension" | "user-extension",
  extensionId: string,
  kind: ExtensionRegistryContributorObservation["kind"],
  name: string,
  bypassed: boolean,
  editable: boolean,
  requiresMaterialization: boolean,
  versionCliRequirementId: string | null = null,
): ExtensionRegistryContributorObservation {
  const address =
    kind === "minimal"
      ? ({ kind } as const)
      : kind === "instruction"
        ? ({ kind, name } as const)
        : kind === "script"
          ? ({ kind, relativePath: name } as const)
          : ({ kind, relativePath: name } as const);
  return {
    kind,
    name,
    bypassed,
    editable,
    openable: !requiresMaterialization,
    requiresMaterialization,
    ...(kind === "script" ? { versionCliRequirementId } : {}),
    source: { sourceKind, sourceId: extensionOwnedSourceId(extensionId, address) },
  };
}

function toolingObservations(
  sourceKind: "builtin-extension" | "user-extension",
  extensionId: string,
  interfaceKind: ExtensionInterfaceKind,
  typescriptApiEnabled: boolean,
  materialized: boolean,
  appNative: boolean,
): ExtensionRegistryToolingObservation[] {
  const source = (
    kind: "svvyx-source" | "command-schema" | "native-tool-schema" | "typescript-api-declaration",
  ): OpenExtensionSourceEditInput => ({
    sourceKind,
    sourceId: extensionOwnedSourceId(extensionId, { kind }),
  });
  const result: ExtensionRegistryToolingObservation[] = [];
  if (interfaceKind === "svvyx" && !appNative) {
    result.push(
      materialized
        ? {
            kind: "svvyx-source",
            name: "source/index.ts",
            openable: true,
            requiresMaterialization: false,
            source: source("svvyx-source"),
          }
        : {
            kind: "svvyx-source",
            name: "source/index.ts",
            openable: false,
            requiresMaterialization: true,
            source: source("svvyx-source"),
          },
    );
  }
  if (interfaceKind === "svvyx") {
    result.push({
      kind: "command-schema",
      name: "commands.json",
      openable: false,
      requiresMaterialization: false,
      source: source("command-schema"),
    });
  }
  if (interfaceKind === "native_tool") {
    result.push({
      kind: "native-tool-schema",
      name: "native-tool-schema.json",
      openable: false,
      requiresMaterialization: false,
      source: source("native-tool-schema"),
    });
  }
  if (typescriptApiEnabled) {
    result.push({
      kind: "typescript-api-declaration",
      name: "index.d.ts",
      openable: false,
      requiresMaterialization: false,
      source: source("typescript-api-declaration"),
    });
  }
  return result;
}

function parseManifest(
  text: string,
  expectedId: string,
  builtin?: ExtensionRecord,
): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw manifestError(expectedId, "Extension manifest is not valid JSON.", cause);
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || value.id !== expectedId) {
    throw manifestError(expectedId, "Extension manifest schemaVersion/id is invalid.");
  }
  const interfaceKind = builtin?.interface ?? value.interface;
  if (
    typeof interfaceKind !== "string" ||
    !interfaceKinds.has(interfaceKind as ExtensionInterfaceKind)
  ) {
    throw manifestError(expectedId, "Extension manifest interface is invalid.");
  }
  const title = nonBlankString(value.title, builtin?.title);
  const description = nonBlankString(value.description, builtin?.description);
  if (!title || !description)
    throw manifestError(expectedId, "Extension manifest title/description is invalid.");
  const typescriptApiEnabled =
    typeof value.typescriptApiEnabled === "boolean"
      ? value.typescriptApiEnabled
      : (builtin?.typescriptApiEnabled ?? false);
  if (typescriptApiEnabled && interfaceKind !== "svvyx") {
    throw manifestError(expectedId, "typescriptApiEnabled requires a svvyx interface.");
  }
  const cliDeclarations = parseCliDeclarations(
    value.cliRequirements ?? builtin?.cliRequirements,
    expectedId,
  );
  const generatedInstructions = parseGeneratedInstructions(
    value.generatedInstructions ?? builtin?.generatedInstructions,
    expectedId,
  );
  const cliRequirementIds = new Set(cliDeclarations.map((item) => item.id));
  for (const generated of generatedInstructions) {
    if (
      generated.versionCliRequirementId !== null &&
      !cliRequirementIds.has(generated.versionCliRequirementId)
    ) {
      throw manifestError(
        expectedId,
        `Generated instruction references unknown CLI requirement: ${generated.versionCliRequirementId}`,
      );
    }
  }
  return {
    id: expectedId,
    interfaceKind: interfaceKind as ExtensionInterfaceKind,
    title,
    description,
    typescriptApiEnabled,
    instructionFiles: parseInstructionFiles(
      value.instructionFiles ?? builtin?.instructionFiles,
      expectedId,
    ),
    generatedInstructions,
    cliDeclarations,
    envDeclarations: parseEnvDeclarations(value.env, expectedId),
    dependencyDeclarations: [
      ...parseDependencies(value.dependencies, "dependency", expectedId),
      ...parseDependencies(value.trustedDependencies, "trusted_dependency", expectedId),
    ],
  };
}

function parseInstructionFiles(value: unknown, id: string): ManifestInstruction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw manifestError(id, "instructionFiles must be an array.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.file !== "string" ||
      typeof item.bypassed !== "boolean" ||
      !isInstructionName(item.file)
    ) {
      throw manifestError(id, "instructionFiles contains an invalid entry.");
    }
    const key = item.file.toLocaleLowerCase();
    if (seen.has(key)) throw manifestError(id, `Duplicate instruction file: ${item.file}`);
    seen.add(key);
    return { file: item.file, bypassed: item.bypassed };
  });
}

function parseGeneratedInstructions(value: unknown, id: string): ManifestGeneratedInstruction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw manifestError(id, "generatedInstructions must be an array.");
  const outputs = new Set<string>();
  const scripts = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.script !== "string" ||
      typeof item.output !== "string" ||
      !canonicalRelative(item.script) ||
      !canonicalRelative(item.output) ||
      !item.script.startsWith("scripts/") ||
      !item.script.endsWith(".ts") ||
      !item.output.startsWith("instructions/full/") ||
      !item.output.endsWith(".md") ||
      (item.versionCliRequirementId !== undefined &&
        (typeof item.versionCliRequirementId !== "string" ||
          item.versionCliRequirementId.trim().length === 0))
    ) {
      throw manifestError(id, "generatedInstructions contains an invalid entry.");
    }
    if (outputs.has(item.output))
      throw manifestError(id, `Duplicate generated output: ${item.output}`);
    if (scripts.has(item.script))
      throw manifestError(id, `Duplicate generated script source: ${item.script}`);
    outputs.add(item.output);
    scripts.add(item.script);
    return {
      script: item.script,
      output: item.output,
      versionCliRequirementId:
        typeof item.versionCliRequirementId === "string"
          ? item.versionCliRequirementId.trim()
          : null,
    };
  });
}

function parseCliDeclarations(value: unknown, id: string): ParsedCliDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw manifestError(id, "cliRequirements must be an array.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !nonBlankString(item.id) ||
      !nonBlankString(item.binary) ||
      typeof item.required !== "boolean"
    ) {
      throw manifestError(id, "cliRequirements contains an invalid entry.");
    }
    if (seen.has(item.id as string))
      throw manifestError(id, `Duplicate CLI requirement: ${item.id}`);
    seen.add(item.id as string);
    const packageName = nullableString(item.package, id, "CLI package");
    const defaultVersion = nullableString(item.version, id, "CLI version");
    const versionCommand = nullableString(item.versionCommand, id, "CLI versionCommand");
    const installCommand = nullableString(item.installCommand, id, "CLI installCommand");
    const nodeRequirement = nullableString(item.nodeRequirement, id, "CLI nodeRequirement");
    if (installCommand?.includes("{{version}}") && !defaultVersion) {
      throw manifestError(id, `CLI installCommand requires a default version: ${item.id}`);
    }
    return {
      id: item.id as string,
      binary: item.binary as string,
      package: packageName,
      required: item.required,
      defaultVersion,
      versionCommand,
      installCommand,
      nodeRequirement,
    };
  });
}

function fingerprintCliDeclarations(
  extensionId: string,
  declarations: readonly ParsedCliDeclaration[],
): Effect.Effect<ExtensionCliDeclaration[], ExtensionError, Crypto.Crypto> {
  return Effect.forEach(declarations, (declaration) =>
    sha256(
      JSON.stringify({
        extensionId,
        declaration,
      }),
    ).pipe(Effect.map((requirementFingerprint) => ({ ...declaration, requirementFingerprint }))),
  );
}

function parseEnvDeclarations(value: unknown, id: string): ExtensionEnvDeclarationObservation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw manifestError(id, "env must be an array.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !/^[A-Z_][A-Z0-9_]*$/.test(item.name) ||
      typeof item.required !== "boolean" ||
      typeof item.secret !== "boolean" ||
      !nonBlankString(item.description)
    ) {
      throw manifestError(id, "env contains an invalid declaration.");
    }
    if (item.default !== undefined && typeof item.default !== "string")
      throw manifestError(id, `Invalid env default: ${item.name}`);
    if (item.secret && item.default !== undefined)
      throw manifestError(id, `Secret env declarations cannot contain defaults: ${item.name}`);
    if (seen.has(item.name)) throw manifestError(id, `Duplicate env declaration: ${item.name}`);
    seen.add(item.name);
    return {
      name: item.name,
      required: item.required,
      secret: item.secret,
      description: item.description as string,
      hasDefault: item.default !== undefined,
    };
  });
}

function parseDependencies(
  value: unknown,
  kind: "dependency" | "trusted_dependency",
  id: string,
): ExtensionDependencyDeclarationObservation[] {
  if (value === undefined) return [];
  if (!isRecord(value)) throw manifestError(id, `${kind} declarations must be an object.`);
  return Object.entries(value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => {
      if (!nonBlankString(name) || !nonBlankString(version))
        throw manifestError(id, `Invalid ${kind} declaration: ${name}`);
      return {
        kind,
        packageManager: "bun",
        source: "npm",
        name,
        version: version as string,
        integrity: null,
        resolution: null,
      };
    });
}

function validateExtensionId(id: string): void {
  if (!extensionIdPattern.test(id) || id.includes("#"))
    throw manifestError(id, `Invalid extension id: ${id}`);
}

function validateUniqueSourceReferences(observation: ExtensionRegistryObservation): void {
  const refs = [
    ...observation.contributors.flatMap((item) =>
      item.source ? [`${item.source.sourceKind}:${item.source.sourceId}`] : [],
    ),
    ...observation.tooling.flatMap((item) =>
      item.source ? [`${item.source.sourceKind}:${item.source.sourceId}`] : [],
    ),
  ];
  if (new Set(refs).size !== refs.length) {
    throw manifestError(
      observation.extensionId,
      "Extension observation contains duplicate source references.",
    );
  }
}

function canonicalRelative(value: string): boolean {
  return (
    !!value &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => !!part && part !== "." && part !== "..")
  );
}

function isInstructionName(value: string): boolean {
  return (
    (value.endsWith(".md") || value.endsWith(".mdx")) &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    value.trim() === value &&
    value !== ".md" &&
    value !== ".mdx"
  );
}

function nonBlankString(value: unknown, fallback?: string): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback?.trim() || null;
}

function nullableString(value: unknown, id: string, label: string): string | null {
  if (value === undefined) return null;
  const result = nonBlankString(value);
  if (!result) throw manifestError(id, `${label} must be a non-empty string.`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function manifestError(id: string, message: string, cause?: unknown): ExtensionError {
  return new ExtensionError({
    extensionId: id,
    operation,
    reason: "invalid-input",
    message,
    cause,
  });
}

function fail(id: string | undefined, message: string): Effect.Effect<never, ExtensionError> {
  return Effect.fail(
    new ExtensionError({
      ...(id ? { extensionId: id } : {}),
      operation,
      reason: "invalid-input",
      message,
    }),
  );
}

function readDirectoryNames(
  fs: FileSystem.FileSystem,
  root: string,
  label: string,
): Effect.Effect<string[], ExtensionError> {
  return Effect.gen(function* () {
    if (!(yield* existsPath(fs, root, label))) return [];
    const stat = yield* statPath(fs, root, label);
    if (stat.type !== "Directory") return yield* fail(undefined, `${label} is not a directory.`);
    return yield* fs.readDirectory(root).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionError({
            operation,
            reason: "execution-failed",
            message: `Failed to read ${label}.`,
            cause,
          }),
      ),
    );
  });
}

function existsPath(
  fs: FileSystem.FileSystem,
  path: string,
  id: string,
): Effect.Effect<boolean, ExtensionError> {
  return fs.exists(path).pipe(
    Effect.mapError(
      (cause) =>
        new ExtensionError({
          extensionId: id,
          operation,
          reason: "execution-failed",
          message: `Failed to inspect extension path: ${path}`,
          cause,
        }),
    ),
  );
}

function existsFile(
  fs: FileSystem.FileSystem,
  path: string,
  id: string,
): Effect.Effect<boolean, ExtensionError> {
  return Effect.gen(function* () {
    if (!(yield* existsPath(fs, path, id))) return false;
    return (yield* statPath(fs, path, id)).type === "File";
  });
}

function statPath(fs: FileSystem.FileSystem, path: string, id: string) {
  return fs.stat(path).pipe(
    Effect.mapError(
      (cause) =>
        new ExtensionError({
          extensionId: id,
          operation,
          reason: "execution-failed",
          message: `Failed to stat extension path: ${path}`,
          cause,
        }),
    ),
  );
}

function readFile(
  fs: FileSystem.FileSystem,
  path: string,
  id: string,
): Effect.Effect<string, ExtensionError> {
  return fs.readFileString(path).pipe(
    Effect.mapError(
      (cause) =>
        new ExtensionError({
          extensionId: id,
          operation,
          reason: "execution-failed",
          message: `Failed to read extension file: ${path}`,
          cause,
        }),
    ),
  );
}

function assertContained(
  path: Path.Path,
  root: string,
  candidate: string,
  id: string,
): Effect.Effect<void, ExtensionError> {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot)
    ? Effect.void
    : fail(id, `Extension source path escapes its root: ${candidate}`);
}

function assertNoSymlinkChain(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  candidate: string,
  id: string,
): Effect.Effect<void, ExtensionError> {
  return Effect.gen(function* () {
    yield* assertContained(path, root, candidate, id);
    let current = candidate;
    while (true) {
      const stat = yield* statPath(fs, current, id);
      if (stat.type === "SymbolicLink") {
        return yield* fail(id, `Extension source contains a symbolic-link boundary: ${current}`);
      }
      if (current === root) return;
      const parent = path.dirname(current);
      if (parent === current) {
        return yield* fail(id, `Extension source containment could not be proven: ${candidate}`);
      }
      current = parent;
    }
  });
}

function sha256(text: string): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const bytes = yield* crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionError({
            operation,
            reason: "execution-failed",
            message: "Failed to fingerprint extension registry observation.",
            cause,
          }),
      ),
    );
    return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}
