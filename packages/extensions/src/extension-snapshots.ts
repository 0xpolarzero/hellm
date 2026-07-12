import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionError,
  ExtensionSnapshotPayloadCodecs,
  type ApplyExtensionSnapshotSourceRestoreInput,
  type CaptureExtensionSnapshotSourcePayloadInput,
  type ExtensionId,
  type ExtensionSnapshotPayload,
  type ExtensionSnapshotSource,
  type ExtensionSnapshotSourceRestorePlan,
  type ExtensionSnapshotSourceRestoreReceipt,
  type FinalizeExtensionSnapshotSourceRestoreInput,
  type FinalizeExtensionSnapshotSourceRestoreResult,
  type PrepareExtensionSnapshotSourceRestoreInput,
} from "@svvy/core";

import { ExtensionSourceRootsPort } from "./extension-source-roots-port";

const operation = "extensions.snapshots";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_COUNT = 512;
const MAX_FILE_COUNT = 10_000;
const excludedNames = new Set([
  ".svvy",
  "builds",
  "generated",
  "deps",
  "node_modules",
  "package.json",
  "bun.lock",
  "bun.lockb",
]);
const snapshotPackageFileNames = ["bun.lock", "package.json"] as const;

type Requirements = FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort;

export function captureExtensionSnapshotSourcePayload(
  input: CaptureExtensionSnapshotSourcePayloadInput,
): Effect.Effect<ExtensionSnapshotPayload, ExtensionError, Requirements> {
  return withEnvironment(({ fs, path, crypto, extensionsRoot }) =>
    Effect.gen(function* () {
      const sources: ExtensionSnapshotSource[] = [];
      const capturedIds = new Set<string>();
      let totalBytes = 0;
      for (const category of ["builtin", "user"] as const) {
        const categoryRoot = path.join(extensionsRoot, "sources", category);
        if (!(yield* fs.exists(categoryRoot))) continue;
        yield* assertContainedDirectory(fs, path, extensionsRoot, categoryRoot);
        for (const extensionName of [...(yield* fs.readDirectory(categoryRoot))].toSorted()) {
          if (!isCanonicalSegment(extensionName)) {
            return yield* fail(
              "invalid-input",
              "Extension source directory name is not canonical.",
            );
          }
          const sourceRoot = path.join(categoryRoot, extensionName);
          if (capturedIds.has(extensionName)) {
            return yield* fail(
              "invalid-input",
              "Extension snapshot capture found the same extension id in multiple categories.",
            );
          }
          capturedIds.add(extensionName);
          yield* assertContainedDirectory(fs, path, categoryRoot, sourceRoot);
          const files = yield* walkRegularFiles(fs, path, crypto, sourceRoot, "");
          const manifest = files.find((file) => file.relativePath === "manifest.json");
          if (!manifest)
            return yield* fail("invalid-input", "Materialized extension source has no manifest.");
          let manifestValue: { id?: unknown };
          try {
            manifestValue = JSON.parse(
              new TextDecoder().decode(fromBase64(manifest.contentBase64)),
            ) as { id?: unknown };
          } catch {
            return yield* fail("invalid-input", "Extension source manifest is invalid JSON.");
          }
          if (manifestValue.id !== extensionName) {
            return yield* fail(
              "invalid-input",
              "Extension source manifest id does not match its directory.",
            );
          }
          totalBytes += files.reduce((sum, file) => sum + file.byteSize, 0);
          if (totalBytes > MAX_PAYLOAD_BYTES) {
            return yield* fail("invalid-input", "Extension snapshot source payload is too large.");
          }
          sources.push({
            extensionId: extensionName as ExtensionId,
            category,
            files: files.toSorted((left, right) =>
              left.relativePath.localeCompare(right.relativePath),
            ),
          });
        }
      }
      const packageRoot = path.join(extensionsRoot, "package");
      const packageFiles: Array<ExtensionSnapshotSource["files"][number]> = [];
      if (yield* fs.exists(packageRoot)) {
        yield* assertContainedDirectory(fs, path, extensionsRoot, packageRoot);
        for (const name of snapshotPackageFileNames) {
          const absolute = path.join(packageRoot, name);
          if (!(yield* fs.exists(absolute))) continue;
          const linked = yield* fs.readLink(absolute).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          );
          if (linked)
            return yield* fail("invalid-input", "Snapshot package state contains a symbolic link.");
          const canonical = yield* fs.realPath(absolute);
          if (!contained(path, packageRoot, canonical))
            return yield* fail("invalid-input", "Snapshot package state escapes its root.");
          if ((yield* fs.stat(absolute)).type !== "File")
            return yield* fail("invalid-input", "Snapshot package state is not a regular file.");
          const bytes = yield* fs.readFile(absolute);
          if (bytes.byteLength > MAX_FILE_BYTES)
            return yield* fail("invalid-input", "Snapshot package file is too large.");
          packageFiles.push({
            relativePath: name,
            contentBase64: toBase64(bytes),
            contentHash: yield* sha256(crypto, bytes),
            byteSize: bytes.byteLength,
          });
          totalBytes += bytes.byteLength;
        }
      }
      if (totalBytes > MAX_PAYLOAD_BYTES)
        return yield* fail("invalid-input", "Extension snapshot payload is too large.");
      const payload = yield* ExtensionSnapshotPayloadCodecs.decodeEffect({
        schemaVersion: 1,
        capturedAt: input.capturedAt,
        sources: sources.toSorted(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            String(a.extensionId).localeCompare(String(b.extensionId)),
        ),
        packageFiles,
        actorSettings: input.actorSettings,
        profileSettings: input.profileSettings,
        nonSecretEnvOverrideScopes: input.nonSecretEnvOverrideScopes,
        nonSecretEnvOverrides: input.nonSecretEnvOverrides,
        secretTargets: input.secretTargets,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionError({
              operation,
              reason: "invalid-input",
              message: "Captured extension snapshot payload is invalid.",
              cause,
            }),
        ),
      );
      yield* validatePayloadFiles(crypto, payload);
      return payload;
    }),
  );
}

