import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  AppendAppLogInputSchema,
  AppLogWritePort,
  StateContractError,
  type WorkspaceId,
} from "@svvy/core";
import { AppLogState, layerAppLogState } from "./app-log-store";
import { appLogWritePortFromAppLogState, layerAppLogWritePort } from "./app-log-write-port";
import { createStateAppLogsFacade } from "./state-facade";
import { runTestEffect } from "./effect.test-support";
import { testPlatformLayer } from "./platform-test-support";

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

describe("AppLogWritePort", () => {
  it("binds omitted workspace scope through a workspace-owned facade", async () => {
    const databaseRoot = mkdtempSync(join(tmpdir(), "svvy-app-log-write-facade-"));
    const workspaceId = "workspace-owned-app-log-facade" as WorkspaceId;
    const facade = createStateAppLogsFacade({
      databasePath: join(databaseRoot, "state.sqlite"),
      digest: testDigest,
      workspaceId,
      now: () => "2026-06-21T12:35:00.000Z",
    });
    try {
      const result = await runTestEffect(
        facade.writePort.append({
          level: "info",
          source: "workspace",
          message: "Workspace-owned write",
          occurredAt: "2026-06-21T12:34:56.789Z" as never,
        }),
      );

      expect(result.afterCommit).toEqual([
        {
          scope: "workspace",
          workspaceId,
          invalidation: { model: "appLogs" },
        },
      ]);
      expect(facade.query({}, workspaceId).entries[0]).toMatchObject({ workspaceId });
      await expect(
        runTestEffect(
          facade.writePort.append({
            workspaceId: "another-workspace" as never,
            level: "info",
            source: "workspace",
            message: "Conflicting workspace",
            occurredAt: "2026-06-21T12:34:57.789Z" as never,
          }),
        ),
      ).rejects.toMatchObject({
        operation: "app-log.write.append",
        reason: "invalid-input",
      });
    } finally {
      facade.close();
      rmSync(databaseRoot, { recursive: true, force: true });
    }
  });

  it("validates and persists app-log writes through the core port", async () => {
    const result = await runTestEffect(
      Effect.gen(function* () {
        const appLogs = yield* AppLogState;
        const port = appLogWritePortFromAppLogState(appLogs);
        const input = Schema.decodeUnknownSync(AppendAppLogInputSchema)({
          workspaceId: "workspace_app_log_write_port",
          level: "error",
          source: "execute_typescript",
          message: "TOKEN=super-secret-value failed",
          occurredAt: "2026-06-21T12:34:56.789Z",
          details: { command: "bun run check", token: "super-secret-value" },
          normalizedError: {
            errorTag: "RuntimeContractError",
            operation: "execute_typescript",
            reason: "execution-failed",
            message: "compile failed",
          },
          related: [
            { kind: "workspace-session", id: "session_app_log_write_port" },
            { kind: "surface", id: "surface_app_log_write_port" },
            { kind: "thread", id: "thread_app_log_write_port" },
            { kind: "command", id: "cmd_app_log_write_port" },
            { kind: "artifact", id: "artifact_app_log_write_port" },
            { kind: "workflow-run", id: "workflow_run_app_log_write_port" },
            { kind: "workflow-task-attempt", id: "workflow_task_app_log_write_port" },
          ],
          idempotencyKey: "app-log-write-port-test",
        });
        const write = yield* port.append(input);
        const readModel = yield* appLogs.query();
        return { write, entry: readModel.entries[0] };
      }).pipe(
        Effect.provide(
          layerAppLogState({ digest: testDigest, now: () => "2026-06-21T12:35:00.000Z" }).pipe(
            Layer.provide(testPlatformLayer()),
          ),
        ),
      ),
    );

    expect(result.write as unknown).toEqual({
      value: { appLogEntryId: "app-log-1" },
      afterCommit: [
        {
          scope: "workspace",
          workspaceId: "workspace_app_log_write_port",
          invalidation: { model: "appLogs" },
        },
      ],
    });
    expect(result.entry).toMatchObject({
      id: "app-log-1",
      createdAt: "2026-06-21T12:34:56.789Z",
      level: "error",
      source: "execute_typescript",
      message: "TOKEN=[REDACTED] failed",
      workspaceSessionId: "session_app_log_write_port",
      surfacePiSessionId: "surface_app_log_write_port",
      threadId: "thread_app_log_write_port",
      commandId: "cmd_app_log_write_port",
      artifactId: "artifact_app_log_write_port",
      workflowRunId: "workflow_run_app_log_write_port",
      workflowTaskAttemptId: "workflow_task_app_log_write_port",
    });
    expect(result.entry?.details).toEqual({
      command: "bun run check",
      token: "[REDACTED]",
    });
    expect(result.entry?.error).toMatchObject({ message: "compile failed" });
  });

  it("maps invalid append input to StateContractError", async () => {
    const error = await runTestEffect(
      Effect.gen(function* () {
        const port = yield* AppLogWritePort;
        return yield* port
          .append({
            level: "not-a-level",
            source: "app.lifecycle",
            message: "invalid",
            occurredAt: "2026-06-21T12:34:56.789Z",
          } as never)
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          layerAppLogWritePort.pipe(
            Layer.provideMerge(
              layerAppLogState({
                digest: testDigest,
                now: () => "2026-06-21T12:35:00.000Z",
              }).pipe(Layer.provide(testPlatformLayer())),
            ),
          ),
        ),
      ),
    );

    expect(error).toBeInstanceOf(StateContractError);
    expect(error).toMatchObject({
      operation: "app-log.write.append",
      reason: "invalid-input",
    });
  });

  it("rejects excess app-log write fields at the state-port boundary", async () => {
    const error = await runTestEffect(
      Effect.gen(function* () {
        const port = yield* AppLogWritePort;
        return yield* port
          .append({
            workspaceId: "workspace_app_log_write_port",
            level: "info",
            source: "workspace",
            message: "extra field should fail",
            occurredAt: "2026-06-21T12:34:56.789Z",
            previewOnly: "not a contract field",
          } as never)
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          layerAppLogWritePort.pipe(
            Layer.provideMerge(
              layerAppLogState({
                digest: testDigest,
                now: () => "2026-06-21T12:35:00.000Z",
              }).pipe(Layer.provide(testPlatformLayer())),
            ),
          ),
        ),
      ),
    );

    expect(error).toBeInstanceOf(StateContractError);
    expect(error).toMatchObject({
      operation: "app-log.write.append",
      reason: "invalid-input",
    });
  });
});
