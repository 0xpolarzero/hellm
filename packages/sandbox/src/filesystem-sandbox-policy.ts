import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

export type FileSystemAccessMode = "read" | "write" | "none";

export interface FileSystemSandboxEntry {
  path: string;
  access: FileSystemAccessMode;
  recursive?: boolean;
  source?: string;
  protectedMetadataNames?: readonly string[];
}

export interface FileSystemSandboxPolicy {
  kind: "restricted" | "unrestricted";
  entries: readonly FileSystemSandboxEntry[];
}

export interface ManagedWorkspaceWritePolicyInput {
  cwd: string;
  writableRoots?: readonly string[];
  readOnlyRoots?: readonly string[];
  noneRoots?: readonly string[];
  includeSlashTmp?: boolean;
  tmpdir?: string | null;
}

export interface MacOsSeatbeltProfile {
  profile: string;
  parameters: Record<string, string>;
}

const PROTECTED_METADATA_NAMES = [".git", ".agents", ".codex"] as const;

const ACCESS_PRECEDENCE: Record<FileSystemAccessMode, number> = {
  read: 1,
  write: 2,
  none: 3,
};

export function buildManagedWorkspaceWriteFileSystemPolicy(
  input: ManagedWorkspaceWritePolicyInput,
): FileSystemSandboxPolicy {
  const entries: FileSystemSandboxEntry[] = [
    { path: resolvePath(sep), access: "read" },
    writableRootEntry(input.cwd),
  ];
  if (input.includeSlashTmp !== false) {
    entries.push(writableRootEntry("/tmp"));
  }
  if (input.tmpdir) {
    entries.push(writableRootEntry(input.tmpdir));
  }
  for (const root of input.writableRoots ?? []) {
    entries.push(writableRootEntry(root));
  }
  for (const root of input.readOnlyRoots ?? []) {
    entries.push({ path: normalizePolicyPath(root), access: "read" });
  }
  for (const root of input.noneRoots ?? []) {
    entries.push({ path: normalizePolicyPath(root), access: "none" });
  }
  return { kind: "restricted", entries };
}

export function unrestrictedFileSystemPolicy(): FileSystemSandboxPolicy {
  return { kind: "unrestricted", entries: [] };
}

export function resolveFileSystemAccess(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): FileSystemAccessMode {
  if (policy.kind === "unrestricted") {
    return "write";
  }
  const target = resolveCandidatePath(path, cwd);
  const match = policy.entries
    .map(normalizeEntry)
    .filter((entry) => entryMatchesPath(entry, target))
    .toSorted((left, right) => {
      const specificity = pathSpecificity(right.path) - pathSpecificity(left.path);
      if (specificity !== 0) return specificity;
      return ACCESS_PRECEDENCE[right.access] - ACCESS_PRECEDENCE[left.access];
    })[0];
  return match?.access ?? "none";
}

export function canReadFileSystemPath(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  return resolveFileSystemAccess(policy, path, cwd) !== "none";
}

export function canWriteFileSystemPath(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  return (
    resolveFileSystemAccess(policy, path, cwd) === "write" &&
    !isProtectedMetadataWriteDenied(policy, path, cwd)
  );
}

export function protectedMetadataNames(): readonly string[] {
  return PROTECTED_METADATA_NAMES;
}

export function buildMacOsSeatbeltProfile(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  input: { networkAccess: boolean },
): MacOsSeatbeltProfile {
  const parameters: Record<string, string> = {};
  const sections = [
    "(version 1)",
    "(allow default)",
    buildSeatbeltFileReadPolicy(policy, cwd, parameters),
    buildSeatbeltFileWritePolicy(policy, cwd, parameters),
    input.networkAccess ? "" : "(deny network*)",
  ].filter((section) => section.length > 0);
  return {
    profile: sections.join("\n"),
    parameters,
  };
}

function writableRootEntry(path: string): FileSystemSandboxEntry {
  return {
    path: normalizePolicyPath(path),
    access: "write",
    protectedMetadataNames: PROTECTED_METADATA_NAMES,
  };
}

