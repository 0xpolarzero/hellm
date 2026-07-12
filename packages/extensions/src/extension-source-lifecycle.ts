import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionError,
  type AddExtensionInstructionInput,
  type AddExtensionInstructionResult,
  type ConfigureExtensionInstructionInput,
  type ConfigureExtensionInstructionResult,
  type CreateExtensionSourceInput,
  type CreateExtensionSourceResult,
  type DeleteExtensionSourceInput,
  type DeleteExtensionSourceResult,
  type DuplicateExtensionSourceInput,
  type DuplicateExtensionSourceResult,
  type ExtensionSourceMutationId,
  type ExtensionInstructionBasename,
  type RemoveExtensionInstructionInput,
  type RemoveExtensionInstructionResult,
  type RenameExtensionInstructionInput,
  type RenameExtensionInstructionResult,
  type ReorderExtensionInstructionsInput,
  type ReorderExtensionInstructionsResult,
  type RevertExtensionSourceMutationInput,
  type RevertExtensionSourceMutationResult,
  type ResetExtensionInstructionsInput,
  type ResetExtensionInstructionsResult,
} from "@svvy/core";

import { copyTree } from "./extension-source-management";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";

type Requirements =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort;

type Manifest = Record<string, unknown> & {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  interface: "instructions" | "svvyx" | "native_tool";
  typescriptApiEnabled: boolean;
  instructionFiles: Array<{ file: string; bypassed: boolean }>;
};

const generatedInstructionPattern = /\.generated\.md$/i;

function lifecycleFailure(
  operation: string,
  extensionId: string,
  reason: "invalid-input" | "not-found" | "execution-failed" | "unsupported-operation",
  message: string,
  cause?: unknown,
): ExtensionError {
  return new ExtensionError({
    operation,
    extensionId,
    reason,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function mutationId(
  crypto: Crypto.Crypto,
  extensionId: string,
  operation: string,
): Effect.Effect<ExtensionSourceMutationId, ExtensionError> {
  return crypto.randomBytes(32).pipe(
    Effect.map(
      (bytes) =>
        `extension-source-mutation:${extensionId}:${Array.from(bytes, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")}` as ExtensionSourceMutationId,
    ),
    Effect.mapError((cause) =>
      lifecycleFailure(
        operation,
        extensionId,
        "execution-failed",
        "Failed to allocate extension source mutation id.",
        cause,
      ),
    ),
  );
}

function readManifest(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  root: string;
  operation: string;
  extensionId: string;
}): Effect.Effect<Manifest, ExtensionError> {
  const manifestPath = input.path.join(input.root, "manifest.json");
  return input.fs.readFileString(manifestPath).pipe(
    Effect.mapError((cause) =>
      lifecycleFailure(
        input.operation,
        input.extensionId,
        "not-found",
        `Extension manifest is unavailable: ${input.extensionId}`,
        cause,
      ),
    ),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) =>
          lifecycleFailure(
            input.operation,
            input.extensionId,
            "invalid-input",
            `Extension manifest is invalid JSON: ${input.extensionId}`,
            cause,
          ),
      }),
    ),
    Effect.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return Effect.fail(
          lifecycleFailure(
            input.operation,
            input.extensionId,
            "invalid-input",
            `Extension manifest must be an object: ${input.extensionId}`,
          ),
        );
      }
      const manifest = value as Partial<Manifest>;
      if (
        manifest.schemaVersion !== 1 ||
        manifest.id !== input.extensionId ||
        typeof manifest.title !== "string" ||
        typeof manifest.description !== "string" ||
        !["instructions", "svvyx", "native_tool"].includes(manifest.interface ?? "") ||
        typeof manifest.typescriptApiEnabled !== "boolean" ||
        !Array.isArray(manifest.instructionFiles) ||
        manifest.instructionFiles.some(
          (entry) =>
            !entry ||
            typeof entry !== "object" ||
            typeof entry.file !== "string" ||
            typeof entry.bypassed !== "boolean",
        )
      ) {
        return Effect.fail(
          lifecycleFailure(
            input.operation,
            input.extensionId,
            "invalid-input",
            `Extension manifest has an invalid lifecycle shape: ${input.extensionId}`,
          ),
        );
      }
      const seen = new Set<string>();
      for (const entry of manifest.instructionFiles) {
        const folded = entry.file.toLocaleLowerCase();
        if (seen.has(folded)) {
          return Effect.fail(
            lifecycleFailure(
              input.operation,
              input.extensionId,
              "invalid-input",
              `Extension manifest contains duplicate instruction file names: ${entry.file}`,
            ),
          );
        }
        seen.add(folded);
      }
      return Effect.succeed(manifest as Manifest);
    }),
  );
}

function writeManifest(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  manifest: Manifest,
  operation: string,
): Effect.Effect<void, ExtensionError> {
  return fs
    .writeFileString(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    .pipe(
      Effect.mapError(
        (cause): ExtensionError =>
          lifecycleFailure(
            operation,
            manifest.id,
            "execution-failed",
            `Failed to write staged extension manifest: ${manifest.id}`,
            cause,
          ),
      ),
    );
}

function locateSource(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  extensionsRoot: string;
  packagedRoot: string;
  extensionId: string;
  operation: string;
}): Effect.Effect<
  { root: string; category: "user" | "builtin"; materialized: boolean },
  ExtensionError
> {
  return Effect.gen(function* () {
    const user = input.path.join(input.extensionsRoot, "sources", "user", input.extensionId);
    if (yield* input.fs.exists(user)) {
      return { root: user, category: "user" as const, materialized: true };
    }
    const builtin = input.path.join(input.extensionsRoot, "sources", "builtin", input.extensionId);
    if (yield* input.fs.exists(builtin)) {
      return { root: builtin, category: "builtin" as const, materialized: true };
    }
    const packaged = input.path.join(input.packagedRoot, input.extensionId);
    if (yield* input.fs.exists(packaged)) {
      return { root: packaged, category: "builtin" as const, materialized: false };
    }
    return yield* Effect.fail(
      lifecycleFailure(
        input.operation,
        input.extensionId,
        "not-found",
        `Extension source does not exist: ${input.extensionId}`,
      ),
    );
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            input.operation,
            input.extensionId,
            "execution-failed",
            `Failed to locate extension source: ${input.extensionId}`,
            cause,
          ),
    ),
  );
}

function publishNew(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  live: string;
  staging: string;
  operation: string;
  extensionId: string;
}): Effect.Effect<void, ExtensionError> {
  return Effect.gen(function* () {
    yield* input.fs.makeDirectory(input.path.dirname(input.live), { recursive: true });
    if (yield* input.fs.exists(input.live)) {
      return yield* Effect.fail(
        lifecycleFailure(
          input.operation,
          input.extensionId,
          "invalid-input",
          `Extension source already exists: ${input.extensionId}`,
        ),
      );
    }
    yield* input.fs.rename(input.staging, input.live);
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            input.operation,
            input.extensionId,
            "execution-failed",
            `Failed to publish extension source: ${input.extensionId}`,
            cause,
          ),
    ),
    Effect.ensuring(
      input.fs.remove(input.staging, { recursive: true, force: true }).pipe(Effect.ignore),
    ),
  );
}

