import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ExtensionSnapshotPayloadCodecs,
  ExtensionSnapshotPayloadStoreError,
  SecretStorePortError,
  type ExtensionSnapshotPayloadRef,
  type ExtensionSnapshotPayloadStorePortService,
  type ExtensionSnapshotSecretPayloadRef,
  type ExtensionSnapshotSecretStorePortService,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

export interface ExtensionSnapshotPayloadStorageOptions {
  readonly root: string;
  readonly isReferenced: (ref: ExtensionSnapshotPayloadRef) => boolean;
  readonly createTemporaryId?: () => string;
}

export function createExtensionSnapshotPayloadStore(
  options: ExtensionSnapshotPayloadStorageOptions,
): ExtensionSnapshotPayloadStorePortService {
  const root = prepareOwnedRoot(options.root);
  const createTemporaryId = options.createTemporaryId ?? randomUUID;

  const readVerified = (ref: ExtensionSnapshotPayloadRef): Uint8Array => {
    validatePayloadRef(ref);
    const path = payloadPath(root, ref);
    if (!existsSync(path))
      throw payloadError("read", "not-found", "Snapshot payload was not found.");
    assertRegularOwnedFile(root, path, "read");
    const bytes = readFileSync(path);
    verifyPayloadBytes(ref, bytes, "read");
    return bytes;
  };

  return {
    put: (input) =>
      payloadEffect("put", () => {
        validatePayloadRef(input.ref);
        verifyPayloadBytes(input.ref, input.bytes, "put");
        const path = payloadPath(root, input.ref);
        secureMkdir(root, join("payloads", "v1", "sha256", digestHex(input.ref).slice(0, 2)));
        if (existsSync(path)) {
          readVerified(input.ref);
          return { ref: input.ref, outcome: "existing" as const };
        }

        const temporaryPath = `${path}.tmp-${createTemporaryId()}`;
        assertOwnedPath(root, temporaryPath, "put");
        let descriptor: number | undefined;
        try {
          descriptor = openSync(temporaryPath, "wx", 0o600);
          writeFileSync(descriptor, input.bytes);
          closeSync(descriptor);
          descriptor = undefined;
          try {
            linkSync(temporaryPath, path);
          } catch (cause) {
            if (!isAlreadyExists(cause)) throw cause;
          }
          readVerified(input.ref);
          return {
            ref: input.ref,
            outcome: lstatSync(path).ino === lstatSync(temporaryPath).ino ? "stored" : "existing",
          };
        } finally {
          if (descriptor !== undefined) closeSync(descriptor);
          try {
            unlinkSync(temporaryPath);
          } catch {
            // The temp name may have lost a same-process race or failed before creation.
          }
        }
      }),
    read: ({ ref }) => payloadEffect("read", () => ({ ref, bytes: readVerified(ref) })),
    cleanup: ({ ref }) =>
      payloadEffect("cleanup", () => {
        validatePayloadRef(ref);
        if (options.isReferenced(ref)) return { ref, outcome: "retained" as const };
        const path = payloadPath(root, ref);
        if (!existsSync(path)) return { ref, outcome: "missing" as const };
        assertRegularOwnedFile(root, path, "cleanup");
        unlinkSync(path);
        return { ref, outcome: "removed" as const };
      }),
  };
}

type SecurityResult = { readonly status: number; readonly stdout: string; readonly stderr: string };
type SecurityRunner = (args: readonly string[], input?: string) => SecurityResult;

export interface ExtensionSnapshotSecretStorageOptions {
  readonly runSecurity?: SecurityRunner;
  readonly isReferenced: (ref: ExtensionSnapshotSecretPayloadRef) => boolean;
  readonly createMaterialId?: () => string;
}

const SNAPSHOT_KEYCHAIN_SERVICE = "svvy-extension-snapshots";

