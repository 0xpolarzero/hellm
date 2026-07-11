import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownMarkAppLogReadCommandInputExit,
  decodeUnknownCreateManagedSnippetCommandInputExit,
  decodeUnknownDeleteManagedSnippetCommandInputExit,
  decodeUnknownRecordProviderAuthStatusCommandInputExit,
  decodeUnknownSetSnippetEnabledCommandInputExit,
  decodeUnknownUpdateAppPreferencesCommandInputExit,
  decodeUnknownUpdateManagedSnippetCommandInputExit,
  encodeCreateManagedSnippetCommandInputExit,
  encodeDeleteManagedSnippetCommandInputExit,
  encodeMarkAppLogReadCommandInputExit,
  encodeRecordProviderAuthStatusCommandInputExit,
  encodeSetSnippetEnabledCommandInputExit,
  encodeUpdateAppPreferencesCommandInputExit,
  encodeUpdateManagedSnippetCommandInputExit,
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
        externalInstructions: {
          globalRoots: [
            {
              id: "custom-docs",
              kind: "custom",
              label: "Custom docs",
              path: "/tmp/custom-docs",
              enabled: true,
            },
          ],
          globalControls: {
            "custom-docs/AGENTS.md": {
              enabled: true,
              actors: ["orchestrator", "handler"],
            },
          },
          workspaceControls: {},
        },
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
    expect(
      Exit.isFailure(
        decodeUnknownUpdateAppPreferencesCommandInputExit({
          patch: {
            externalInstructions: {
              globalRoots: [],
              globalControls: {},
              workspaceControls: {},
              rendererPreview: true,
            },
          },
        }),
      ),
    ).toBe(true);
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

  it("requires explicit workspace routing on every managed-snippet command", () => {
    const create = decodeUnknownCreateManagedSnippetCommandInputExit({
      workspaceId: "workspace_snippets",
      title: "Review",
      body: "Review this file.",
      metadata: {},
      enabled: true,
    });
    expect(Exit.isSuccess(create)).toBe(true);
    if (Exit.isSuccess(create)) {
      expect(encodeCreateManagedSnippetCommandInputExit(create.value)).toEqual(create);
    }
    expect(
      Exit.isFailure(
        decodeUnknownCreateManagedSnippetCommandInputExit({
          title: "Review",
          body: "Review this file.",
          metadata: {},
          enabled: true,
        }),
      ),
    ).toBe(true);

    const update = decodeUnknownUpdateManagedSnippetCommandInputExit({
      workspaceId: "workspace_snippets",
      snippetId: "snippet_01",
      patch: { body: "Review this change." },
    });
    expect(Exit.isSuccess(update)).toBe(true);
    if (Exit.isSuccess(update)) {
      expect(encodeUpdateManagedSnippetCommandInputExit(update.value)).toEqual(update);
    }
    expect(
      Exit.isFailure(
        decodeUnknownUpdateManagedSnippetCommandInputExit({
          snippetId: "snippet_01",
          patch: { body: "Review this change." },
        }),
      ),
    ).toBe(true);

    const remove = decodeUnknownDeleteManagedSnippetCommandInputExit({
      workspaceId: "workspace_snippets",
      snippetId: "snippet_01",
    });
    expect(Exit.isSuccess(remove)).toBe(true);
    if (Exit.isSuccess(remove)) {
      expect(encodeDeleteManagedSnippetCommandInputExit(remove.value)).toEqual(remove);
    }
    expect(
      Exit.isFailure(
        decodeUnknownDeleteManagedSnippetCommandInputExit({ snippetId: "snippet_01" }),
      ),
    ).toBe(true);

    const setEnabled = decodeUnknownSetSnippetEnabledCommandInputExit({
      workspaceId: "workspace_snippets",
      snippetId: "snippet_01",
      enabled: false,
    });
    expect(Exit.isSuccess(setEnabled)).toBe(true);
    if (Exit.isSuccess(setEnabled)) {
      expect(encodeSetSnippetEnabledCommandInputExit(setEnabled.value)).toEqual(setEnabled);
    }
    expect(
      Exit.isFailure(
        decodeUnknownSetSnippetEnabledCommandInputExit({
          snippetId: "snippet_01",
          enabled: false,
        }),
      ),
    ).toBe(true);
  });
});
