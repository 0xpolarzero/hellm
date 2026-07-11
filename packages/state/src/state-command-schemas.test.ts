import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownMarkAppLogReadCommandInputExit,
  decodeUnknownMarkSessionReadCommandInputExit,
  decodeUnknownMarkSessionUnreadCommandInputExit,
  decodeUnknownCreateManagedSnippetCommandInputExit,
  decodeUnknownDeleteManagedSnippetCommandInputExit,
  decodeUnknownRecordProviderAuthStatusCommandInputExit,
  decodeUnknownSetSnippetEnabledCommandInputExit,
  decodeUnknownSetSessionArchivedCommandInputExit,
  decodeUnknownSetSessionNavigationSectionStateCommandInputExit,
  decodeUnknownSetSessionPinnedCommandInputExit,
  decodeUnknownUpdateAppPreferencesCommandInputExit,
  decodeUnknownUpdateManagedSnippetCommandInputExit,
  encodeCreateManagedSnippetCommandInputExit,
  encodeDeleteManagedSnippetCommandInputExit,
  encodeMarkAppLogReadCommandInputExit,
  encodeMarkSessionReadCommandInputExit,
  encodeMarkSessionUnreadCommandInputExit,
  encodeRecordProviderAuthStatusCommandInputExit,
  encodeSetSnippetEnabledCommandInputExit,
  encodeSetSessionArchivedCommandInputExit,
  encodeSetSessionNavigationSectionStateCommandInputExit,
  encodeSetSessionPinnedCommandInputExit,
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
      title: "  Review  ",
      body: "Review this file.",
      metadata: { description: "Review a file", argumentHint: "path" },
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
          metadata: { description: null, argumentHint: null },
          enabled: true,
        }),
      ),
    ).toBe(true);

    const update = decodeUnknownUpdateManagedSnippetCommandInputExit({
      workspaceId: "workspace_snippets",
      snippetId: "snippet_01",
      patch: { title: "  Revised review  ", body: "Review this change." },
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

  it("rejects empty managed titles and non-contract snippet metadata", () => {
    for (const title of ["", "   "]) {
      expect(
        Exit.isFailure(
          decodeUnknownCreateManagedSnippetCommandInputExit({
            workspaceId: "workspace_snippets",
            title,
            body: "Review this file.",
            metadata: { description: null, argumentHint: null },
            enabled: true,
          }),
        ),
      ).toBe(true);
      expect(
        Exit.isFailure(
          decodeUnknownUpdateManagedSnippetCommandInputExit({
            workspaceId: "workspace_snippets",
            snippetId: "snippet_01",
            patch: { title },
          }),
        ),
      ).toBe(true);
    }

    for (const metadata of [
      {},
      { description: null },
      { description: null, argumentHint: null, allowedTools: ["Shell"] },
    ]) {
      expect(
        Exit.isFailure(
          decodeUnknownCreateManagedSnippetCommandInputExit({
            workspaceId: "workspace_snippets",
            title: "Review",
            body: "Review this file.",
            metadata,
            enabled: true,
          }),
        ),
      ).toBe(true);
    }
  });

  it("requires explicit workspace routing for exact session navigation commands", () => {
    const clientSubmission = {
      clientRequestId: "request_session_navigation",
      source: "desktop" as const,
    };
    const target = {
      workspaceId: "workspace_navigation",
      workspaceSessionId: "session_navigation",
      clientSubmission,
    };
    const pinned = decodeUnknownSetSessionPinnedCommandInputExit({ ...target, pinned: true });
    const archived = decodeUnknownSetSessionArchivedCommandInputExit({
      ...target,
      archived: false,
    });
    const read = decodeUnknownMarkSessionReadCommandInputExit(target);
    const unread = decodeUnknownMarkSessionUnreadCommandInputExit(target);
    expect(Exit.isSuccess(pinned)).toBe(true);
    expect(Exit.isSuccess(archived)).toBe(true);
    expect(Exit.isSuccess(read)).toBe(true);
    expect(Exit.isSuccess(unread)).toBe(true);
    if (Exit.isSuccess(pinned)) {
      expect(encodeSetSessionPinnedCommandInputExit(pinned.value)).toEqual(pinned);
    }
    if (Exit.isSuccess(archived)) {
      expect(encodeSetSessionArchivedCommandInputExit(archived.value)).toEqual(archived);
    }
    if (Exit.isSuccess(read)) {
      expect(encodeMarkSessionReadCommandInputExit(read.value)).toEqual(read);
    }
    if (Exit.isSuccess(unread)) {
      expect(encodeMarkSessionUnreadCommandInputExit(unread.value)).toEqual(unread);
    }

    const { workspaceId: _workspaceId, ...missingWorkspace } = target;
    for (const decode of [
      decodeUnknownSetSessionPinnedCommandInputExit,
      decodeUnknownSetSessionArchivedCommandInputExit,
      decodeUnknownMarkSessionReadCommandInputExit,
      decodeUnknownMarkSessionUnreadCommandInputExit,
    ]) {
      expect(Exit.isFailure(decode(missingWorkspace))).toBe(true);
    }

    const section = decodeUnknownSetSessionNavigationSectionStateCommandInputExit({
      workspaceId: "workspace_navigation",
      section: "archived",
      collapsed: false,
      sizePx: 420.5,
      clientSubmission,
    });
    expect(Exit.isSuccess(section)).toBe(true);
    if (Exit.isSuccess(section)) {
      expect(encodeSetSessionNavigationSectionStateCommandInputExit(section.value)).toEqual(
        section,
      );
    }
    expect(
      Exit.isFailure(
        decodeUnknownSetSessionNavigationSectionStateCommandInputExit({
          workspaceId: "workspace_navigation",
          section: "archived",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownSetSessionNavigationSectionStateCommandInputExit({
          workspaceId: "workspace_navigation",
          section: "sessions",
          collapsed: true,
        }),
      ),
    ).toBe(true);
  });
});
