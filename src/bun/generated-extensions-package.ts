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
import {
  generatedExtensionExportIdsFromHost,
  generatedExtensionsPackageContentsFromHost,
  renderGeneratedExtensionsPackageFiles,
  type GeneratedExtensionExportDiscoveryHost,
} from "@svvy/extensions";
import type { AbsolutePath } from "@svvy/core";
import {
  ExtensionDependencyApprovalStore,
  extensionDependencyIdentityFromDeclaration,
} from "./extension-dependency-approval-store";

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
    extensionsGeneratedPackagePath?: string;
    extensionsRoot?: string;
    generatedPackagePath?: string;
  } = {},
): { extensionIds: string[]; generatedPackagePath: string } {
  const generatedPackagePath = effectiveExtensionsGeneratedPackagePath(options);
  const extensionsRoot = options.extensionsRoot ?? defaultExtensionsRoot();
  const contents = generatedExtensionsPackageContentsFromHost(
    { extensionsRoot: extensionsRoot as AbsolutePath },
    generatedExtensionDiscoveryHost(extensionsRoot),
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
  options: { extensionsRoot?: string } = {},
): Set<string> {
  const extensionsRoot = options.extensionsRoot ?? defaultExtensionsRoot();
  return generatedExtensionExportIdsFromHost(
    { extensionsRoot: extensionsRoot as AbsolutePath },
    generatedExtensionDiscoveryHost(extensionsRoot),
  );
}

function generatedExtensionDiscoveryHost(
  extensionsRoot: string,
): GeneratedExtensionExportDiscoveryHost {
  const dependencyApprovalStore = new ExtensionDependencyApprovalStore({ extensionsRoot });
  return {
    isDependencyApproved: (dependency) =>
      dependencyApprovalStore.hasApproved(extensionDependencyIdentityFromDeclaration(dependency)),
    join,
    readDirectory: (path) => {
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        return [];
      }
      return readdirSync(path);
    },
    readFileString: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    sourceFingerprint: sourceBuildFingerprint,
    statType: (path) => {
      try {
        const stat = statSync(path);
        return stat.isDirectory() ? "Directory" : stat.isFile() ? "File" : "Other";
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