function replaceLive(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  crypto: Crypto.Crypto;
  extensionsRoot: string;
  live: string;
  staging: string;
  mutationId: ExtensionSourceMutationId;
  operation: string;
  extensionId: string;
  revertsMutationId?: ExtensionSourceMutationId;
}): Effect.Effect<void, ExtensionError> {
  const payload = input.path.join(
    input.extensionsRoot,
    ".svvy",
    "lifecycle-payloads",
    input.mutationId,
  );
  const journal = input.path.join(
    input.extensionsRoot,
    ".svvy",
    "lifecycle-journal",
    `${input.mutationId}.json`,
  );
  const record = (status: "prepared" | "committed", digests: Record<string, string> = {}) =>
    input.fs.writeFileString(
      journal,
      `${JSON.stringify({ schemaVersion: 1, kind: "replace", mutationId: input.mutationId, operation: input.operation, extensionId: input.extensionId, status, live: input.live, staging: input.staging, payload, ...(input.revertsMutationId ? { revertsMutationId: input.revertsMutationId } : {}), ...digests }, null, 2)}\n`,
    );
  return Effect.gen(function* () {
    yield* input.fs.makeDirectory(input.path.dirname(payload), { recursive: true });
    yield* input.fs.makeDirectory(input.path.dirname(journal), { recursive: true });
    yield* record("prepared");
    yield* input.fs.rename(input.live, payload);
    yield* input.fs
      .rename(input.staging, input.live)
      .pipe(Effect.tapError(() => input.fs.rename(payload, input.live).pipe(Effect.ignore)));
    yield* record("committed", {
      beforeDigest: yield* sourceTreeDigest(input, payload),
      afterDigest: yield* sourceTreeDigest(input, input.live),
    });
  }).pipe(
    Effect.mapError((cause) =>
      lifecycleFailure(
        input.operation,
        input.extensionId,
        "execution-failed",
        `Failed to atomically replace extension source: ${input.extensionId}`,
        cause,
      ),
    ),
    Effect.ensuring(
      input.fs.remove(input.staging, { recursive: true, force: true }).pipe(Effect.ignore),
    ),
  );
}

