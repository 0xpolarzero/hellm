import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownMarkAppLogReadCommandInputExit,
  decodeUnknownRecordProviderAuthStatusCommandInputExit,
  decodeUnknownUpdateAppPreferencesCommandInputExit,
  encodeMarkAppLogReadCommandInputExit,
  encodeRecordProviderAuthStatusCommandInputExit,
  encodeUpdateAppPreferencesCommandInputExit,
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
});