export function prepareExtensionSnapshotSourceRestore(
  input: PrepareExtensionSnapshotSourceRestoreInput,
): Effect.Effect<ExtensionSnapshotSourceRestorePlan, ExtensionError, Requirements> {
  return withEnvironment(({ fs, path, crypto, extensionsRoot }) =>
    Effect.gen(function* () {
      const payload = yield* ExtensionSnapshotPayloadCodecs.decodeEffect(input.payload).pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionError({
              operation,
              reason: "invalid-input",
              message: "Snapshot payload is invalid.",
              cause,
            }),
        ),
      );
      yield* validatePayloadFiles(crypto, payload);
      const planRoot = restoreRoot(path, extensionsRoot, input.planId);
      const payloadText = JSON.stringify(payload);
      const plan = {
        schemaVersion: 1 as const,
        planId: input.planId,
        snapshotId: input.snapshotId,
        payloadDigest: yield* sha256(crypto, new TextEncoder().encode(payloadText)),
        sourceCount: payload.sources.length,
        fileCount:
          payload.sources.reduce((sum, source) => sum + source.files.length, 0) +
          payload.packageFiles.length,
      } satisfies ExtensionSnapshotSourceRestorePlan;
      if (
        (yield* fs.exists(path.join(planRoot, "receipt.json"))) &&
        (yield* fs.exists(path.join(planRoot, "plan.json")))
      ) {
        const existing = JSON.parse(
          yield* fs.readFileString(path.join(planRoot, "plan.json")),
        ) as ExtensionSnapshotSourceRestorePlan;
        if (JSON.stringify(existing) !== JSON.stringify(plan)) {
          return yield* fail("invalid-input", "Prepared snapshot restore plan conflicts.");
        }
        return existing;
      }
      yield* fs.remove(planRoot, { recursive: true, force: true });
      const stagedRoot = path.join(planRoot, "staged");
      for (const source of payload.sources) {
        const sourceRoot = path.join(stagedRoot, source.category, String(source.extensionId));
        for (const file of source.files) {
          const target = path.join(sourceRoot, ...file.relativePath.split("/"));
          if (!contained(path, sourceRoot, target)) {
            return yield* fail("invalid-input", "Snapshot source file escapes its staging root.");
          }
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.writeFile(target, fromBase64(file.contentBase64));
        }
      }
      const stagedPackageRoot = path.join(stagedRoot, "package");
      yield* fs.makeDirectory(stagedPackageRoot, { recursive: true });
      for (const file of payload.packageFiles) {
        yield* fs.writeFile(
          path.join(stagedPackageRoot, file.relativePath),
          fromBase64(file.contentBase64),
        );
      }
      yield* fs.makeDirectory(planRoot, { recursive: true });
      yield* fs.writeFileString(path.join(planRoot, "payload.json"), payloadText);
      yield* fs.writeFileString(path.join(planRoot, "plan.json"), JSON.stringify(plan));
      return plan;
    }),
  );
}

