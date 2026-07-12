import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
  ExtensionError,
  type ExternalInstructionActor,
  type ExternalInstructionControl,
  type ExternalInstructionDiagnostic,
  type ExternalInstructionFileName,
  type ExternalInstructionGlobalRootSetting,
  type ExternalInstructionScanInput,
  type ExternalInstructionScanResult,
  type ExternalInstructionSourceAddress,
  type ExternalInstructionSourceContent,
  type ExternalInstructionSourceId,
  type ExternalInstructionSourceObservation,
  type ResolveExternalInstructionSourceInput,
  type ResolvedExternalInstructionSource,
  type SaveExternalInstructionSourceInput,
  decodeUnknownExternalInstructionScanInputEffect,
  decodeUnknownResolveExternalInstructionSourceInputEffect,
  decodeUnknownSaveExternalInstructionSourceInputEffect,
} from "@svvy/core";

const supportedFileNames = ["AGENTS.md", "CLAUDE.md"] as const;

export type ExternalInstructionServices = FileSystem.FileSystem | Path.Path | Crypto.Crypto;

interface CandidateRoot {
  readonly path: string;
  readonly sourceGroup: ExternalInstructionSourceObservation["sourceGroup"];
  readonly rootId?: string;
  readonly rootLabel?: string;
  readonly controls: Record<string, ExternalInstructionControl>;
}

interface DiscoveredCandidate {
  readonly canonicalPath: string;
  readonly fileName: ExternalInstructionFileName;
  readonly sourceGroup: ExternalInstructionSourceObservation["sourceGroup"];
  readonly rootId?: string;
  readonly rootLabel?: string;
  readonly control?: ExternalInstructionControl;
  readonly content?: string;
  readonly readError?: string;
}

export function scanExternalInstructions(
  input: ExternalInstructionScanInput,
): Effect.Effect<ExternalInstructionScanResult, ExtensionError, ExternalInstructionServices> {
  const operation = "extensions.externalInstructions.scan";
  return Effect.gen(function* () {
    const decoded = yield* decodeScanInput(operation, input);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const diagnostics: ExternalInstructionDiagnostic[] = [];
    const roots = yield* candidateRoots({ input: decoded, fs, path, diagnostics });
    const candidates: DiscoveredCandidate[] = [];
    const seenCanonicalPaths = new Set<string>();

    for (const root of roots) {
      const rootCandidates: DiscoveredCandidate[] = [];
      for (const fileName of supportedFileNames) {
        const candidate = yield* discoverCandidate({ fs, path, root, fileName, diagnostics });
        if (!candidate || seenCanonicalPaths.has(candidate.canonicalPath)) continue;
        seenCanonicalPaths.add(candidate.canonicalPath);
        rootCandidates.push(candidate);
      }
      const hasAgents = rootCandidates.some((candidate) => candidate.fileName === "AGENTS.md");
      for (const candidate of rootCandidates) {
        candidates.push({
          ...candidate,
          control:
            candidate.control ??
            ({
              enabled: candidate.fileName === "AGENTS.md" || !hasAgents,
              actors: [...DEFAULT_EXTERNAL_INSTRUCTION_ACTORS],
            } satisfies ExternalInstructionControl),
        });
      }
    }

    const sources: ExternalInstructionSourceObservation[] = [];
    const contents: ExternalInstructionSourceContent[] = [];
    for (const [order, candidate] of candidates.entries()) {
      const sourceId = yield* sourceIdForCanonicalPath(crypto, candidate.canonicalPath);
      const eligibleActors = normalizedActors(candidate.control?.actors ?? []);
      const contentHash =
        candidate.content === undefined ? "" : yield* sha256(crypto, candidate.content);
      const fingerprint = yield* sha256(
        crypto,
        JSON.stringify({
          canonicalPath: candidate.canonicalPath,
          contentHash,
          enabled: candidate.control?.enabled === true,
          eligibleActors,
          readStatus: candidate.readError ? "unreadable" : "readable",
        }),
      );
      const source = {
        sourceKind: "external-instruction" as const,
        sourceId,
      } satisfies ExternalInstructionSourceAddress;
      sources.push({
        id: sourceId,
        source,
        fileName: candidate.fileName,
        title: candidate.fileName,
        canonicalPath:
          candidate.canonicalPath as ExternalInstructionSourceObservation["canonicalPath"],
        sourceGroup: candidate.sourceGroup,
        ...(candidate.rootId ? { rootId: candidate.rootId } : {}),
        ...(candidate.rootLabel ? { rootLabel: candidate.rootLabel } : {}),
        order,
        enabled: candidate.control?.enabled === true,
        eligibleActors,
        readOnly: true,
        contentHash,
        fingerprint,
        readStatus: candidate.readError
          ? { status: "unreadable", error: candidate.readError }
          : { status: "readable" },
      });
      if (candidate.content !== undefined) {
        contents.push({ sourceId, content: candidate.content });
      }
      if (candidate.readError) {
        diagnostics.push({
          sourceId,
          severity: "error",
          code: "external-instruction-unreadable",
          message: candidate.readError,
        });
      }
    }
    return { sources, contents, diagnostics };
  });
}

