import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import { RUNTIME_TURN_DECISIONS, RuntimeTurnDecisionSchema } from "@svvy/core";
import {
  buildNativeToolSchemaJsonForExtension,
  buildNativeToolSchemasJson,
} from "./native-tool-catalog";
import { getNativeToolCommandMetadata, nativeToolCommandMetadata } from "./native-tool-metadata";

describe("native tool schema catalog", () => {
  it("emits only native-tool extension records in stable extension order", () => {
    const parsed = JSON.parse(
      buildNativeToolSchemasJson([
        {
          id: "thread-handling",
          title: "Thread Handling",
          description: "Handler thread tools.",
          category: "builtin",
          interface: "native_tool",
        },
        {
          id: "workflows",
          title: "Workflows",
          description: "Reusable workflows.",
          category: "builtin",
          interface: "svvyx",
        },
        {
          id: "shell",
          title: "Shell",
          description: "Run shell commands.",
          category: "builtin",
          interface: "native_tool",
        },
      ]),
    );

    expect(parsed.nativeTools.map((entry: { id: string }) => entry.id)).toEqual([
      "shell",
      "thread-handling",
    ]);
    expect(parsed.nativeTools[0].tools.map((tool: { name: string }) => tool.name)).toEqual([
      "exec_command",
      "write_stdin",
    ]);
  });

  it("fails closed for native-tool extension records without a concrete catalog entry", () => {
    expect(() =>
      buildNativeToolSchemaJsonForExtension({
        id: "missing-native-tool",
        title: "Missing",
        description: "Missing schema.",
        category: "test",
        interface: "native_tool",
      }),
    ).toThrow("Missing native tool schema definitions for extension: missing-native-tool");
  });

  it("owns command projection metadata for native tools", () => {
    const handlerProvidedFactTools = nativeToolCommandMetadata
      .filter((metadata) => metadata.executionCommand === "self-recorded-command")
      .map((metadata) => metadata.toolName);

    expect(handlerProvidedFactTools).toEqual([
      "execute_typescript",
      "list_extensions",
      "load_extension",
      "request_user_input",
      "thread_start",
      "thread_followup",
      "thread_request_report",
      "thread_list",
      "thread_episodes",
      "thread_current",
      "thread_group",
      "thread_report",
    ]);
    expect(getNativeToolCommandMetadata("exec_command")).toMatchObject({
      extensionIds: ["shell"],
      actorAvailability: {
        orchestrator: "loaded",
        handler: "loaded",
        "workflow-task": "loaded",
      },
      visibility: "summary",
      streamingArguments: "record",
      executionCommand: "generic-command",
      turnDecision: "exec_command",
    });
    expect(getNativeToolCommandMetadata("thread_episodes")).toMatchObject({
      extensionIds: ["thread-handling", "thread-orchestration"],
      actorAvailability: {
        orchestrator: "loaded",
        handler: "loaded",
        "workflow-task": "unavailable",
      },
      visibility: "surface",
      streamingArguments: "skip",
      executionCommand: "self-recorded-command",
      turnDecision: "thread_episodes",
    });
    expect(getNativeToolCommandMetadata("thread_list")).toMatchObject({
      executionCommand: "self-recorded-command",
      turnDecision: "thread_list",
    });
    expect(getNativeToolCommandMetadata("thread_current")).toMatchObject({
      executionCommand: "self-recorded-command",
      turnDecision: "thread_current",
    });
    expect(getNativeToolCommandMetadata("read")).toBeNull();
  });

  it("keeps native metadata turn decisions inside the shared core vocabulary", () => {
    const isRuntimeTurnDecision = Schema.is(RuntimeTurnDecisionSchema);
    expect([...RUNTIME_TURN_DECISIONS]).toContain("thread_list");
    expect([...RUNTIME_TURN_DECISIONS]).toContain("thread_current");

    const violations = nativeToolCommandMetadata
      .filter((metadata) => metadata.turnDecision !== null)
      .filter((metadata) => !isRuntimeTurnDecision(metadata.turnDecision))
      .map((metadata) => `${metadata.toolName}: ${metadata.turnDecision}`);

    expect(violations).toEqual([]);
  });
});
