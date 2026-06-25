import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSourceStatePort,
  StateContractError,
  type AbsolutePath,
  type CommandId,
  type RecordRuntimeSourceDeleteInput,
  type RecordRuntimeSourceSaveInput,
  type RuntimeSourceFactRecord,
} from "@svvy/core";
import { layerRuntimeSourceStatePort, runtimeSourceStatePortFromStore } from "./index";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_source_state_port",
  cwd: "/tmp/svvy-runtime-source-state-port",
  label: "Runtime source state port",
};

const path = (value: string) => value as AbsolutePath;
const savedAt = (value: string) => value as RecordRuntimeSourceSaveInput["savedAt"];
const deletedAt = (value: string) => value as RecordRuntimeSourceDeleteInput["deletedAt"];
const factDeletedAt = (value: string) => value as RuntimeSourceFactRecord["deletedAt"];

describe("RuntimeSourceStatePort", () => {
  it("records, reads, updates, deletes, and persists source facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-source-port-"));
    const databasePath = join(dir, "state.sqlite");
    try {
      const store = createStructuredSessionStateStore({ databasePath, workspace });
      const port = runtimeSourceStatePortFromStore(store);
      const saved = await runTestEffect(
        port.recordSourceSave({
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          path: path("/tmp/svvy-runtime-source-state-port/.smithers/reviewer.agent.json"),
          sourceVersion: "version_01",
          fingerprint: "fingerprint_01",
          diagnostics: [],
          savedAt: savedAt("2026-04-18T10:00:00.000Z"),
        }),
      );
      const updated = await runTestEffect(
        port.recordSourceSave({
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          path: path("/tmp/svvy-runtime-source-state-port/.smithers/reviewer.agent.json"),
          previousSourceVersion: "version_01",
          sourceVersion: "version_02",
          fingerprint: "fingerprint_02",
          diagnostics: [{ severity: "warning", message: "Check model.", code: "MODEL" }],
          sourceCommandId: "command-source-save" as CommandId,
          savedAt: savedAt("2026-04-18T10:01:00.000Z"),
        }),
      );
      const deleted = await runTestEffect(
        port.recordSourceDelete({
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          expectedSourceVersion: "version_02",
          deletedAt: deletedAt("2026-04-18T10:02:00.000Z"),
        }),
      );
      store.close();

      const reopened = createStructuredSessionStateStore({ databasePath, workspace });
      const reopenedPort = runtimeSourceStatePortFromStore(reopened);
      const read = await runTestEffect(
        reopenedPort.readSourceVersion({
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
        }),
      );
      reopened.close();

      expect(saved.afterCommit).toEqual([
        { scope: "app", invalidation: { model: "agents" } },
        { scope: "app", invalidation: { model: "workflowsGenerated" } },
      ]);
      expect(updated.value).toMatchObject({
        sourceVersion: "version_02",
        fingerprint: "fingerprint_02",
        sourceCommandId: "command-source-save",
        deletedAt: null,
      });
      expect(deleted.value.deletedAt).toBe(factDeletedAt("2026-04-18T10:02:00.000Z"));
      expect(read).toMatchObject({
        sourceKind: "workflow-agent",
        sourceId: "agent-reviewer",
        sourceVersion: "version_02",
        deletedAt: factDeletedAt("2026-04-18T10:02:00.000Z"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects stale source save versions through the typed state error boundary", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    await runTestEffect(
      port.recordSourceSave({
        sourceKind: "user-extension",
        sourceId: "extension-a",
        path: path("/tmp/svvy-runtime-source-state-port/extensions/a.mdx"),
        sourceVersion: "version_01",
        fingerprint: "fingerprint_01",
        diagnostics: [],
        savedAt: savedAt("2026-04-18T11:00:00.000Z"),
      }),
    );

    await expect(
      runTestEffect(
        port.recordSourceSave({
          sourceKind: "user-extension",
          sourceId: "extension-a",
          path: path("/tmp/svvy-runtime-source-state-port/extensions/a.mdx"),
          previousSourceVersion: "version_missing",
          sourceVersion: "version_02",
          fingerprint: "fingerprint_02",
          diagnostics: [],
          savedAt: savedAt("2026-04-18T11:01:00.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
    store.close();
  });

  it("exposes the source state port through a layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* RuntimeSourceStatePort;
          const result = yield* port.recordSourceSave({
            sourceKind: "builtin-extension",
            sourceId: "base-orchestrator",
            path: path("/tmp/svvy-runtime-source-state-port/base-orchestrator.mdx"),
            sourceVersion: "version_01",
            fingerprint: "fingerprint_01",
            diagnostics: [],
            savedAt: savedAt("2026-04-18T12:00:00.000Z"),
          });
          expect(result.afterCommit).toEqual([
            { scope: "app", invalidation: { model: "extensions" } },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
