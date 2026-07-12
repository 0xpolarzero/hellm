import type { ExtensionId, SvvyxCommandManifest } from "@svvy/core";

export type AppNativeSvvyxMetadata = {
  readonly extensionId: ExtensionId;
  readonly namespace: string;
  readonly minimalInstruction: string;
  readonly commandManifest: SvvyxCommandManifest;
  readonly typescriptApiEnabled: boolean;
};

const openCommand = (name: string, description: string) => ({
  name,
  description,
  schema: {
    options: { type: "object", additionalProperties: true },
    output: { type: "object", additionalProperties: true },
  },
});

const objectSchema = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required: [...required] } : {}),
  additionalProperties: false,
});
const stringSchema = { type: "string" };
const artifactProperties = {
  id: stringSchema,
  path: stringSchema,
  name: stringSchema,
  immutable: { type: "boolean" },
  mimeType: stringSchema,
  bytes: { type: "number" },
  sha256: stringSchema,
  createdAt: stringSchema,
};
const artifactRequired = Object.keys(artifactProperties);
const artifactSchema = objectSchema(artifactProperties, artifactRequired);
const workflowKind = { type: "string", enum: ["agent", "prompt", "component", "workflow"] };
const workflowItemProperties = {
  kind: workflowKind,
  namespace: stringSchema,
  exportName: stringSchema,
  qualifiedName: stringSchema,
  sourcePath: stringSchema,
  generatedPath: stringSchema,
};
const workflowItem = objectSchema(workflowItemProperties, Object.keys(workflowItemProperties));
const diagnostic = objectSchema(
  { code: stringSchema, message: stringSchema, path: stringSchema, exportName: stringSchema },
  ["code", "message"],
);

const definitions = [
  {
    extensionId: "extension-managing",
    namespace: "extensions",
    minimalInstruction:
      "Load this extension when local extension source or build inspection is needed.",
    typescriptApiEnabled: false,
    commands: [
      [
        "inspect",
        "Inspect one extension's source paths, readiness, usage, build state, and generated artifacts.",
      ],
      ["create", "Create a user extension source skeleton."],
      ["duplicate", "Duplicate a non-native extension into a user extension source skeleton."],
      [
        "configure",
        "Change extension manifest-level configuration such as TypeScript API enablement.",
      ],
      ["instructions add", "Add a loaded instruction source file."],
      [
        "instructions remove",
        "Remove a loaded instruction source file and move app-owned source into trash.",
      ],
      ["instructions rename", "Rename a loaded instruction source file."],
      ["instructions reorder", "Reorder loaded instruction source files."],
      [
        "instructions configure",
        "Configure loaded instruction source state such as bypassed or active.",
      ],
      [
        "build",
        "Build or validate an extension and regenerate scripted instructions, command schemas, and TypeScript declarations when applicable.",
      ],
      ["set-usage", "Set extension usage state for an agent profile."],
      ["delete", "Delete a user extension by moving its source into app-owned trash."],
      ["reset", "Reset a builtin extension source scope to its packaged default."],
      ["revert", "Revert a reversible Extension Managing change by id."],
      ["snapshots list", "List local Extension Managing snapshots."],
      ["snapshots save", "Save a local Extension Managing snapshot."],
      [
        "snapshots load",
        "Restore a local Extension Managing snapshot and run the normal build/readiness pipeline.",
      ],
      ["snapshots rename", "Rename a local Extension Managing snapshot."],
      ["snapshots delete", "Delete a local Extension Managing snapshot."],
    ],
  },
  {
    extensionId: "artifacts",
    namespace: "artifacts",
    minimalInstruction:
      "Use Artifacts for durable files that should remain inspectable after a turn.",
    typescriptApiEnabled: true,
    commandManifest: {
      version: "incur.v1",
      commands: [
        {
          name: "create",
          description:
            "Create a durable session artifact from a new file name or an existing source path.",
          schema: {
            options: objectSchema({
              name: stringSchema,
              path: stringSchema,
              immutable: { type: "boolean" },
              "mime-type": stringSchema,
            }),
            output: artifactSchema,
          },
        },
        {
          name: "delete",
          description: "Delete a mutable durable artifact by id.",
          schema: {
            options: objectSchema({ id: stringSchema }, ["id"]),
            output: objectSchema({ id: stringSchema, deleted: { type: "boolean" } }, [
              "id",
              "deleted",
            ]),
          },
        },
        {
          name: "inspect",
          description: "Inspect one durable session artifact by id.",
          schema: { options: objectSchema({ id: stringSchema }, ["id"]), output: artifactSchema },
        },
        {
          name: "list",
          description: "List durable session artifacts.",
          schema: {
            options: objectSchema({ "thread-id": stringSchema, limit: { type: "number" } }),
            output: objectSchema({ artifacts: { type: "array", items: artifactSchema } }, [
              "artifacts",
            ]),
          },
        },
        {
          name: "open",
          description: "Open a durable artifact by id.",
          schema: {
            options: objectSchema({ id: stringSchema }, ["id"]),
            output: objectSchema({ id: stringSchema, opened: { type: "boolean" } }, [
              "id",
              "opened",
            ]),
          },
        },
      ],
    },
  },
  {
    extensionId: "workflows",
    namespace: "workflows",
    minimalInstruction:
      "Use svvyx workflows only for reusable app-global Workflows source-library operations.",
    typescriptApiEnabled: true,
    commandManifest: {
      version: "incur.v1",
      commands: [
        {
          name: "build",
          description: "Build generated app-global Workflows package output.",
          schema: {
            output: objectSchema(
              {
                ok: { type: "boolean" },
                generatedPackagePath: stringSchema,
                diagnostics: { type: "array", items: diagnostic },
                items: { type: "array", items: workflowItem },
              },
              ["ok", "generatedPackagePath", "diagnostics", "items"],
            ),
          },
        },
        {
          name: "list",
          description: "List generated app-global Workflows source-library exports.",
          schema: {
            options: objectSchema({ kind: workflowKind }),
            output: objectSchema({ items: { type: "array", items: workflowItem } }, ["items"]),
          },
        },
        {
          name: "models list",
          description:
            "List provider/model/reasoning choices for reusable workflow task-agent parameters.",
          schema: { output: objectSchema({ items: { type: "array", items: {} } }, ["items"]) },
        },
        {
          name: "save",
          description:
            "Save reusable Smithers material into the app-global Workflows source library.",
          schema: {
            options: objectSchema(
              {
                from: stringSchema,
                kind: workflowKind,
                as: stringSchema,
                export: stringSchema,
                overwrite: { type: "boolean" },
              },
              ["from", "kind", "as"],
            ),
            output: objectSchema(
              {
                ok: { type: "boolean" },
                sourcePath: stringSchema,
                generatedPackagePath: stringSchema,
                exportName: stringSchema,
                kind: workflowKind,
                diagnostics: { type: "array", items: diagnostic },
              },
              ["ok", "sourcePath", "generatedPackagePath", "exportName", "kind", "diagnostics"],
            ),
          },
        },
      ],
    },
  },
] as const;

