import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionError as CoreExtensionError,
  type AbsolutePath,
  type ExtensionDependencyApprovalIdentity,
  type ExtensionError,
  type GeneratedPackageDependencyEvidence,
  ExtensionStatePort,
  type GeneratedPackageBuildId,
  type IsoDateTimeString,
  type StateContractError,
} from "@svvy/core";
import { workflowTaskReferenceableBuiltinExtensionIds } from "./extension-records";
import { replaceGeneratedPackageDirectory } from "./generated-package-writer";

export const GENERATED_EXTENSIONS_PACKAGE_NAME = "@svvyx/extensions";
export const GENERATED_PACKAGE_EVIDENCE_MANIFEST = ".svvy-generated-package.json";

const currentGeneratedPackageTimestamp = Effect.map(DateTime.now, DateTime.formatIso);

export interface GeneratedExtensionReference<Id extends string = string> {
  readonly id: Id;
}

export interface GeneratedExtensionDependencyDeclaration {
  readonly kind: "dependency" | "trusted_dependency";
  readonly name: string;
  readonly version: string;
}

export type GeneratedExtensionsPackageDependencyEvidence = Extract<
  GeneratedPackageDependencyEvidence,
  { readonly kind: "package" }
>;

export interface GeneratedExtensionsPackageEvidence {
  readonly buildId: GeneratedPackageBuildId;
  readonly sourceFingerprint: string;
  readonly outputFingerprint: string;
  readonly dependencies: readonly GeneratedExtensionsPackageDependencyEvidence[];
  readonly createdAt: IsoDateTimeString;
}

export type GeneratedExtensionExportDiscoveryServices =
  | FileSystem.FileSystem
  | Path.Path
  | ExtensionStatePort;

export interface GeneratedExtensionExportIdsInput {
  extensionsRoot: AbsolutePath;
  builtinExtensionIds?: readonly string[];
}

export interface GeneratedExtensionsPackageFile {
  relativePath: "package.json" | "index.ts" | typeof GENERATED_PACKAGE_EVIDENCE_MANIFEST;
  contents: string;
}

export interface WriteGeneratedExtensionsPackageInput {
  generatedPackagePath: AbsolutePath;
  extensionExportIds: ReadonlySet<string> | readonly string[];
  dependencies?: readonly GeneratedExtensionsPackageDependencyEvidence[];
  createdAt?: IsoDateTimeString;
}

export interface WriteGeneratedExtensionsPackageResult {
  generatedPackagePath: AbsolutePath;
  extensionIds: readonly string[];
  manifestPath: AbsolutePath;
  evidence: GeneratedExtensionsPackageEvidence;
  generatedFiles: readonly {
    relativePath: string;
    path: AbsolutePath;
  }[];
}

export type GeneratedExtensionsPackageContentsInput = GeneratedExtensionExportIdsInput;

export interface GeneratedExtensionsPackageContents {
  extensionIds: readonly string[];
  dependencies: readonly GeneratedExtensionsPackageDependencyEvidence[];
  files: readonly GeneratedExtensionsPackageFile[];
  evidence: GeneratedExtensionsPackageEvidence;
}

export type GeneratedExtensionDiscoveryFileType = "Directory" | "File" | "Other";

export interface GeneratedExtensionExportDiscoveryHost {
  join(...segments: readonly string[]): string;
  readDirectory(path: string): readonly string[];
  readFileString(path: string): string | null;
  sourceFingerprint(sourceRoot: string): string | null;
  isDependencyApproved(dependency: ExtensionDependencyApprovalIdentity): boolean;
  statType(path: string): GeneratedExtensionDiscoveryFileType | null;
}

export interface RefreshGeneratedExtensionsPackageInput extends GeneratedExtensionsPackageContentsInput {
  generatedPackagePath: AbsolutePath;
}

export type RefreshGeneratedExtensionsPackageResult = WriteGeneratedExtensionsPackageResult;

