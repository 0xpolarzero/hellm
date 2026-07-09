import { createHash } from "node:crypto";
import {
  existsSync,
  realpathSync,
  readdirSync,
  readFileSync,
  statSync,
  watch as nodeWatch,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import {
  SandboxPolicyError,
  type RuntimeContractError,
  type BuildLaunchPolicyInput,
  type AbsolutePath,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type SandboxLaunchFacts,
  type IsoDateTimeString,
  type WorkspaceId,
} from "@svvy/core";
import {
  type HostProcessReferencePortService,
  type HostProcessReferenceSnapshot,
  type SandboxHelperCandidatesPortService,
  type SandboxHelperCandidatesSnapshot,
} from "@svvy/sandbox";
import {
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeLayerConfig,
  type RuntimeSourceInvalidationDirectoryEntry,
  type RuntimeSourceInvalidationHost,
} from "@svvy/runtime/bootstrap";
import { WorkspaceSessionCatalog } from "./session-catalog";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { LiveCommandStdinRegistry } from "./live-command-stdin-registry";
import type { RunAcceptedLoadExtension } from "./extension-tools";
import type { RunAcceptedRequestUserInput } from "./request-user-input-tool";

export type RuntimeProviderAuthDependencies = {
  ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
  getProviderAuthUnavailableMessage(provider: string): string;
};

export type NativeSandboxHelperMetadata = {
  schemaVersion: 1;
  artifact: "svvy-sandbox-helper";
  platform: "darwin";
  arch: "arm64" | "x64";
  digest: {
    algorithm: "sha256";
    hex: string;
  };
};

export type PackagedSandboxHostSupportServices = {
  helperCandidates: SandboxHelperCandidatesPortService;
  hostProcess: HostProcessReferencePortService;
};

export type PackagedSandboxHostSupportInput = {
  executablePath?: string;
  appSupportRoot?: string;
  tempRoot?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  readFileString?: (path: string) => string;
};

export function createRuntimeBackedWorkspaceSessionCatalog(
  cwd: string,
  agentDir?: string,
  sessionDir?: string,
  _namerSessionDir?: string,
  workspaceId?: string,
  recoveryOptions?: {
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
    acquireExecuteTypescriptLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind">,
    ) => Promise<{
      facts: SandboxLaunchFacts;
      close(): Promise<void>;
    }>;
    acquireDirectToolLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
        toolName: "exec_command" | "apply_patch" | "execute_typescript";
      },
    ) => Promise<{
      facts: SandboxLaunchFacts;
      close(): Promise<void>;
    }>;
    refreshGeneratedPackages?: (
      input: InternalRefreshGeneratedPackagesRequest,
    ) => Promise<GeneratedPackagesRefreshResult>;
    runAcceptedLoadExtension?: RunAcceptedLoadExtension;
    runAcceptedRequestUserInput?: RunAcceptedRequestUserInput;
    requestDirectToolApproval?: RuntimeApprovalBoundary;
  },
  approvalBoundary?: RuntimeApprovalBoundary,
  managedSandbox?: boolean | (() => boolean),
  runtimeCommandStdin?: LiveCommandStdinRegistry,
  runtimeLayerConfig?: RuntimeLayerConfig,
): WorkspaceSessionCatalog {
  return new WorkspaceSessionCatalog(
    cwd,
    agentDir,
    sessionDir,
    workspaceId,
    recoveryOptions,
    approvalBoundary,
    managedSandbox,
    runtimeCommandStdin,
    runRuntimeEffect,
    runtimeLayerConfig,
  );
}

export function createPackagedSandboxHostSupportServices(
  input: PackagedSandboxHostSupportInput = {},
): PackagedSandboxHostSupportServices {
  const executablePath = input.executablePath ?? process.execPath;
  const executableDir = dirname(executablePath);
  const appBundleRoot = resolve(executableDir, "..", "..") as AbsolutePath;
  const appSupportRoot = (input.appSupportRoot ??
    join(homedir(), ".config", "svvy")) as AbsolutePath;
  const tempRoot = (input.tempRoot ?? tmpdir()) as AbsolutePath;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const readFileString = input.readFileString ?? ((path: string) => readFileSync(path, "utf8"));
  const helperSnapshot = buildPackagedHelperCandidatesSnapshot({
    platform,
    executableDir,
    readFileString,
  });

  const hostProcess: HostProcessReferencePortService = {
    getSnapshot: () =>
      Effect.try({
        try: (): HostProcessReferenceSnapshot => ({
          platform: parseSandboxHostPlatform(platform),
          arch: parseSandboxHostArch(arch),
          appBundleRoot,
          appSupportRoot,
          tempRoot,
        }),
        catch: (cause) => sandboxHostSupportError("HostProcessReferencePort.getSnapshot", cause),
      }),
  };

  const helperCandidates: SandboxHelperCandidatesPortService = {
    getSnapshot: () => Effect.succeed(helperSnapshot),
  };

  return { helperCandidates, hostProcess };
}