function sourceTreeDigest(
  input: {
    fs: FileSystem.FileSystem;
    path: Path.Path;
    crypto: Crypto.Crypto;
    operation: string;
    extensionId: string;
  },
  root: string,
): Effect.Effect<string, ExtensionError> {
  const walk = (
    current: string,
    relative: string,
  ): Effect.Effect<Array<[string, string]>, ExtensionError> =>
    input.fs.readDirectory(current).pipe(
      Effect.flatMap((names) =>
        Effect.forEach(names.toSorted(), (name) => {
          const absolute = input.path.join(current, name);
          const child = relative ? `${relative}/${name}` : name;
          return Effect.gen(function* () {
            const stat = yield* input.fs
              .stat(absolute)
              .pipe(
                Effect.mapError((cause) =>
                  lifecycleFailure(
                    input.operation,
                    input.extensionId,
                    "execution-failed",
                    `Failed to inspect extension source entry: ${child}`,
                    cause,
                  ),
                ),
              );
            if (stat.type === "SymbolicLink") {
              return yield* Effect.fail(
                lifecycleFailure(
                  input.operation,
                  input.extensionId,
                  "invalid-input",
                  `Extension source contains a symbolic link: ${child}`,
                ),
              );
            }
            if (stat.type === "Directory") return yield* walk(absolute, child);
            if (stat.type === "File") {
              const content = yield* input.fs
                .readFileString(absolute)
                .pipe(
                  Effect.mapError((cause) =>
                    lifecycleFailure(
                      input.operation,
                      input.extensionId,
                      "execution-failed",
                      `Failed to read extension source entry: ${child}`,
                      cause,
                    ),
                  ),
                );
              return [[child, content] as [string, string]];
            }
            return yield* Effect.fail(
              lifecycleFailure(
                input.operation,
                input.extensionId,
                "invalid-input",
                `Extension source contains an unsupported entry: ${child}`,
              ),
            );
          });
        }),
      ),
      Effect.map((parts) => parts.flat()),
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              input.operation,
              input.extensionId,
              "execution-failed",
              "Failed to fingerprint extension source tree.",
              cause,
            ),
      ),
    );
  return walk(root, "").pipe(
    Effect.map((entries) => JSON.stringify(entries)),
    Effect.flatMap((canonical) =>
      input.crypto.digest("SHA-256", new TextEncoder().encode(canonical)),
    ),
    Effect.map(
      (bytes) =>
        `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    ),
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            input.operation,
            input.extensionId,
            "execution-failed",
            "Failed to fingerprint extension source tree.",
            cause,
          ),
    ),
  );
}

function stageEditable(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  crypto: Crypto.Crypto;
  extensionsRoot: string;
  packagedRoot: string;
  extensionId: string;
  operation: string;
}): Effect.Effect<{ live: string; staging: string; manifest: Manifest }, ExtensionError> {
  return Effect.gen(function* () {
    const located = yield* locateSource(input);
    if (!located.materialized) {
      const live = input.path.join(input.extensionsRoot, "sources", "builtin", input.extensionId);
      const nonce = yield* input.crypto.randomUUIDv4;
      const scaffold = `${live}.staging-${nonce}`;
      yield* copyTree({
        fs: input.fs,
        path: input.path,
        from: located.root,
        to: scaffold,
        onFailure: (message, cause) =>
          lifecycleFailure(input.operation, input.extensionId, "execution-failed", message, cause),
      });
      yield* publishNew({ ...input, live, staging: scaffold });
    }
    const live = located.materialized
      ? located.root
      : input.path.join(input.extensionsRoot, "sources", "builtin", input.extensionId);
    const manifest = yield* readManifest({ ...input, root: live });
    if (manifest.interface === "native_tool" && located.category !== "builtin") {
      return yield* Effect.fail(
        lifecycleFailure(
          input.operation,
          input.extensionId,
          "invalid-input",
          "Native tool sources are app-owned.",
        ),
      );
    }
    const nonce = yield* input.crypto.randomUUIDv4;
    const staging = `${live}.staging-${nonce}`;
    yield* copyTree({
      fs: input.fs,
      path: input.path,
      from: live,
      to: staging,
      onFailure: (message, cause) =>
        lifecycleFailure(input.operation, input.extensionId, "execution-failed", message, cause),
    });
    return { live, staging, manifest };
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            input.operation,
            input.extensionId,
            "execution-failed",
            "Failed to stage extension source.",
            cause,
          ),
    ),
  );
}

function withEnvironment<A>(
  f: (environment: {
    fs: FileSystem.FileSystem;
    path: Path.Path;
    crypto: Crypto.Crypto;
    extensionsRoot: string;
    packagedRoot: string;
  }) => Effect.Effect<A, ExtensionError>,
): Effect.Effect<A, ExtensionError, Requirements> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templates = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const environment = {
      fs,
      path,
      crypto,
      extensionsRoot: path.resolve(roots.extensionsRoot),
      packagedRoot: path.resolve(templates.builtinExtensionsRoot),
    };
    yield* recoverExtensionSourceLifecycle(environment);
    return yield* f(environment);
  });
}

export function recoverExtensionSourceMutations(): Effect.Effect<
  void,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    yield* recoverExtensionSourceLifecycle({
      fs,
      path,
      crypto,
      extensionsRoot: path.resolve(roots.extensionsRoot),
    });
  });
}

function recoverExtensionSourceLifecycle(environment: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  crypto: Crypto.Crypto;
  extensionsRoot: string;
}): Effect.Effect<void, ExtensionError> {
  const operation = "extensions.sources.recover-lifecycle";
  const journalRoot = environment.path.join(
    environment.extensionsRoot,
    ".svvy",
    "lifecycle-journal",
  );
  const contained = (candidate: unknown): candidate is string =>
    typeof candidate === "string" &&
    (environment.path.resolve(candidate) === environment.extensionsRoot ||
      environment.path.resolve(candidate).startsWith(`${environment.extensionsRoot}/`));
  return Effect.gen(function* () {
    if (!(yield* environment.fs.exists(journalRoot))) return;
    for (const name of yield* environment.fs.readDirectory(journalRoot)) {
      if (!name.endsWith(".json")) continue;
      const journal = environment.path.join(journalRoot, name);
      const raw = JSON.parse(yield* environment.fs.readFileString(journal)) as Record<
        string,
        unknown
      >;
      if (raw.status !== "prepared") continue;
      if (!contained(raw.live)) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            typeof raw.extensionId === "string" ? raw.extensionId : "unknown",
            "invalid-input",
            "Lifecycle journal contains a path outside the extensions root.",
          ),
        );
      }
      const live = raw.live;
      const liveExists = yield* environment.fs.exists(live);
      if (raw.operation === "extensions.sources.delete-extension") {
        if (!contained(raw.trash)) {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              String(raw.extensionId),
              "invalid-input",
              "Delete lifecycle journal contains an invalid trash path.",
            ),
          );
        }
        const trashExists = yield* environment.fs.exists(raw.trash);
        if (!liveExists && trashExists) {
          yield* environment.fs.writeFileString(
            journal,
            `${JSON.stringify({ ...raw, status: "committed" }, null, 2)}\n`,
          );
        } else if (liveExists && !trashExists) {
          yield* environment.fs.remove(journal, { force: true });
        } else {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              String(raw.extensionId),
              "invalid-input",
              "Delete lifecycle recovery found ambiguous live/trash state.",
            ),
          );
        }
        continue;
      }
      if (!contained(raw.staging) || !contained(raw.payload)) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            String(raw.extensionId),
            "invalid-input",
            "Replace lifecycle journal contains an invalid transaction path.",
          ),
        );
      }
      const stagingExists = yield* environment.fs.exists(raw.staging);
      const payloadExists = yield* environment.fs.exists(raw.payload);
      if (!liveExists && payloadExists && stagingExists) {
        yield* environment.fs.rename(raw.staging, live);
        yield* environment.fs.writeFileString(
          journal,
          `${JSON.stringify({ ...raw, status: "committed", beforeDigest: yield* sourceTreeDigest({ ...environment, operation, extensionId: String(raw.extensionId) }, raw.payload), afterDigest: yield* sourceTreeDigest({ ...environment, operation, extensionId: String(raw.extensionId) }, live) }, null, 2)}\n`,
        );
      } else if (liveExists && payloadExists) {
        yield* environment.fs.remove(raw.staging, { recursive: true, force: true });
        yield* environment.fs.writeFileString(
          journal,
          `${JSON.stringify({ ...raw, status: "committed", beforeDigest: yield* sourceTreeDigest({ ...environment, operation, extensionId: String(raw.extensionId) }, raw.payload), afterDigest: yield* sourceTreeDigest({ ...environment, operation, extensionId: String(raw.extensionId) }, live) }, null, 2)}\n`,
        );
      } else if (!liveExists && payloadExists) {
        yield* environment.fs.rename(raw.payload, live);
        yield* environment.fs.remove(journal, { force: true });
      } else if (liveExists && !payloadExists) {
        yield* environment.fs.remove(raw.staging, { recursive: true, force: true });
        yield* environment.fs.remove(journal, { force: true });
      } else {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            String(raw.extensionId),
            "invalid-input",
            "Lifecycle recovery found an unrecoverable transaction state.",
          ),
        );
      }
    }
    for (const name of yield* environment.fs.readDirectory(journalRoot)) {
      if (!name.endsWith(".json")) continue;
      const child = environment.path.join(journalRoot, name);
      const raw = JSON.parse(yield* environment.fs.readFileString(child)) as Record<
        string,
        unknown
      >;
      if (
        (raw.status !== "committed" && raw.status !== "retained") ||
        typeof raw.revertsMutationId !== "string" ||
        typeof raw.mutationId !== "string"
      )
        continue;
      const target = environment.path.join(journalRoot, `${raw.revertsMutationId}.json`);
      if (!(yield* environment.fs.exists(target))) continue;
      const targetRaw = JSON.parse(yield* environment.fs.readFileString(target)) as Record<
        string,
        unknown
      >;
      if (targetRaw.status === "retained") {
        yield* environment.fs.writeFileString(
          target,
          `${JSON.stringify({ ...targetRaw, status: "reverted", revertedBy: raw.mutationId }, null, 2)}\n`,
        );
      }
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            operation,
            "unknown",
            "execution-failed",
            "Failed to recover extension source lifecycle transactions.",
            cause,
          ),
    ),
  );
}

export function finalizeExtensionSourceMutation(
  mutation: ExtensionSourceMutationId,
): Effect.Effect<
  { readonly finalized: boolean },
  ExtensionError,
  FileSystem.FileSystem | Path.Path | ExtensionSourceRootsPort
> {
  const operation = "extensions.sources.finalize-lifecycle";
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const journal = path.join(
      path.resolve(roots.extensionsRoot),
      ".svvy",
      "lifecycle-journal",
      `${mutation}.json`,
    );
    if (!(yield* fs.exists(journal))) return { finalized: false };
    const raw = JSON.parse(yield* fs.readFileString(journal)) as Record<string, unknown>;
    if (raw.mutationId !== mutation) {
      return yield* Effect.fail(
        lifecycleFailure(
          operation,
          typeof raw.extensionId === "string" ? raw.extensionId : "unknown",
          "invalid-input",
          "Lifecycle mutation is not committed and cannot be finalized.",
        ),
      );
    }
    if (raw.status === "retained" || raw.status === "reverted") {
      return { finalized: false };
    }
    if (raw.status !== "committed") {
      return yield* Effect.fail(
        lifecycleFailure(
          operation,
          typeof raw.extensionId === "string" ? raw.extensionId : "unknown",
          "invalid-input",
          "Lifecycle mutation is not committed and cannot be finalized.",
        ),
      );
    }
    yield* fs.writeFileString(
      journal,
      `${JSON.stringify({ ...raw, status: "retained", retention: "reversible-history" }, null, 2)}\n`,
    );
    return { finalized: true };
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : lifecycleFailure(
            operation,
            "unknown",
            "execution-failed",
            "Failed to finalize extension source mutation.",
            cause,
          ),
    ),
  );
}

export function revertExtensionSourceMutation(
  input: RevertExtensionSourceMutationInput,
): Effect.Effect<RevertExtensionSourceMutationResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.revert-mutation";
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const journal = environment.path.join(
        environment.extensionsRoot,
        ".svvy",
        "lifecycle-journal",
        `${input.mutationId}.json`,
      );
      if (!(yield* environment.fs.exists(journal))) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            "unknown",
            "not-found",
            `Lifecycle mutation does not exist: ${input.mutationId}`,
          ),
        );
      }
      const raw = JSON.parse(yield* environment.fs.readFileString(journal)) as Record<
        string,
        unknown
      >;
      const extensionId = typeof raw.extensionId === "string" ? raw.extensionId : "unknown";
      const contained = (candidate: unknown): candidate is string =>
        typeof candidate === "string" &&
        environment.path.resolve(candidate).startsWith(`${environment.extensionsRoot}/`);
      if (
        raw.mutationId === input.mutationId &&
        raw.kind === "delete" &&
        raw.status === "retained" &&
        contained(raw.live) &&
        contained(raw.payload) &&
        typeof raw.beforeDigest === "string"
      ) {
        if (yield* environment.fs.exists(raw.live)) {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              extensionId,
              "invalid-input",
              `Extension source already exists and blocks delete revert: ${raw.live}`,
            ),
          );
        }
        if (!(yield* environment.fs.exists(raw.payload))) {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              extensionId,
              "invalid-input",
              "Lifecycle mutation payload is incomplete.",
            ),
          );
        }
        const payloadDigest = yield* sourceTreeDigest(
          { ...environment, operation, extensionId },
          raw.payload,
        );
        if (payloadDigest !== raw.beforeDigest) {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              extensionId,
              "invalid-input",
              "Extension source changed after the target lifecycle mutation.",
            ),
          );
        }
        const nextId = yield* mutationId(environment.crypto, extensionId, operation);
        const nextJournal = environment.path.join(
          environment.extensionsRoot,
          ".svvy",
          "lifecycle-journal",
          `${nextId}.json`,
        );
        yield* environment.fs.writeFileString(
          nextJournal,
          `${JSON.stringify({ schemaVersion: 1, kind: "delete-revert", mutationId: nextId, operation, extensionId, status: "prepared", live: raw.live, payload: raw.payload, revertsMutationId: input.mutationId }, null, 2)}\n`,
        );
        yield* environment.fs.rename(raw.payload, raw.live);
        yield* environment.fs.writeFileString(
          nextJournal,
          `${JSON.stringify({ schemaVersion: 1, kind: "delete-revert", mutationId: nextId, operation, extensionId, status: "committed", live: raw.live, revertsMutationId: input.mutationId, afterDigest: yield* sourceTreeDigest({ ...environment, operation, extensionId }, raw.live) }, null, 2)}\n`,
        );
        yield* environment.fs.writeFileString(
          journal,
          `${JSON.stringify({ ...raw, status: "reverted", revertedBy: nextId }, null, 2)}\n`,
        );
        return {
          action: "mutation-reverted",
          mutationId: nextId,
          revertedMutationId: input.mutationId,
          extensionId: extensionId as RevertExtensionSourceMutationResult["extensionId"],
          changed: true,
        } satisfies RevertExtensionSourceMutationResult;
      }
      if (
        raw.mutationId !== input.mutationId ||
        raw.kind !== "replace" ||
        raw.status !== "retained" ||
        !contained(raw.live) ||
        !contained(raw.payload) ||
        typeof raw.beforeDigest !== "string" ||
        typeof raw.afterDigest !== "string"
      ) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            extensionId,
            "invalid-input",
            "Lifecycle mutation is not a reversible retained source replacement.",
          ),
        );
      }
      if (
        !(yield* environment.fs.exists(raw.live)) ||
        !(yield* environment.fs.exists(raw.payload))
      ) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            extensionId,
            "invalid-input",
            "Lifecycle mutation payload is incomplete.",
          ),
        );
      }
      const currentDigest = yield* sourceTreeDigest(
        { ...environment, operation, extensionId },
        raw.live,
      );
      const payloadDigest = yield* sourceTreeDigest(
        { ...environment, operation, extensionId },
        raw.payload,
      );
      if (currentDigest !== raw.afterDigest || payloadDigest !== raw.beforeDigest) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            extensionId,
            "invalid-input",
            "Extension source changed after the target lifecycle mutation.",
          ),
        );
      }
      const nextId = yield* mutationId(environment.crypto, extensionId, operation);
      const staging = `${raw.live}.staging-${nextId}`;
      yield* copyTree({
        fs: environment.fs,
        path: environment.path,
        from: raw.payload,
        to: staging,
        onFailure: (message, cause) =>
          lifecycleFailure(operation, extensionId, "execution-failed", message, cause),
      });
      yield* replaceLive({
        ...environment,
        live: raw.live,
        staging,
        mutationId: nextId,
        operation,
        extensionId,
        revertsMutationId: input.mutationId,
      });
      yield* environment.fs.writeFileString(
        journal,
        `${JSON.stringify({ ...raw, status: "reverted", revertedBy: nextId }, null, 2)}\n`,
      );
      return {
        action: "mutation-reverted",
        mutationId: nextId,
        revertedMutationId: input.mutationId,
        extensionId: extensionId as RevertExtensionSourceMutationResult["extensionId"],
        changed: true,
      } satisfies RevertExtensionSourceMutationResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              operation,
              "unknown",
              "execution-failed",
              "Failed to revert extension source mutation.",
              cause,
            ),
      ),
    ),
  );
}

export function createExtensionSource(
  input: CreateExtensionSourceInput,
): Effect.Effect<CreateExtensionSourceResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.create-extension";
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      if (input.id === "extensions") {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.id,
            "invalid-input",
            "Extension id is reserved by svvyx.",
          ),
        );
      }
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.id)) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.id,
            "invalid-input",
            "Extension id must be lowercase kebab-case starting with a letter.",
          ),
        );
      }
      const id = yield* mutationId(environment.crypto, input.id, operation);
      const live = environment.path.join(environment.extensionsRoot, "sources", "user", input.id);
      const staging = `${live}.staging-${id}`;
      const builtin = environment.path.join(environment.packagedRoot, input.id);
      const trash = environment.path.join(environment.extensionsRoot, ".svvy", "trash");
      if ((yield* environment.fs.exists(builtin)) || (yield* environment.fs.exists(live))) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.id,
            "invalid-input",
            `Extension id already exists: ${input.id}`,
          ),
        );
      }
      if (yield* environment.fs.exists(trash)) {
        const entries = yield* environment.fs.readDirectory(trash);
        if (entries.some((entry) => entry.endsWith(`-${input.id}`))) {
          return yield* Effect.fail(
            lifecycleFailure(
              operation,
              input.id,
              "invalid-input",
              `Extension id remains reserved by trash: ${input.id}`,
            ),
          );
        }
      }
      yield* environment.fs.makeDirectory(environment.path.join(staging, "instructions", "full"), {
        recursive: true,
      });
      yield* environment.fs.makeDirectory(environment.path.join(staging, "instructions"), {
        recursive: true,
      });
      const instructionName = `010-${input.id}.mdx`;
      yield* environment.fs.writeFileString(
        environment.path.join(staging, "instructions", "full", instructionName),
        `# ${input.title}\n`,
      );
      yield* environment.fs.writeFileString(
        environment.path.join(staging, "instructions", "minimal.mdx"),
        "",
      );
      if (input.interfaceKind === "svvyx") {
        yield* environment.fs.makeDirectory(environment.path.join(staging, "source"), {
          recursive: true,
        });
        yield* environment.fs.writeFileString(
          environment.path.join(staging, "source", "index.ts"),
          [
            'import { Cli } from "incur";',
            "",
            `const cli = Cli.create(${JSON.stringify(input.id)}, {`,
            `  description: ${JSON.stringify(input.description)},`,
            "});",
            "",
            "export default cli;",
            "",
          ].join("\n"),
        );
      }
      yield* writeManifest(
        environment.fs,
        environment.path,
        staging,
        {
          schemaVersion: 1,
          id: input.id,
          title: input.title,
          description: input.description,
          interface: input.interfaceKind,
          typescriptApiEnabled: input.typescriptApiEnabled,
          ...(input.interfaceKind === "svvyx" && input.typescriptApiEnabled
            ? { workflowTaskAgentReferenceExportEnabled: true }
            : {}),
          instructionFiles: [{ file: instructionName, bypassed: false }],
        },
        operation,
      );
      yield* publishNew({ ...environment, live, staging, operation, extensionId: input.id });
      return {
        action: "created",
        mutationId: id,
        extensionId: input.id,
        changed: true,
      } satisfies CreateExtensionSourceResult;
    }).pipe(
      Effect.mapError(
        (cause): ExtensionError =>
          cause instanceof ExtensionError
            ? cause
            : lifecycleFailure(
                operation,
                input.id,
                "execution-failed",
                "Failed to create extension source.",
                cause,
              ),
      ),
    ),
  );
}