export function applyExtensionSnapshotSourceRestore(
  input: ApplyExtensionSnapshotSourceRestoreInput,
): Effect.Effect<ExtensionSnapshotSourceRestoreReceipt, ExtensionError, Requirements> {
  return withEnvironment((environment) =>
    Effect.gen(function* () {
      const { fs, path, crypto, extensionsRoot } = environment;
      const planRoot = restoreRoot(path, extensionsRoot, input.plan.planId);
      const journal = path.join(planRoot, "journal.json");
      const persistedReceipt = path.join(planRoot, "receipt.json");
      if (yield* fs.exists(persistedReceipt)) {
        const receipt = JSON.parse(
          yield* fs.readFileString(persistedReceipt),
        ) as ExtensionSnapshotSourceRestoreReceipt;
        if (receipt.planId !== input.plan.planId) {
          return yield* fail("invalid-input", "Persisted snapshot restore receipt does not match.");
        }
        yield* fs.remove(path.join(planRoot, "backup"), { recursive: true, force: true });
        yield* fs.remove(journal, { force: true });
        return { ...receipt, outcome: "recovered" as const };
      }
      const recoveredInterruptedAttempt = yield* recoverInterruptedRestore(environment, planRoot);
      const storedPlan = JSON.parse(
        yield* fs.readFileString(path.join(planRoot, "plan.json")),
      ) as ExtensionSnapshotSourceRestorePlan;
      if (JSON.stringify(storedPlan) !== JSON.stringify(input.plan)) {
        return yield* fail("invalid-input", "Prepared snapshot restore plan does not match.");
      }
      const payloadText = yield* fs.readFileString(path.join(planRoot, "payload.json"));
      if (
        (yield* sha256(crypto, new TextEncoder().encode(payloadText))) !== input.plan.payloadDigest
      ) {
        return yield* fail("invalid-input", "Prepared snapshot restore payload is corrupt.");
      }
      const payload = yield* ExtensionSnapshotPayloadCodecs.decodeEffect(
        JSON.parse(payloadText),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionError({
              operation,
              reason: "invalid-input",
              message: "Prepared payload is invalid.",
              cause,
            }),
        ),
      );
      yield* validateStagedFiles(environment, planRoot, payload);
      const restoredUserIds = new Set(
        payload.sources
          .filter((source) => source.category === "user")
          .map((source) => String(source.extensionId)),
      );
      const liveUserRoot = path.join(extensionsRoot, "sources", "user");
      const removedUserExtensionIds = (yield* fs.exists(liveUserRoot))
        ? (yield* fs.readDirectory(liveUserRoot))
            .filter((id) => isCanonicalSegment(id) && !restoredUserIds.has(id))
            .toSorted()
            .map((id) => id as ExtensionId)
        : [];
      yield* fs.writeFileString(journal, JSON.stringify({ schemaVersion: 1, phase: "prepared" }));
      const roots = [
        {
          key: "builtin",
          live: path.join(extensionsRoot, "sources", "builtin"),
          staged: path.join(planRoot, "staged", "builtin"),
        },
        {
          key: "user",
          live: path.join(extensionsRoot, "sources", "user"),
          staged: path.join(planRoot, "staged", "user"),
        },
        {
          key: "package",
          live: path.join(extensionsRoot, "package"),
          staged: path.join(planRoot, "staged", "package"),
        },
      ] as const;
      const apply = Effect.gen(function* () {
        for (const root of roots) {
          const { live, staged } = root;
          const backup = path.join(planRoot, "backup", root.key);
          yield* fs.makeDirectory(path.dirname(backup), { recursive: true });
          yield* fs.makeDirectory(path.dirname(live), { recursive: true });
          if (!(yield* fs.exists(live))) yield* fs.makeDirectory(live, { recursive: true });
          yield* fs.rename(live, backup);
          if (yield* fs.exists(staged)) yield* fs.rename(staged, live);
          else yield* fs.makeDirectory(live, { recursive: true });
          yield* fs.writeFileString(journal, JSON.stringify({ schemaVersion: 1, phase: root.key }));
        }
      });
      yield* apply.pipe(
        Effect.onError(() => rollbackRestore(environment, planRoot)),
        Effect.onInterrupt(() => rollbackRestore(environment, planRoot)),
        Effect.mapError((cause) =>
          cause instanceof ExtensionError
            ? cause
            : new ExtensionError({
                operation,
                reason: "execution-failed",
                message: "Failed to atomically apply extension snapshot sources.",
                cause,
              }),
        ),
      );
      const receipt = {
        planId: input.plan.planId,
        outcome: recoveredInterruptedAttempt ? "recovered" : "applied",
        sourceCount: input.plan.sourceCount,
        fileCount: input.plan.fileCount,
        removedUserExtensionIds,
      } satisfies ExtensionSnapshotSourceRestoreReceipt;
      const receiptTemporary = `${persistedReceipt}.tmp`;
      yield* fs.writeFileString(receiptTemporary, JSON.stringify(receipt));
      yield* fs.rename(receiptTemporary, persistedReceipt);
      yield* fs.remove(path.join(planRoot, "backup"), { recursive: true, force: true });
      yield* fs.remove(journal, { force: true });
      return receipt;
    }),
  );
}