export function createExtensionSnapshotSecretStore(
  options: ExtensionSnapshotSecretStorageOptions,
): ExtensionSnapshotSecretStorePortService {
  const createMaterialId = options.createMaterialId ?? randomUUID;
  const runSecurity =
    options.runSecurity ??
    ((args, input) => {
      const result = spawnSync("security", args, {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return {
        status: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    });
  return {
    put: (input) =>
      secretEffect("putSnapshotSecretPayload", () => {
        const materialId = createMaterialId();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(materialId)) {
          throw secretError("putSnapshotSecretPayload", "invalid-input");
        }
        const snapshotKey = String(input.snapshotId).slice("extension-snapshot:".length);
        const ref =
          `extension-snapshot-secret:v1:${snapshotKey}-${materialId}` as ExtensionSnapshotSecretPayloadRef;
        const envelope = JSON.stringify({
          schemaVersion: 1,
          encoding: "base64",
          bytes: Buffer.from(Redacted.value(input.bytes)).toString("base64"),
        });
        const result = runSecurity(
          ["add-generic-password", "-s", SNAPSHOT_KEYCHAIN_SERVICE, "-a", ref, "-w"],
          `${envelope}\n`,
        );
        if (result.status !== 0)
          throw secretError("putSnapshotSecretPayload", "persistence-failed");
        return { ref, outcome: "stored" as const };
      }),
    read: ({ ref }) =>
      secretEffect("readSnapshotSecretPayload", () => {
        const result = runSecurity([
          "find-generic-password",
          "-s",
          SNAPSHOT_KEYCHAIN_SERVICE,
          "-a",
          ref,
          "-w",
        ]);
        if (result.status !== 0) {
          throw secretError(
            "readSnapshotSecretPayload",
            /could not be found/i.test(result.stderr) ? "secret-not-found" : "secret-unavailable",
          );
        }
        try {
          const envelope = JSON.parse(result.stdout.replace(/\n$/, "")) as Record<string, unknown>;
          if (
            envelope.schemaVersion !== 1 ||
            envelope.encoding !== "base64" ||
            typeof envelope.bytes !== "string" ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.bytes)
          ) {
            throw new Error("invalid envelope");
          }
          return {
            ref,
            bytes: Redacted.make(new Uint8Array(Buffer.from(envelope.bytes, "base64")), {
              label: "extension-snapshot-secret-payload",
            }),
          };
        } catch (cause) {
          throw new SecretStorePortError({
            operation: "readSnapshotSecretPayload",
            reason: "secret-unavailable",
            message: "Snapshot secret payload is corrupt.",
            cause,
          });
        }
      }),
    cleanup: ({ ref }) =>
      secretEffect("cleanupSnapshotSecretPayload", () => {
        if (options.isReferenced(ref)) return { ref, outcome: "retained" as const };
        const result = runSecurity([
          "delete-generic-password",
          "-s",
          SNAPSHOT_KEYCHAIN_SERVICE,
          "-a",
          ref,
        ]);
        if (result.status === 0) return { ref, outcome: "removed" as const };
        if (/could not be found/i.test(result.stderr)) return { ref, outcome: "missing" as const };
        throw secretError("cleanupSnapshotSecretPayload", "persistence-failed");
      }),
  };
}

function prepareOwnedRoot(configuredRoot: string): string {
  if (!isAbsolute(configuredRoot)) {
    throw payloadError("configure", "invalid-input", "Snapshot payload root must be absolute.");
  }
  const configured = resolve(configuredRoot);
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  if (lstatSync(configured).isSymbolicLink()) {
    throw payloadError("configure", "unsafe-path", "Snapshot payload root must not be a symlink.");
  }
  const actual = realpathSync(configured);
  return actual;
}

function validatePayloadRef(ref: ExtensionSnapshotPayloadRef): void {
  if (
    ref.schemaVersion !== 1 ||
    ref.algorithm !== "sha256" ||
    ref.codec !== "svvy-extension-snapshot-json-v1" ||
    !/^sha256:[0-9a-f]{64}$/.test(ref.digest) ||
    !Number.isSafeInteger(ref.byteSize) ||
    ref.byteSize < 0
  ) {
    throw payloadError("validate", "invalid-input", "Snapshot payload reference is invalid.");
  }
}

function verifyPayloadBytes(
  ref: ExtensionSnapshotPayloadRef,
  bytes: Uint8Array,
  operation: string,
): void {
  if (bytes.byteLength !== ref.byteSize) {
    throw payloadError(
      operation,
      "corrupt-payload",
      "Snapshot payload byte size does not match its reference.",
    );
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== ref.digest) {
    throw payloadError(
      operation,
      "corrupt-payload",
      "Snapshot payload digest does not match its reference.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw payloadError(operation, "corrupt-payload", "Snapshot payload is not valid JSON.", cause);
  }
  const decoded = ExtensionSnapshotPayloadCodecs.decodeExit(parsed);
  if (Exit.isFailure(decoded)) {
    throw payloadError(
      operation,
      "corrupt-payload",
      "Snapshot payload does not match its codec schema.",
    );
  }
}

function digestHex(ref: ExtensionSnapshotPayloadRef): string {
  return ref.digest.slice("sha256:".length);
}

function payloadPath(root: string, ref: ExtensionSnapshotPayloadRef): string {
  const hex = digestHex(ref);
  const path = join(root, "payloads", "v1", "sha256", hex.slice(0, 2), `${hex}.json`);
  assertOwnedPath(root, path, "resolve");
  return path;
}

function secureMkdir(root: string, relativeDirectory: string): void {
  let current = root;
  for (const segment of relativeDirectory.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    assertOwnedPath(root, current, "mkdir");
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw payloadError("mkdir", "unsafe-path", "Snapshot payload directory is unsafe.");
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
  }
}

function assertRegularOwnedFile(root: string, path: string, operation: string): void {
  assertOwnedPath(root, path, operation);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw payloadError(operation, "unsafe-path", "Snapshot payload path is not a regular file.");
  }
  assertOwnedPath(root, realpathSync(path), operation);
}

function assertOwnedPath(root: string, path: string, operation: string): void {
  const child = resolve(path);
  const relation = relative(root, child);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw payloadError(
      operation,
      "unsafe-path",
      "Snapshot payload path escapes its configured root.",
    );
  }
}

