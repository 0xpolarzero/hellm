#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PublicSymbolRow = {
  readonly symbol: string;
  readonly sourceModule: string;
  readonly ownerDomain: string;
  readonly publicStatus: "public root export";
  readonly contractKind: string;
  readonly schemaSymbol: string;
  readonly encodedType: string;
  readonly decodedType: string;
  readonly boundaryHelpers: string;
  readonly parseOptions: string;
  readonly requiredTests: string;
};

const projectRoot = join(import.meta.dir, "..");
const coreSrcRoot = join(projectRoot, "packages", "core", "src");
const outputPath = join(
  projectRoot,
  "docs",
  "specs",
  "package-architecture",
  "core-public-symbol-index.generated.md",
);
const canonicalPublicFacadeModules = new Set([
  "extension-contracts",
  "runtime-effect-requests",
  "runtime-source-invalidation",
  "runtime-submit",
  "workflow-task-agent-bridge-contracts",
]);

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function readCoreRootModules(): string[] {
  return readSource(join(coreSrcRoot, "index.ts"))
    .split("\n")
    .map((line) => line.match(/^export \* from "\.\/(.+)";$/)?.[1])
    .filter((moduleName): moduleName is string => Boolean(moduleName));
}

function readExportedNames(source: string): string[] {
  const declaredNames = Array.from(
    source.matchAll(
      /^export\s+(?:declare\s+)?(?:async\s+)?(?:class|interface|type|const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm,
    ),
    (match) => match[1]!,
  );
  const explicitNames = Array.from(source.matchAll(/^export\s+(?:type\s+)?\{([^}]+)\}/gm))
    .flatMap((match) => match[1]!.split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      return alias?.[1] ?? part.split(/\s+/)[0]!;
    });

  return [...new Set([...declaredNames, ...explicitNames])];
}

function ownerDomain(moduleName: string): string {
  if (moduleName === "ids") return "identity";
  if (moduleName.includes("runtime-source")) return "runtime-source";
  if (moduleName.includes("runtime-state")) return "runtime-state";
  if (moduleName.includes("runtime")) return "runtime";
  if (moduleName.includes("extension")) return "extensions";
  if (moduleName.includes("pi-adapter")) return "pi-adapter";
  if (moduleName.includes("sandbox")) return "sandbox";
  if (moduleName.includes("artifact")) return "artifacts";
  if (moduleName.includes("app-log")) return "app-logs";
  if (moduleName.includes("workflow-task-agent")) return "workflow-task-agent";
  if (moduleName.includes("composer")) return "composer";
  if (moduleName.includes("native-tool")) return "native-tools";
  if (moduleName.includes("context-budget")) return "context-budget";
  if (moduleName.includes("prompt-execution")) return "prompt-execution";
  if (moduleName.includes("provider-auth")) return "provider-auth";
  if (moduleName.includes("secret-store")) return "secret-store";
  if (moduleName.includes("session-navigation")) return "session-navigation";
  if (moduleName.includes("generated-package")) return "generated-packages";
  if (moduleName.includes("boundary")) return "boundary";
  if (moduleName.includes("errors")) return "errors";
  return moduleName;
}

function isTaggedErrorSymbol(symbol: string, source: string): boolean {
  return new RegExp(`export\\s+class\\s+${symbol}\\s+extends\\s+Schema\\.TaggedErrorClass<`).test(
    source,
  );
}

function isBrandedSchemaAlias(symbol: string, source: string): boolean {
  return new RegExp(
    `export\\s+const\\s+${symbol}\\s*=\\s*Schema\\.String\\.pipe\\(\\s*Schema\\.brand\\(`,
  ).test(source);
}

function isContextServiceSymbol(symbol: string, source: string): boolean {
  return new RegExp(
    `export\\s+const\\s+${symbol}\\s*=\\s*Context\\.Service<|export\\s+class\\s+${symbol}\\s+extends\\s+Context\\.Service<`,
  ).test(source);
}