export function resolveExternalInstructionSource(
  input: ResolveExternalInstructionSourceInput,
): Effect.Effect<ResolvedExternalInstructionSource, ExtensionError, ExternalInstructionServices> {
  const operation = "extensions.externalInstructions.resolve-source";
  return Effect.gen(function* () {
    const decoded = yield* decodeResolveInput(operation, input);
    const result = yield* scanExternalInstructions(decoded.scan);
    const observation = result.sources.find((source) => source.id === decoded.source.sourceId);
    const content = result.contents.find((entry) => entry.sourceId === decoded.source.sourceId);
    if (!observation || !content) {
      return yield* Effect.fail(
        new ExtensionError({
          operation,
          reason: "not-found",
          message: `External instruction source is unavailable: ${decoded.source.sourceId}`,
        }),
      );
    }
    return { observation, content: content.content };
  });
}

export function saveExternalInstructionSource(
  input: SaveExternalInstructionSourceInput,
): Effect.Effect<never, ExtensionError> {
  const operation = "extensions.externalInstructions.save-source";
  return decodeSaveInput(operation, input).pipe(
    Effect.flatMap((decoded) =>
      Effect.fail(
        new ExtensionError({
          operation,
          reason: "read-only-source",
          message: `External instruction source is read-only: ${decoded.source.sourceId}`,
        }),
      ),
    ),
  );
}

function candidateRoots(input: {
  readonly input: ExternalInstructionScanInput;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly diagnostics: ExternalInstructionDiagnostic[];
}): Effect.Effect<CandidateRoot[], never> {
  return Effect.gen(function* () {
    const roots: CandidateRoot[] = [];
    for (const configuredRoot of input.input.settings.globalRoots) {
      if (!configuredRoot.enabled) continue;
      const root = yield* canonicalRoot({
        configuredRoot,
        controls: input.input.settings.globalControls,
        homeDirectory: input.input.homeDirectory,
        fs: input.fs,
        path: input.path,
        diagnostics: input.diagnostics,
      });
      if (root) roots.push(root);
    }

    const workspaceRoot = yield* canonicalDirectory(
      input.fs,
      input.path,
      input.input.workspaceRoot,
    );
    const cwd = yield* canonicalDirectory(input.fs, input.path, input.input.cwd);
    if (!workspaceRoot || !cwd || !isContainedPath(input.path, workspaceRoot, cwd)) {
      input.diagnostics.push({
        severity: "error",
        code: "external-instruction-workspace-root-invalid",
        message: "Workspace cwd must resolve inside its trusted workspace root.",
      });
      return roots;
    }
    const workspaceControls =
      input.input.settings.workspaceControls[input.input.workspaceId as string] ?? {};
    const filesystemRoot = input.path.parse(cwd).root;
    for (const directory of ancestorChain(input.path, filesystemRoot, cwd)) {
      roots.push({
        path: directory,
        sourceGroup: "workspace_chain",
        controls: workspaceControls,
      });
    }
    return roots;
  });
}

function canonicalRoot(input: {
  readonly configuredRoot: ExternalInstructionGlobalRootSetting;
  readonly controls: Record<string, ExternalInstructionControl>;
  readonly homeDirectory: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly diagnostics: ExternalInstructionDiagnostic[];
}): Effect.Effect<CandidateRoot | null, never> {
  return Effect.gen(function* () {
    const canonicalPath = yield* canonicalDirectory(
      input.fs,
      input.path,
      expandTrustedHome(input.path, input.homeDirectory, input.configuredRoot.path),
    );
    if (!canonicalPath) {
      input.diagnostics.push({
        severity: "warning",
        code: "external-instruction-global-root-unavailable",
        message: `Configured external instruction root is unavailable: ${input.configuredRoot.label}`,
      });
      return null;
    }
    return {
      path: canonicalPath,
      sourceGroup:
        input.configuredRoot.kind === "builtin" ? "builtin_global_root" : "custom_global_root",
      rootId: input.configuredRoot.id,
      rootLabel: input.configuredRoot.label,
      controls: input.controls,
    };
  });
}

