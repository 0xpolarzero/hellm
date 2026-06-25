import { describe, expect, it } from "bun:test";
import type {
  NativeToolDeclaration,
  NativeToolExtensionSchema,
  NativeToolSchema,
  NativeToolSchemaExtension,
  NativeToolSchemasDocument,
} from "./native-tool-contracts";

const shellExtension: NativeToolSchemaExtension = {
  id: "shell",
  title: "Shell",
  description: "Run shell commands.",
  category: "builtin",
  interface: "native_tool",
};

describe("@svvy/core native tool contracts", () => {
  it("defines pi-free declaration, schema document, result, and invocation shapes", () => {
    const toolSchema: NativeToolSchema = {
      name: "exec_command",
      label: "exec_command",
      description: "Execute a shell command.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
      },
    };
    const declaration: NativeToolDeclaration = toolSchema;
    const extensionSchema: NativeToolExtensionSchema = {
      id: shellExtension.id,
      title: shellExtension.title,
      description: shellExtension.description,
      category: shellExtension.category,
      tools: [toolSchema],
    };
    const document: NativeToolSchemasDocument = { nativeTools: [extensionSchema] };

    expect(declaration).toEqual(toolSchema);
    expect(document.nativeTools[0]).toEqual(extensionSchema);
  });
});