export function duplicateExtensionSource(
  input: DuplicateExtensionSourceInput,
): Effect.Effect<DuplicateExtensionSourceResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.duplicate-extension";
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const source = yield* locateSource({
        ...environment,
        extensionId: input.sourceExtensionId,
        operation,
      });
      const sourceManifest = yield* readManifest({
        ...environment,
        root: source.root,
        extensionId: input.sourceExtensionId,
        operation,
      });
      if (sourceManifest.interface === "native_tool") {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.sourceExtensionId,
            "unsupported-operation",
            "App-native extensions cannot be duplicated.",
          ),
        );
      }
      const id = yield* mutationId(environment.crypto, input.targetExtensionId, operation);
      const live = environment.path.join(
        environment.extensionsRoot,
        "sources",
        "user",
        input.targetExtensionId,
      );
      const staging = `${live}.staging-${id}`;
      if (
        (yield* environment.fs.exists(live)) ||
        (yield* environment.fs.exists(
          environment.path.join(environment.packagedRoot, input.targetExtensionId),
        ))
      ) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.targetExtensionId,
            "invalid-input",
            `Extension id already exists: ${input.targetExtensionId}`,
          ),
        );
      }
      yield* copyTree({
        fs: environment.fs,
        path: environment.path,
        from: source.root,
        to: staging,
        onFailure: (message, cause) =>
          lifecycleFailure(operation, input.targetExtensionId, "execution-failed", message, cause),
      });
      for (const excluded of [".svvy", "node_modules", "build", "current", "generated"]) {
        yield* environment.fs.remove(environment.path.join(staging, excluded), {
          recursive: true,
          force: true,
        });
      }
      if (sourceManifest.interface === "svvyx") {
        const sourceIndex = environment.path.join(staging, "source", "index.ts");
        if (!(yield* environment.fs.exists(sourceIndex))) {
          yield* environment.fs.makeDirectory(environment.path.dirname(sourceIndex), {
            recursive: true,
          });
          yield* environment.fs.writeFileString(
            sourceIndex,
            [
              'import { Cli } from "incur";',
              "",
              `const cli = Cli.create(${JSON.stringify(input.targetExtensionId)}, {`,
              `  description: ${JSON.stringify(sourceManifest.description)},`,
              "});",
              "",
              "export default cli;",
              "",
            ].join("\n"),
          );
        }
      }
      const instructionFiles = sourceManifest.instructionFiles.filter(
        (entry) => !generatedInstructionPattern.test(entry.file),
      );
      for (const entry of sourceManifest.instructionFiles) {
        if (generatedInstructionPattern.test(entry.file)) {
          yield* environment.fs.remove(
            environment.path.join(staging, "instructions", "full", entry.file),
            { force: true },
          );
        }
      }
      yield* writeManifest(
        environment.fs,
        environment.path,
        staging,
        {
          ...sourceManifest,
          id: input.targetExtensionId,
          title: input.title,
          instructionFiles,
        },
        operation,
      );
      yield* publishNew({
        ...environment,
        live,
        staging,
        operation,
        extensionId: input.targetExtensionId,
      });
      return {
        action: "duplicated",
        mutationId: id,
        sourceExtensionId: input.sourceExtensionId,
        extensionId: input.targetExtensionId,
        changed: true,
      } satisfies DuplicateExtensionSourceResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              operation,
              input.targetExtensionId,
              "execution-failed",
              "Failed to duplicate extension source.",
              cause,
            ),
      ),
    ),
  );
}

