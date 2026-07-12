import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import { decodeUnknownSvvyxWorkflowsRuntimeIntentExit } from "./svvyx-workflows-runtime-transport-contracts";

describe("Svvyx Workflows Runtime transport", () => {
  it("strictly decodes the response-bearing build intent", () => {
    const decoded = decodeUnknownSvvyxWorkflowsRuntimeIntentExit({
      id: "workflows-runtime-1",
      kind: "workflows.runtime_request",
      request: {
        operation: "build",
        input: { sourceCommandId: "command-workflows-1" },
      },
    });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("rejects unknown operations and excess fields", () => {
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxWorkflowsRuntimeIntentExit({
          id: "workflows-runtime-1",
          kind: "workflows.runtime_request",
          request: { operation: "write-files", input: {} },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxWorkflowsRuntimeIntentExit({
          id: "workflows-runtime-1",
          kind: "workflows.runtime_request",
          request: { operation: "build", input: {}, extra: true },
        }),
      ),
    ).toBe(true);
  });
});
