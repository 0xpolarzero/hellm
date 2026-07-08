import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type GeneratedExtensionExportDiscoveryHost,
  generatedExtensionExportIdsFromHost,
  generatedExtensionsPackageContentsFromHost,
  renderGeneratedExtensionsPackageFiles,
} from "@svvy/extensions";
import type { AbsolutePath, ExtensionDependencyApprovalIdentity } from "@svvy/core";
import { extensionDependencyIdentityFromDeclaration } from "./extension-dependency-approval-store";
import type { ExtensionDependencyCommittedApprovalState } from "./svvyx-extensions-command";

export { GENERATED_EXTENSIONS_PACKAGE_NAME } from "@svvy/extensions";
export { generatedExtensionReferenceExpression } from "@svvy/extensions";

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
    dependencyApprovalState?: ExtensionDependencyCommittedApprovalState;
    extensionsGeneratedPackagePath?: string;
    extensionsRoot?: string;
    generatedPackagePath?: string;
  } = {},
): { extensionIds: string[]; generatedPackagePath: string } {
  const generatedPackagePath = effectiveExtensionsGeneratedPackagePath(options);
  const extensionsRoot = options.extensionsRoot ?? defaultExtensionsRoot();
  const contents = generatedExtensionsPackageContentsFromHost(
    { extensionsRoot: extensionsRoot as AbsolutePath },
    generatedExtensionDiscoveryHost(options.dependencyApprovalState),
  );
  writeGeneratedExtensionsPackageFiles(generatedPackagePath, contents.files);
  return {
    extensionIds: [...contents.extensionIds],
    generatedPackagePath,
  };
}

export function writeGeneratedExtensionsPackage(
  generatedPackagePath: string,
  extensionExportIds: ReadonlySet<string>,
): void {
  writeGeneratedExtensionsPackageFiles(
    generatedPackagePath,
    renderGeneratedExtensionsPackageFiles(extensionExportIds),
  );
}

function writeGeneratedExtensionsPackageFiles(
  generatedPackagePath: string,
  files: ReturnType<typeof renderGeneratedExtensionsPackageFiles>,
): void {
  mkdirSync(generatedPackagePath, { recursive: true });
  for (const file of files) {
    writeFileSync(join(generatedPackagePath, file.relativePath), file.contents);
  }
}

export function generatedExtensionExportIds(
  options: {
    dependencyApprovalState?: ExtensionDependencyCommittedApprovalState;
    extensionsRoot?: string;
  } = {},
): Set<string> {
  const extensionsRoot = options.extensionsRoot ?? defaultExtensionsRoot();
  return generatedExtensionExportIdsFromHost(
    { extensionsRoot: extensionsRoot as AbsolutePath },
    generatedExtensionDiscoveryHost(options.dependencyApprovalState),
  );
}

function generatedExtensionDiscoveryHost(
  dependencyApprovalState: ExtensionDependencyCommittedApprovalState | undefined,
): GeneratedExtensionExportDiscoveryHost {
  return {
    isDependencyApproved: (dependency: ExtensionDependencyApprovalIdentity) =>
      dependencyApprovalState?.isApproved(extensionDependencyIdentityFromDeclaration(dependency)) ??
      false,
    join,
    readDirectory: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    readFileString: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    sourceFingerprint: (sourceRoot) => sourceBuildFingerprint(sourceRoot),
    statType: (path) => {
      try {
        const stats = lstatSync(path);
        if (stats.isDirectory()) {
          return "Directory";
        }
        if (stats.isFile()) {
          return "File";
        }
        return "Other";
      } catch {
        return null;
      }
    },
  };
}

export function sourceBuildFingerprint(sourceRoot: string): string | null {
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

function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
}