function buildPackagedHelperCandidatesSnapshot(input: {
  platform: NodeJS.Platform;
  executableDir: string;
  readFileString: (path: string) => string;
}): SandboxHelperCandidatesSnapshot {
  if (input.platform !== "darwin") {
    return { candidates: [], allowedRoots: [] };
  }
  const metadataPath = join(input.executableDir, "svvy-sandbox-helper.metadata.json");
  const metadata = (() => {
    try {
      return parseNativeSandboxHelperMetadata(input.readFileString(metadataPath));
    } catch (cause) {
      throw sandboxHostSupportError("createPackagedSandboxHostSupportServices", cause);
    }
  })();
  return {
    candidates: [
      {
        path: join(input.executableDir, metadata.artifact) as AbsolutePath,
        platform: metadata.platform,
        arch: metadata.arch,
        expectedDigest: metadata.digest.hex,
      },
    ],
    allowedRoots: [input.executableDir as AbsolutePath],
  };
}

export function parseNativeSandboxHelperMetadata(source: string): NativeSandboxHelperMetadata {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Native sandbox helper metadata must be an object.");
  }
  const metadata = parsed as Partial<NativeSandboxHelperMetadata>;
  if (metadata.schemaVersion !== 1) {
    throw new Error("Native sandbox helper metadata schemaVersion must be 1.");
  }
  if (metadata.artifact !== "svvy-sandbox-helper") {
    throw new Error("Native sandbox helper metadata artifact must be svvy-sandbox-helper.");
  }
  if (metadata.platform !== "darwin") {
    throw new Error("Native sandbox helper metadata platform must be darwin.");
  }
  if (metadata.arch !== "arm64" && metadata.arch !== "x64") {
    throw new Error("Native sandbox helper metadata arch must be arm64 or x64.");
  }
  if (!metadata.digest || metadata.digest.algorithm !== "sha256") {
    throw new Error("Native sandbox helper metadata digest algorithm must be sha256.");
  }
  if (!/^[a-f0-9]{64}$/.test(metadata.digest.hex)) {
    throw new Error("Native sandbox helper metadata digest hex must be a SHA-256 hex string.");
  }
  return metadata as NativeSandboxHelperMetadata;
}

function parseSandboxHostPlatform(
  platform: NodeJS.Platform,
): HostProcessReferenceSnapshot["platform"] {
  if (platform === "darwin") {
    return platform;
  }
  throw new Error(`Native sandbox helper is unsupported on platform ${platform}.`);
}

function parseSandboxHostArch(arch: NodeJS.Architecture): HostProcessReferenceSnapshot["arch"] {
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Native sandbox helper is unsupported on architecture ${arch}.`);
}

function sandboxHostSupportError(operation: string, cause: unknown): SandboxPolicyError {
  if (cause instanceof SandboxPolicyError) {
    return cause;
  }
  return new SandboxPolicyError({
    operation,
    reason: "helper-unavailable",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export interface RuntimeGeneratedPackageRefreshBoundaryHost {
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  listRecoverableWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  materializeCoreTypeContractPackage(): Effect.Effect<void, RuntimeContractError>;
  now(): Effect.Effect<IsoDateTimeString, RuntimeContractError>;
  readonly workspaceLinkFileHost: RuntimeGeneratedPackageWorkspaceLinkFileHost;
}

export function createNodeSourceInvalidationHost(): RuntimeSourceInvalidationHost {
  return {
    homeDir: homedir(),
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map(
          (entry): RuntimeSourceInvalidationDirectoryEntry => ({
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          }),
        ),
      readFileString: (path) => readFileSync(path, "utf8"),
      realPath: (path) => {
        try {
          return realpathSync.native(path);
        } catch {
          return null;
        }
      },
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: (path, listener) => {
      const watcher = nodeWatch(path, (eventType, filename) => {
        void runRuntimeEffect(listener(eventType, filename));
      });
      watcher.on("error", () => {});
      return { close: () => watcher.close() };
    },
  };
}

function runRuntimeEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
