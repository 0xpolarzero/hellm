import { describe, expect, it } from "bun:test";
import { Type } from "@mariozechner/pi-ai";
import { createListToolsTool } from "./list-tools-tool";

describe("list_tools tool", () => {
  it("lists only active tools by default", async () => {
    const tool = createListToolsTool({
      getSession: () => ({
        getActiveToolNames: () => ["read", "list_tools"],
        getAllTools: () => [
          {
            name: "read",
            description: "Read files.",
            parameters: Type.Object({ path: Type.String() }),
          },
          {
            name: "list_tools",
            description: "List tools.",
            parameters: Type.Object({}),
          },
          {
            name: "hidden_tool",
            description: "Not active.",
            parameters: Type.Object({}),
          },
        ],
      }),
    });

    const result = await tool.execute("tool-call-list", {});

    expect(result.details.activeToolNames).toEqual(["read", "list_tools"]);
    expect(result.details.tools.map((entry) => entry.name)).toEqual(["read", "list_tools"]);
    expect(result.details.tools[0]).not.toHaveProperty("parameters");
  });

  it("can include schemas and filter to one tool", async () => {
    const tool = createListToolsTool({
      getSession: () => ({
        getActiveToolNames: () => ["read", "bash"],
        getAllTools: () => [
          {
            name: "read",
            description: "Read files.",
            parameters: Type.Object({ path: Type.String() }),
          },
          {
            name: "bash",
            description: "Run commands.",
            parameters: Type.Object({ command: Type.String() }),
          },
        ],
      }),
    });

    const result = await tool.execute("tool-call-list", {
      toolName: "bash",
      includeSchemas: true,
    });

    expect(result.details.tools).toHaveLength(1);
    expect(result.details.tools[0]?.name).toBe("bash");
    expect(result.details.tools[0]).toHaveProperty("parameters");
  });
});
