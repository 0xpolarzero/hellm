import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BUILTIN_EXTENSIONS, resolveActorExtensionState } from "../shared/extensions";
import {
  ExtensionDependencyApprovalStore,
  extensionDependencyIdentityFromDeclaration,
} from "./extension-dependency-approval-store";
import { isSvvyxCommandManifest } from "./svvyx-typescript-declarations";

export function getExtensionsGeneratedPackagePath(): string {
  return join(homedir(), ".config", "svvy", "extensions", "generated", "package");
}

export function effectiveExtensionsGeneratedPackagePath(
  options: {
    extensionsGeneratedPackagePath?: string;
    extensionsRoot?: string;
    generatedPackagePath?: string;
  } = {},
): string {
  if (options.extensionsGeneratedPackagePath) {
    return options.extensionsGeneratedPackagePath;
  }
  if (options.extensionsRoot) {
    return join(options.extensionsRoot, "generated", "package");
  }
  if (options.generatedPackagePath) {
    return join(dirname(options.generatedPackagePath), "extensions-package");
  }
  return getExtensionsGeneratedPackagePath();
}

export function refreshGeneratedExtensionsPackage(
  options: {
    extensionsGeneratedPackagePath?: string;
    extensionsRoot?: string;
    generatedPackagePath?: string;
  } = {},
): { extensionIds: string[]; generatedPackagePath: string } {
  const generatedPackagePath = effectiveExtensionsGeneratedPackagePath(options);
  const extensionIds = [...generatedExtensionExportIds({ extensionsRoot: options.extensionsRoot })];
  writeGeneratedExtensionsPackage(generatedPackagePath, new Set(extensionIds));
  return {
    extensionIds,
    generatedPackagePath,
  };
}

export function writeGeneratedExtensionsPackage(
  generatedPackagePath: string,
  extensionExportIds: ReadonlySet<string>,
): void {
  const exportedIds = [...extensionExportIds].toSorted();
  mkdirSync(generatedPackagePath, { recursive: true });
  writeFileSync(
    join(generatedPackagePath, "package.json"),
    JSON.stringify(
      {
        name: "@svvy/extensions",
        type: "module",
        exports: {
          ".": "./index.ts",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(generatedPackagePath, "index.ts"),
    [
      "export const Extensions = {",
      ...exportedIds.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(id)},`),
      "} as const;",
      "",
      "export type ExtensionId = (typeof Extensions)[keyof typeof Extensions];",
      "",
    ].join("\n"),
  );
}

export function generatedExtensionExportIds(
  options: { extensionsRoot?: string } = {},
): Set<string> {
  const workflowTaskExtensions = resolveActorExtensionState({
    actor: "workflow-task",
  });
  const workflowTaskUsableIds = new Set<string>([
    ...workflowTaskExtensions.loadedExtensionIds,
    ...workflowTaskExtensions.availableExtensionIds,
  ]);
  return new Set(
    [
      ...BUILTIN_EXTENSIONS.filter((extension) => workflowTaskUsableIds.has(extension.id)).map(
        (extension) => extension.id,
      ),
      ...readReadyUserExtensionExportIds(options.extensionsRoot),
    ].toSorted(),
  );
}

function readReadyUserExtensionExportIds(extensionsRoot?: string): string[] {
  const userSourceRoot = join(extensionsRoot ?? defaultExtensionsRoot(), "sources", "user");
  if (!existsSync(userSourceRoot) || !statSync(userSourceRoot).isDirectory()) {
    return [];
  }
  return readdirSync(userSourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((extensionId) => userExtensionHasReadyGeneratedExport(extensionId, extensionsRoot))
    .toSorted();
}

function userExtensionHasReadyGeneratedExport(
  extensionId: string,
  extensionsRoot: string | undefined,
): boolean {
  const root = extensionsRoot ?? defaultExtensionsRoot();
  const sourceRoot = join(root, "sources", "user", extensionId);
  const sourceManifestPath = join(sourceRoot, "manifest.json");
  const currentBuildManifestPath = join(
    root,
    "builds",
    "extensions",
    extensionId,
    "current",
    "manifest.json",
  );
  const sourceManifest = readOptionalJsonObject(sourceManifestPath);
  const currentBuildManifest = readOptionalJsonObject(currentBuildManifestPath);
  if (!sourceManifest || !currentBuildManifest) {
    return false;
  }
  if (
    sourceManifest.schemaVersion !== 1 ||
    sourceManifest.id !== extensionId ||
    sourceManifest.interface !== "svvyx" ||
    sourceManifest.typescriptApiEnabled !== true
  ) {
    return false;
  }
  if (
    currentBuildManifest.schemaVersion !== 1 ||
    currentBuildManifest.extensionId !== extensionId ||
    currentBuildManifest.interface !== "svvyx" ||
    typeof currentBuildManifest.module !== "string" ||
    currentBuildManifest.typescriptTypes !==
      join(root, "generated", "extensions", extensionId, "types.d.ts") ||
    !isSvvyxCommandManifest(currentBuildManifest.commandManifest) ||
    !Array.isArray(currentBuildManifest.dependencies)
  ) {
    return false;
  }
  const sourceFingerprint = sourceBuildFingerprint(sourceRoot);
  if (!sourceFingerprint || currentBuildManifest.sourceFingerprint !== sourceFingerprint) {
    return false;
  }
  const dependencyApprovalStore = new ExtensionDependencyApprovalStore({ extensionsRoot: root });
  return currentBuildManifest.dependencies.every(
    (dependency) =>
      generatedExtensionDependencyApproved(dependencyApprovalStore, dependency) &&
      generatedExtensionDependencyArtifactInstalled(root, dependency),
  );
}

function generatedExtensionDependencyApproved(
  dependencyApprovalStore: ExtensionDependencyApprovalStore,
  dependency: unknown,
): boolean {
  const declaration = readGeneratedExtensionDependencyDeclaration(dependency);
  return declaration
    ? dependencyApprovalStore.hasApproved(extensionDependencyIdentityFromDeclaration(declaration))
    : false;
}

function generatedExtensionDependencyArtifactInstalled(
  extensionsRoot: string,
  dependency: unknown,
): boolean {
  const declaration = readGeneratedExtensionDependencyDeclaration(dependency);
  if (!declaration) {
    return false;
  }
  const packageJsonPath = join(
    extensionsRoot,
    "package",
    "node_modules",
    ...declaration.name.split("/"),
    "package.json",
  );
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    return packageJson.name === declaration.name && packageJson.version === declaration.version;
  } catch {
    return false;
  }
}

function readGeneratedExtensionDependencyDeclaration(
  dependency: unknown,
): { kind: "dependency" | "trusted_dependency"; name: string; version: string } | null {
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

function sourceBuildFingerprint(sourceRoot: string): string | null {
  if (!existsSync(sourceRoot)) {
    return null;
  }
  const files = listBuildInputFiles(sourceRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(sourceRoot.length + 1));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listBuildInputFiles(root: string): string[] {
  const files: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === ".svvy") {
        continue;
      }
      const path = join(current, entry);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (stat.isFile()) {
        files.push(path);
      }
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function readOptionalJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
}