export function renderGeneratedExtensionsPackageFiles(
  extensionExportIds: ReadonlySet<string> | readonly string[],
  options: {
    dependencies?: readonly GeneratedExtensionsPackageDependencyEvidence[];
    createdAt?: IsoDateTimeString;
  } = {},
): readonly GeneratedExtensionsPackageFile[] {
  const exportedIds = [...extensionExportIds].toSorted();
  const packageJson = renderGeneratedExtensionsPackageJson();
  const index = renderGeneratedExtensionsPackageIndex(exportedIds);
  const evidence = generatedExtensionsPackageEvidence({
    createdAt: options.createdAt ?? ("1970-01-01T00:00:00.000Z" as IsoDateTimeString),
    dependencies: options.dependencies ?? [],
    extensionIds: exportedIds,
    generatedFiles: [
      { relativePath: "package.json", contents: packageJson },
      { relativePath: "index.ts", contents: index },
    ],
  });
  const evidenceManifest = renderGeneratedExtensionsPackageEvidenceManifest({
    evidence,
    extensionIds: exportedIds,
    generatedFiles: ["package.json", "index.ts"],
  });
  return [
    {
      relativePath: "package.json",
      contents: packageJson,
    },
    {
      relativePath: "index.ts",
      contents: index,
    },
    {
      relativePath: GENERATED_PACKAGE_EVIDENCE_MANIFEST,
      contents: evidenceManifest,
    },
  ];
}

export function renderGeneratedExtensionsPackageJson(): string {
  return JSON.stringify(
    {
      name: GENERATED_EXTENSIONS_PACKAGE_NAME,
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    },
    null,
    2,
  );
}

export function renderGeneratedExtensionsPackageIndex(
  extensionExportIds: readonly string[],
): string {
  const references = generatedExtensionReferences([...extensionExportIds].toSorted());
  return [
    "export type ExtensionReference<Id extends string = string> = {",
    "  readonly id: Id;",
    "};",
    "",
    "export const Extensions = {",
    ...references.map(
      (reference) => `  ${JSON.stringify(reference.id)}: ${JSON.stringify(reference)},`,
    ),
    "} as const satisfies Record<string, ExtensionReference>;",
    "",
    'export type ExtensionId = (typeof Extensions)[keyof typeof Extensions]["id"];',
    "",
  ].join("\n");
}

export function renderGeneratedExtensionsPackageEvidenceManifest(input: {
  evidence: GeneratedExtensionsPackageEvidence;
  extensionIds: readonly string[];
  generatedFiles: readonly string[];
}): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      packageName: GENERATED_EXTENSIONS_PACKAGE_NAME,
      buildId: input.evidence.buildId,
      sourceFingerprint: input.evidence.sourceFingerprint,
      outputFingerprint: input.evidence.outputFingerprint,
      dependencies: input.evidence.dependencies,
      createdAt: input.evidence.createdAt,
      extensionIds: [...input.extensionIds].toSorted(),
      generatedFiles: [...input.generatedFiles],
    },
    null,
    2,
  );
}

export function generatedExtensionReferences(
  extensionIds: readonly string[],
): readonly GeneratedExtensionReference[] {
  return extensionIds.map((id) => ({ id }));
}

export function generatedExtensionReferenceExpression(extensionId: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(extensionId)) {
    return `Extensions.${extensionId}.id`;
  }
  return `Extensions[${JSON.stringify(extensionId)}].id`;
}

export const generatedExtensionExportIds = Effect.fn(
  "@svvy/extensions/generatedExtensionExportIds",
)(function* (input: GeneratedExtensionExportIdsInput) {
  return new Set(
    [
      ...(input.builtinExtensionIds ?? workflowTaskReferenceableBuiltinExtensionIds()),
      ...(yield* readReadyUserExtensionExportIds(input)),
    ].toSorted(),
  );
});

export const generatedExtensionsPackageContents = Effect.fn(
  "@svvy/extensions/generatedExtensionsPackageContents",
)(function* (input: GeneratedExtensionsPackageContentsInput) {
  const exportRecords = yield* generatedExtensionExportRecords(input);
  const extensionIds = exportRecords.map((record) => record.extensionId).toSorted();
  const dependencies = generatedExtensionsPackageDependencies(exportRecords);
  const files = renderGeneratedExtensionsPackageFiles(extensionIds, { dependencies });
  const manifest = files.find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST);
  return {
    extensionIds,
    dependencies,
    evidence: readGeneratedExtensionsPackageEvidenceManifest(manifest?.contents),
    files,
  };
});

