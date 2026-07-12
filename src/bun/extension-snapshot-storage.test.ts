import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionSnapshotId,
  ExtensionSnapshotPayload,
  ExtensionSnapshotPayloadRef,
  ExtensionSnapshotSecretPayloadRef,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import {
  createExtensionSnapshotPayloadStore,
  createExtensionSnapshotSecretStore,
} from "./extension-snapshot-storage";

const directories: string[] = [];

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

function payloadFixture(): { bytes: Uint8Array; ref: ExtensionSnapshotPayloadRef } {
  const payload: ExtensionSnapshotPayload = {
    schemaVersion: 1,
    capturedAt: "2026-07-12T10:00:00.000Z" as ExtensionSnapshotPayload["capturedAt"],
    sources: [],
    packageFiles: [],
    actorSettings: [],
    profileSettings: [],
    nonSecretEnvOverrideScopes: [],
    nonSecretEnvOverrides: [],
    secretTargets: [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    bytes,
    ref: {
      schemaVersion: 1,
      algorithm: "sha256",
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteSize: bytes.byteLength,
      codec: "svvy-extension-snapshot-json-v1",
    },
  };
}

function blobPath(root: string, ref: ExtensionSnapshotPayloadRef) {
  const hex = ref.digest.slice("sha256:".length);
  return join(root, "payloads", "v1", "sha256", hex.slice(0, 2), `${hex}.json`);
}

function fakeSecurity() {
  const values = new Map<string, string>();
  return {
    values,
    run: (args: readonly string[], input?: string) => {
      const account = args[args.indexOf("-a") + 1]!;
      if (args[0] === "add-generic-password") {
        values.set(account, input?.replace(/\n$/, "") ?? "");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "find-generic-password") {
        const value = values.get(account);
        return value === undefined
          ? { status: 44, stdout: "", stderr: "could not be found" }
          : { status: 0, stdout: `${value}\n`, stderr: "" };
      }
      const removed = values.delete(account);
      return removed
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 44, stdout: "", stderr: "could not be found" };
    },
  };
}

describe("app-owned extension snapshot payload storage", () => {
  it("atomically puts immutable content once and verifies idempotent reads", async () => {
    const root = directory("svvy-snapshot-payload-");
    const fixture = payloadFixture();
    const store = createExtensionSnapshotPayloadStore({ root, isReferenced: () => false });

    const [first, second] = await Promise.all([
      Effect.runPromise(store.put(fixture)),
      Effect.runPromise(store.put(fixture)),
    ]);
    expect([first.outcome, second.outcome].toSorted()).toEqual(["existing", "stored"]);
    expect((await Effect.runPromise(store.read({ ref: fixture.ref }))).bytes).toEqual(
      fixture.bytes,
    );
    expect(first).not.toHaveProperty("path");
  });

  it("fails closed for corrupt and missing blobs", async () => {
    const root = directory("svvy-snapshot-corrupt-");
    const fixture = payloadFixture();
    const store = createExtensionSnapshotPayloadStore({ root, isReferenced: () => false });
    await Effect.runPromise(store.put(fixture));
    writeFileSync(blobPath(root, fixture.ref), "corrupt");
    await expect(Effect.runPromise(store.read({ ref: fixture.ref }))).rejects.toMatchObject({
      reason: "corrupt-payload",
    });

    const original = payloadFixture();
    const missing = {
      ...original,
      ref: { ...original.ref, digest: `sha256:${"f".repeat(64)}` },
    } as typeof original;
    await expect(Effect.runPromise(store.read({ ref: missing.ref }))).rejects.toMatchObject({
      reason: "not-found",
    });
  });

  it("rejects relative roots and symlinked storage shards", async () => {
    expect(() =>
      createExtensionSnapshotPayloadStore({ root: "relative", isReferenced: () => false }),
    ).toThrow("must be absolute");

    const root = directory("svvy-snapshot-symlink-");
    const outside = directory("svvy-snapshot-outside-");
    const fixture = payloadFixture();
    const hex = fixture.ref.digest.slice("sha256:".length);
    mkdirSync(join(root, "payloads", "v1", "sha256"), { recursive: true });
    symlinkSync(outside, join(root, "payloads", "v1", "sha256", hex.slice(0, 2)));
    const store = createExtensionSnapshotPayloadStore({ root, isReferenced: () => false });
    await expect(Effect.runPromise(store.put(fixture))).rejects.toMatchObject({
      reason: "unsafe-path",
    });
    expect(readFileSync(join(outside, "sentinel"), { encoding: "utf8", flag: "a+" })).toBe("");
  });

  it("retains referenced blobs and removes unreferenced blobs", async () => {
    const root = directory("svvy-snapshot-cleanup-");
    const fixture = payloadFixture();
    let referenced = true;
    const store = createExtensionSnapshotPayloadStore({ root, isReferenced: () => referenced });
    await Effect.runPromise(store.put(fixture));
    expect((await Effect.runPromise(store.cleanup({ ref: fixture.ref }))).outcome).toBe("retained");
    referenced = false;
    expect((await Effect.runPromise(store.cleanup({ ref: fixture.ref }))).outcome).toBe("removed");
    expect((await Effect.runPromise(store.cleanup({ ref: fixture.ref }))).outcome).toBe("missing");
  });
});