function isSchemaDerivedScalarAlias(symbol: string, exportedSymbols: ReadonlySet<string>): boolean {
  return (
    symbol === "NonNegativeSafeInteger" ||
    symbol === "PositiveSafeInteger" ||
    symbol === "ByteCount" ||
    exportedSymbols.has(`${symbol}Schema`)
  );
}

function contractKind(
  symbol: string,
  source: string,
  exportedSymbols: ReadonlySet<string>,
): string {
  if (isTaggedErrorSymbol(symbol, source)) return "tagged-error-schema-contract";
  if (symbol.endsWith("Schema")) return "schema";
  if (symbol.endsWith("Encoded")) return "encoded-dto-alias";
  if (symbol.endsWith("Error")) return "tagged-error-or-error-contract";
  if (isContextServiceSymbol(symbol, source)) return "service-port-contract";
  if (symbol.endsWith("Service") || symbol.endsWith("Port")) return "service-port-contract";
  if (isBrandedSchemaAlias(symbol, source)) return "branded-or-nominal-contract";
  if (isSchemaDerivedScalarAlias(symbol, exportedSymbols)) return "schema-derived-scalar-contract";
  if (
    [
      "AbsolutePath",
      "Base64String",
      "MimeType",
      "NonEmptyString",
      "WorkspaceRelativePath",
    ].includes(symbol)
  ) {
    return "branded-or-nominal-contract";
  }
  if (
    symbol.startsWith("decodeUnknown") ||
    symbol.startsWith("encode") ||
    symbol.startsWith("unsafeDecode")
  ) {
    return "boundary-helper";
  }
  return "type-or-value-contract";
}

function sourceDeclaresSymbol(symbol: string, source: string): boolean {
  return new RegExp(
    `^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:class|interface|type|const|let|var|function)\\s+${symbol}\\b`,
    "m",
  ).test(source);
}

function inferredSchemaSymbol(symbol: string): string {
  if (symbol.endsWith("Schema")) return symbol;
  if (symbol.endsWith("Encoded")) return `${symbol.slice(0, -"Encoded".length)}Schema`;
  if (
    symbol.endsWith("Input") ||
    symbol.endsWith("Result") ||
    symbol.endsWith("Message") ||
    symbol.endsWith("Payload") ||
    symbol.endsWith("Event") ||
    symbol.endsWith("Error") ||
    symbol.endsWith("Request") ||
    symbol.endsWith("Response") ||
    symbol.endsWith("Envelope") ||
    symbol.endsWith("Document") ||
    symbol.endsWith("Declaration") ||
    symbol.endsWith("Summary") ||
    symbol.endsWith("Model") ||
    symbol.endsWith("Record") ||
    symbol.endsWith("Fact")
  ) {
    return `${symbol}Schema`;
  }
  return "n/a";
}

function schemaSymbol(
  symbol: string,
  exportedSymbols: ReadonlySet<string>,
  source: string,
): string {
  if (isTaggedErrorSymbol(symbol, source)) return symbol;
  const directSchema = `${symbol}Schema`;
  if (exportedSymbols.has(directSchema)) return directSchema;
  const inferred = inferredSchemaSymbol(symbol);
  return inferred !== "n/a" && exportedSymbols.has(inferred) ? inferred : "n/a";
}

function encodedType(symbol: string, schema: string): string {
  if (symbol.endsWith("Schema")) {
    return `typeof ${symbol}.Encoded when encoded and decoded shapes differ; otherwise same as decoded or n/a`;
  }
  if (symbol.endsWith("Encoded")) return symbol;

  if (schema === "n/a") return "n/a";
  return `typeof ${schema}.Encoded when encoded and decoded shapes differ; otherwise same as decoded or n/a`;
}

function decodedType(symbol: string): string {
  if (symbol.endsWith("Schema")) return `typeof ${symbol}.Type`;
  if (symbol.endsWith("Encoded")) return `decoded alias is ${symbol.slice(0, -"Encoded".length)}`;
  return "exported type/value contract";
}