export function generatedExtensionExportIdsFromHost(
  input: GeneratedExtensionExportIdsInput,
  host: GeneratedExtensionExportDiscoveryHost,
): Set<string> {
  return new Set(
    [
      ...(input.builtinExtensionIds ?? workflowTaskReferenceableBuiltinExtensionIds()),
      ...readReadyUserExtensionExportIdsFromHost(input, host),
    ].toSorted(),
  );
}

export function generatedExtensionsPackageContentsFromHost(
  input: GeneratedExtensionsPackageContentsInput,
  host: GeneratedExtensionExportDiscoveryHost,
): GeneratedExtensionsPackageContents {
  const exportRecords = generatedExtensionExportRecordsFromHost(input, host);
  const extensionIds = exportRecords.map((record) => record.extensionId).toSorted();
  const dependencies = generatedExtensionsPackageDependencies(exportRecords);
  const files = renderGeneratedExtensionsPackageFiles(extensionIds, { dependencies });
  const manifest = files.find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST);
  return {
    extensionIds,
    dependencies,
    evidence: readGeneratedExtensionsPackageEvidenceManifest(manifest?.contents),
    files,
  };
}

export const writeGeneratedExtensionsPackage = Effect.fn(
  "@svvy/extensions/writeGeneratedExtensionsPackage",
)(function* (input: WriteGeneratedExtensionsPackageInput) {
  const path = yield* Path.Path;
  const createdAt = input.createdAt ?? (yield* currentGeneratedPackageTimestamp);
  const files = renderGeneratedExtensionsPackageFiles(input.extensionExportIds, {
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    createdAt,
  });
  const manifest = files.find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST);
  const evidence = readGeneratedExtensionsPackageEvidenceManifest(manifest?.contents);

  yield* replaceGeneratedPackageDirectory({
    generatedPackagePath: input.generatedPackagePath,
    files,
  });

  return {
    generatedPackagePath: input.generatedPackagePath,
    extensionIds: [...input.extensionExportIds].toSorted(),
    manifestPath: path.join(
      input.generatedPackagePath,
      GENERATED_PACKAGE_EVIDENCE_MANIFEST,
    ) as AbsolutePath,
    evidence,
    generatedFiles: files.map((file) => ({
      relativePath: file.relativePath,
      path: path.join(input.generatedPackagePath, file.relativePath) as AbsolutePath,
    })),
  };
});

export const refreshGeneratedExtensionsPackage = Effect.fn(
  "@svvy/extensions/refreshGeneratedExtensionsPackage",
)(function* (input: RefreshGeneratedExtensionsPackageInput) {
  const contents = yield* generatedExtensionsPackageContents(input);
  return yield* writeGeneratedExtensionsPackage({
    dependencies: contents.dependencies,
    generatedPackagePath: input.generatedPackagePath,
    extensionExportIds: contents.extensionIds,
  });
});

interface GeneratedExtensionExportRecord {
  readonly extensionId: string;
  readonly dependencies: readonly GeneratedExtensionDependencyDeclaration[];
}

const generatedExtensionExportRecords = Effect.fn(
  "@svvy/extensions/generatedExtensionExportRecords",
)(function* (input: GeneratedExtensionExportIdsInput) {
  return [
    ...(input.builtinExtensionIds ?? workflowTaskReferenceableBuiltinExtensionIds()).map(
      (extensionId) => ({ extensionId, dependencies: [] }),
    ),
    ...(yield* readReadyUserExtensionExportRecords(input)),
  ].toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
});

function generatedExtensionExportRecordsFromHost(
  input: GeneratedExtensionExportIdsInput,
  host: GeneratedExtensionExportDiscoveryHost,
): readonly GeneratedExtensionExportRecord[] {
  return [
    ...(input.builtinExtensionIds ?? workflowTaskReferenceableBuiltinExtensionIds()).map(
      (extensionId) => ({ extensionId, dependencies: [] }),
    ),
    ...readReadyUserExtensionExportRecordsFromHost(input, host),
  ].toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
}

