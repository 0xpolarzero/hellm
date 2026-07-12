import { describe, expect, it } from "bun:test";
import { ExtensionEnvSecretRefSchema, ExtensionEnvSecretTargetSchema } from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  createMacOsKeychainExtensionEnvSecretStore,
  createMacOsKeychainSecretStoreServices,
} from "./extension-env-secret-store";

describe("extension env secret store", () => {
  it("passes keychain secret writes through stdin instead of argv", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const store = createMacOsKeychainExtensionEnvSecretStore({
      runSecurity(args, input) {
        calls.push({ args, input });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    store.set(
      { kind: "extension-env", extensionId: "linear", envName: "LINEAR_TOKEN" },
      "secret-token-value",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "add-generic-password",
      "-U",
      "-s",
      "svvy-extension-env",
      "-a",
      "linear:LINEAR_TOKEN",
      "-w",
    ]);
    expect(calls[0]?.args.join(" ")).not.toContain("secret-token-value");
    expect(calls[0]?.input).toBe("secret-token-value\n");
  });

  it("treats unavailable Keychain reads as missing without weakening writes", () => {
    const unavailable = new Error("Keychain unavailable");
    const store = createMacOsKeychainExtensionEnvSecretStore({
      runSecurity: () => {
        throw unavailable;
      },
    });
    const key = { kind: "extension-env", extensionId: "example", envName: "TOKEN" } as const;

    expect(store.get(key)).toBeUndefined();
    expect(store.has(key)).toBeFalse();
    expect(() => store.set(key, "secret")).toThrow(unavailable);
    expect(() => store.remove(key)).toThrow(unavailable);
  });

  it("writes immutable material versions and leaves replaced material for state cleanup", async () => {
    const fake = createFakeSecurityRunner();
    const { secretStore, secretStoreMutation } = createMacOsKeychainSecretStoreServices({
      runSecurity: fake.run,
      createMaterialId: (() => {
        const ids = ["material_v1", "material_v2"];
        return () => ids.shift() ?? "unexpected_material";
      })(),
    });
    const target = Schema.decodeUnknownSync(ExtensionEnvSecretTargetSchema)({
      kind: "extension-env",
      extensionId: "linear",
      envName: "LINEAR_TOKEN",
    });

    const first = await Effect.runPromise(
      secretStoreMutation.writeSecretValue({
        target,
        value: Redacted.make("first-secret-sentinel", { label: "extension-env-secret" }),
      }),
    );
    const second = await Effect.runPromise(
      secretStoreMutation.writeSecretValue({
        target,
        value: Redacted.make("second-secret-sentinel", { label: "extension-env-secret" }),
        replaces: {
          ref: first.ref,
          expectedRevisionFingerprint: first.revisionFingerprint,
        },
      }),
    );

    expect(first.ref.materialId as string).toBe("material_v1");
    expect(second.ref.materialId as string).toBe("material_v2");
    expect(first.revisionFingerprint).not.toBe(second.revisionFingerprint);
    expect(first.revisionFingerprint).not.toContain("first-secret-sentinel");
    expect(second.revisionFingerprint).not.toContain("second-secret-sentinel");
    expect(fake.values.size).toBe(2);
    expect(
      Redacted.value(
        (await Effect.runPromise(secretStore.resolveInvocationValue(first.ref))).value,
      ),
    ).toBe("first-secret-sentinel");
    expect(
      Redacted.value(
        (await Effect.runPromise(secretStore.resolveInvocationValue(second.ref))).value,
      ),
    ).toBe("second-secret-sentinel");

    await Effect.runPromise(
      secretStoreMutation.removeSecretValue({
        ref: first.ref,
        expectedRevisionFingerprint: first.revisionFingerprint,
      }),
    );
    expect(fake.values.size).toBe(1);
    expect(
      Redacted.value(
        (await Effect.runPromise(secretStore.resolveInvocationValue(second.ref))).value,
      ),
    ).toBe("second-secret-sentinel");
  });

  it("fails exact missing refs and rejects stale replacement and removal fingerprints", async () => {
    const fake = createFakeSecurityRunner();
    const { secretStore, secretStoreMutation } = createMacOsKeychainSecretStoreServices({
      runSecurity: fake.run,
      createMaterialId: () => "material_v1",
    });
    const target = Schema.decodeUnknownSync(ExtensionEnvSecretTargetSchema)({
      kind: "extension-env",
      extensionId: "example",
      envName: "TOKEN",
    });
    const missingRef = Schema.decodeUnknownSync(ExtensionEnvSecretRefSchema)({
      ...target,
      materialId: "missing_material",
    });

    const missing = await Effect.runPromise(
      secretStore.resolveInvocationValue(missingRef).pipe(Effect.flip),
    );
    const missingRemove = await Effect.runPromise(
      secretStoreMutation.removeSecretValue({ ref: missingRef }).pipe(Effect.flip),
    );
    expect(missing.reason).toBe("secret-not-found");
    expect(missingRemove.reason).toBe("secret-not-found");

    const first = await Effect.runPromise(
      secretStoreMutation.writeSecretValue({
        target,
        value: Redacted.make("secret-sentinel", { label: "extension-env-secret" }),
      }),
    );
    const staleWrite = await Effect.runPromise(
      secretStoreMutation
        .writeSecretValue({
          target,
          value: Redacted.make("replacement-sentinel", { label: "extension-env-secret" }),
          replaces: { ref: first.ref, expectedRevisionFingerprint: "stale-fingerprint" },
        })
        .pipe(Effect.flip),
    );
    const staleRemove = await Effect.runPromise(
      secretStoreMutation
        .removeSecretValue({
          ref: first.ref,
          expectedRevisionFingerprint: "stale-fingerprint",
        })
        .pipe(Effect.flip),
    );
    expect(staleWrite.reason).toBe("state-conflict");
    expect(staleRemove.reason).toBe("state-conflict");
    expect(fake.values.size).toBe(1);
  });

  it("never copies secret values or security stderr into typed failures", async () => {
    const secret = "raw-secret-sentinel";
    const stderr = `security failed while handling ${secret}`;
    const { secretStoreMutation } = createMacOsKeychainSecretStoreServices({
      createMaterialId: () => "material_error",
      runSecurity: () => ({ status: 1, stdout: "", stderr }),
    });
    const result = await Effect.runPromise(
      secretStoreMutation
        .writeSecretValue({
          target: Schema.decodeUnknownSync(ExtensionEnvSecretTargetSchema)({
            kind: "extension-env",
            extensionId: "example",
            envName: "TOKEN",
          }),
          value: Redacted.make(secret, { label: "extension-env-secret" }),
        })
        .pipe(Effect.flip),
    );
    const serialized = JSON.stringify(result);
    expect(result.reason).toBe("persistence-failed");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(stderr);
  });

  it("derives revision fingerprints only from opaque material identity", async () => {
    const write = async (secret: string) => {
      const fake = createFakeSecurityRunner();
      const { secretStoreMutation } = createMacOsKeychainSecretStoreServices({
        createMaterialId: () => "stable_material_identity",
        runSecurity: fake.run,
      });
      return Effect.runPromise(
        secretStoreMutation.writeSecretValue({
          target: Schema.decodeUnknownSync(ExtensionEnvSecretTargetSchema)({
            kind: "extension-env",
            extensionId: "example",
            envName: "TOKEN",
          }),
          value: Redacted.make(secret, { label: "extension-env-secret" }),
        }),
      );
    };

    const first = await write("first-distinct-secret-sentinel");
    const second = await write("second-distinct-secret-sentinel");
    expect(first.revisionFingerprint).toBe(second.revisionFingerprint);
    expect(first.revisionFingerprint).not.toContain("first-distinct-secret-sentinel");
    expect(first.revisionFingerprint).not.toContain("second-distinct-secret-sentinel");
  });

  it("replays a host-reserved material identity with an idempotent keychain update", async () => {
    const calls: string[][] = [];
    const fake = createFakeSecurityRunner();
    const services = createMacOsKeychainSecretStoreServices({
      runSecurity: (args, input) => {
        calls.push(args);
        return fake.run(args, input);
      },
    });
    const target = Schema.decodeUnknownSync(ExtensionEnvSecretTargetSchema)({
      kind: "extension-env",
      extensionId: "example",
      envName: "TOKEN",
    });
    const request = {
      target,
      materialId: "snapshot_durable_request" as never,
      value: Redacted.make("snapshot-secret-sentinel", { label: "extension-env-secret" }),
    };
    const first = await Effect.runPromise(services.secretStoreMutation.writeSecretValue(request));
    const replay = await Effect.runPromise(services.secretStoreMutation.writeSecretValue(request));
    expect(replay.ref).toEqual(first.ref);
    expect(calls.filter((args) => args[0] === "add-generic-password")).toEqual([
      expect.arrayContaining(["-U"]),
      expect.arrayContaining(["-U"]),
    ]);
  });
});

function createFakeSecurityRunner() {
  const values = new Map<string, string>();
  return {
    values,
    run(args: string[], input?: string) {
      const account = args[args.indexOf("-a") + 1] ?? "";
      if (args[0] === "add-generic-password") {
        values.set(account, (input ?? "").replace(/\n$/, ""));
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "find-generic-password") {
        const value = values.get(account);
        return value === undefined
          ? { status: 44, stdout: "", stderr: "The specified item could not be found." }
          : { status: 0, stdout: args.includes("-w") ? `${value}\n` : "", stderr: "" };
      }
      if (args[0] === "delete-generic-password") {
        return values.delete(account)
          ? { status: 0, stdout: "", stderr: "" }
          : { status: 44, stdout: "", stderr: "The specified item could not be found." };
      }
      return { status: 1, stdout: "", stderr: "Unsupported security command." };
    },
  };
}
