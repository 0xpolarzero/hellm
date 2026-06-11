export type SvvyxCommandManifest = {
  version: "incur.v1";
  commands: SvvyxCommandManifestEntry[];
};

export type SvvyxCommandManifestEntry = {
  name: string;
  aliases?: string[];
  description?: string;
  examples?: { command: string; description?: string }[];
  schema?: {
    args?: Record<string, unknown>;
    env?: Record<string, unknown>;
    options?: Record<string, unknown>;
    output?: Record<string, unknown>;
  };
  streaming?: boolean;
};

export function buildUserSvvyxTypescriptDeclaration(input: {
  commandManifest: SvvyxCommandManifest;
  extensionId: string;
}): string {
  const prefix = pascalCase(input.extensionId);
  const commandMapName = `${prefix}ExtensionCommandMap`;
  const clientName = `${prefix}ExtensionClient`;
  const outputControlsName = `${prefix}ExtensionOutputControls`;
  const inputArgName = `${prefix}ExtensionInputArg`;
  return [
    `type ${outputControlsName} = {`,
    "  selection?: string[];",
    '  outputFormat?: "toon" | "json" | "yaml" | "md" | "jsonl";',
    "  outputTokenCount?: boolean;",
    "  outputTokenLimit?: number;",
    "  outputTokenOffset?: number;",
    "};",
    "",
    `type ${commandMapName} = {`,
    ...input.commandManifest.commands
      .filter((command) => !command.streaming)
      .flatMap((command) => renderCommandMapEntry(command, outputControlsName, commandMapName)),
    "};",
    "",
    `type ${inputArgName}<CommandId extends keyof ${commandMapName}> = keyof Omit<${commandMapName}[CommandId]["input"], keyof ${outputControlsName}> extends never`,
    `  ? [input?: ${commandMapName}[CommandId]["input"]]`,
    `  : [input: ${commandMapName}[CommandId]["input"]];`,
    "",
    `interface ${clientName} {`,
    `  run<CommandId extends keyof ${commandMapName}>(`,
    "    commandId: CommandId,",
    `    ...input: ${inputArgName}<CommandId>`,
    `  ): Promise<${commandMapName}[CommandId]["result"]>;`,
    "}",
    "",
    "interface LoadedExtensionsClient {",
    `  ${propertyName(input.extensionId)}: ${clientName};`,
    "}",
    "",
  ].join("\n");
}

export function isSvvyxCommandManifest(value: unknown): value is SvvyxCommandManifest {
  if (!isRecord(value) || value.version !== "incur.v1" || !Array.isArray(value.commands)) {
    return false;
  }
  const names = new Set<string>();
  for (const command of value.commands) {
    if (!isSvvyxCommandManifestEntry(command)) {
      return false;
    }
    if (names.has(command.name)) {
      return false;
    }
    names.add(command.name);
  }
  return true;
}

function isSvvyxCommandManifestEntry(value: unknown): value is SvvyxCommandManifestEntry {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0) {
    return false;
  }
  if ("aliases" in value) {
    if (
      !Array.isArray(value.aliases) ||
      !value.aliases.every((alias) => typeof alias === "string")
    ) {
      return false;
    }
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if ("examples" in value) {
    if (!Array.isArray(value.examples) || !value.examples.every(isSvvyxCommandExample)) {
      return false;
    }
  }
  if ("schema" in value && !isSvvyxCommandSchema(value.schema)) {
    return false;
  }
  if ("streaming" in value && typeof value.streaming !== "boolean") {
    return false;
  }
  return true;
}

function isSvvyxCommandExample(value: unknown): value is {
  command: string;
  description?: string;
} {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    (!("description" in value) || typeof value.description === "string")
  );
}

function isSvvyxCommandSchema(
  value: unknown,
): value is NonNullable<SvvyxCommandManifestEntry["schema"]> {
  if (!isRecord(value)) {
    return false;
  }
  return ["args", "env", "options", "output"].every(
    (key) => !(key in value) || isRecord(value[key]),
  );
}

function renderCommandMapEntry(
  command: SvvyxCommandManifestEntry,
  outputControlsName: string,
  commandMapName: string,
): string[] {
  return [
    `  ${JSON.stringify(command.name)}: {`,
    `    input: ${renderCommandInput(command, outputControlsName)};`,
    `    result: Run.Result<${renderJsonSchemaType(command.schema?.output)}, ${commandMapName}>;`,
    "  };",
  ];
}

function renderCommandInput(
  command: SvvyxCommandManifestEntry,
  outputControlsName: string,
): string {
  const fields: string[] = [];
  if (command.schema?.args) {
    fields.push(
      `args${schemaHasRequiredProperties(command.schema.args) ? "" : "?"}: ${renderJsonSchemaType(command.schema.args)}`,
    );
  }
  if (command.schema?.options) {
    fields.push(
      `options${schemaHasRequiredProperties(command.schema.options) ? "" : "?"}: ${renderJsonSchemaType(command.schema.options)}`,
    );
  }
  if (fields.length === 0) {
    return outputControlsName;
  }
  return `{ ${fields.join("; ")} } & ${outputControlsName}`;
}

function schemaHasRequiredProperties(schema: unknown): boolean {
  return isRecord(schema) && Array.isArray(schema.required) && schema.required.length > 0;
}

function renderJsonSchemaType(schema: unknown): string {
  if (!isRecord(schema)) {
    return "unknown";
  }
  if ("const" in schema) {
    return JSON.stringify(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ") || "never";
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map(renderJsonSchemaType).join(" | ") || "unknown";
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map(renderJsonSchemaType).join(" | ") || "unknown";
  }
  if (typeof schema.$ref === "string") {
    return "unknown";
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.map((entry) => renderJsonSchemaType({ ...schema, type: entry })).join(" | ");
  }
  if (type === "string") {
    return "string";
  }
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "null") {
    return "null";
  }
  if (type === "array") {
    const itemType = renderJsonSchemaType(schema.items);
    return itemType.includes(" | ") ? `(${itemType})[]` : `${itemType}[]`;
  }
  if (type === "object" || isRecord(schema.properties)) {
    return renderJsonSchemaObjectType(schema);
  }
  return "unknown";
}

function renderJsonSchemaObjectType(schema: Record<string, unknown>): string {
  if (!isRecord(schema.properties)) {
    return "{}";
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const entries = Object.entries(schema.properties).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";
    return `${propertyName(key)}${optional}: ${renderJsonSchemaType(value)}`;
  });
  return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function pascalCase(value: string): string {
  const parts = value
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const name = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join("");
  return /^[A-Za-z_$]/.test(name) ? name : `Extension${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