function payloadEffect<A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, ExtensionSnapshotPayloadStoreError> {
  return Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof ExtensionSnapshotPayloadStoreError
        ? cause
        : payloadError(operation, "persistence-failed", "Snapshot payload storage failed.", cause),
  });
}

function secretEffect<A>(operation: string, run: () => A): Effect.Effect<A, SecretStorePortError> {
  return Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof SecretStorePortError
        ? cause
        : new SecretStorePortError({
            operation,
            reason: "secret-unavailable",
            message: "Snapshot secret storage is unavailable.",
            cause,
          }),
  });
}

function payloadError(
  operation: string,
  reason: "invalid-input" | "not-found" | "corrupt-payload" | "persistence-failed" | "unsafe-path",
  message: string,
  cause?: unknown,
): ExtensionSnapshotPayloadStoreError {
  return new ExtensionSnapshotPayloadStoreError({
    operation,
    reason,
    message,
    ...(cause ? { cause } : {}),
  });
}

function secretError(
  operation: string,
  reason: "invalid-input" | "secret-not-found" | "secret-unavailable" | "persistence-failed",
): SecretStorePortError {
  return new SecretStorePortError({
    operation,
    reason,
    message:
      reason === "secret-not-found"
        ? "Snapshot secret payload was not found."
        : reason === "invalid-input"
          ? "Snapshot secret payload input is invalid."
          : reason === "persistence-failed"
            ? "Snapshot secret payload could not be persisted."
            : "Snapshot secret storage is unavailable.",
  });
}

function isAlreadyExists(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST";
}
