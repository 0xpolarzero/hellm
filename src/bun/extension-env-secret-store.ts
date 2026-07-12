import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  SecretStorePortError,
  type ExtensionEnvSecretRef,
  type ExtensionEnvSecretTarget,
  type SecretStoreMutationPortService,
  type SecretStorePortService,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export type ExtensionEnvSecretKey = {
  kind: "extension-env";
  extensionId: string;
  envName: string;
};

export type SnapshotSecretStateStoreKey = {
  kind: "snapshot-secret-state";
  snapshotId: string;
};

export type ExtensionEnvSecretStoreKey = ExtensionEnvSecretKey | SnapshotSecretStateStoreKey;

export type ExtensionEnvSecretStore = {
  get(key: ExtensionEnvSecretStoreKey): string | undefined;
  has(key: ExtensionEnvSecretStoreKey): boolean;
  set(key: ExtensionEnvSecretStoreKey, value: string): void;
  remove(key: ExtensionEnvSecretStoreKey): void;
};

const KEYCHAIN_SERVICE = "svvy-extension-env";

type SecurityResult = { status: number; stdout: string; stderr: string };
type SecurityRunner = (args: string[], input?: string) => SecurityResult;

export type MacOsKeychainSecretStoreServices = {
  secretStore: SecretStorePortService;
  secretStoreMutation: SecretStoreMutationPortService;
};

export function createMacOsKeychainSecretStoreServices(
  options: {
    runSecurity?: SecurityRunner;
    createMaterialId?: () => string;
  } = {},
): MacOsKeychainSecretStoreServices {
  const run = options.runSecurity ?? runSecurity;
  const createMaterialId = options.createMaterialId ?? randomUUID;

  const read = (
    ref: ExtensionEnvSecretRef,
    operation: string,
  ): Effect.Effect<string, SecretStorePortError> =>
    Effect.try({
      try: () =>
        run([
          "find-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          versionedKeychainAccount(ref),
          "-w",
        ]),
      catch: () => secretStoreError(operation, "secret-unavailable"),
    }).pipe(
      Effect.flatMap((result) => {
        if (result.status === 0) {
          return Effect.succeed(result.stdout.replace(/\n$/, ""));
        }
        return Effect.fail(
          secretStoreError(
            operation,
            /could not be found/i.test(result.stderr) ? "secret-not-found" : "secret-unavailable",
          ),
        );
      }),
    );

  const resolve = (ref: ExtensionEnvSecretRef, operation: string) =>
    read(ref, operation).pipe(
      Effect.map((value) => ({
        ref,
        value: Redacted.make(value, { label: "extension-env-secret" }),
        revisionFingerprint: revisionFingerprint(ref),
      })),
    );

  const secretStore: SecretStorePortService = {
    getStatus: (ref) =>
      resolve(ref, "getStatus").pipe(
        Effect.map(({ revisionFingerprint: fingerprint }) => ({
          ref,
          configured: true,
          revisionFingerprint: fingerprint,
        })),
        Effect.catchTag("SecretStorePortError", (error) =>
          error.reason === "secret-not-found"
            ? Effect.succeed({ ref, configured: false })
            : Effect.fail(error),
        ),
      ),
    listStatus: ({ refs }) =>
      Effect.forEach(refs, (ref) => secretStore.getStatus(ref), { concurrency: 1 }),
    resolveInvocationValue: (ref) => resolve(ref, "resolveInvocationValue"),
  };

  const secretStoreMutation: SecretStoreMutationPortService = {
    writeSecretValue: (input) =>
      Effect.gen(function* () {
        if (input.replaces) {
          if (!sameTarget(input.target, input.replaces.ref)) {
            return yield* Effect.fail(secretStoreError("writeSecretValue", "invalid-input"));
          }
          const current = yield* resolve(input.replaces.ref, "writeSecretValue");
          if (current.revisionFingerprint !== input.replaces.expectedRevisionFingerprint) {
            return yield* Effect.fail(secretStoreError("writeSecretValue", "state-conflict"));
          }
        }

        const materialId = input.materialId ?? createMaterialId();
        if (!/^[A-Za-z0-9_-]+$/.test(materialId)) {
          return yield* Effect.fail(secretStoreError("writeSecretValue", "invalid-input"));
        }
        const ref = { ...input.target, materialId } as ExtensionEnvSecretRef;
        const value = Redacted.value(input.value);
        const result = yield* Effect.try({
          try: () =>
            run(
              [
                "add-generic-password",
                ...(input.materialId ? ["-U"] : []),
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                versionedKeychainAccount(ref),
                "-w",
              ],
              `${value}\n`,
            ),
          catch: () => secretStoreError("writeSecretValue", "secret-unavailable"),
        });
        if (result.status !== 0) {
          return yield* Effect.fail(secretStoreError("writeSecretValue", "persistence-failed"));
        }
        return { ref, revisionFingerprint: revisionFingerprint(ref) };
      }),
    removeSecretValue: (input) =>
      Effect.gen(function* () {
        const current = yield* resolve(input.ref, "removeSecretValue");
        if (
          input.expectedRevisionFingerprint !== undefined &&
          input.expectedRevisionFingerprint !== current.revisionFingerprint
        ) {
          return yield* Effect.fail(secretStoreError("removeSecretValue", "state-conflict"));
        }
        const result = yield* Effect.try({
          try: () =>
            run([
              "delete-generic-password",
              "-s",
              KEYCHAIN_SERVICE,
              "-a",
              versionedKeychainAccount(input.ref),
            ]),
          catch: () => secretStoreError("removeSecretValue", "secret-unavailable"),
        });
        if (result.status !== 0) {
          return yield* Effect.fail(
            secretStoreError(
              "removeSecretValue",
              /could not be found/i.test(result.stderr) ? "secret-not-found" : "persistence-failed",
            ),
          );
        }
        return {
          ref: input.ref,
          removed: true,
          revisionFingerprint: current.revisionFingerprint,
        };
      }),
  };

  return { secretStore, secretStoreMutation };
}

