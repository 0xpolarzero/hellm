import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";

import {
  AppendAppLogInputSchema,
  AppLogWriteResultSchema,
  AppLogEntrySchema,
  SvvyObservationAnnotationSchema,
} from "./app-log-contracts";

describe("@svvy/core app-log contracts", () => {
  it("decodes stable app-log read DTOs without requiring branded caller literals", () => {
    const decoded = Schema.decodeUnknownSync(AppLogEntrySchema)({
      id: "app-log-1",
      seq: 1,
      createdAt: "2026-06-21T12:34:56.789Z",
      level: "warn",
      source: "app.lifecycle",
      message: "Runtime boundary warning.",
    });

    expect(decoded).toMatchObject({
      id: "app-log-1",
      level: "warn",
      source: "app.lifecycle",
    });
  });

  it("rejects invalid app-log timestamp strings", () => {
    expect(() =>
      Schema.decodeUnknownSync(AppLogEntrySchema)({
        id: "app-log-1",
        seq: 1,
        createdAt: "not-a-date",
        level: "warn",
        source: "app.lifecycle",
        message: "Runtime boundary warning.",
      }),
    ).toThrow();
  });

  it("decodes app-log write-port inputs and after-commit results", () => {
    const input = Schema.decodeUnknownSync(AppendAppLogInputSchema)({
      workspaceId: "wksp_01",
      level: "error",
      source: "app.lifecycle",
      message: "Command failed.",
      occurredAt: "2026-06-21T12:34:56.789Z",
      details: { command: "bun run check" },
      related: [{ kind: "command", id: "cmd_01" }],
      idempotencyKey: "log_cmd_01_failed",
    });

    const result = Schema.decodeUnknownSync(AppLogWriteResultSchema)({
      value: { appLogEntryId: "app-log-1" },
      afterCommit: [
        {
          scope: "workspace",
          workspaceId: input.workspaceId,
          invalidation: { model: "appLogs" },
        },
      ],
    });

    expect(input.related as unknown).toEqual([{ kind: "command", id: "cmd_01" }]);
    expect(result.value.appLogEntryId as unknown).toBe("app-log-1");
    expect(result.afterCommit as unknown).toEqual([
      {
        scope: "workspace",
        workspaceId: "wksp_01",
        invalidation: { model: "appLogs" },
      },
    ]);
  });

  it("keeps observation annotations closed to normalized product metadata", () => {
    const annotation = Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
      key: "svvy.command_id",
      value: "cmd_01",
    });

    expect(annotation as unknown).toEqual({ key: "svvy.command_id", value: "cmd_01" });
    expect(
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.package",
        value: "runtime",
      }) as unknown,
    ).toEqual({ key: "svvy.package", value: "runtime" });
    expect(
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.operation",
        value: "queue.claim_latency",
      }) as unknown,
    ).toEqual({ key: "svvy.operation", value: "queue.claim_latency" });
    expect(
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.reason_class",
        value: "runtime_retry",
      }) as unknown,
    ).toEqual({ key: "svvy.reason_class", value: "runtime_retry" });
    expect(() =>
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.raw_error",
        value: "ENOENT /Users/me/.config/token",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.package",
        value: "generated-plugin",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.operation",
        value: "/Users/me/.config/token",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SvvyObservationAnnotationSchema)({
        key: "svvy.reason_class",
        value: "RuntimeRetry",
      }),
    ).toThrow();
  });
});
