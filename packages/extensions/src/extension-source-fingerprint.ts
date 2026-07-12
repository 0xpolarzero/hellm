import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ExtensionError, type ExtensionSourceFingerprint } from "@svvy/core";

const operation = "extensions.builds.fingerprint-source";

export interface ExtensionSourceFingerprintInput {
  readonly extensionId: string;
  readonly root: string;
  readonly declaredFiles: readonly {
    readonly role: "manifest" | "minimal-instruction" | "full-instruction" | "generator-script";
    readonly relativePath: string;
  }[];
}

export function fingerprintExtensionSource(
  input: ExtensionSourceFingerprintInput,
): Effect.Effect<
  ExtensionSourceFingerprint,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries: {
      role:
        | "manifest"
        | "minimal-instruction"
        | "full-instruction"
        | "generator-script"
        | "source-file";
      relativePath: string;
    }[] = [...input.declaredFiles];
    const sourceRoot = path.resolve(input.root, "source");
    if (
      yield* fs
        .exists(sourceRoot)
        .pipe(
          Effect.mapError((cause) =>
            failure(input.extensionId, `Failed to inspect ${sourceRoot}.`, cause),
          ),
        )
    ) {
      entries.push(
        ...(yield* collectSourceFiles({
          fs,
          path,
          extensionId: input.extensionId,
          extensionRoot: input.root,
          directory: sourceRoot,
        })).map((absolutePath) => ({
          role: "source-file" as const,
          relativePath: normalizeRelative(input.root, absolutePath, path.sep),
        })),
      );
    }
    const keys = entries.map((entry) => `${entry.role}\0${entry.relativePath}`);
    if (new Set(keys).size !== keys.length) {
      return yield* Effect.fail(
        failure(input.extensionId, "Canonical source input set contains duplicates."),
      );
    }
    const evidence: { role: string; relativePath: string; contentHash: string }[] = [];
    for (const entry of entries.toSorted((left, right) =>
      `${left.role}\0${left.relativePath}`.localeCompare(`${right.role}\0${right.relativePath}`),
    )) {
      if (!canonicalRelative(entry.relativePath)) {
        return yield* Effect.fail(
          failure(input.extensionId, `Canonical source path is invalid: ${entry.relativePath}`),
        );
      }
      const absolutePath = path.resolve(input.root, entry.relativePath);
      yield* assertRegularContained({
        fs,
        path,
        extensionId: input.extensionId,
        root: input.root,
        candidate: absolutePath,
      });
      const bytes = yield* fs
        .readFile(absolutePath)
        .pipe(
          Effect.mapError((cause) =>
            failure(input.extensionId, `Failed to read ${absolutePath}.`, cause),
          ),
        );
      evidence.push({
        role: entry.role,
        relativePath: entry.relativePath,
        contentHash: yield* sha256(bytes, input.extensionId),
      });
    }
    const framed = [
      "svvy-extension-source-v1",
      ...evidence.flatMap((entry) => [entry.role, entry.relativePath, entry.contentHash]),
    ]
      .map((part) => `${new TextEncoder().encode(part).byteLength}:${part}`)
      .join("");
    return (yield* sha256(
      new TextEncoder().encode(framed),
      input.extensionId,
    )) as ExtensionSourceFingerprint;
  });
}

function collectSourceFiles(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  extensionId: string;
  extensionRoot: string;
  directory: string;
}): Effect.Effect<string[], ExtensionError> {
  return Effect.gen(function* () {
    yield* assertDirectoryContained(input);
    const names = yield* input.fs
      .readDirectory(input.directory)
      .pipe(
        Effect.mapError((cause) =>
          failure(input.extensionId, `Failed to read ${input.directory}.`, cause),
        ),
      );
    const files: string[] = [];
    for (const name of names.toSorted()) {
      const candidate = input.path.resolve(input.directory, name);
      const stat = yield* input.fs
        .stat(candidate)
        .pipe(
          Effect.mapError((cause) =>
            failure(input.extensionId, `Failed to stat ${candidate}.`, cause),
          ),
        );
      if (stat.type === "SymbolicLink") {
        return yield* Effect.fail(
          failure(
            input.extensionId,
            `Extension source contains a symbolic-link boundary: ${candidate}`,
          ),
        );
      }
      if (stat.type === "Directory") {
        files.push(...(yield* collectSourceFiles({ ...input, directory: candidate })));
      } else if (stat.type === "File") {
        files.push(candidate);
      }
    }
    return files;
  });
}

function assertDirectoryContained(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  extensionId: string;
  extensionRoot: string;
  directory: string;
}): Effect.Effect<void, ExtensionError> {
  return Effect.gen(function* () {
    yield* assertContained(input.path, input.extensionRoot, input.directory, input.extensionId);
    const stat = yield* input.fs
      .stat(input.directory)
      .pipe(
        Effect.mapError((cause) =>
          failure(input.extensionId, `Failed to stat ${input.directory}.`, cause),
        ),
      );
    if (stat.type !== "Directory") {
      return yield* Effect.fail(
        failure(input.extensionId, `Extension source path is not a directory: ${input.directory}`),
      );
    }
  });
}

function assertRegularContained(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  extensionId: string;
  root: string;
  candidate: string;
}): Effect.Effect<void, ExtensionError> {
  return Effect.gen(function* () {
    yield* assertContained(input.path, input.root, input.candidate, input.extensionId);
    let current = input.candidate;
    while (true) {
      const stat = yield* input.fs
        .stat(current)
        .pipe(
          Effect.mapError((cause) =>
            failure(input.extensionId, `Failed to stat ${current}.`, cause),
          ),
        );
      if (stat.type === "SymbolicLink") {
        return yield* Effect.fail(
          failure(
            input.extensionId,
            `Extension source contains a symbolic-link boundary: ${current}`,
          ),
        );
      }
      if (current === input.candidate && stat.type !== "File") {
        return yield* Effect.fail(
          failure(input.extensionId, `Canonical source input is not a regular file: ${current}`),
        );
      }
      if (current === input.root) return;
      const parent = input.path.dirname(current);
      if (parent === current) {
        return yield* Effect.fail(
          failure(
            input.extensionId,
            `Extension source containment could not be proven: ${current}`,
          ),
        );
      }
      current = parent;
    }
  });
}

function assertContained(path: Path.Path, root: string, candidate: string, extensionId: string) {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot)
    ? Effect.void
    : Effect.fail(failure(extensionId, `Extension source path escapes its root: ${candidate}`));
}

function normalizeRelative(root: string, candidate: string, separator: string): string {
  return candidate
    .slice(root.length + (root.endsWith(separator) ? 0 : 1))
    .split(separator)
    .join("/");
}

function canonicalRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function sha256(
  bytes: Uint8Array,
  extensionId: string,
): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const digest = yield* crypto
      .digest("SHA-256", bytes)
      .pipe(
        Effect.mapError((cause) =>
          failure(extensionId, "Failed to fingerprint extension source.", cause),
        ),
      );
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}

function failure(extensionId: string, message: string, cause?: unknown): ExtensionError {
  return new ExtensionError({
    extensionId,
    operation,
    reason: "invalid-input",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