export function finalizeExtensionSnapshotSourceRestore(
  input: FinalizeExtensionSnapshotSourceRestoreInput,
): Effect.Effect<FinalizeExtensionSnapshotSourceRestoreResult, ExtensionError, Requirements> {
  return withEnvironment(({ fs, path, extensionsRoot }) =>
    Effect.gen(function* () {
      const planRoot = restoreRoot(path, extensionsRoot, input.planId);
      if (!(yield* fs.exists(planRoot))) {
        return { planId: input.planId, outcome: "missing" as const };
      }
      if (yield* fs.exists(path.join(planRoot, "journal.json"))) {
        return yield* fail(
          "invalid-input",
          "Cannot finalize an extension snapshot source restore with an active journal.",
        );
      }
      yield* fs.remove(planRoot, { recursive: true, force: true });
      return { planId: input.planId, outcome: "removed" as const };
    }),
  );
}

function withEnvironment<A>(
  use: (environment: {
    fs: FileSystem.FileSystem;
    path: Path.Path;
    crypto: Crypto.Crypto;
    extensionsRoot: string;
  }) => Effect.Effect<A, unknown>,
): Effect.Effect<A, ExtensionError, Requirements> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    if (!(yield* fs.exists(roots.extensionsRoot))) {
      yield* fs.makeDirectory(roots.extensionsRoot, { recursive: true });
    }
    const rootIsLink = yield* fs.readLink(roots.extensionsRoot).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (rootIsLink)
      return yield* fail("invalid-input", "Extension source root is a symbolic link.");
    const extensionsRoot = yield* fs.realPath(roots.extensionsRoot);
    return yield* use({ fs, path, crypto, extensionsRoot });
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExtensionError
        ? cause
        : new ExtensionError({
            operation,
            reason: "execution-failed",
            message: "Snapshot source operation failed.",
            cause,
          }),
    ),
  );
}