function boundaryHelpers(symbol: string, schema: string): string {
  if (
    symbol.startsWith("decodeUnknown") ||
    symbol.startsWith("encode") ||
    symbol.startsWith("unsafeDecode")
  ) {
    return "this symbol is itself a boundary helper";
  }
  return schema === "n/a"
    ? "n/a"
    : "strict decode/encode helpers required when the symbol crosses public package, facade, generated-package, bridge, tool, or persistence boundaries";
}

function readRows(): PublicSymbolRow[] {
  const bySymbol = new Map<string, PublicSymbolRow>();
  const moduleEntries = readCoreRootModules().map((moduleName) => ({
    moduleName,
    source: readSource(join(coreSrcRoot, `${moduleName}.ts`)),
  }));
  const exportedSymbols = new Set(moduleEntries.flatMap(({ source }) => readExportedNames(source)));
  const canonicalModuleBySymbol = new Map<string, string>();
  for (const { moduleName, source } of moduleEntries) {
    if (!canonicalPublicFacadeModules.has(moduleName)) continue;
    for (const symbol of readExportedNames(source)) {
      canonicalModuleBySymbol.set(symbol, moduleName);
    }
  }

  for (const { moduleName, source } of moduleEntries) {
    for (const symbol of readExportedNames(source)) {
      const canonicalModuleName = canonicalModuleBySymbol.get(symbol) ?? moduleName;
      if (canonicalModuleName !== moduleName) continue;
      if (bySymbol.has(symbol)) continue;
      const contractSource =
        moduleEntries.find((entry) => sourceDeclaresSymbol(symbol, entry.source))?.source ?? source;
      const schema = schemaSymbol(symbol, exportedSymbols, contractSource);
      bySymbol.set(symbol, {
        symbol,
        sourceModule: canonicalModuleName,
        ownerDomain: ownerDomain(canonicalModuleName),
        publicStatus: "public root export",
        contractKind: contractKind(symbol, contractSource, exportedSymbols),
        schemaSymbol: schema,
        encodedType: encodedType(symbol, schema),
        decodedType: decodedType(symbol),
        boundaryHelpers: boundaryHelpers(symbol, schema),
        parseOptions: "`strictBoundaryParseOptions` for boundary schemas; n/a otherwise",
        requiredTests: "root export index coverage plus focused owner tests",
      });
    }
  }

  return Array.from(bySymbol.values()).toSorted(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.sourceModule.localeCompare(b.sourceModule),
  );
}

function renderTable(rows: readonly PublicSymbolRow[]): string {
  const header = [
    "Symbol",
    "Source module",
    "Owner domain",
    "Public status",
    "Contract kind",
    "Schema symbol",
    "Encoded type",
    "Decoded type",
    "Boundary helpers",
    "Parse options",
    "Required tests",
  ];
  const values = rows.map((row) => [
    `\`${row.symbol}\``,
    `\`${row.sourceModule}\``,
    row.ownerDomain,
    row.publicStatus,
    row.contractKind,
    row.schemaSymbol,
    row.encodedType,
    row.decodedType,
    row.boundaryHelpers,
    row.parseOptions,
    row.requiredTests,
  ]);
  const widths = header.map((label, index) =>
    Math.max(label.length, ...values.map((value) => value[index]!.length)),
  );
  const renderRow = (value: readonly string[]) =>
    `| ${value.map((cell, index) => cell.padEnd(widths[index]!)).join(" | ")} |`;
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

  return [renderRow(header), divider, ...values.map(renderRow)].join("\n");
}

function renderDocument(): string {
  return [
    "# @svvy/core Public Symbol Contract Index",
    "",
    "Status: generated architecture index for the spec-defined public `@svvy/core` root export contract.",
    "Implementation freshness is verified by `bun run check:core-index`; package-boundary tests verify",
    "representative module placement and boundary behavior.",
    "",
    renderTable(readRows()),
    "",
  ].join("\n");
}

const next = renderDocument();
if (process.argv.includes("--check")) {
  const current = readSource(outputPath);
  if (current !== next) {
    console.error(
      `${outputPath} is out of date. Run bun scripts/generate-core-public-symbol-index.ts.`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, next, "utf8");
}