function isProtectedMetadataWriteDenied(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  if (policy.kind === "unrestricted") {
    return false;
  }
  const target = resolveCandidatePath(path, cwd);
  for (const entry of policy.entries.map(normalizeEntry)) {
    if (entry.access !== "write" || !entry.protectedMetadataNames?.length) {
      continue;
    }
    if (!entryMatchesPath(entry, target)) {
      continue;
    }
    const root = entry.path;
    for (const metadataName of entry.protectedMetadataNames) {
      const metadataRoot = resolvePath(root, metadataName);
      if (!isPathInside(metadataRoot, target)) {
        continue;
      }
      if (hasExplicitMetadataWrite(policy, root, metadataRoot, target)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function hasExplicitMetadataWrite(
  policy: FileSystemSandboxPolicy,
  broadWritableRoot: string,
  metadataRoot: string,
  target: string,
): boolean {
  return policy.entries.some((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized.access !== "write") {
      return false;
    }
    const entryPath = normalized.path;
    return (
      entryPath !== broadWritableRoot &&
      isPathInside(metadataRoot, entryPath) &&
      entryMatchesPath(normalized, target)
    );
  });
}

function buildSeatbeltFileReadPolicy(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  parameters: Record<string, string>,
): string {
  if (policy.kind === "unrestricted") {
    return "";
  }
  const unreadableRoots = policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access === "none")
    .filter((entry) => resolveFileSystemAccess(policy, entry.path, cwd) === "none")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  if (unreadableRoots.length === 0) {
    return "";
  }
  const roots = unreadableRoots.flatMap((root, index) => {
    const rootParam = `UNREADABLE_ROOT_${index}`;
    parameters[rootParam] = root.path;
    const requirements = entrySeatbeltPathRequirements(rootParam, root.recursive);
    const excludedRequirements = readableSubpathsForUnreadableRoot(policy, root, cwd).flatMap(
      (excluded, excludedIndex) => {
        const excludedParam = `UNREADABLE_ROOT_${index}_EXCLUDED_${excludedIndex}`;
        parameters[excludedParam] = excluded.path;
        return entrySeatbeltPathRequirements(excludedParam, excluded.recursive).map(
          (requirement) => `(require-not ${requirement})`,
        );
      },
    );
    if (excludedRequirements.length === 0) {
      return requirements;
    }
    return requirements.map(
      (requirement) => `(require-all ${requirement} ${excludedRequirements.join(" ")})`,
    );
  });
  return `(deny file-read*\n${roots.join("\n")}\n)`;
}

function readableSubpathsForUnreadableRoot(
  policy: FileSystemSandboxPolicy,
  root: NormalizedFileSystemSandboxEntry,
  cwd: string,
): NormalizedFileSystemSandboxEntry[] {
  return policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access !== "none")
    .filter((entry) => entryContainsPath(root, entry.path))
    .filter((entry) => canReadFileSystemPath(policy, entry.path, cwd))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function buildSeatbeltFileWritePolicy(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  parameters: Record<string, string>,
): string {
  if (policy.kind === "unrestricted") {
    return "";
  }
  const writableRoots = policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access === "write")
    .filter((entry) => canWriteFileSystemPath(policy, entry.path, cwd));
  if (writableRoots.length === 0) {
    return "(deny file-write*)";
  }
  const roots = writableRoots.map((root, index) => {
    const rootParam = `WRITABLE_ROOT_${index}`;
    parameters[rootParam] = root.path;
    const requirements = root.recursive
      ? [`(subpath (param "${rootParam}"))`]
      : [`(literal (param "${rootParam}"))`];
    for (const [excludedIndex, excluded] of readOnlySubpathsForWritableRoot(
      policy,
      root,
      cwd,
    ).entries()) {
      const excludedParam = `WRITABLE_ROOT_${index}_EXCLUDED_${excludedIndex}`;
      parameters[excludedParam] = excluded.path;
      for (const requirement of entrySeatbeltPathRequirements(excludedParam, excluded.recursive)) {
        requirements.push(`(require-not ${requirement})`);
      }
    }
    for (const metadataName of root.protectedMetadataNames ?? []) {
      requirements.push(
        `(require-not (regex #"${seatbeltProtectedMetadataNameRegex(root.path, metadataName)}"))`,
      );
    }
    return `(require-all ${requirements.join(" ")} )`;
  });
  return ["(deny file-write*)", `(allow file-write*\n${roots.join(" ")}\n)`].join("\n");
}

function readOnlySubpathsForWritableRoot(
  policy: FileSystemSandboxPolicy,
  root: NormalizedFileSystemSandboxEntry,
  cwd: string,
): NormalizedFileSystemSandboxEntry[] {
  return policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access !== "write")
    .filter((entry) => entryContainsPath(root, entry.path))
    .filter((entry) => !canWriteFileSystemPath(policy, entry.path, cwd))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

type NormalizedFileSystemSandboxEntry = FileSystemSandboxEntry & {
  path: string;
  recursive: boolean;
};

function normalizeEntry(entry: FileSystemSandboxEntry): NormalizedFileSystemSandboxEntry {
  return {
    ...entry,
    path: normalizePolicyPath(entry.path),
    recursive: entry.recursive !== false,
  };
}

function entryMatchesPath(entry: NormalizedFileSystemSandboxEntry, target: string): boolean {
  return entry.recursive ? isPathInside(entry.path, target) : entry.path === target;
}

function entryContainsPath(entry: NormalizedFileSystemSandboxEntry, path: string): boolean {
  return entry.recursive
    ? isPathInside(entry.path, path)
    : entry.path === normalizePolicyPath(path);
}

function entrySeatbeltPathRequirements(parameterName: string, recursive: boolean): string[] {
  return recursive
    ? [`(literal (param "${parameterName}"))`, `(subpath (param "${parameterName}"))`]
    : [`(literal (param "${parameterName}"))`];
}

function seatbeltProtectedMetadataNameRegex(root: string, name: string): string {
  let normalizedRoot = normalizePolicyPath(root);
  while (normalizedRoot.length > 1 && normalizedRoot.endsWith(sep)) {
    normalizedRoot = normalizedRoot.slice(0, -1);
  }
  const escapedRoot = escapeRegex(normalizedRoot);
  const escapedName = escapeRegex(name);
  if (normalizedRoot === sep) {
    return `^/${escapedName}(/.*)?$`;
  }
  return `^${escapedRoot}/${escapedName}(/.*)?$`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveCandidatePath(path: string, cwd: string): string {
  return normalizePolicyPath(isAbsolute(path) ? path : resolvePath(cwd, path));
}

function normalizePolicyPath(path: string): string {
  return resolvePath(path);
}

function pathSpecificity(path: string): number {
  return normalizePolicyPath(path).split(sep).filter(Boolean).length;
}

function isPathInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