function walkRegularFiles(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  crypto: Crypto.Crypto,
  root: string,
  prefix: string,
  exclude = true,
): Effect.Effect<ExtensionSnapshotSource["files"], unknown> {
  return Effect.gen(function* () {
    const files: Array<ExtensionSnapshotSource["files"][number]> = [];
    for (const name of [
      ...(yield* fs.readDirectory(prefix ? path.join(root, prefix) : root)),
    ].toSorted()) {
      if (!isCanonicalSegment(name))
        return yield* fail("invalid-input", "Snapshot source path is not canonical.");
      if (exclude && excludedNames.has(name)) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const absolute = path.join(root, ...relativePath.split("/"));
      const linked = yield* fs.readLink(absolute).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (linked) return yield* fail("invalid-input", "Snapshot source contains a symbolic link.");
      const canonical = yield* fs.realPath(absolute);
      if (!contained(path, root, canonical))
        return yield* fail("invalid-input", "Snapshot source escapes its root.");
      const stat = yield* fs.stat(absolute);
      if (stat.type === "Directory")
        files.push(...(yield* walkRegularFiles(fs, path, crypto, root, relativePath, exclude)));
      else if (stat.type === "File") {
        const bytes = yield* fs.readFile(absolute);
        if (bytes.byteLength > MAX_FILE_BYTES)
          return yield* fail("invalid-input", "Snapshot source file is too large.");
        files.push({
          relativePath,
          contentBase64: toBase64(bytes),
          contentHash: yield* sha256(crypto, bytes),
          byteSize: bytes.byteLength,
        });
      } else return yield* fail("invalid-input", "Snapshot source contains an unsupported entry.");
    }
    return files;
  });
}