function generatedExtensionsPackageDependencies(
  records: readonly GeneratedExtensionExportRecord[],
): readonly GeneratedExtensionsPackageDependencyEvidence[] {
  const byName = new Map<string, GeneratedExtensionsPackageDependencyEvidence>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      byName.set(`${dependency.name}@${dependency.version}`, {
        kind: "package",
        name: dependency.name,
        resolution: "package-manager",
        version: dependency.version,
      });
    }
  }
  return [...byName.values()].toSorted((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

function generatedExtensionsPackageEvidence(input: {
  createdAt: IsoDateTimeString;
  dependencies: readonly GeneratedExtensionsPackageDependencyEvidence[];
  extensionIds: readonly string[];
  generatedFiles: readonly { readonly relativePath: string; readonly contents: string }[];
}): GeneratedExtensionsPackageEvidence {
  const sourceFingerprint = stableFingerprint("source", [
    ...input.extensionIds,
    ...input.dependencies.map(
      (dependency) => `${dependency.resolution}:${dependency.name}@${dependency.version}`,
    ),
  ]);
  const outputFingerprint = stableFingerprint(
    "output",
    input.generatedFiles.map((file) => `${file.relativePath}\0${file.contents}`),
  );
  return {
    buildId: `${GENERATED_EXTENSIONS_PACKAGE_NAME}:${outputFingerprint}` as GeneratedPackageBuildId,
    createdAt: input.createdAt,
    dependencies: input.dependencies,
    outputFingerprint,
    sourceFingerprint,
  };
}

function readGeneratedExtensionsPackageEvidenceManifest(
  contents: string | undefined,
): GeneratedExtensionsPackageEvidence {
  const manifest = contents ? (JSON.parse(contents) as Record<string, unknown>) : {};
  return {
    buildId: manifest.buildId as GeneratedPackageBuildId,
    createdAt: manifest.createdAt as IsoDateTimeString,
    dependencies: Array.isArray(manifest.dependencies)
      ? manifest.dependencies.filter(isGeneratedPackageDependencyEvidence).map((dependency) => ({
          kind: dependency.kind,
          name: dependency.name,
          resolution: dependency.resolution,
          version: dependency.version,
        }))
      : [],
    outputFingerprint: String(manifest.outputFingerprint ?? ""),
    sourceFingerprint: String(manifest.sourceFingerprint ?? ""),
  };
}

function stableFingerprint(kind: string, parts: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const part of [kind, ...parts]) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= BigInt(part.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    hash ^= 0xffn;
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `svvy-fnv64-v1:${hash.toString(16).padStart(16, "0")}`;
}

const readReadyUserExtensionExportIds = Effect.fn(
  "@svvy/extensions/readReadyUserExtensionExportIds",
)(function* (input: GeneratedExtensionExportIdsInput) {
  return (yield* readReadyUserExtensionExportRecords(input)).map((record) => record.extensionId);
});

const readReadyUserExtensionExportRecords = Effect.fn(
  "@svvy/extensions/readReadyUserExtensionExportRecords",
)(function* (input: GeneratedExtensionExportIdsInput) {
  const path = yield* Path.Path;
  const userSourceRoot = path.join(input.extensionsRoot, "sources", "user");
  const directoryNames = yield* readDirectoryNames(userSourceRoot);
  const readyRecords: GeneratedExtensionExportRecord[] = [];
  for (const extensionId of directoryNames) {
    const record = yield* readyUserExtensionExportRecord({
      extensionId,
      extensionsRoot: input.extensionsRoot,
    });
    if (record) {
      readyRecords.push(record);
    }
  }
  return readyRecords.toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
});

function readReadyUserExtensionExportIdsFromHost(
  input: GeneratedExtensionExportIdsInput,
  host: GeneratedExtensionExportDiscoveryHost,
): readonly string[] {
  return readReadyUserExtensionExportRecordsFromHost(input, host).map(
    (record) => record.extensionId,
  );
}

function readReadyUserExtensionExportRecordsFromHost(
  input: GeneratedExtensionExportIdsInput,
  host: GeneratedExtensionExportDiscoveryHost,
): readonly GeneratedExtensionExportRecord[] {
  const userSourceRoot = host.join(input.extensionsRoot, "sources", "user");
  const directoryNames = readDirectoryNamesFromHost(userSourceRoot, host);
  const readyRecords: GeneratedExtensionExportRecord[] = [];
  for (const extensionId of directoryNames) {
    const record = readyUserExtensionExportRecordFromHost({
      extensionId,
      extensionsRoot: input.extensionsRoot,
      host,
    });
    if (record) {
      readyRecords.push(record);
    }
  }
  return readyRecords.toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
}

const readyUserExtensionExportRecord = Effect.fn("@svvy/extensions/readyUserExtensionExportRecord")(
  function* (input: { extensionId: string; extensionsRoot: AbsolutePath }) {
    const path = yield* Path.Path;
    const extensionState = yield* ExtensionStatePort;
    const sourceRoot = path.join(input.extensionsRoot, "sources", "user", input.extensionId);
    const sourceManifestPath = path.join(sourceRoot, "manifest.json");
    const currentBuildManifestPath = path.join(
      input.extensionsRoot,
      "builds",
      "extensions",
      input.extensionId,
      "current",
      "manifest.json",
    );
    const sourceManifest = yield* readOptionalJsonObject(sourceManifestPath);
    const currentBuildManifest = yield* readOptionalJsonObject(currentBuildManifestPath);
    if (!sourceManifest || !currentBuildManifest) {
      return null;
    }
    const dependencies = readReadyGeneratedExtensionDependencies({
      currentBuildManifest,
      expectedTypesPath: path.join(
        input.extensionsRoot,
        "generated",
        "extensions",
        input.extensionId,
        "types.d.ts",
      ),
      extensionId: input.extensionId,
      sourceManifest,
    });
    if (!dependencies) {
      return null;
    }
    const sourceFingerprint = yield* extensionState.records
      .readSourceFingerprint({ sourceRoot: sourceRoot as AbsolutePath })
      .pipe(
        Effect.mapError((cause) =>
          extensionStateReadError("extensions.generated-package.read-source-fingerprint", cause),
        ),
      );
    if (!sourceFingerprint || currentBuildManifest.sourceFingerprint !== sourceFingerprint) {
      return null;
    }
    for (const dependency of dependencies) {
      if (!(yield* generatedExtensionDependencyReady(input.extensionsRoot, dependency))) {
        return null;
      }
    }
    return {
      dependencies: dependencies.map((dependency) => dependency),
      extensionId: input.extensionId,
    };
  },
);

function readyUserExtensionExportRecordFromHost(input: {
  extensionId: string;
  extensionsRoot: AbsolutePath;
  host: GeneratedExtensionExportDiscoveryHost;
}): GeneratedExtensionExportRecord | null {
  const sourceRoot = input.host.join(input.extensionsRoot, "sources", "user", input.extensionId);
  const sourceManifestPath = input.host.join(sourceRoot, "manifest.json");
  const currentBuildManifestPath = input.host.join(
    input.extensionsRoot,
    "builds",
    "extensions",
    input.extensionId,
    "current",
    "manifest.json",
  );
  const sourceManifest = readOptionalJsonObjectFromHost(sourceManifestPath, input.host);
  const currentBuildManifest = readOptionalJsonObjectFromHost(currentBuildManifestPath, input.host);
  if (!sourceManifest || !currentBuildManifest) {
    return null;
  }
  const dependencies = readReadyGeneratedExtensionDependencies({
    currentBuildManifest,
    expectedTypesPath: input.host.join(
      input.extensionsRoot,
      "generated",
      "extensions",
      input.extensionId,
      "types.d.ts",
    ),
    extensionId: input.extensionId,
    sourceManifest,
  });
  if (!dependencies) {
    return null;
  }
  const sourceFingerprint = input.host.sourceFingerprint(sourceRoot);
  if (!sourceFingerprint || currentBuildManifest.sourceFingerprint !== sourceFingerprint) {
    return null;
  }
  for (const dependency of dependencies) {
    if (!generatedExtensionDependencyReadyFromHost(input.extensionsRoot, dependency, input.host)) {
      return null;
    }
  }
  return {
    dependencies: dependencies.map((dependency) => dependency),
    extensionId: input.extensionId,
  };
}

function readReadyGeneratedExtensionDependencies(input: {
  currentBuildManifest: Record<string, unknown>;
  expectedTypesPath: string;
  extensionId: string;
  sourceManifest: Record<string, unknown>;
}): readonly GeneratedExtensionDependencyDeclaration[] | null {
  if (
    input.sourceManifest.schemaVersion !== 1 ||
    input.sourceManifest.id !== input.extensionId ||
    input.sourceManifest.interface !== "svvyx" ||
    input.sourceManifest.typescriptApiEnabled !== true ||
    input.sourceManifest.workflowTaskAgentReferenceExportEnabled !== true
  ) {
    return null;
  }
  if (
    input.currentBuildManifest.schemaVersion !== 1 ||
    input.currentBuildManifest.extensionId !== input.extensionId ||
    input.currentBuildManifest.interface !== "svvyx" ||
    typeof input.currentBuildManifest.module !== "string" ||
    input.currentBuildManifest.typescriptTypes !== input.expectedTypesPath ||
    !isGeneratedExtensionCommandManifest(input.currentBuildManifest.commandManifest) ||
    !Array.isArray(input.currentBuildManifest.dependencies)
  ) {
    return null;
  }
  const dependencies: GeneratedExtensionDependencyDeclaration[] = [];
  for (const dependency of input.currentBuildManifest.dependencies) {
    const declaration = readGeneratedExtensionDependencyDeclaration(dependency);
    if (!declaration) {
      return null;
    }
    dependencies.push(declaration);
  }
  return dependencies;
}

const generatedExtensionDependencyReady = Effect.fn(
  "@svvy/extensions/generatedExtensionDependencyReady",
)(function* (extensionsRoot: AbsolutePath, dependency: unknown) {
  const extensionState = yield* ExtensionStatePort;
  const declaration = readGeneratedExtensionDependencyDeclaration(dependency);
  return (
    declaration !== null &&
    (yield* extensionState.dependencies
      .isApproved({ dependency: extensionDependencyApprovalIdentityFromDeclaration(declaration) })
      .pipe(
        Effect.mapError((cause) =>
          extensionStateReadError("extensions.generated-package.read-dependency-approval", cause),
        ),
      )) &&
    (yield* generatedExtensionDependencyArtifactInstalled(extensionsRoot, declaration))
  );
});

function generatedExtensionDependencyReadyFromHost(
  extensionsRoot: AbsolutePath,
  dependency: unknown,
  host: GeneratedExtensionExportDiscoveryHost,
): boolean {
  const declaration = readGeneratedExtensionDependencyDeclaration(dependency);
  const approvalIdentity =
    declaration === null ? null : extensionDependencyApprovalIdentityFromDeclaration(declaration);
  return (
    declaration !== null &&
    approvalIdentity !== null &&
    host.isDependencyApproved(approvalIdentity) &&
    generatedExtensionDependencyArtifactInstalledFromHost(extensionsRoot, declaration, host)
  );
}

const generatedExtensionDependencyArtifactInstalled = Effect.fn(
  "@svvy/extensions/generatedExtensionDependencyArtifactInstalled",
)(function* (extensionsRoot: AbsolutePath, dependency: GeneratedExtensionDependencyDeclaration) {
  const path = yield* Path.Path;
  const packageJsonPath = path.join(
    extensionsRoot,
    "package",
    "node_modules",
    ...dependency.name.split("/"),
    "package.json",
  );
  const packageJson = yield* readOptionalJsonObject(packageJsonPath);
  return generatedExtensionDependencyArtifactMatches(packageJson, dependency);
});

function generatedExtensionDependencyArtifactInstalledFromHost(
  extensionsRoot: AbsolutePath,
  dependency: GeneratedExtensionDependencyDeclaration,
  host: GeneratedExtensionExportDiscoveryHost,
): boolean {
  const packageJsonPath = host.join(
    extensionsRoot,
    "package",
    "node_modules",
    ...dependency.name.split("/"),
    "package.json",
  );
  const packageJson = readOptionalJsonObjectFromHost(packageJsonPath, host);
  return generatedExtensionDependencyArtifactMatches(packageJson, dependency);
}

function generatedExtensionDependencyArtifactMatches(
  packageJson: Record<string, unknown> | null,
  dependency: GeneratedExtensionDependencyDeclaration,
): boolean {
  return packageJson?.name === dependency.name && packageJson.version === dependency.version;
}

function readDirectoryNames(
  directoryPath: string,
): Effect.Effect<string[], ExtensionError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs
      .readDirectory(directoryPath)
      .pipe(Effect.catch(() => Effect.succeed([])));
    const names: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry);
      const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (stat?.type === "Directory") {
        names.push(entry);
      }
    }
    return names.toSorted();
  }).pipe(mapDiscoveryReadError("extensions.generated-package.read-directory", directoryPath));
}

