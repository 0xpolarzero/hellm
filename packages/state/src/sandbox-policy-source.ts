import { createHash } from "node:crypto";
import { join, resolve as resolvePath } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  SandboxPolicyError,
  SandboxPolicySource,
  type AbsolutePath,
  type FileSystemSandboxPolicy,
  type FileSystemSandboxPolicyEntry,
  type GeneratedPackageName,
  type SandboxLaunchScope,
  type SandboxPolicySnapshot,
  type SandboxPolicySnapshotInput,
  type SandboxPolicySourceService,
  type WorkspaceId,
} from "@svvy/core";

export type SandboxPolicySourceSettings = {
  readonly workspace: {
    readonly id: WorkspaceId;
    readonly cwd: AbsolutePath;
    readonly artifactDir?: AbsolutePath;
  };
  readonly appPreferences: {
    readonly approvalMode?: "auto-review" | "user" | "full-access";
    readonly managedSandbox?: boolean;
    readonly networkAccess?: boolean;
  };
  readonly generatedPackageRoots?: Partial<Record<GeneratedPackageName, AbsolutePath>>;
  readonly generatedOutputRoots?: readonly AbsolutePath[];
  readonly extensionDependencyRoots?: readonly AbsolutePath[];
  readonly temporaryRoots?: readonly AbsolutePath[];
  readonly now?: () => string;
};

export function sandboxPolicySourceFromSettings(
  settings: SandboxPolicySourceSettings,
): SandboxPolicySourceService {
  return {
    snapshot: (input) =>
      Effect.try({
        try: () => buildSnapshot(settings, input),
        catch: (cause) =>
          cause instanceof SandboxPolicyError
            ? cause
            : new SandboxPolicyError({
                operation: "SandboxPolicySource.snapshot",
                reason: "invalid-policy",
                message: cause instanceof Error ? cause.message : "Unable to build sandbox policy.",
                cause,
              }),
      }),
  };
}

export const makeSandboxPolicySource = Effect.fn("@svvy/state/makeSandboxPolicySource")(
  (settings: SandboxPolicySourceSettings) =>
    Effect.succeed(sandboxPolicySourceFromSettings(settings)),
);

export const layerSandboxPolicySource = (
  settings: SandboxPolicySourceSettings,
): Layer.Layer<SandboxPolicySource> =>
  Layer.effect(SandboxPolicySource, makeSandboxPolicySource(settings));

function buildSnapshot(
  settings: SandboxPolicySourceSettings,
  input: SandboxPolicySnapshotInput,
): SandboxPolicySnapshot {
  const cwd = normalizeAbsolutePath(input.cwd ?? settings.workspace.cwd, "cwd");
  const scope = validateScope(settings, input.scope);
  const filesystemPolicy = buildFileSystemPolicy(settings, scope, cwd);
  const sandboxMode =
    settings.appPreferences.approvalMode === "full-access" ||
    settings.appPreferences.managedSandbox === false
      ? "omitted_full_access"
      : "managed";
  const networkPolicy =
    settings.appPreferences.approvalMode === "full-access" ||
    settings.appPreferences.networkAccess !== false
      ? "allow"
      : "deny";
  const fingerprintInput = {
    scope,
    surfacePiSessionId: input.surfacePiSessionId ?? null,
    commandId: input.commandId,
    launchKind: input.launchKind,
    cwd,
    sandboxMode,
    networkPolicy,
    filesystemPolicy,
  };
  const fingerprint = sha256Json(fingerprintInput);
  const resolvedAt = (settings.now?.() ??
    new Date().toISOString()) as unknown as SandboxPolicySnapshot["resolvedAt"];
  return {
    snapshotId: `sandbox_policy_${fingerprint.slice(0, 16)}`,
    fingerprint,
    resolvedAt,
    scope,
    ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
    commandId: input.commandId,
    launchKind: input.launchKind,
    cwd,
    sandboxMode,
    networkPolicy,
    filesystemPolicy,
    ...(sandboxMode === "managed" ? { profileDigest: sha256Json(filesystemPolicy) } : {}),
  };
}

function validateScope(
  settings: SandboxPolicySourceSettings,
  scope: SandboxLaunchScope,
): SandboxLaunchScope {
  if (
    (scope.kind === "workspace" || scope.kind === "workspace-generated-package-link") &&
    scope.workspaceId !== settings.workspace.id
  ) {
    throw new SandboxPolicyError({
      operation: "SandboxPolicySource.snapshot",
      reason: "invalid-policy",
      message: `Sandbox scope workspace ${scope.workspaceId} does not match state workspace ${settings.workspace.id}.`,
    });
  }
  return scope;
}