function validatePayloadFiles(
  crypto: Crypto.Crypto,
  payload: ExtensionSnapshotPayload,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    if (payload.sources.length > MAX_SOURCE_COUNT) {
      return yield* fail("invalid-input", "Snapshot contains too many extension sources.");
    }
    let declaredFileCount = 0;
    let declaredTotalBytes = 0;
    for (const files of [payload.packageFiles, ...payload.sources.map((source) => source.files)]) {
      for (const file of files) {
        declaredFileCount += 1;
        if (declaredFileCount > MAX_FILE_COUNT) {
          return yield* fail("invalid-input", "Snapshot contains too many source files.");
        }
        if (file.byteSize > MAX_FILE_BYTES) {
          return yield* fail("invalid-input", "Snapshot source file is too large.");
        }
        declaredTotalBytes += file.byteSize;
        if (declaredTotalBytes > MAX_PAYLOAD_BYTES) {
          return yield* fail("invalid-input", "Snapshot source payload is too large.");
        }
        if (file.contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
          return yield* fail("invalid-input", "Snapshot source encoding is too large.");
        }
      }
    }
    const ids = new Set<string>();
    let fileCount = 0;
    let totalBytes = 0;
    let previousSourceKey: string | null = null;
    for (const source of payload.sources) {
      const sourceKey = `${source.category}:${source.extensionId}`;
      if (previousSourceKey !== null && sourceKey.localeCompare(previousSourceKey) <= 0) {
        return yield* fail(
          "invalid-input",
          "Snapshot extension sources are not canonically ordered.",
        );
      }
      previousSourceKey = sourceKey;
      if (ids.has(String(source.extensionId)))
        return yield* fail("invalid-input", "Snapshot has duplicate source ids.");
      ids.add(String(source.extensionId));
      const manifest = source.files.find((file) => file.relativePath === "manifest.json");
      if (!manifest) {
        return yield* fail("invalid-input", "Snapshot source has no manifest.");
      }
      try {
        const value = JSON.parse(new TextDecoder().decode(fromBase64(manifest.contentBase64))) as {
          id?: unknown;
        };
        if (value.id !== source.extensionId) {
          return yield* fail("invalid-input", "Snapshot source manifest id does not match.");
        }
      } catch {
        return yield* fail("invalid-input", "Snapshot source manifest is invalid JSON.");
      }
      const paths = new Set<string>();
      let previousPath: string | null = null;
      for (const file of source.files) {
        fileCount += 1;
        if (fileCount > MAX_FILE_COUNT) {
          return yield* fail("invalid-input", "Snapshot contains too many source files.");
        }
        if (file.byteSize > MAX_FILE_BYTES) {
          return yield* fail("invalid-input", "Snapshot source file is too large.");
        }
        totalBytes += file.byteSize;
        if (totalBytes > MAX_PAYLOAD_BYTES) {
          return yield* fail("invalid-input", "Snapshot source payload is too large.");
        }
        const maximumEncodedLength = Math.ceil(MAX_FILE_BYTES / 3) * 4;
        if (file.contentBase64.length > maximumEncodedLength) {
          return yield* fail("invalid-input", "Snapshot source encoding is too large.");
        }
        if (previousPath !== null && file.relativePath.localeCompare(previousPath) <= 0) {
          return yield* fail("invalid-input", "Snapshot source files are not canonically ordered.");
        }
        previousPath = file.relativePath;
        if (paths.has(file.relativePath) || excludedNames.has(file.relativePath.split("/")[0]!)) {
          return yield* fail(
            "invalid-input",
            "Snapshot source contains duplicate or excluded paths.",
          );
        }
        paths.add(file.relativePath);
        const bytes = fromBase64(file.contentBase64);
        if (
          bytes.byteLength !== file.byteSize ||
          (yield* sha256(crypto, bytes)) !== file.contentHash
        ) {
          return yield* fail("invalid-input", "Snapshot source file hash or size is corrupt.");
        }
      }
    }
    let previousPackagePath: string | null = null;
    for (const file of payload.packageFiles) {
      if (!snapshotPackageFileNames.includes(file.relativePath as never))
        return yield* fail("invalid-input", "Snapshot package state contains an unsupported path.");
      if (previousPackagePath !== null && file.relativePath.localeCompare(previousPackagePath) <= 0)
        return yield* fail("invalid-input", "Snapshot package files are not canonically ordered.");
      previousPackagePath = file.relativePath;
      const bytes = fromBase64(file.contentBase64);
      if (bytes.byteLength !== file.byteSize || (yield* sha256(crypto, bytes)) !== file.contentHash)
        return yield* fail("invalid-input", "Snapshot package file hash or size is corrupt.");
    }
  });
}

function validateStagedFiles(
  environment: {
    fs: FileSystem.FileSystem;
    path: Path.Path;
    crypto: Crypto.Crypto;
    extensionsRoot: string;
  },
  planRoot: string,
  payload: ExtensionSnapshotPayload,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* validatePayloadFiles(environment.crypto, payload);
    for (const source of payload.sources) {
      const root = environment.path.join(
        planRoot,
        "staged",
        source.category,
        String(source.extensionId),
      );
      yield* assertContainedDirectory(environment.fs, environment.path, planRoot, root);
      const staged = yield* walkRegularFiles(
        environment.fs,
        environment.path,
        environment.crypto,
        root,
        "",
        false,
      );
      if (
        JSON.stringify(staged.map(({ relativePath }) => relativePath)) !==
        JSON.stringify(source.files.map(({ relativePath }) => relativePath).toSorted())
      ) {
        return yield* fail(
          "invalid-input",
          "Staged snapshot source file set does not match its plan.",
        );
      }
      for (const file of source.files) {
        const bytes = yield* environment.fs.readFile(
          environment.path.join(root, ...file.relativePath.split("/")),
        );
        if (
          bytes.byteLength !== file.byteSize ||
          (yield* sha256(environment.crypto, bytes)) !== file.contentHash
        ) {
          return yield* fail("invalid-input", "Staged snapshot source is corrupt.");
        }
      }
    }
    const packageRoot = environment.path.join(planRoot, "staged", "package");
    yield* assertContainedDirectory(environment.fs, environment.path, planRoot, packageRoot);
    const stagedPackageFiles = yield* walkRegularFiles(
      environment.fs,
      environment.path,
      environment.crypto,
      packageRoot,
      "",
      false,
    );
    if (
      JSON.stringify(stagedPackageFiles.map(({ relativePath }) => relativePath)) !==
      JSON.stringify(payload.packageFiles.map(({ relativePath }) => relativePath))
    )
      return yield* fail("invalid-input", "Staged snapshot package file set does not match.");
    for (const file of payload.packageFiles) {
      const bytes = yield* environment.fs.readFile(
        environment.path.join(packageRoot, file.relativePath),
      );
      if (
        bytes.byteLength !== file.byteSize ||
        (yield* sha256(environment.crypto, bytes)) !== file.contentHash
      )
        return yield* fail("invalid-input", "Staged snapshot package state is corrupt.");
    }
  });
}