function discoverCandidate(input: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly root: CandidateRoot;
  readonly fileName: ExternalInstructionFileName;
  readonly diagnostics: ExternalInstructionDiagnostic[];
}): Effect.Effect<DiscoveredCandidate | null, never> {
  return Effect.gen(function* () {
    const lexicalPath = input.path.resolve(input.root.path, input.fileName);
    if (!isContainedPath(input.path, input.root.path, lexicalPath)) {
      return null;
    }
    const exists = yield* input.fs
      .exists(lexicalPath)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return null;
    const canonicalPath = yield* input.fs.realPath(lexicalPath).pipe(
      Effect.map((value) => input.path.resolve(value)),
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!canonicalPath) return null;
    if (!isContainedPath(input.path, input.root.path, canonicalPath)) {
      input.diagnostics.push({
        severity: "error",
        code: "external-instruction-source-outside-root",
        message: `External instruction candidate resolves outside its trusted root: ${input.fileName}`,
      });
      return null;
    }
    const stat = yield* input.fs.stat(canonicalPath).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat || stat.type !== "File") return null;
    const contentResult = yield* input.fs.readFileString(canonicalPath).pipe(
      Effect.map((content) => ({ status: "readable" as const, content })),
      Effect.catch(() => Effect.succeed({ status: "unreadable" as const })),
    );
    const control =
      input.root.controls[canonicalPath] ?? input.root.controls[lexicalPath] ?? undefined;
    if (contentResult.status === "unreadable") {
      return {
        canonicalPath,
        fileName: input.fileName,
        sourceGroup: input.root.sourceGroup,
        ...(input.root.rootId ? { rootId: input.root.rootId } : {}),
        ...(input.root.rootLabel ? { rootLabel: input.root.rootLabel } : {}),
        ...(control ? { control } : {}),
        readError: `Unable to read external instruction: ${input.fileName}`,
      };
    }
    return {
      canonicalPath,
      fileName: input.fileName,
      sourceGroup: input.root.sourceGroup,
      ...(input.root.rootId ? { rootId: input.root.rootId } : {}),
      ...(input.root.rootLabel ? { rootLabel: input.root.rootLabel } : {}),
      ...(control ? { control } : {}),
      content: contentResult.content,
    };
  });
}

function canonicalDirectory(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  rawPath: string,
): Effect.Effect<string | null, never> {
  if (!path.isAbsolute(rawPath)) return Effect.succeed(null);
  return fs.realPath(path.resolve(rawPath)).pipe(
    Effect.flatMap((canonicalPath) =>
      fs
        .stat(canonicalPath)
        .pipe(
          Effect.map((stat) => (stat.type === "Directory" ? path.resolve(canonicalPath) : null)),
        ),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );
}

function ancestorChain(path: Path.Path, root: string, cwd: string): string[] {
  const chain: string[] = [];
  let current = cwd;
  while (true) {
    chain.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current || !isContainedPath(path, root, parent)) return [];
    current = parent;
  }
  return chain.toReversed();
}

function expandTrustedHome(path: Path.Path, homeDirectory: string, configuredPath: string): string {
  if (configuredPath === "~") return path.resolve(homeDirectory);
  if (configuredPath.startsWith(`~${path.sep}`)) {
    return path.resolve(homeDirectory, configuredPath.slice(2));
  }
  return configuredPath;
}

function isContainedPath(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizedActors(actors: readonly ExternalInstructionActor[]): ExternalInstructionActor[] {
  const selected = new Set(actors);
  return DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.filter((actor) => selected.has(actor));
}

function sourceIdForCanonicalPath(
  crypto: Crypto.Crypto,
  canonicalPath: string,
): Effect.Effect<ExternalInstructionSourceId, ExtensionError> {
  return sha256(crypto, canonicalPath).pipe(
    Effect.map(
      (hash) =>
        `external_instruction_${hash.slice("sha256:".length)}` as ExternalInstructionSourceId,
    ),
  );
}

function sha256(crypto: Crypto.Crypto, text: string): Effect.Effect<string, ExtensionError> {
  return crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
    Effect.map(
      (bytes) =>
        `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    ),
    Effect.mapError(
      (cause) =>
        new ExtensionError({
          operation: "extensions.externalInstructions.hash",
          reason: "execution-failed",
          message: "Failed to fingerprint an external instruction source.",
          cause,
        }),
    ),
  );
}

function decodeScanInput(
  operation: string,
  input: ExternalInstructionScanInput,
): Effect.Effect<ExternalInstructionScanInput, ExtensionError> {
  return decodeUnknownExternalInstructionScanInputEffect(input).pipe(
    Effect.mapError((cause) => invalidInput(operation, cause)),
  );
}

function decodeResolveInput(
  operation: string,
  input: ResolveExternalInstructionSourceInput,
): Effect.Effect<ResolveExternalInstructionSourceInput, ExtensionError> {
  return decodeUnknownResolveExternalInstructionSourceInputEffect(input).pipe(
    Effect.mapError((cause) => invalidInput(operation, cause)),
  );
}

function decodeSaveInput(
  operation: string,
  input: SaveExternalInstructionSourceInput,
): Effect.Effect<SaveExternalInstructionSourceInput, ExtensionError> {
  return decodeUnknownSaveExternalInstructionSourceInputEffect(input).pipe(
    Effect.mapError((cause) => invalidInput(operation, cause)),
  );
}

function invalidInput(operation: string, cause: unknown): ExtensionError {
  return new ExtensionError({
    operation,
    reason: "invalid-input",
    message: "External instruction input did not match its public contract.",
    cause,
  });
}
