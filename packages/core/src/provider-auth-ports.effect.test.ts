import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  decodeUnknownRemoveSecretValueInputEffect,
  decodeUnknownGetProviderAuthSnapshotInputEffect,
  decodeUnknownListProviderStatusesInputEffect,
  decodeUnknownRecordProviderAuthStatusInputEffect,
  decodeUnknownRequestProviderRefreshInputEffect,
  decodeUnknownWriteSecretValueInputEffect,
  RemoveSecretValueResultSchema,
  ProviderAuthStatusSchema,
  ProviderCredentialSnapshotSchema,
  WriteSecretValueResultSchema,
  WriteSecretValueInputSchema,
  strictBoundaryParseOptions,
  type ProviderId,
  type WorkspaceId,
} from ".";

describe("@svvy/core provider auth port contracts", () => {
  it.effect("decodes process-local usable credential snapshots with redacted secrets", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(
        ProviderCredentialSnapshotSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        workspaceId: "workspace_01",
        health: "usable",
        accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
        refreshToken: Redacted.make("refresh-test", { label: "provider-credential" }),
        redactedAccountLabel: "OpenAI key",
        expiresAt: "2026-06-23T12:00:00.000Z",
        credentialFingerprint: "credential_fingerprint_01",
      });

      assert.strictEqual(decoded.providerId, "openai" as ProviderId);
      assert.strictEqual(decoded.workspaceId, "workspace_01" as WorkspaceId);
      assert.strictEqual(decoded.health, "usable");
      if (decoded.health !== "usable") {
        assert.fail("expected usable credential snapshot");
      }
      assert.strictEqual(Redacted.value(decoded.accessToken), "sk-test");
      assert.strictEqual(
        decoded.refreshToken ? Redacted.value(decoded.refreshToken) : undefined,
        "refresh-test",
      );
      assert.strictEqual(decoded.credentialFingerprint, "credential_fingerprint_01");
    }),
  );

  it.effect("rejects raw provider credential bags", () =>
    Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(
        ProviderCredentialSnapshotSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        health: "usable",
        apiKey: "sk-raw",
        credentialFingerprint: "credential_fingerprint_01",
      }).pipe(Effect.flip);
      yield* Schema.decodeUnknownEffect(
        ProviderCredentialSnapshotSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        health: "usable",
        accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
        headers: { authorization: "Bearer sk-raw" },
        credentialFingerprint: "credential_fingerprint_01",
      }).pipe(Effect.flip);
    }),
  );

  it.effect("rejects mismatched provider credential states", () =>
    Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(
        ProviderCredentialSnapshotSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        health: "usable",
        credentialFingerprint: "credential_fingerprint_01",
      }).pipe(Effect.flip);
      yield* Schema.decodeUnknownEffect(
        ProviderCredentialSnapshotSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        health: "expired",
        accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
        issue: "expired",
      }).pipe(Effect.flip);
    }),
  );

  it("prevents JSON encoding usable credential snapshots", () => {
    const ProviderCredentialSnapshotJsonSchema = Schema.toCodecJson(
      ProviderCredentialSnapshotSchema,
    );

    assert.throws(() =>
      Schema.encodeSync(ProviderCredentialSnapshotJsonSchema)({
        providerId: "openai" as ProviderId,
        health: "usable",
        accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
        credentialFingerprint: "credential_fingerprint_01",
      }),
    );
  });

  it.effect("keeps provider status secret-free and decodes named port inputs", () =>
    Effect.gen(function* () {
      const status = yield* Schema.decodeUnknownEffect(
        ProviderAuthStatusSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        workspaceId: "workspace_01",
        health: "expired",
        redactedAccountLabel: "OpenAI key",
        refreshedAt: "2026-06-23T11:00:00.000Z",
        expiresAt: "2026-06-23T12:00:00.000Z",
        issue: "expired",
      });
      assert.strictEqual(status.providerId, "openai" as ProviderId);
      assert.strictEqual(status.workspaceId, "workspace_01" as WorkspaceId);
      assert.strictEqual(status.health, "expired");
      assert.strictEqual(status.redactedAccountLabel, "OpenAI key");
      assert.strictEqual(String(status.refreshedAt), "2026-06-23T11:00:00.000Z");
      assert.strictEqual(String(status.expiresAt), "2026-06-23T12:00:00.000Z");
      assert.strictEqual(status.issue, "expired");
      yield* Schema.decodeUnknownEffect(
        ProviderAuthStatusSchema,
        strictBoundaryParseOptions,
      )({
        providerId: "openai",
        health: "usable",
        apiKey: "sk-raw",
      }).pipe(Effect.flip);
      assert.deepStrictEqual(
        yield* decodeUnknownGetProviderAuthSnapshotInputEffect({
          providerId: "openai",
          workspaceId: "workspace_01",
        }),
        {
          providerId: "openai" as ProviderId,
          workspaceId: "workspace_01" as WorkspaceId,
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownRequestProviderRefreshInputEffect({
          providerId: "openai",
          reason: "runtime_retry",
        }),
        {
          providerId: "openai" as ProviderId,
          reason: "runtime_retry",
        },
      );
      const recordInput = yield* decodeUnknownRecordProviderAuthStatusInputEffect({
        status: {
          providerId: "openai",
          workspaceId: "workspace_01",
          health: "refresh_failed",
          issue: "expired refresh token",
        },
        observedAt: "2026-06-23T11:05:00.000Z",
        source: "provider_refresh",
      });
      assert.deepStrictEqual(recordInput.status, {
        providerId: "openai" as ProviderId,
        workspaceId: "workspace_01" as WorkspaceId,
        health: "refresh_failed",
        issue: "expired refresh token",
      });
      assert.strictEqual(String(recordInput.observedAt), "2026-06-23T11:05:00.000Z");
      assert.strictEqual(recordInput.source, "provider_refresh");
      yield* decodeUnknownListProviderStatusesInputEffect({
        workspaceId: "workspace_01",
        rendererOnly: true,
      }).pipe(Effect.flip);
    }),
  );

  it.effect("decodes secret mutation inputs through the mutation-only secret port contract", () =>
    Effect.gen(function* () {
      const writeInput = yield* decodeUnknownWriteSecretValueInputEffect({
        target: {
          kind: "extension-env",
          extensionId: "extension_01",
          envName: "API_KEY",
        },
        value: Redacted.make("sk-test-secret", { label: "extension-env-secret" }),
        replaces: {
          ref: {
            kind: "extension-env",
            extensionId: "extension_01",
            envName: "API_KEY",
            materialId: "material_01",
          },
          expectedRevisionFingerprint: "rev_01",
        },
      });
      assert.strictEqual(writeInput.target.extensionId, "extension_01");
      assert.strictEqual(writeInput.target.envName, "API_KEY");
      assert.strictEqual(Redacted.value(writeInput.value), "sk-test-secret");
      assert.strictEqual(writeInput.replaces?.expectedRevisionFingerprint, "rev_01");
      assert.throws(
        () => Schema.encodeSync(Schema.toCodecJson(WriteSecretValueInputSchema))(writeInput),
        /Cannot serialize Redacted/,
      );

      const removeInput = yield* decodeUnknownRemoveSecretValueInputEffect({
        ref: {
          kind: "extension-env",
          extensionId: "extension_01",
          envName: "API_KEY",
          materialId: "material_02",
        },
        expectedRevisionFingerprint: "rev_02",
      });
      assert.strictEqual(removeInput.ref.kind, "extension-env");
      assert.strictEqual(removeInput.ref.extensionId, "extension_01");
      assert.strictEqual(removeInput.ref.envName, "API_KEY");
      assert.strictEqual(removeInput.expectedRevisionFingerprint, "rev_02");

      yield* decodeUnknownWriteSecretValueInputEffect({
        target: {
          kind: "extension-env",
          extensionId: "extension_01",
          envName: "API_KEY",
        },
        value: Redacted.make("", { label: "extension-env-secret" }),
      }).pipe(Effect.flip);

      const writeResult = yield* Schema.decodeUnknownEffect(
        WriteSecretValueResultSchema,
        strictBoundaryParseOptions,
      )({
        ref: {
          kind: "extension-env",
          extensionId: "extension_01",
          envName: "API_KEY",
          materialId: "material_03",
        },
        revisionFingerprint: "rev_03",
      });
      assert.strictEqual(writeResult.revisionFingerprint, "rev_03");

      const removeResult = yield* Schema.decodeUnknownEffect(
        RemoveSecretValueResultSchema,
        strictBoundaryParseOptions,
      )({
        ref: {
          kind: "extension-env",
          extensionId: "extension_01",
          envName: "API_KEY",
          materialId: "material_04",
        },
        removed: true,
        revisionFingerprint: "rev_04",
      });
      assert.strictEqual(removeResult.removed, true);
      assert.strictEqual(removeResult.revisionFingerprint, "rev_04");
    }),
  );
});