function recoverInterruptedRestore(
  environment: { fs: FileSystem.FileSystem; path: Path.Path; extensionsRoot: string },
  planRoot: string,
): Effect.Effect<boolean, unknown> {
  return Effect.gen(function* () {
    const journal = environment.path.join(planRoot, "journal.json");
    if (!(yield* environment.fs.exists(journal))) return false;
    yield* rollbackRestore(environment, planRoot);
    return true;
  });
}

function rollbackRestore(
  environment: { fs: FileSystem.FileSystem; path: Path.Path; extensionsRoot: string },
  planRoot: string,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    for (const root of [
      {
        key: "builtin",
        live: environment.path.join(environment.extensionsRoot, "sources", "builtin"),
      },
      { key: "user", live: environment.path.join(environment.extensionsRoot, "sources", "user") },
      { key: "package", live: environment.path.join(environment.extensionsRoot, "package") },
    ] as const) {
      const live = root.live;
      const backup = environment.path.join(planRoot, "backup", root.key);
      const staged = environment.path.join(planRoot, "staged", root.key);
      if (yield* environment.fs.exists(backup)) {
        if (yield* environment.fs.exists(live)) {
          yield* environment.fs.makeDirectory(environment.path.dirname(staged), {
            recursive: true,
          });
          yield* environment.fs.rename(live, staged);
        }
        yield* environment.fs.makeDirectory(environment.path.dirname(live), { recursive: true });
        yield* environment.fs.rename(backup, live);
      }
    }
    yield* environment.fs.remove(environment.path.join(planRoot, "journal.json"), { force: true });
  }).pipe(Effect.ignore);
}

function assertContainedDirectory(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  directory: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const linked = yield* fs.readLink(directory).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (linked) return yield* fail("invalid-input", "Snapshot source root is a symbolic link.");
    const canonical = yield* fs.realPath(directory);
    if (!contained(path, root, canonical))
      return yield* fail("invalid-input", "Snapshot source root escapes containment.");
    if ((yield* fs.stat(directory)).type !== "Directory")
      return yield* fail("invalid-input", "Snapshot source root is not a directory.");
  });
}

function restoreRoot(path: Path.Path, extensionsRoot: string, planId: string): string {
  return path.join(
    extensionsRoot,
    ".svvy",
    "snapshot-restore",
    planId.replace(/^extension-snapshot-source-restore:/, ""),
  );
}

function contained(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isCanonicalSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/:]/.test(value);
}

function sha256(
  crypto: Crypto.Crypto,
  bytes: Uint8Array,
): Effect.Effect<`sha256:${string}`, ExtensionError> {
  return crypto.digest("SHA-256", bytes).pipe(
    Effect.map(
      (digest) =>
        `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as const,
    ),
    Effect.mapError(
      (cause) =>
        new ExtensionError({
          operation,
          reason: "execution-failed",
          message: "Snapshot hashing failed.",
          cause,
        }),
    ),
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fail(reason: "invalid-input", message: string): Effect.Effect<never, ExtensionError> {
  return Effect.fail(new ExtensionError({ operation, reason, message }));
}