export function createMacOsKeychainExtensionEnvSecretStore(
  options: { runSecurity?: SecurityRunner } = {},
): ExtensionEnvSecretStore {
  const run = options.runSecurity ?? runSecurity;
  return {
    get: (key) => {
      let result: SecurityResult;
      try {
        result = run([
          "find-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          keychainAccount(key),
          "-w",
        ]);
      } catch {
        return undefined;
      }
      if (result.status !== 0) {
        return undefined;
      }
      return result.stdout.replace(/\n$/, "");
    },
    has: (key) => {
      let result: SecurityResult;
      try {
        result = run(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(key)]);
      } catch {
        return false;
      }
      return result.status === 0;
    },
    set: (key, value) => {
      const result = run(
        ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(key), "-w"],
        `${value}\n`,
      );
      if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "Unable to store extension env secret.");
      }
    },
    remove: (key) => {
      const result = run([
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(key),
      ]);
      if (result.status !== 0 && !/could not be found/i.test(result.stderr)) {
        throw new Error(result.stderr.trim() || "Unable to remove extension env secret.");
      }
    },
  };
}

function keychainAccount(key: ExtensionEnvSecretStoreKey): string {
  switch (key.kind) {
    case "extension-env":
      return `${key.extensionId}:${key.envName}`;
    case "snapshot-secret-state":
      return `__snapshot__:${key.snapshotId}:extension-env`;
  }
}

function versionedKeychainAccount(ref: ExtensionEnvSecretRef): string {
  return `${encodeURIComponent(ref.extensionId)}:${ref.envName}:${ref.materialId}`;
}

function sameTarget(target: ExtensionEnvSecretTarget, ref: ExtensionEnvSecretRef): boolean {
  return target.extensionId === ref.extensionId && target.envName === ref.envName;
}

function revisionFingerprint(ref: ExtensionEnvSecretRef): string {
  return createHash("sha256")
    .update("svvy-extension-env-secret-v1\0")
    .update(JSON.stringify([ref.extensionId, ref.envName, ref.materialId]))
    .digest("hex");
}

function secretStoreError(
  operation: string,
  reason:
    | "invalid-input"
    | "secret-not-found"
    | "secret-unavailable"
    | "state-conflict"
    | "persistence-failed",
): SecretStorePortError {
  const message =
    reason === "secret-not-found"
      ? "Secret material was not found."
      : reason === "state-conflict"
        ? "Secret material changed since it was observed."
        : reason === "invalid-input"
          ? "Secret store input is invalid."
          : reason === "persistence-failed"
            ? "Secret material could not be persisted."
            : "Secret storage is unavailable.";
  return new SecretStorePortError({ operation, reason, message });
}

function runSecurity(args: string[], input?: string): SecurityResult {
  if (process.platform !== "darwin") {
    throw new Error("Extension env secret storage requires macOS Keychain.");
  }
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
