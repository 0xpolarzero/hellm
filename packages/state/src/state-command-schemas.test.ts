import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownMarkAppLogReadCommandInputExit,
  decodeUnknownRecordProviderAuthStatusCommandInputExit,
  decodeUnknownSetExtensionSecretValueCommandInputExit,
  decodeUnknownUpdateAppPreferencesCommandInputExit,
  encodeMarkAppLogReadCommandInputExit,
  encodeRecordProviderAuthStatusCommandInputExit,
  decodeUnknownUpsertProviderCredentialCommandInputExit,
  encodeSetExtensionSecretValueCommandInputExit,
  encodeUpdateAppPreferencesCommandInputExit,
  encodeUpsertProviderCredentialCommandInputExit,
} from "./state-command-schemas";

describe("@svvy/state command schemas", () => {
  it("decodes and encodes app-log read state commands", () => {
    const decoded = decodeUnknownMarkAppLogReadCommandInputExit({
      workspaceId: "workspace_01",
      entryIds: ["app-log-1"],
      readAt: "2026-06-21T12:34:56.789Z",
      clientSubmission: {
        clientRequestId: "request_mark_read",
        source: "desktop",
      },
    });
    const excess = decodeUnknownMarkAppLogReadCommandInputExit({
      workspaceId: "workspace_01",
      entryIds: ["app-log-1"],
      readAt: "2026-06-21T12:34:56.789Z",
      clientSubmission: {
        clientRequestId: "request_mark_read",
        source: "desktop",
      },
      preview: { unread: 0 },
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    expect(Exit.isFailure(excess)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeMarkAppLogReadCommandInputExit(decoded.value)).toEqual(decoded);
    }
  });

  it("decodes and encodes app preference patch commands", () => {
    const decoded = decodeUnknownUpdateAppPreferencesCommandInputExit({
      patch: {
        appearance: "dark",
        externalEditor: null,
        artifactDirectory: "/tmp/svvy-artifacts",
        approvalMode: "user",
        networkAccess: false,
        ambientResources: { skills: true },
      },
      clientSubmission: {
        clientRequestId: "request_settings",
        source: "desktop",
      },
    });
    const undefinedField = decodeUnknownUpdateAppPreferencesCommandInputExit({
      patch: {
        externalEditor: undefined,
      },
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    expect(Exit.isFailure(undefinedField)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeUpdateAppPreferencesCommandInputExit(decoded.value)).toEqual(decoded);
    }
  });

  it("decodes and encodes provider credential secret intake", () => {
    const decoded = decodeUnknownUpsertProviderCredentialCommandInputExit({
      providerId: "openai",
      credentialKind: "api-key",
      secretValue: "sk-test-secret",
      redactedAccountLabel: "sk-...test",
      expiresAt: "2026-06-21T12:34:56.789Z",
      clientSubmission: {
        submissionId: "submission_01",
        clientRequestId: "request_01",
        source: "desktop",
        submittedAt: "2026-06-21T12:34:56.789Z",
      },
    });
    const missingSecret = decodeUnknownUpsertProviderCredentialCommandInputExit({
      providerId: "openai",
      credentialKind: "api-key",
    });
    const emptySecret = decodeUnknownUpsertProviderCredentialCommandInputExit({
      providerId: "openai",
      credentialKind: "api-key",
      secretValue: "",
    });
    const invalidKind = decodeUnknownUpsertProviderCredentialCommandInputExit({
      providerId: "openai",
      credentialKind: "password",
      secretValue: "sk-test-secret",
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    expect(Exit.isFailure(missingSecret)).toBe(true);
    expect(Exit.isFailure(emptySecret)).toBe(true);
    expect(Exit.isFailure(invalidKind)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(decoded.value.secretValue).toBe("sk-test-secret");
      expect(encodeUpsertProviderCredentialCommandInputExit(decoded.value)).toEqual(decoded);
    }
  });

  it("decodes and encodes provider auth status commands without secret fields", () => {
    const decoded = decodeUnknownRecordProviderAuthStatusCommandInputExit({
      status: {
        providerId: "openai",
        health: "usable",
        redactedAccountLabel: "acct-openai",
        refreshedAt: "2026-06-21T12:34:56.789Z",
      },
      observedAt: "2026-06-21T12:34:56.789Z",
      source: "startup_scan",
      clientSubmission: {
        clientRequestId: "request_provider_status",
        source: "desktop",
      },
    });
    const invalidHealth = decodeUnknownRecordProviderAuthStatusCommandInputExit({
      status: {
        providerId: "openai",
        health: "connected",
      },
      observedAt: "2026-06-21T12:34:56.789Z",
      source: "startup_scan",
    });
    const secretLeak = decodeUnknownRecordProviderAuthStatusCommandInputExit({
      status: {
        providerId: "openai",
        health: "usable",
        accessToken: "sk-secret",
      },
      observedAt: "2026-06-21T12:34:56.789Z",
      source: "startup_scan",
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    expect(Exit.isFailure(invalidHealth)).toBe(true);
    expect(Exit.isFailure(secretLeak)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeRecordProviderAuthStatusCommandInputExit(decoded.value)).toEqual(decoded);
    }
  });

  it("decodes and encodes extension env secret intake by envName", () => {
    const decoded = decodeUnknownSetExtensionSecretValueCommandInputExit({
      extensionId: "ext_openai",
      envName: "OPENAI_API_KEY",
      secretValue: "sk-test-secret",
      clientSubmission: {
        submissionId: "submission_02",
        clientRequestId: "request_02",
        source: "desktop",
        submittedAt: "2026-06-21T12:34:56.789Z",
      },
    });
    const staleNameShape = decodeUnknownSetExtensionSecretValueCommandInputExit({
      extensionId: "ext_openai",
      name: "OPENAI_API_KEY",
      secretValue: "sk-test-secret",
    });
    const lowercaseEnvName = decodeUnknownSetExtensionSecretValueCommandInputExit({
      extensionId: "ext_openai",
      envName: "openai_api_key",
      secretValue: "sk-test-secret",
    });
    const emptySecret = decodeUnknownSetExtensionSecretValueCommandInputExit({
      extensionId: "ext_openai",
      envName: "OPENAI_API_KEY",
      secretValue: "",
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    expect(Exit.isFailure(staleNameShape)).toBe(true);
    expect(Exit.isFailure(lowercaseEnvName)).toBe(true);
    expect(Exit.isFailure(emptySecret)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(decoded.value.envName as string).toBe("OPENAI_API_KEY");
      expect(decoded.value.secretValue).toBe("sk-test-secret");
      expect(encodeSetExtensionSecretValueCommandInputExit(decoded.value)).toEqual(decoded);
    }
  });
});