export function deleteExtensionSource(
  input: DeleteExtensionSourceInput,
): Effect.Effect<DeleteExtensionSourceResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.delete-extension";
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const live = environment.path.join(
        environment.extensionsRoot,
        "sources",
        "user",
        input.extensionId,
      );
      if (!(yield* environment.fs.exists(live))) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "unsupported-operation",
            "Only user extensions can be deleted.",
          ),
        );
      }
      const id = yield* mutationId(environment.crypto, input.extensionId, operation);
      const trash = environment.path.join(
        environment.extensionsRoot,
        ".svvy",
        "trash",
        id,
        "sources",
        "user",
        input.extensionId,
      );
      const journal = environment.path.join(
        environment.extensionsRoot,
        ".svvy",
        "lifecycle-journal",
        `${id}.json`,
      );
      yield* environment.fs.makeDirectory(environment.path.dirname(trash), { recursive: true });
      yield* environment.fs.makeDirectory(environment.path.dirname(journal), { recursive: true });
      const beforeDigest = yield* sourceTreeDigest(
        { ...environment, operation, extensionId: input.extensionId },
        live,
      );
      yield* environment.fs.writeFileString(
        journal,
        `${JSON.stringify({ schemaVersion: 1, kind: "delete", mutationId: id, operation, extensionId: input.extensionId, status: "prepared", live, payload: trash, beforeDigest }, null, 2)}\n`,
      );
      yield* environment.fs.rename(live, trash);
      yield* environment.fs.writeFileString(
        journal,
        `${JSON.stringify({ schemaVersion: 1, kind: "delete", mutationId: id, operation, extensionId: input.extensionId, status: "committed", live, payload: trash, beforeDigest }, null, 2)}\n`,
      );
      return {
        action: "deleted",
        mutationId: id,
        extensionId: input.extensionId,
        changed: true,
      } satisfies DeleteExtensionSourceResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              operation,
              input.extensionId,
              "execution-failed",
              "Failed to delete extension source.",
              cause,
            ),
      ),
    ),
  );
}

