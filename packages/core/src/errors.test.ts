import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  decodeUnknownProviderAuthPortErrorExit,
  decodeUnknownRuntimeContractErrorEffect,
  decodeUnknownRuntimeContractErrorExit,
  decodeUnknownRuntimeEventErrorExit,
  encodeProviderAuthPortErrorExit,
  encodeRuntimeContractErrorEffect,
  encodeRuntimeContractErrorExit,
  ExtensionError,
  formatBoundaryIssues,
  normalizeBoundaryIssuePath,
  PiAdapterError,
  RuntimeContractError,
} from "./errors";
import {
  decodeUnknownDesktopBridgeErrorContractExit,
  decodeUnknownDesktopSubmitPromptRequestExit,
  decodeUnknownDesktopWriteCommandStdinRequestExit,
  encodeDesktopBridgeErrorContractExit,
  normalizeDesktopBridgeErrorContract,
} from "./desktop-bridge-error-contract";

describe("@svvy/core errors", () => {
  it("decodes every desktop bridge error reason and rejects unknown reasons", () => {
    const reasons = [
      "invalid-input",
      "invalid-panel-binding",
      "state-facade-failed",
      "runtime-facade-failed",
      "renderer-disconnected",
      "desktop-shutdown",
    ] as const;

    for (const reason of reasons) {
      const decoded = decodeUnknownDesktopBridgeErrorContractExit({
        operation: "desktop.test",
        reason,
        message: reason,
      });
      expect(Exit.isSuccess(decoded)).toBe(true);
      if (Exit.isSuccess(decoded)) {
        expect(decoded.value.reason).toBe(reason);
      }
    }

    expect(
      Exit.isFailure(
        decodeUnknownDesktopBridgeErrorContractExit({
          operation: "desktop.test",
          reason: "stack-leaked",
          message: "not allowed",
        }),
      ),
    ).toBe(true);
  });

  it("round trips desktop bridge errors without leaking raw stacks", () => {
    const error = new Error("host failure");
    error.stack = "secret stack";
    const normalized = normalizeDesktopBridgeErrorContract({
      operation: "desktop.rpc",
      reason: "runtime-facade-failed",
      message: "Runtime call failed.",
      cause: error,
    });

    expect(JSON.stringify(normalized)).not.toContain("secret stack");
    const encoded = encodeDesktopBridgeErrorContractExit(normalized);
    expect(Exit.isSuccess(encoded)).toBe(true);
    if (Exit.isSuccess(encoded)) {
      expect(JSON.stringify(encoded.value)).not.toContain("secret stack");
    }
  });

  it("strictly decodes desktop submit and command stdin bridge requests", () => {
    const target = {
      workspaceSessionId: "session-desktop-bridge",
      surface: "orchestrator",
      surfacePiSessionId: "surface-desktop-bridge",
    };

    expect(
      Exit.isSuccess(
        decodeUnknownDesktopSubmitPromptRequestExit({
          panelId: "primary",
          target,
          text: "Hello",
          attachments: [],
          clientRequestId: "client-request-1",
        }),
      ),
    ).toBe(true);

    for (const forbiddenField of [
      "messages",
      "systemPrompt",
      "toolDeclarations",
      "generatedContext",
      "panelSnapshot",
    ]) {
      expect(
        Exit.isFailure(
          decodeUnknownDesktopSubmitPromptRequestExit({
            panelId: "primary",
            target,
            text: "Hello",
            clientRequestId: "client-request-1",
            [forbiddenField]: {},
          }),
        ),
      ).toBe(true);
    }

    expect(
      Exit.isSuccess(
        decodeUnknownDesktopWriteCommandStdinRequestExit({
          commandId: "command-desktop-bridge",
          text: "yes\n",
          clientSubmission: {
            source: "command-inspector",
            clientRequestId: "stdin-request-1",
          },
        }),
      ),
    ).toBe(true);
  });

  it("decodes every public runtime contract error reason", () => {
    const reasons = [
      "invalid-input",
      "schema-error",
      "target-not-found",
      "target-not-ready",
      "surface-not-messageable",
      "stale-state",
      "state-conflict",
      "unsupported-operation",
      "startup-pending",
      "startup-failed",
      "runtime-shutdown",
      "runtime-disposed",
      "runtime-closed",
      "backpressure",
      "approval-required",
      "dependency-not-ready",
      "read-only-source",
      "event-replay-unavailable",
      "stream-failed",
      "bridge-invalid-request",
      "bridge-payload-too-large",
      "bridge-forbidden",
      "source-command-not-found",
      "source-command-not-handler-owned",
    ] as const;

    for (const reason of reasons) {
      expect(
        Schema.decodeUnknownSync(RuntimeContractError)({
          _tag: "RuntimeContractError",
          operation: "runtime.test",
          reason,
          message: reason,
        }).reason,
      ).toBe(reason);
    }
  });

  it("decodes every public extension error reason", () => {
    const reasons = [
      "invalid-input",
      "not-found",
      "not-loaded",
      "dependency-not-ready",
      "unsupported-operation",
      "read-only-source",
      "execution-failed",
      "redaction-failed",
    ] as const;

    for (const reason of reasons) {
      expect(
        Schema.decodeUnknownSync(ExtensionError)({
          _tag: "ExtensionError",
          operation: "extensions.test",
          reason,
          message: reason,
        }).reason,
      ).toBe(reason);
    }
  });

  it("decodes every public pi adapter error reason", () => {
    const reasons = [
      "provider-auth-failed",
      "provider-auth-missing",
      "provider-auth-expired",
      "provider-auth-refresh-failed",
      "runtime-paths-failed",
      "session-conflict",
      "session-not-found",
      "session-open-failed",
      "session-create-failed",
      "session-close-failed",
      "session-reference-failed",
      "active-turn-running",
      "turn-not-active",
      "turn-mismatch",
      "turn-already-terminal",
      "turn-failed",
      "event-decode-failed",
      "model-read-failed",
      "history-operation-failed",
      "helper-job-failed",
      "tool-execution-failed",
    ] as const;

    for (const reason of reasons) {
      expect(
        Schema.decodeUnknownSync(PiAdapterError)({
          _tag: "PiAdapterError",
          operation: "pi-adapter.test",
          reason,
          message: reason,
        }).reason,
      ).toBe(reason);
    }
  });

  it("round trips runtime contract errors through public codecs", () => {
    expect(typeof decodeUnknownRuntimeContractErrorEffect).toBe("function");
    expect(typeof encodeRuntimeContractErrorEffect).toBe("function");

    const decoded = decodeUnknownRuntimeContractErrorExit({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.submit",
      reason: "backpressure",
      message: "Queue is full.",
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(decoded.value.reason).toBe("backpressure");
      expect(encodeRuntimeContractErrorExit(decoded.value)).toEqual(
        Exit.succeed({
          _tag: "RuntimeContractError",
          operation: "runtime.messages.submit",
          reason: "backpressure",
          message: "Queue is full.",
        }),
      );
    }
  });

  it("round trips port errors through public Exit codecs", () => {
    const decoded = decodeUnknownProviderAuthPortErrorExit({
      _tag: "ProviderAuthPortError",
      operation: "providerAuth.snapshot",
      reason: "credentials-missing",
      message: "No provider token is stored.",
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeProviderAuthPortErrorExit(decoded.value)).toEqual(
        Exit.succeed({
          _tag: "ProviderAuthPortError",
          operation: "providerAuth.snapshot",
          reason: "credentials-missing",
          message: "No provider token is stored.",
        }),
      );
    }
  });

  it("strictly decodes runtime event error union members", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownRuntimeEventErrorExit({
          _tag: "RuntimeEventRebaselineRequired",
          reason: "stale-cursor",
          requestedAfterSequence: 10,
          retainedFromSequence: 12,
          currentHighWaterSequence: 18,
          eventGenerationId: "event_generation_01",
          affectedReadModels: [],
          message: "The event cursor is outside the retained range.",
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decodeUnknownRuntimeEventErrorExit({
          _tag: "RuntimeEventRebaselineRequired",
          reason: "stale-cursor",
          requestedAfterSequence: 10,
          retainedFromSequence: 12,
          currentHighWaterSequence: 18,
          eventGenerationId: "event_generation_01",
          affectedReadModels: [],
          message: "The event cursor is outside the retained range.",
          preview: "not part of the public contract",
        }),
      ),
    ).toBe(true);
  });

  it("normalizes non-json schema issue path segments", () => {
    const anonymousSymbol = Symbol();

    expect(
      normalizeBoundaryIssuePath([
        "threads",
        { key: 0 },
        { key: Symbol("objective") },
        Symbol("leaf"),
        { key: anonymousSymbol },
        { key: null },
        undefined,
        null,
        { key: { nested: true } },
      ]),
    ).toEqual(["threads", 0, "objective", "leaf", "Symbol()", "[object Object]"]);
  });

  it("preserves string and numeric schema issue path segments", () => {
    const DecodeTarget = Schema.Struct({
      threads: Schema.Array(
        Schema.Struct({
          objective: Schema.String,
        }),
      ),
    });

    try {
      Schema.decodeUnknownSync(DecodeTarget)({
        threads: [{ objective: 1 }],
      });
    } catch (error) {
      expect(formatBoundaryIssues(error as Schema.SchemaError)).toEqual([
        {
          path: ["threads", 0, "objective"],
          message: "Expected string, got 1",
        },
      ]);
      return;
    }

    throw new Error("Expected schema decoding to fail.");
  });
});