function readDirectoryNamesFromHost(
  directoryPath: string,
  host: GeneratedExtensionExportDiscoveryHost,
): readonly string[] {
  const entries = host.readDirectory(directoryPath);
  const names: string[] = [];
  for (const entry of entries) {
    const entryPath = host.join(directoryPath, entry);
    if (host.statType(entryPath) === "Directory") {
      names.push(entry);
    }
  }
  return names.toSorted();
}

function readOptionalJsonObject(
  filePath: string,
): Effect.Effect<Record<string, unknown> | null, ExtensionError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs
      .readFileString(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (contents === null) {
      return null;
    }
    return parseOptionalJsonObject(contents);
  }).pipe(mapDiscoveryReadError("extensions.generated-package.read-json", filePath));
}

function readOptionalJsonObjectFromHost(
  filePath: string,
  host: GeneratedExtensionExportDiscoveryHost,
): Record<string, unknown> | null {
  const contents = host.readFileString(filePath);
  if (contents === null) {
    return null;
  }
  return parseOptionalJsonObject(contents);
}

function parseOptionalJsonObject(contents: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(contents) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function mapDiscoveryReadError<A, R>(
  operation: string,
  path: string,
): (effect: Effect.Effect<A, unknown, R>) => Effect.Effect<A, ExtensionError, R> {
  return (effect) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new CoreExtensionError({
            operation,
            reason: "execution-failed",
            message: `Unable to read generated extension discovery input: ${path}`,
            cause,
          }),
      ),
    );
}