export function resetExtensionInstructions(
  input: ResetExtensionInstructionsInput,
): Effect.Effect<ResetExtensionInstructionsResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.reset-extension-instructions";
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const packaged = environment.path.join(environment.packagedRoot, input.extensionId);
      if (!(yield* environment.fs.exists(packaged))) {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "unsupported-operation",
            "Only builtin extensions can be reset.",
          ),
        );
      }
      const defaultManifest = yield* readManifest({
        ...environment,
        root: packaged,
        extensionId: input.extensionId,
        operation,
      });
      const located = yield* locateSource({
        ...environment,
        extensionId: input.extensionId,
        operation,
      });
      if (located.category !== "builtin") {
        return yield* Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "unsupported-operation",
            "Only builtin extensions can be reset.",
          ),
        );
      }
      if (!located.materialized) {
        return {
          action: "reset",
          mutationId: null,
          extensionId: input.extensionId,
          scope: "instructions",
          changed: false,
        } satisfies ResetExtensionInstructionsResult;
      }
      const currentManifest = yield* readManifest({
        ...environment,
        root: located.root,
        extensionId: input.extensionId,
        operation,
      });
      const currentScope = yield* snapshotInstructionScope(
        environment.fs,
        environment.path,
        located.root,
        currentManifest,
      );
      const defaultScope = yield* snapshotInstructionScope(
        environment.fs,
        environment.path,
        packaged,
        defaultManifest,
      );
      if (currentScope === defaultScope) {
        return {
          action: "reset",
          mutationId: null,
          extensionId: input.extensionId,
          scope: "instructions",
          changed: false,
        } satisfies ResetExtensionInstructionsResult;
      }
      const id = yield* mutationId(environment.crypto, input.extensionId, operation);
      const staged = yield* stageEditable({
        ...environment,
        extensionId: input.extensionId,
        operation,
      });
      yield* environment.fs.remove(environment.path.join(staged.staging, "instructions"), {
        recursive: true,
        force: true,
      });
      yield* copyTree({
        fs: environment.fs,
        path: environment.path,
        from: environment.path.join(packaged, "instructions"),
        to: environment.path.join(staged.staging, "instructions"),
        onFailure: (message, cause) =>
          lifecycleFailure(operation, input.extensionId, "execution-failed", message, cause),
      });
      yield* writeManifest(
        environment.fs,
        environment.path,
        staged.staging,
        {
          ...staged.manifest,
          instructionFiles: defaultManifest.instructionFiles,
          ...(defaultManifest.generatedInstructions === undefined
            ? { generatedInstructions: undefined }
            : { generatedInstructions: defaultManifest.generatedInstructions }),
        },
        operation,
      );
      yield* replaceLive({
        ...environment,
        live: staged.live,
        staging: staged.staging,
        mutationId: id,
        operation,
        extensionId: input.extensionId,
      });
      return {
        action: "reset",
        mutationId: id,
        extensionId: input.extensionId,
        scope: "instructions",
        changed: true,
      } satisfies ResetExtensionInstructionsResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              operation,
              input.extensionId,
              "execution-failed",
              "Failed to reset extension instructions.",
              cause,
            ),
      ),
    ),
  );
}

function snapshotInstructionScope(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  manifest: Manifest,
): Effect.Effect<string, ExtensionError> {
  const operation = "extensions.sources.snapshot-instruction-scope";
  const extensionId = manifest.id;
  const walk = (
    directory: string,
    prefix: string,
  ): Effect.Effect<Array<[string, string]>, unknown> =>
    fs.readDirectory(directory).pipe(
      Effect.flatMap((names) =>
        Effect.forEach([...names].toSorted(), (name) => {
          const absolute = path.join(directory, name);
          const relative = prefix ? `${prefix}/${name}` : name;
          return fs.readLink(absolute).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
            Effect.flatMap((isLink) =>
              isLink
                ? Effect.fail(
                    lifecycleFailure(
                      operation,
                      extensionId,
                      "invalid-input",
                      `Instruction source contains a symbolic link: ${relative}`,
                    ),
                  )
                : fs
                    .stat(absolute)
                    .pipe(
                      Effect.flatMap((stat) =>
                        stat.type === "Directory"
                          ? walk(absolute, relative)
                          : stat.type === "File"
                            ? fs
                                .readFileString(absolute)
                                .pipe(Effect.map((text) => [[relative, text] as [string, string]]))
                            : Effect.fail(
                                lifecycleFailure(
                                  operation,
                                  extensionId,
                                  "invalid-input",
                                  `Instruction source contains an unsupported entry: ${relative}`,
                                ),
                              ),
                      ),
                    ),
            ),
          );
        }).pipe(Effect.map((entries) => entries.flat() as Array<[string, string]>)),
      ),
      Effect.mapError(
        (cause): ExtensionError =>
          cause instanceof ExtensionError
            ? cause
            : lifecycleFailure(
                operation,
                extensionId,
                "execution-failed",
                `Failed to inspect instruction scope: ${extensionId}`,
                cause,
              ),
      ),
    );
  return walk(path.join(root, "instructions"), "").pipe(
    Effect.mapError(
      (cause): ExtensionError =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              operation,
              extensionId,
              "execution-failed",
              `Failed to inspect instruction scope: ${extensionId}`,
              cause,
            ),
    ),
    Effect.map((files) =>
      JSON.stringify({
        instructionFiles: manifest.instructionFiles,
        generatedInstructions: manifest.generatedInstructions ?? null,
        files,
      }),
    ),
  );
}