export const APP_NATIVE_SVVYX_METADATA = new Map<string, AppNativeSvvyxMetadata>(
  definitions.map((definition) => [
    definition.extensionId,
    {
      extensionId: definition.extensionId as ExtensionId,
      namespace: definition.namespace,
      minimalInstruction: definition.minimalInstruction,
      typescriptApiEnabled: definition.typescriptApiEnabled,
      commandManifest:
        "commandManifest" in definition
          ? definition.commandManifest
          : {
              version: "incur.v1",
              commands: definition.commands.map(([name, description]) =>
                openCommand(name, description),
              ),
            },
    },
  ]),
);

export function appNativeSvvyxMetadataFingerprintInput(metadata: AppNativeSvvyxMetadata): string {
  return JSON.stringify(metadata);
}

export function renderSvvyxCommandManifest(manifest: SvvyxCommandManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function renderSvvyxTypescriptDeclaration(input: {
  readonly extensionId: string;
  readonly commandManifest: SvvyxCommandManifest;
}): string {
  const prefix = pascalCase(input.extensionId);
  const commandMapName = `${prefix}ExtensionCommandMap`;
  const facadeName = `${prefix}ExtensionFacade`;
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
    `interface ${facadeName} {`,
    `  run<CommandId extends keyof ${commandMapName}>(`,
    "    commandId: CommandId,",
    `    ...input: ${inputArgName}<CommandId>`,
    `  ): Promise<${commandMapName}[CommandId]["result"]>;`,
    "}",
    "",
    "interface LoadedExtensionsFacade {",
    `  ${propertyName(input.extensionId)}: ${facadeName};`,
    "}",
    "",
  ].join("\n");
}

function renderCommandMapEntry(
  command: SvvyxCommandManifest["commands"][number],
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
  command: SvvyxCommandManifest["commands"][number],
  outputControlsName: string,
): string {
  const fields: string[] = [];
  if (command.schema?.args)
    fields.push(
      `args${schemaHasRequiredProperties(command.schema.args) ? "" : "?"}: ${renderJsonSchemaType(command.schema.args)}`,
    );
  if (command.schema?.options)
    fields.push(
      `options${schemaHasRequiredProperties(command.schema.options) ? "" : "?"}: ${renderJsonSchemaType(command.schema.options)}`,
    );
  return fields.length === 0
    ? outputControlsName
    : `{ ${fields.join("; ")} } & ${outputControlsName}`;
}

function schemaHasRequiredProperties(schema: unknown): boolean {
  return isRecord(schema) && Array.isArray(schema.required) && schema.required.length > 0;
}

function renderJsonSchemaType(schema: unknown): string {
  if (!isRecord(schema)) return "unknown";
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ") || "never";
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.map(renderJsonSchemaType).join(" | ") || "unknown";
  if (Array.isArray(schema.oneOf))
    return schema.oneOf.map(renderJsonSchemaType).join(" | ") || "unknown";
  if (typeof schema.$ref === "string") return "unknown";
  const type = schema.type;
  if (Array.isArray(type))
    return type.map((entry) => renderJsonSchemaType({ ...schema, type: entry })).join(" | ");
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  if (type === "array") {
    const itemType = renderJsonSchemaType(schema.items);
    return itemType.includes(" | ") ? `(${itemType})[]` : `${itemType}[]`;
  }
  if (type === "object" || isRecord(schema.properties)) return renderJsonSchemaObjectType(schema);
  return "unknown";
}

function renderJsonSchemaObjectType(schema: Record<string, unknown>): string {
  if (!isRecord(schema.properties)) return "{}";
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const entries = Object.entries(schema.properties).map(
    ([key, value]) =>
      `${propertyName(key)}${required.has(key) ? "" : "?"}: ${renderJsonSchemaType(value)}`,
  );
  return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function pascalCase(value: string): string {
  const name = value
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^[A-Za-z_$]/.test(name) ? name : `Extension${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