function buildFileSystemPolicy(
  settings: SandboxPolicySourceSettings,
  scope: SandboxLaunchScope,
  cwd: AbsolutePath,
): FileSystemSandboxPolicy {
  if (settings.appPreferences.approvalMode === "full-access") {
    return { defaultAccess: "read", entries: [] };
  }

  const entries: FileSystemSandboxPolicyEntry[] = [];
  if (scope.kind === "workspace") {
    entries.push(writeEntry(cwd, "workspace"));
    if (settings.workspace.artifactDir) {
      entries.push(writeEntry(settings.workspace.artifactDir, "artifact"));
    }
  } else if (scope.kind === "workspace-generated-package-link") {
    entries.push(
      writeEntry(
        workspaceGeneratedPackageLinkPath(settings, scope.packageName),
        "generated-output",
      ),
    );
    entries.push(
      readEntry(requireGeneratedPackageRoot(settings, scope.packageName), "generated-output"),
    );
  } else if (scope.kind === "app-global-generated-package") {
    entries.push(
      writeEntry(requireGeneratedPackageRoot(settings, scope.packageName), "generated-output"),
    );
  } else if (scope.kind === "app-global-extension-dependency") {
    for (const root of settings.extensionDependencyRoots ?? []) {
      entries.push(writeEntry(root, "app-runtime"));
    }
    if (!entries.length) {
      throw new SandboxPolicyError({
        operation: "SandboxPolicySource.snapshot",
        reason: "invalid-policy",
        message:
          "Extension dependency sandbox policy requires at least one app-owned dependency root.",
      });
    }
  }

  for (const root of settings.generatedOutputRoots ?? []) {
    entries.push(readEntry(root, "generated-output"));
  }
  for (const root of settings.temporaryRoots ?? []) {
    entries.push(writeEntry(root, "temporary"));
  }

  return {
    defaultAccess: "read",
    entries: dedupeEntries(entries),
  };
}

function requireGeneratedPackageRoot(
  settings: SandboxPolicySourceSettings,
  packageName: GeneratedPackageName,
): AbsolutePath {
  const root = settings.generatedPackageRoots?.[packageName];
  if (!root) {
    throw new SandboxPolicyError({
      operation: "SandboxPolicySource.snapshot",
      reason: "invalid-policy",
      message: `Sandbox policy for ${packageName} requires a generated package root.`,
    });
  }
  return root;
}

function workspaceGeneratedPackageLinkPath(
  settings: SandboxPolicySourceSettings,
  packageName: GeneratedPackageName,
): AbsolutePath {
  const [, name] = packageName.split("/");
  if (!name) {
    throw new SandboxPolicyError({
      operation: "SandboxPolicySource.snapshot",
      reason: "invalid-policy",
      message: `Invalid generated package name: ${packageName}.`,
    });
  }
  return normalizeAbsolutePath(
    join(settings.workspace.cwd, ".smithers", "node_modules", "@svvyx", name),
    "generated package workspace link",
  );
}

function writeEntry(
  path: AbsolutePath,
  source: FileSystemSandboxPolicyEntry["source"],
): FileSystemSandboxPolicyEntry {
  return {
    path: normalizeAbsolutePath(path, "sandbox policy entry"),
    access: "write",
    recursive: true,
    source,
  };
}

function readEntry(
  path: AbsolutePath,
  source: FileSystemSandboxPolicyEntry["source"],
): FileSystemSandboxPolicyEntry {
  return {
    path: normalizeAbsolutePath(path, "sandbox policy entry"),
    access: "read",
    recursive: true,
    source,
  };
}

function normalizeAbsolutePath(path: string, label: string): AbsolutePath {
  const resolved = resolvePath(path);
  if (!resolved.startsWith("/")) {
    throw new SandboxPolicyError({
      operation: "SandboxPolicySource.snapshot",
      reason: "invalid-policy",
      message: `Sandbox ${label} must resolve to an absolute path.`,
    });
  }
  return resolved as AbsolutePath;
}

function dedupeEntries(
  entries: readonly FileSystemSandboxPolicyEntry[],
): readonly FileSystemSandboxPolicyEntry[] {
  const byKey = new Map<string, FileSystemSandboxPolicyEntry>();
  for (const entry of entries) {
    byKey.set(`${entry.path}\0${entry.access}\0${entry.source}`, entry);
  }
  return [...byKey.values()].toSorted((left, right) =>
    `${left.path}:${left.access}:${left.source}`.localeCompare(
      `${right.path}:${right.access}:${right.source}`,
    ),
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