function extensionStateReadError(operation: string, cause: StateContractError): ExtensionError {
  return new CoreExtensionError({
    operation,
    reason: "execution-failed",
    message: describeExtensionStateCause(cause),
    cause,
  });
}

function describeExtensionStateCause(cause: StateContractError): string {
  return cause.message.length > 0 ? cause.message : "Unable to read extension state.";
}

function readGeneratedExtensionDependencyDeclaration(
  dependency: unknown,
): GeneratedExtensionDependencyDeclaration | null {
  if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
    return null;
  }
  const entry = dependency as Record<string, unknown>;
  if (
    (entry.kind !== "dependency" && entry.kind !== "trusted_dependency") ||
    typeof entry.name !== "string" ||
    typeof entry.version !== "string"
  ) {
    return null;
  }
  return {
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
  };
}

function extensionDependencyApprovalIdentityFromDeclaration(
  dependency: GeneratedExtensionDependencyDeclaration,
): ExtensionDependencyApprovalIdentity {
  return {
    kind: dependency.kind,
    packageManager: "bun",
    source: "npm",
    name: dependency.name,
    version: dependency.version,
    integrity: null,
    resolution: null,
  };
}

function isGeneratedExtensionCommandManifest(value: unknown): boolean {
  if (!isRecord(value) || value.version !== "incur.v1" || !Array.isArray(value.commands)) {
    return false;
  }
  const names = new Set<string>();
  for (const command of value.commands) {
    if (
      !isRecord(command) ||
      typeof command.name !== "string" ||
      command.name.trim().length === 0 ||
      names.has(command.name)
    ) {
      return false;
    }
    if ("aliases" in command) {
      if (
        !Array.isArray(command.aliases) ||
        !command.aliases.every((alias) => typeof alias === "string")
      ) {
        return false;
      }
    }
    if ("description" in command && typeof command.description !== "string") {
      return false;
    }
    if ("examples" in command) {
      if (!Array.isArray(command.examples) || !command.examples.every(isCommandExample)) {
        return false;
      }
    }
    if ("schema" in command && !isCommandSchema(command.schema)) {
      return false;
    }
    if ("streaming" in command && typeof command.streaming !== "boolean") {
      return false;
    }
    names.add(command.name);
  }
  return true;
}

function isCommandExample(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    (!("description" in value) || typeof value.description === "string")
  );
}

function isCommandSchema(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["args", "env", "options", "output"].every((key) => !(key in value) || isRecord(value[key]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isGeneratedPackageDependencyEvidence(
  value: unknown,
): value is GeneratedExtensionsPackageDependencyEvidence {
  return (
    isRecord(value) &&
    value.kind === "package" &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    (value.resolution === "app-owned-package" || value.resolution === "package-manager")
  );
}