function mutateInstruction<T>(input: {
  extensionId: string;
  operation: string;
  probe?: (manifest: Manifest) => Effect.Effect<{ noChange: T } | void, ExtensionError>;
  change: (
    environment: { fs: FileSystem.FileSystem; path: Path.Path },
    staging: string,
    manifest: Manifest,
  ) => Effect.Effect<
    { manifest: Manifest; result: (mutationId: ExtensionSourceMutationId) => T } | { noChange: T },
    ExtensionError
  >;
}): Effect.Effect<T, ExtensionError, Requirements> {
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const located = yield* locateSource({
        ...environment,
        extensionId: input.extensionId,
        operation: input.operation,
      });
      const manifest = yield* readManifest({
        ...environment,
        root: located.root,
        extensionId: input.extensionId,
        operation: input.operation,
      });
      if (input.probe) {
        const probe = yield* input.probe(manifest);
        if (probe && "noChange" in probe) return probe.noChange;
      }
      const staged = yield* stageEditable({
        ...environment,
        extensionId: input.extensionId,
        operation: input.operation,
      });
      const change = yield* input.change(environment, staged.staging, staged.manifest);
      if ("noChange" in change) return change.noChange;
      yield* writeManifest(
        environment.fs,
        environment.path,
        staged.staging,
        change.manifest,
        input.operation,
      );
      const id = yield* mutationId(environment.crypto, input.extensionId, input.operation);
      yield* replaceLive({
        ...environment,
        live: staged.live,
        staging: staged.staging,
        mutationId: id,
        operation: input.operation,
        extensionId: input.extensionId,
      });
      return change.result(id);
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExtensionError
          ? cause
          : lifecycleFailure(
              input.operation,
              input.extensionId,
              "execution-failed",
              "Failed to mutate extension instruction source.",
              cause,
            ),
      ),
    ),
  );
}

export function addExtensionInstruction(
  input: AddExtensionInstructionInput,
): Effect.Effect<AddExtensionInstructionResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.add-instruction";
  if (generatedInstructionPattern.test(input.name)) {
    return Effect.fail(
      lifecycleFailure(
        operation,
        input.extensionId,
        "invalid-input",
        "Generated instruction outputs are read-only.",
      ),
    );
  }
  return mutateInstruction<AddExtensionInstructionResult>({
    extensionId: input.extensionId,
    operation,
    probe: (manifest) =>
      manifest.instructionFiles.some(
        (entry) => entry.file.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
      )
        ? Effect.fail(
            lifecycleFailure(
              operation,
              input.extensionId,
              "invalid-input",
              `Instruction file already exists: ${input.name}`,
            ),
          )
        : Effect.void,
    change: (environment, root, manifest) => {
      if (
        manifest.instructionFiles.some(
          (entry) => entry.file.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
        )
      ) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "invalid-input",
            `Instruction file already exists: ${input.name}`,
          ),
        );
      }
      return environment.fs
        .writeFileString(environment.path.join(root, "instructions", "full", input.name), "")
        .pipe(
          Effect.mapError((cause) =>
            lifecycleFailure(
              operation,
              input.extensionId,
              "execution-failed",
              `Failed to add instruction file: ${input.name}`,
              cause,
            ),
          ),
          Effect.as({
            manifest: {
              ...manifest,
              instructionFiles: [
                ...manifest.instructionFiles,
                { file: input.name, bypassed: false },
              ].toSorted((a, b) => a.file.localeCompare(b.file)),
            },
            result: (id: ExtensionSourceMutationId): AddExtensionInstructionResult => ({
              action: "instruction-added",
              mutationId: id,
              extensionId: input.extensionId,
              name: input.name,
              changed: true,
            }),
          }),
        );
    },
  });
}

export function removeExtensionInstruction(
  input: RemoveExtensionInstructionInput,
): Effect.Effect<RemoveExtensionInstructionResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.remove-instruction";
  if (generatedInstructionPattern.test(input.name)) {
    return Effect.fail(
      lifecycleFailure(
        operation,
        input.extensionId,
        "invalid-input",
        "Generated instruction outputs are read-only.",
      ),
    );
  }
  return mutateInstruction<RemoveExtensionInstructionResult>({
    extensionId: input.extensionId,
    operation,
    probe: (manifest) =>
      manifest.instructionFiles.some((entry) => entry.file === input.name)
        ? Effect.void
        : Effect.fail(
            lifecycleFailure(
              operation,
              input.extensionId,
              "not-found",
              `Instruction file does not exist: ${input.name}`,
            ),
          ),
    change: (environment, root, manifest) => {
      if (!manifest.instructionFiles.some((entry) => entry.file === input.name)) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "not-found",
            `Instruction file does not exist: ${input.name}`,
          ),
        );
      }
      return environment.fs
        .remove(environment.path.join(root, "instructions", "full", input.name), { force: true })
        .pipe(
          Effect.mapError((cause) =>
            lifecycleFailure(
              operation,
              input.extensionId,
              "execution-failed",
              `Failed to remove instruction file: ${input.name}`,
              cause,
            ),
          ),
          Effect.as({
            manifest: {
              ...manifest,
              instructionFiles: manifest.instructionFiles.filter(
                (entry) => entry.file !== input.name,
              ),
            },
            result: (id: ExtensionSourceMutationId): RemoveExtensionInstructionResult => ({
              action: "instruction-removed",
              mutationId: id,
              extensionId: input.extensionId,
              name: input.name,
              changed: true,
            }),
          }),
        );
    },
  });
}

export function configureExtensionInstruction(
  input: ConfigureExtensionInstructionInput,
): Effect.Effect<ConfigureExtensionInstructionResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.configure-instruction";
  return mutateInstruction({
    extensionId: input.extensionId,
    operation,
    probe: (manifest) => {
      const current = manifest.instructionFiles.find((entry) => entry.file === input.name);
      if (!current) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "not-found",
            `Instruction file does not exist: ${input.name}`,
          ),
        );
      }
      return Effect.succeed(
        current.bypassed === input.bypassed
          ? {
              noChange: {
                action: "instruction-configured",
                mutationId: null,
                extensionId: input.extensionId,
                name: input.name,
                bypassed: input.bypassed,
                changed: false,
              } satisfies ConfigureExtensionInstructionResult,
            }
          : undefined,
      );
    },
    change: (_environment, _root, manifest) => {
      const current = manifest.instructionFiles.find((entry) => entry.file === input.name);
      if (!current) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "not-found",
            `Instruction file does not exist: ${input.name}`,
          ),
        );
      }
      if (current.bypassed === input.bypassed) {
        return Effect.succeed({
          noChange: {
            action: "instruction-configured",
            mutationId: null,
            extensionId: input.extensionId,
            name: input.name,
            bypassed: input.bypassed,
            changed: false,
          },
        });
      }
      return Effect.succeed({
        manifest: {
          ...manifest,
          instructionFiles: manifest.instructionFiles.map((entry) =>
            entry.file === input.name ? { ...entry, bypassed: input.bypassed } : entry,
          ),
        },
        result: (id: ExtensionSourceMutationId): ConfigureExtensionInstructionResult => ({
          action: "instruction-configured",
          mutationId: id,
          extensionId: input.extensionId,
          name: input.name,
          bypassed: input.bypassed,
          changed: true,
        }),
      });
    },
  });
}

