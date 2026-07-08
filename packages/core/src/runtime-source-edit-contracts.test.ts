import { describe, expect, it } from "bun:test";
import {
  unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap,
  unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap,
  unsafeDecodeSourceEditSaveResultSyncForTestsAndBootstrap,
  unsafeDecodeSourceEditSessionSyncForTestsAndBootstrap,
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
});