describe("versioned extension snapshot secret payload storage", () => {
  it("stores redacted bytes under an immutable versioned private ref", async () => {
    const security = fakeSecurity();
    const bytes = new TextEncoder().encode('{"TOKEN":"top-secret"}');
    const store = createExtensionSnapshotSecretStore({
      runSecurity: security.run,
      isReferenced: () => false,
      createMaterialId: () => "material-1",
    });
    const put = await Effect.runPromise(
      store.put({
        snapshotId: "extension-snapshot:one" as ExtensionSnapshotId,
        bytes: Redacted.make(bytes, { label: "test-secret" }),
      }),
    );
    expect(String(put.ref)).toBe("extension-snapshot-secret:v1:one-material-1");
    expect(JSON.stringify(put)).not.toContain("top-secret");
    const read = await Effect.runPromise(store.read({ ref: put.ref }));
    expect(new TextDecoder().decode(Redacted.value(read.bytes))).toContain("top-secret");
    expect(JSON.stringify(read)).not.toContain("top-secret");
    security.values.set(String(put.ref), '{"schemaVersion":1,"bytes":"%%%"}');
    await expect(Effect.runPromise(store.read({ ref: put.ref }))).rejects.toMatchObject({
      reason: "secret-unavailable",
    });
  });

  it("reports missing secrets and performs reference-aware cleanup", async () => {
    const security = fakeSecurity();
    let referenced = true;
    const store = createExtensionSnapshotSecretStore({
      runSecurity: security.run,
      isReferenced: () => referenced,
      createMaterialId: () => "material-2",
    });
    const put = await Effect.runPromise(
      store.put({
        snapshotId: "extension-snapshot:two" as ExtensionSnapshotId,
        bytes: Redacted.make(new Uint8Array([1, 2, 3]), { label: "test-secret" }),
      }),
    );
    expect((await Effect.runPromise(store.cleanup({ ref: put.ref }))).outcome).toBe("retained");
    referenced = false;
    expect((await Effect.runPromise(store.cleanup({ ref: put.ref }))).outcome).toBe("removed");
    await expect(Effect.runPromise(store.read({ ref: put.ref }))).rejects.toMatchObject({
      reason: "secret-not-found",
    });
    expect((await Effect.runPromise(store.cleanup({ ref: put.ref }))).outcome).toBe("missing");

    const absent = "extension-snapshot-secret:v1:absent" as ExtensionSnapshotSecretPayloadRef;
    await expect(Effect.runPromise(store.read({ ref: absent }))).rejects.toMatchObject({
      reason: "secret-not-found",
    });
  });
});
