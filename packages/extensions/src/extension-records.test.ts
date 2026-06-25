import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import { ExtensionUsageStateSchema } from "@svvy/core";
import { BUILTIN_EXTENSIONS, builtinDefaultExtensionUsageState } from "./extension-records";

describe("@svvy/extensions extension records", () => {
  it("resolves builtin default usage states through the core usage-state contract", () => {
    const isExtensionUsageState = Schema.is(ExtensionUsageStateSchema);
    const violations = BUILTIN_EXTENSIONS.flatMap((extension) =>
      (["orchestrator", "handler", "workflow-task"] as const)
        .map((actor) => ({
          actor,
          state: builtinDefaultExtensionUsageState(extension.id, actor),
        }))
        .filter(({ state }) => !isExtensionUsageState(state))
        .map(({ actor, state }) => `${extension.id}:${actor}:${state}`),
    );

    expect(violations).toEqual([]);
  });
});
