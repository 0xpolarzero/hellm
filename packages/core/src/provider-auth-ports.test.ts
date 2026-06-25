import { describe, expect, it } from "bun:test";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { runTestEffect } from "./effect.test-support";
import {
  decodeUnknownGetProviderAuthSnapshotInputEffect,
  decodeUnknownListProviderStatusesInputEffect,
  decodeUnknownRecordProviderAuthStatusInputEffect,
  decodeUnknownRequestProviderRefreshInputEffect,
  ProviderAuthStatusSchema,
  ProviderCredentialSnapshotSchema,
  strictBoundaryParseOptions,
  type ProviderId,
  type WorkspaceId,
} from ".";

describe("@svvy/core provider auth port contracts", () => {
  it("decodes process-local usable credential snapshots with redacted secrets", async () => {
    const decoded = await runTestEffect(
      Schema.decodeUnknownEffect(
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
      }),
    );

    expect(decoded.providerId).toBe("openai" as ProviderId);
    expect(decoded.workspaceId).toBe("workspace_01" as WorkspaceId);
    expect(decoded.health).toBe("usable");
    if (decoded.health !== "usable") {
      throw new Error("expected usable credential snapshot");
    }
    expect(Redacted.value(decoded.accessToken)).toBe("sk-test");
    expect(decoded.refreshToken ? Redacted.value(decoded.refreshToken) : undefined).toBe(
      "refresh-test",
    );
    expect(decoded.credentialFingerprint).toBe("credential_fingerprint_01");
  });

  it("rejects raw provider credential bags", async () => {
    await expect(
      runTestEffect(
        Schema.decodeUnknownEffect(
          ProviderCredentialSnapshotSchema,
          strictBoundaryParseOptions,
        )({
          providerId: "openai",
          health: "usable",
          apiKey: "sk-raw",
          credentialFingerprint: "credential_fingerprint_01",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        Schema.decodeUnknownEffect(
          ProviderCredentialSnapshotSchema,
          strictBoundaryParseOptions,
        )({
          providerId: "openai",
          health: "usable",
          accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
          headers: { authorization: "Bearer sk-raw" },
          credentialFingerprint: "credential_fingerprint_01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects mismatched provider credential states", async () => {
    await expect(
      runTestEffect(
        Schema.decodeUnknownEffect(
          ProviderCredentialSnapshotSchema,
          strictBoundaryParseOptions,
        )({
          providerId: "openai",
          health: "usable",
          credentialFingerprint: "credential_fingerprint_01",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        Schema.decodeUnknownEffect(
          ProviderCredentialSnapshotSchema,
          strictBoundaryParseOptions,
        )({
          providerId: "openai",
          health: "expired",
          accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
          issue: "expired",
        }),
      ),
    ).rejects.toThrow();
  });

  it("prevents JSON encoding usable credential snapshots", () => {
    const ProviderCredentialSnapshotJsonSchema = Schema.toCodecJson(
      ProviderCredentialSnapshotSchema,
    );

    expect(() =>
      Schema.encodeSync(ProviderCredentialSnapshotJsonSchema)({
        providerId: "openai" as ProviderId,
        health: "usable",
        accessToken: Redacted.make("sk-test", { label: "provider-credential" }),
        credentialFingerprint: "credential_fingerprint_01",
      }),
    ).toThrow("Cannot serialize Redacted");
  });

  it("keeps provider status secret-free and decodes named port inputs", async () => {
    const status = await runTestEffect(
      Schema.decodeUnknownEffect(
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
      }),
    );
    expect(status.providerId).toBe("openai" as ProviderId);
    expect(status.workspaceId).toBe("workspace_01" as WorkspaceId);
    expect(status.health).toBe("expired");
    expect(status.redactedAccountLabel).toBe("OpenAI key");
    expect(String(status.refreshedAt)).toBe("2026-06-23T11:00:00.000Z");
    expect(String(status.expiresAt)).toBe("2026-06-23T12:00:00.000Z");
    expect(status.issue).toBe("expired");
    await expect(
      runTestEffect(
        Schema.decodeUnknownEffect(
          ProviderAuthStatusSchema,
          strictBoundaryParseOptions,
        )({
          providerId: "openai",
          health: "usable",
          apiKey: "sk-raw",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        decodeUnknownGetProviderAuthSnapshotInputEffect({
          providerId: "openai",
          workspaceId: "workspace_01",
        }),
      ),
    ).resolves.toEqual({
      providerId: "openai" as ProviderId,
      workspaceId: "workspace_01" as WorkspaceId,
    });
    await expect(
      runTestEffect(
        decodeUnknownRequestProviderRefreshInputEffect({
          providerId: "openai",
          reason: "runtime_retry",
        }),
      ),
    ).resolves.toEqual({
      providerId: "openai" as ProviderId,
      reason: "runtime_retry",
    });
    const recordInput = await runTestEffect(
      decodeUnknownRecordProviderAuthStatusInputEffect({
        status: {
          providerId: "openai",
          workspaceId: "workspace_01",
          health: "refresh_failed",
          issue: "expired refresh token",
        },
        observedAt: "2026-06-23T11:05:00.000Z",
        source: "provider_refresh",
      }),
    );
    expect(recordInput.status).toEqual({
      providerId: "openai" as ProviderId,
      workspaceId: "workspace_01" as WorkspaceId,
      health: "refresh_failed",
      issue: "expired refresh token",
    });
    expect(String(recordInput.observedAt)).toBe("2026-06-23T11:05:00.000Z");
    expect(recordInput.source).toBe("provider_refresh");
    await expect(
      runTestEffect(
        decodeUnknownListProviderStatusesInputEffect({
          workspaceId: "workspace_01",
          rendererOnly: true,
        }),
      ),
    ).rejects.toThrow();
  });
});