export function renameExtensionInstruction(
  input: RenameExtensionInstructionInput,
): Effect.Effect<RenameExtensionInstructionResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.rename-instruction";
  return mutateInstruction({
    extensionId: input.extensionId,
    operation,
    probe: (manifest) => {
      if (!manifest.instructionFiles.some((entry) => entry.file === input.from)) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "not-found",
            `Instruction file does not exist: ${input.from}`,
          ),
        );
      }
      return manifest.instructionFiles.some(
        (entry) => entry.file.toLocaleLowerCase() === input.to.toLocaleLowerCase(),
      )
        ? Effect.fail(
            lifecycleFailure(
              operation,
              input.extensionId,
              "invalid-input",
              `Instruction file already exists: ${input.to}`,
            ),
          )
        : Effect.void;
    },
    change: (environment, root, manifest) => {
      const current = manifest.instructionFiles.find((entry) => entry.file === input.from);
      if (!current) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "not-found",
            `Instruction file does not exist: ${input.from}`,
          ),
        );
      }
      if (
        manifest.instructionFiles.some(
          (entry) => entry.file.toLocaleLowerCase() === input.to.toLocaleLowerCase(),
        )
      ) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "invalid-input",
            `Instruction file already exists: ${input.to}`,
          ),
        );
      }
      return environment.fs
        .rename(
          environment.path.join(root, "instructions", "full", input.from),
          environment.path.join(root, "instructions", "full", input.to),
        )
        .pipe(
          Effect.mapError((cause) =>
            lifecycleFailure(
              operation,
              input.extensionId,
              "execution-failed",
              `Failed to rename instruction file: ${input.from}`,
              cause,
            ),
          ),
          Effect.as({
            manifest: {
              ...manifest,
              instructionFiles: manifest.instructionFiles.map((entry) =>
                entry.file === input.from ? { ...entry, file: input.to } : entry,
              ),
            },
            result: (id: ExtensionSourceMutationId): RenameExtensionInstructionResult => ({
              action: "instruction-renamed",
              mutationId: id,
              extensionId: input.extensionId,
              from: input.from,
              to: input.to,
              changed: true,
            }),
          }),
        );
    },
  });
}

export function reorderExtensionInstructions(
  input: ReorderExtensionInstructionsInput,
): Effect.Effect<ReorderExtensionInstructionsResult, ExtensionError, Requirements> {
  const operation = "extensions.sources.reorder-instructions";
  return mutateInstruction<ReorderExtensionInstructionsResult>({
    extensionId: input.extensionId,
    operation,
    probe: (manifest) => {
      const currentNames = manifest.instructionFiles
        .filter((entry) => entry.file.endsWith(".mdx"))
        .map((entry) => entry.file);
      if (
        input.order.length !== currentNames.length ||
        new Set(input.order).size !== input.order.length ||
        input.order.some((name) => !currentNames.includes(name))
      ) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "invalid-input",
            "Reorder must mention every editable instruction file exactly once.",
          ),
        );
      }
      const finalOrder = input.order.map(
        (name, index) =>
          `${String((index + 1) * 10).padStart(3, "0")}-${name.replace(/^\d+-/, "")}`,
      );
      return Effect.succeed(
        input.order.every((name, index) => name === finalOrder[index])
          ? {
              noChange: {
                action: "instructions-reordered",
                mutationId: null,
                extensionId: input.extensionId,
                order: input.order,
                changed: false,
              } satisfies ReorderExtensionInstructionsResult,
            }
          : undefined,
      );
    },
    change: (environment, root, manifest) => {
      const editable = manifest.instructionFiles.filter((entry) => entry.file.endsWith(".mdx"));
      const currentNames = editable.map((entry) => entry.file);
      if (
        input.order.length !== currentNames.length ||
        new Set(input.order).size !== input.order.length ||
        input.order.some((name) => !currentNames.includes(name))
      ) {
        return Effect.fail(
          lifecycleFailure(
            operation,
            input.extensionId,
            "invalid-input",
            "Reorder must mention every editable instruction file exactly once.",
          ),
        );
      }
      const finalNames = new Map<string, ExtensionInstructionBasename>(
        input.order.map((name, index) => [
          name,
          `${String((index + 1) * 10).padStart(3, "0")}-${name.replace(/^\d+-/, "")}` as ExtensionInstructionBasename,
        ]),
      );
      const finalOrder = input.order.map(
        (name) => finalNames.get(name)! as ExtensionInstructionBasename,
      );
      if (input.order.every((name, index) => name === finalOrder[index])) {
        return Effect.succeed({
          noChange: {
            action: "instructions-reordered",
            mutationId: null,
            extensionId: input.extensionId,
            order: finalOrder,
            changed: false,
          },
        });
      }
      return Effect.gen(function* () {
        for (const [index, name] of input.order.entries()) {
          yield* environment.fs.rename(
            environment.path.join(root, "instructions", "full", name),
            environment.path.join(root, "instructions", "full", `.reorder-${index}.tmp`),
          );
        }
        for (const [index, name] of finalOrder.entries()) {
          yield* environment.fs.rename(
            environment.path.join(root, "instructions", "full", `.reorder-${index}.tmp`),
            environment.path.join(root, "instructions", "full", name),
          );
        }
        return {
          manifest: {
            ...manifest,
            instructionFiles: manifest.instructionFiles
              .map((entry) => {
                const name = finalNames.get(entry.file);
                return name ? { ...entry, file: name } : entry;
              })
              .toSorted((left, right) => left.file.localeCompare(right.file)),
          },
          result: (id: ExtensionSourceMutationId): ReorderExtensionInstructionsResult => ({
            action: "instructions-reordered",
            mutationId: id,
            extensionId: input.extensionId,
            order: finalOrder,
            changed: true,
          }),
        };
      }).pipe(
        Effect.mapError((cause) =>
          lifecycleFailure(
            operation,
            input.extensionId,
            "execution-failed",
            "Failed to reorder instruction files.",
            cause,
          ),
        ),
      );
    },
  });
}
