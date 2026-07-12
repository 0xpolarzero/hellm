import { describe, expect, it } from "bun:test";
import {
  unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap,
  unsafeDecodeDeleteWorkflowAgentSourceInputSyncForTestsAndBootstrap,
  unsafeDecodeDuplicateWorkflowAgentSourceInputSyncForTestsAndBootstrap,
  unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap,
  unsafeDecodeRuntimeSaveExtensionSourceEditInputSyncForTestsAndBootstrap,
  unsafeDecodeScaffoldMissingWorkflowAgentSourcesResultSyncForTestsAndBootstrap,
  unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap,
  unsafeDecodeSourceEditSaveResultSyncForTestsAndBootstrap,
  unsafeDecodeSourceEditSessionSyncForTestsAndBootstrap,
  unsafeDecodeWorkflowAgentSourceDeleteResultSyncForTestsAndBootstrap,
  unsafeDecodeWorkflowAgentSourceLifecycleResultSyncForTestsAndBootstrap,
  unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap,
} from "./runtime-source-edit-contracts";

describe("runtime source edit contracts", () => {
  it("decodes file-backed source edit sessions without UI conflict state", () => {
    expect(
      unsafeDecodeSourceEditSessionSyncForTestsAndBootstrap({
        sourceKind: "workflow-agent",
        sourceId: "agent_review",
        path: "/tmp/svvy/workflows/agents/review.agent.json",
        sourceVersion: "version_01",
        fingerprint: "fingerprint_01",
        text: '{"name":"review"}',
        diagnostics: [
          {
            severity: "warning",
            message: "Missing optional description.",
            code: "workflow-agent.description",
            path: "/tmp/svvy/workflows/agents/review.agent.json",
            line: 3,
            column: 5,
          },
        ],
      }) as unknown,
    ).toEqual({
      sourceKind: "workflow-agent",
      sourceId: "agent_review",
      path: "/tmp/svvy/workflows/agents/review.agent.json",
      sourceVersion: "version_01",
      fingerprint: "fingerprint_01",
      text: '{"name":"review"}',
      diagnostics: [
        {
          severity: "warning",
          message: "Missing optional description.",
          code: "workflow-agent.description",
          path: "/tmp/svvy/workflows/agents/review.agent.json",
          line: 3,
          column: 5,
        },
      ],
    });

    expect(() =>
      unsafeDecodeSourceEditSessionSyncForTestsAndBootstrap({
        sourceKind: "workflow-agent",
        sourceId: "agent_review",
        path: "/tmp/svvy/workflows/agents/review.agent.json",
        sourceVersion: "version_01",
        fingerprint: "fingerprint_01",
        text: "{}",
        diagnostics: [],
        conflictModalOpen: true,
      }),
    ).toThrow();
  });

  it("decodes source edit open, save, and stale conflict results", () => {
    expect(
      unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "user-extension",
        sourceId: "web",
      }) as unknown,
    ).toEqual({
      sourceKind: "user-extension",
      sourceId: "web",
    });

    expect(
      unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "user-extension",
        sourceId: "web",
        expectedSourceVersion: "version_01",
        text: "export default {};",
        saveMode: "compare-and-swap",
        sourceCommandId: "cmd_source_01",
      }) as unknown,
    ).toEqual({
      sourceKind: "user-extension",
      sourceId: "web",
      expectedSourceVersion: "version_01",
      text: "export default {};",
      saveMode: "compare-and-swap",
      sourceCommandId: "cmd_source_01",
    });

    expect(
      unsafeDecodeRuntimeSaveExtensionSourceEditInputSyncForTestsAndBootstrap({
        workspaceId: "ws_source_save_01",
        source: {
          sourceKind: "workflow-agent",
          sourceId: "reviewAgent",
          expectedSourceVersion: "version_01",
          text: "{}\n",
          saveMode: "compare-and-swap",
        },
      }) as unknown,
    ).toEqual({
      workspaceId: "ws_source_save_01",
      source: {
        sourceKind: "workflow-agent",
        sourceId: "reviewAgent",
        expectedSourceVersion: "version_01",
        text: "{}\n",
        saveMode: "compare-and-swap",
      },
    });

    expect(() =>
      unsafeDecodeRuntimeSaveExtensionSourceEditInputSyncForTestsAndBootstrap({
        source: {
          sourceKind: "workflow-agent",
          sourceId: "reviewAgent",
          expectedSourceVersion: "version_01",
          text: "{}\n",
          saveMode: "compare-and-swap",
        },
      }),
    ).toThrow();

    expect(
      unsafeDecodeSourceEditSaveResultSyncForTestsAndBootstrap({
        status: "saved",
        sourceVersion: "version_02",
        fingerprint: "fingerprint_02",
        diagnostics: [],
        reconcileRequired: true,
      }) as unknown,
    ).toEqual({
      status: "saved",
      sourceVersion: "version_02",
      fingerprint: "fingerprint_02",
      diagnostics: [],
      reconcileRequired: true,
    });

    expect(
      unsafeDecodeSourceEditSaveResultSyncForTestsAndBootstrap({
        status: "stale",
        current: {
          sourceKind: "user-extension",
          sourceId: "web",
          path: "/tmp/svvy/extensions/web/index.ts",
          sourceVersion: "version_03",
          fingerprint: "fingerprint_03",
          text: "export const current = true;",
          diagnostics: [],
        },
      }) as unknown,
    ).toEqual({
      status: "stale",
      current: {
        sourceKind: "user-extension",
        sourceId: "web",
        path: "/tmp/svvy/extensions/web/index.ts",
        sourceVersion: "version_03",
        fingerprint: "fingerprint_03",
        text: "export const current = true;",
        diagnostics: [],
      },
    });

    expect(
      unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "workflow-workflow",
        sourceId: "repair_loop",
      }) as unknown,
    ).toEqual({
      sourceKind: "workflow-workflow",
      sourceId: "repair_loop",
    });

    expect(() =>
      unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "workflow-module",
        sourceId: "repair_loop",
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "user-extension",
        sourceId: "web",
        path: "/tmp/svvy/extensions/web/index.ts",
      }),
    ).toThrow();
  });

  it("rejects source edit payloads that mix renderer-owned draft metadata into file contracts", () => {
    expect(() =>
      unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "user-extension",
        sourceId: "web",
        expectedSourceVersion: "version_01",
        text: "export default {};",
        saveMode: "overwrite",
        editorSelection: { line: 1, column: 1 },
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap({
        sourceKind: "user-extension",
        sourceId: "web",
        path: "/tmp/svvy/extensions/web/index.ts",
        expectedSourceVersion: "version_01",
        text: "export default {};",
        saveMode: "overwrite",
      }),
    ).toThrow();
  });

  it("decodes canonical workflow-agent create, duplicate, delete, and lifecycle contracts", () => {
    const create = unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
      draft: {
        exportName: "strictReviewer",
        displayName: "Strict reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructionText: "Review strictly.",
        extensionUsageOverrides: [
          { extensionId: "git", usage: "loaded" },
          { extensionId: "github", usage: "available" },
        ],
        extensionOrder: ["github", "git"],
      },
      sourceOwner: "agents-pane",
      sourceCommandId: "cmd_workflow_agent_create_01",
    });
    expect(create as unknown).toEqual({
      draft: {
        exportName: "strictReviewer",
        displayName: "Strict reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructionText: "Review strictly.",
        extensionUsageOverrides: [
          { extensionId: "git", usage: "loaded" },
          { extensionId: "github", usage: "available" },
        ],
        extensionOrder: ["github", "git"],
      },
      sourceOwner: "agents-pane",
      sourceCommandId: "cmd_workflow_agent_create_01",
    });

    expect(
      unsafeDecodeDuplicateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        sourceId: "reviewerAgent",
        draftPatch: {
          exportName: "reviewerCopy",
          displayName: "Reviewer copy",
          instructionText: "Review the implementation.",
        },
        sourceOwner: "headless",
      }) as unknown,
    ).toEqual({
      sourceId: "reviewerAgent",
      draftPatch: {
        exportName: "reviewerCopy",
        displayName: "Reviewer copy",
        instructionText: "Review the implementation.",
      },
      sourceOwner: "headless",
    });

    expect(
      unsafeDecodeDeleteWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        sourceId: "reviewerCopy",
        expectedSourceVersion: "sha256:previous",
        sourceOwner: "svvyx-workflows-command",
      }) as unknown,
    ).toEqual({
      sourceId: "reviewerCopy",
      expectedSourceVersion: "sha256:previous",
      sourceOwner: "svvyx-workflows-command",
    });

    const session = {
      sourceKind: "workflow-agent",
      sourceId: "reviewerCopy",
      path: "/tmp/svvy/workflows/agents/reviewerCopy.agent.json",
      sourceVersion: "sha256:created",
      fingerprint: "sha256:created",
      text: "{}\n",
      diagnostics: [],
    };
    expect(
      unsafeDecodeWorkflowAgentSourceLifecycleResultSyncForTestsAndBootstrap({
        status: "duplicated",
        session,
        fileWriteReceipt: {
          path: session.path,
          previousExists: false,
          bytes: 3,
        },
        reconcileRequired: true,
      }) as unknown,
    ).toMatchObject({ status: "duplicated", session });
    expect(
      unsafeDecodeWorkflowAgentSourceDeleteResultSyncForTestsAndBootstrap({
        status: "deleted",
        sourceKind: "workflow-agent",
        sourceId: "reviewerCopy",
        deletedPath: session.path,
        previousSourceVersion: "sha256:created",
        fileWriteReceipt: { path: session.path, deleted: true },
        reconcileRequired: true,
      }) as unknown,
    ).toMatchObject({ status: "deleted", sourceId: "reviewerCopy" });
  });

  it("rejects noncanonical workflow-agent lifecycle payloads", () => {
    expect(() =>
      unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        draft: {
          exportName: "review-agent",
          displayName: "Review agent",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
        },
        sourceOwner: "agents-pane",
      }),
    ).toThrow();
    expect(() =>
      unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        draft: {
          exportName: "reviewAgent",
          displayName: "Review agent",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
        },
        sourceOwner: "agents-pane",
      }),
    ).toThrow();
    expect(() =>
      unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        draft: {
          exportName: "reviewAgent",
          displayName: "Review agent",
          description: "Renderer-only metadata",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
        },
        sourceOwner: "agents-pane",
      }),
    ).toThrow();
    expect(() =>
      unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        draft: {
          exportName: "reviewAgent",
          displayName: "Review agent",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
          extensionUsageOverrides: [
            { extensionId: "git", usage: "loaded" },
            { extensionId: "git", usage: "available" },
          ],
        },
        sourceOwner: "agents-pane",
      }),
    ).toThrow();
    expect(() =>
      unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap({
        draft: {
          exportName: "reviewAgent",
          displayName: "Review agent",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
          extensionOrder: ["git", "git"],
        },
        sourceOwner: "agents-pane",
      }),
    ).toThrow();
  });

  it("decodes current workflow-agent observations and canonical scaffold evidence", () => {
    const valid = unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap({
      sourceId: "reviewerAgent",
      path: "/tmp/svvy/workflows/agents/reviewerAgent.agent.json",
      sourceVersion: "sha256:reviewer",
      fingerprint: "sha256:reviewer",
      validationStatus: "valid",
      diagnostics: [],
      parameters: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructions: "Review the implementation.",
      },
      extensionOrder: ["git"],
      observedAt: "2026-07-11T08:00:00.000Z",
    });
    expect(valid as unknown).toMatchObject({
      sourceId: "reviewerAgent",
      validationStatus: "valid",
      parameters: { id: "reviewerAgent" },
      extensionOrder: ["git"],
    });

    expect(
      unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap({
        sourceId: "invalid-source-name",
        path: "/tmp/svvy/workflows/agents/invalid-source-name.agent.json",
        sourceVersion: "sha256:invalid",
        fingerprint: "sha256:invalid",
        validationStatus: "invalid",
        diagnostics: [{ severity: "error", message: "Invalid export name." }],
        parameters: null,
        extensionOrder: [],
        observedAt: "2026-07-11T08:00:00.000Z",
      }) as unknown,
    ).toMatchObject({ sourceId: "invalid-source-name", validationStatus: "invalid" });

    expect(() =>
      unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap({
        ...valid,
        validationStatus: "invalid",
      }),
    ).toThrow();
    expect(() =>
      unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap({
        ...valid,
        parameters: { ...valid.parameters!, id: "differentAgent" },
      }),
    ).toThrow("filename identity");

    expect(
      unsafeDecodeScaffoldMissingWorkflowAgentSourcesResultSyncForTestsAndBootstrap({
        created: [
          {
            sourceId: "defaultAgent",
            path: "/tmp/svvy/workflows/agents/defaultAgent.agent.json",
          },
        ],
        preserved: [
          {
            sourceId: "reviewerAgent",
            path: "/tmp/svvy/workflows/agents/reviewerAgent.agent.json",
          },
        ],
      }) as unknown,
    ).toMatchObject({
      created: [{ sourceId: "defaultAgent" }],
      preserved: [{ sourceId: "reviewerAgent" }],
    });
  });
});
