import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import ts from "typescript";
import type {
  WorkspaceWorkflowsGeneratedExport,
  WorkspaceWorkflowsGeneratedKind,
  WorkspaceWorkflowsGeneratedNamespace,
  WorkspaceWorkflowsGeneratedReadModel,
} from "../../shared/workspace-contract";
import { isValidWorkflowExportName } from "../../shared/workflows-export-name";
import {
  extensionsGeneratedPackagePath,
  workflowsGeneratedPackagePath,
  workflowsSourceRoot,
} from "../extension-paths";

export const getExtensionsGeneratedPackagePath = () => extensionsGeneratedPackagePath();

const WORKFLOW_NAMESPACE_BY_DIR = {
  agents: { kind: "agent", namespace: "Agents" },
  components: { kind: "component", namespace: "Components" },
  prompts: { kind: "prompt", namespace: "Prompts" },
  workflows: { kind: "workflow", namespace: "Workflows" },
} satisfies Record<
  string,
  { kind: WorkspaceWorkflowsGeneratedKind; namespace: WorkspaceWorkflowsGeneratedNamespace }
>;

export function getWorkflowsSourceRoot(): string {
  return workflowsSourceRoot();
}

export function getWorkflowsGeneratedPackagePath(): string {
  return workflowsGeneratedPackagePath();
}

export type WorkflowsBuildDiagnostic = {
  code: string;
  message: string;
  path?: string;
  exportName?: string;
};

export type WorkflowsBuildResult = {
  ok: boolean;
  generatedPackagePath: string;
  diagnostics: WorkflowsBuildDiagnostic[];
  items: WorkspaceWorkflowsGeneratedExport[];
};

type WorkflowGeneratedManifest = {
  items: Array<{
    generatedPath: string;
    sourcePath: string;
  }>;
};

const GENERATED_MANIFEST_FILE = ".svvy-workflows-manifest.json";
export const GENERATED_WORKFLOWS_PACKAGE_NAME = "@svvyx/workflows";

const SOURCE_DIR_BY_KIND = {
  agent: "agents",
  component: "components",
  prompt: "prompts",
  workflow: "workflows",
} satisfies Record<WorkspaceWorkflowsGeneratedKind, string>;

export function getWorkflowSourcePath(input: {
  exportName: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  sourceExtension?: string;
  sourceRoot?: string;
}): string {
  assertValidExportName(input.exportName);
  return workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: input.sourceExtension,
    sourceRoot: input.sourceRoot ?? getWorkflowsSourceRoot(),
  });
}

export function copyWorkflowSourceItem(input: {
  exportName: string;
  fromPath: string;
  kind: Exclude<WorkspaceWorkflowsGeneratedKind, "agent">;
  overwrite?: boolean;
  sourceRoot?: string;
}): { sourcePath: string } {
  assertValidExportName(input.exportName);
  const extension = extname(input.fromPath);
  validateSourceExtension(input.kind, extension, input.fromPath);
  const sourceRoot = input.sourceRoot ?? getWorkflowsSourceRoot();
  const sourcePath = workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: extension,
    sourceRoot,
  });
  if (existsSync(sourcePath) && !input.overwrite) {
    throw workflowLibraryError(
      "target_exists",
      `Workflows source target already exists: ${sourcePath}`,
      sourcePath,
      input.exportName,
    );
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  copyFileSync(input.fromPath, sourcePath);
  return { sourcePath };
}

export function extractWorkflowSourceExportItem(input: {
  exportName: string;
  fromPath: string;
  kind: "component" | "workflow";
  overwrite?: boolean;
  sourceExportName: string;
  sourceRoot?: string;
}): { sourcePath: string } {
  assertValidExportName(input.exportName);
  assertValidExportName(input.sourceExportName);
  const extension = extname(input.fromPath);
  validateSourceExtension(input.kind, extension, input.fromPath);
  const sourceRoot = input.sourceRoot ?? getWorkflowsSourceRoot();
  const sourcePath = workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: extension,
    sourceRoot,
  });
  if (existsSync(sourcePath) && !input.overwrite) {
    throw workflowLibraryError(
      "target_exists",
      `Workflows source target already exists: ${sourcePath}`,
      sourcePath,
      input.exportName,
    );
  }
  const sourceCode = extractNamedWorkflowSourceExport({
    exportName: input.exportName,
    fromPath: input.fromPath,
    sourceExportName: input.sourceExportName,
  });
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, sourceCode);
  return { sourcePath };
}

export function extractWorkflowAgentParametersFromSource(input: {
  exportName?: string;
  path: string;
  sourceRoot?: string;
}): { exportName: string; parameters: Record<string, unknown> } {
  const source = readFileSync(input.path, "utf8");
  const sourceFile = ts.createSourceFile(input.path, source, ts.ScriptTarget.Latest, true);
  const staticContext: WorkflowAgentStaticContext = {
    sourceFile,
    sourceRoot: input.sourceRoot ?? getWorkflowsSourceRoot(),
  };
  const matches: Array<{ exportName: string; parameters: Record<string, unknown> }> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (input.exportName && declaration.name.text !== input.exportName) continue;
      const initializer = unwrapLiteralExpression(declaration.initializer);
      if (!ts.isCallExpression(initializer) || !isDefineTaskAgentCall(initializer.expression)) {
        continue;
      }
      const argument = initializer.arguments[0];
      if (!argument) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must pass a literal object to defineTaskAgent.`,
          input.path,
          declaration.name.text,
        );
      }
      const literal = unwrapLiteralExpression(argument);
      if (!ts.isObjectLiteralExpression(literal)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must pass a literal object to defineTaskAgent.`,
          input.path,
          declaration.name.text,
        );
      }
      const parameters = literalExpressionToStaticValue(literal, staticContext);
      if (!isRecord(parameters)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must resolve to an object.`,
          input.path,
          declaration.name.text,
        );
      }
      matches.push({ exportName: declaration.name.text, parameters });
    }
  }

  if (input.exportName && matches.length === 0) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `No static defineTaskAgent export named ${input.exportName} found.`,
      input.path,
      input.exportName,
    );
  }
  if (matches.length !== 1) {
    throw workflowLibraryError(
      "invalid_agent_source",
      matches.length === 0
        ? "No static defineTaskAgent export found."
        : "Multiple static defineTaskAgent exports found; pass --export.",
      input.path,
    );
  }
  return matches[0]!;
}

export async function readWorkflowsGeneratedReadModel(
  generatedPackagePath = getWorkflowsGeneratedPackagePath(),
  options: { sourceRoot?: string } = {},
): Promise<WorkspaceWorkflowsGeneratedReadModel> {
  const sourceRoot = options.sourceRoot ?? getWorkflowsSourceRoot();
  const items = readGeneratedExports(generatedPackagePath, sourceRoot);
  const counts = {
    agent: 0,
    component: 0,
    prompt: 0,
    workflow: 0,
  } satisfies Record<WorkspaceWorkflowsGeneratedKind, number>;
  for (const item of items) {
    counts[item.kind] += 1;
  }
  return {
    generatedPackagePath,
    items,
    counts,
    updatedAt: readGeneratedUpdatedAt(generatedPackagePath),
  };
}

function readGeneratedExports(
  generatedPackagePath: string,
  sourceRoot: string,
): WorkspaceWorkflowsGeneratedExport[] {
  if (!existsSync(generatedPackagePath)) {
    return [];
  }
  const manifest = readGeneratedManifest(generatedPackagePath);
  return Object.entries(WORKFLOW_NAMESPACE_BY_DIR).flatMap(([dirName, meta]) => {
    const namespaceRoot = join(generatedPackagePath, dirName);
    if (!existsSync(namespaceRoot)) {
      return [];
    }
    return walkFiles(namespaceRoot)
      .filter((path) => /\.(ts|tsx|js|jsx|mdx|json)$/.test(path))
      .filter((path) => basename(path, extname(path)) !== "index")
      .flatMap((path) => readExportRows(generatedPackagePath, sourceRoot, path, meta, manifest));
  });
}

function readExportRows(
  generatedPackagePath: string,
  sourceRoot: string,
  generatedPath: string,
  meta: { kind: WorkspaceWorkflowsGeneratedKind; namespace: WorkspaceWorkflowsGeneratedNamespace },
  manifest: Map<string, string>,
): WorkspaceWorkflowsGeneratedExport[] {
  const generatedCode = readFileSync(generatedPath, "utf8");
  const exportNames = extractExportNames(generatedCode);
  return exportNames.map((exportName) => {
    const agentParameters =
      meta.kind === "agent" ? readAgentParameters(generatedCode, exportName) : null;
    const workflowAgentId =
      typeof agentParameters?.id === "string" && agentParameters.id.trim()
        ? agentParameters.id
        : null;
    return {
      id: `${meta.namespace}.${exportName}`,
      kind: meta.kind,
      namespace: meta.namespace,
      exportName,
      qualifiedName: `${meta.namespace}.${exportName}`,
      sourcePath:
        manifest.get(generatedPath) ??
        inferSourcePath(generatedPackagePath, sourceRoot, generatedPath, meta.kind),
      generatedPath,
      generatedCode,
      agentParameters,
      workflowAgentId,
    };
  });
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /\bexport\s+(?:const|let|var|(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]!);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const raw of match[1]!.split(",")) {
      const [left, right] = raw.split(/\s+as\s+/).map((part) => part.trim());
      const name = right || left;
      if (name && !name.startsWith("type ")) {
        names.add(name);
      }
    }
  }
  return [...names].toSorted();
}

function inferSourcePath(
  generatedPackagePath: string,
  sourceRoot: string,
  generatedPath: string,
  kind: WorkspaceWorkflowsGeneratedKind,
): string {
  const relativeGenerated = relative(generatedPackagePath, generatedPath).replace(/\\/g, "/");
  const withoutNamespace = relativeGenerated.split("/").slice(1).join("/");
  const sourceDir = sourceDirForKind(kind);
  const sourceRelative =
    kind === "agent" ? agentSourceRelativePath(withoutNamespace) : withoutNamespace;
  return join(sourceRoot, sourceDir, sourceRelative).replace(/\\/g, "/");
}

function sourceDirForKind(kind: WorkspaceWorkflowsGeneratedKind): string {
  if (kind === "agent") return "agents";
  if (kind === "component") return "components";
  if (kind === "prompt") return "prompts";
  return "workflows";
}

function agentSourceRelativePath(generatedRelativePath: string): string {
  const extension = extname(generatedRelativePath);
  const base = basename(generatedRelativePath, extension);
  const parent = generatedRelativePath.slice(
    0,
    generatedRelativePath.length - basename(generatedRelativePath).length,
  );
  return `${parent}${base}.agent.json`;
}

function readAgentParameters(source: string, exportName: string): Record<string, unknown> | null {
  const sourceFile = ts.createSourceFile(
    "generated-agent.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      if (!declaration.initializer) return null;
      const initializer = unwrapLiteralExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) return null;
      const value = literalExpressionToValue(initializer, sourceFile);
      return isRecord(value) ? value : null;
    }
  }
  return null;
}

function extractNamedWorkflowSourceExport(input: {
  exportName: string;
  fromPath: string;
  sourceExportName: string;
}): string {
  const source = readFileSync(input.fromPath, "utf8");
  const sourceFile = ts.createSourceFile(input.fromPath, source, ts.ScriptTarget.Latest, true);
  const retainedStatements: string[] = [];
  const skippedExportNames: string[] = [];
  let selectedStatement: string | null = null;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      rejectRelativeWorkflowSourceImport(statement, input.fromPath, input.sourceExportName);
      retainedStatements.push(statement.getText(sourceFile));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      retainedStatements.push(stripExportModifier(statement.getText(sourceFile)));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const selectedDeclaration = statement.declarationList.declarations.find(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === input.sourceExportName,
      );
      if (selectedDeclaration && hasExportModifier(statement)) {
        if (statement.declarationList.declarations.length !== 1) {
          throw workflowLibraryError(
            "invalid_source_export",
            `Workflow source export ${input.sourceExportName} must be the only declaration in its statement.`,
            input.fromPath,
            input.sourceExportName,
          );
        }
        selectedStatement = renderSelectedVariableExport({
          declaration: selectedDeclaration,
          declarationList: statement.declarationList,
          exportName: input.exportName,
          sourceExportName: input.sourceExportName,
          sourceFile,
        });
        continue;
      }
      throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name?.text === input.sourceExportName && hasExportModifier(statement)) {
        if (hasDefaultModifier(statement)) {
          throw workflowLibraryError(
            "invalid_source_export",
            `Workflow source export ${input.sourceExportName} must be a named export, not a default export.`,
            input.fromPath,
            input.sourceExportName,
          );
        }
        selectedStatement = renameSelectedNamedExport({
          exportName: input.exportName,
          sourceExportName: input.sourceExportName,
          sourceFile,
          statement,
        });
        continue;
      }
      if (statement.name && hasExportModifier(statement)) {
        skippedExportNames.push(statement.name.text);
        continue;
      }
      throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
    }
    if (ts.isEmptyStatement(statement)) continue;
    throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
  }

  if (!selectedStatement) {
    throw workflowLibraryError(
      "invalid_source_export",
      `No extractable source export named ${input.sourceExportName} found.`,
      input.fromPath,
      input.sourceExportName,
    );
  }
  for (const skippedName of skippedExportNames) {
    if (new RegExp(`\\b${skippedName}\\b`).test(selectedStatement)) {
      throw workflowLibraryError(
        "invalid_source_export",
        `Workflow source export ${input.sourceExportName} references skipped export ${skippedName}.`,
        input.fromPath,
        input.sourceExportName,
      );
    }
  }

  return [...retainedStatements, selectedStatement, ""].join("\n\n");
}

function renderSelectedVariableExport(input: {
  declaration: ts.VariableDeclaration;
  declarationList: ts.VariableDeclarationList;
  exportName: string;
  sourceExportName: string;
  sourceFile: ts.SourceFile;
}): string {
  if (!ts.isIdentifier(input.declaration.name) || !input.declaration.initializer) {
    throw workflowLibraryError(
      "invalid_source_export",
      "Workflow source variable exports must use named initialized declarations.",
      input.sourceFile.fileName,
    );
  }
  const declarationKind =
    input.declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : input.declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";
  const typeText = input.declaration.type
    ? `: ${input.declaration.type.getText(input.sourceFile)}`
    : "";
  if (
    input.exportName !== input.sourceExportName &&
    identifierAppearsInNode(input.declaration.initializer, input.sourceExportName)
  ) {
    throw workflowLibraryError(
      "invalid_source_export",
      `Workflow source export ${input.sourceExportName} references itself and cannot be renamed safely.`,
      input.sourceFile.fileName,
      input.sourceExportName,
    );
  }
  return [
    `export ${declarationKind} ${input.exportName}${typeText} = ${input.declaration.initializer.getText(
      input.sourceFile,
    )};`,
  ].join("\n");
}

function renameSelectedNamedExport(input: {
  exportName: string;
  sourceExportName: string;
  sourceFile: ts.SourceFile;
  statement: ts.ClassDeclaration | ts.FunctionDeclaration;
}): string {
  const bodyNodes = ts.isFunctionDeclaration(input.statement)
    ? input.statement.body
      ? [input.statement.body]
      : []
    : Array.from(input.statement.members);
  if (
    input.exportName !== input.sourceExportName &&
    bodyNodes.some((node) => identifierAppearsInNode(node, input.sourceExportName))
  ) {
    throw workflowLibraryError(
      "invalid_source_export",
      `Workflow source export ${input.sourceExportName} references itself and cannot be renamed safely.`,
      input.sourceFile.fileName,
      input.sourceExportName,
    );
  }
  const text = input.statement.getText(input.sourceFile);
  const declarationKeyword =
    input.statement.kind === ts.SyntaxKind.ClassDeclaration ? "class" : "function";
  return text.replace(
    new RegExp(`\\b${declarationKeyword}\\s+${input.sourceExportName}\\b`),
    `${declarationKeyword} ${input.exportName}`,
  );
}

function stripExportModifier(text: string): string {
  return text.replace(/^export\s+/, "");
}

function rejectRelativeWorkflowSourceImport(
  statement: ts.ImportDeclaration,
  path: string,
  exportName: string,
): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  if (!statement.moduleSpecifier.text.startsWith(".")) return;
  throw workflowLibraryError(
    "invalid_source_export",
    `Workflow source export ${exportName} cannot be extracted safely because relative imports change meaning after relocation.`,
    path,
    exportName,
  );
}

function identifierAppearsInNode(node: ts.Node, identifierName: string): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === identifierName) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function ambiguousWorkflowSourceExport(
  path: string,
  exportName: string,
  statement: ts.Statement,
): WorkflowLibraryError {
  return workflowLibraryError(
    "invalid_source_export",
    `Workflow source export ${exportName} cannot be extracted safely because the source contains another runtime top-level statement: ${statement.getText().slice(0, 80)}`,
    path,
    exportName,
  );
}

function unwrapLiteralExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalExpressionToValue(expression: ts.Expression, sourceFile: ts.SourceFile): unknown {
  const current = unwrapLiteralExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.map((element) => literalExpressionToValue(element, sourceFile));
  }
  if (ts.isObjectLiteralExpression(current)) {
    const record: Record<string, unknown> = {};
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyNameToString(property.name);
      if (!name) continue;
      record[name] = literalExpressionToValue(property.initializer, sourceFile);
    }
    return record;
  }
  const extensionId = extensionReferenceToId(current);
  if (extensionId) return extensionId;
  if (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)) {
    return current.getText(sourceFile);
  }
  return current.getText(sourceFile);
}

type WorkflowAgentStaticContext = {
  sourceFile: ts.SourceFile;
  sourceRoot: string;
};

function literalExpressionToStaticValue(
  expression: ts.Expression,
  context: WorkflowAgentStaticContext,
): unknown {
  const current = unwrapLiteralExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.map((element) => literalExpressionToStaticValue(element, context));
  }
  if (ts.isObjectLiteralExpression(current)) {
    const record: Record<string, unknown> = {};
    for (const property of current.properties) {
      if (ts.isSpreadAssignment(property)) {
        Object.assign(record, resolveWorkflowAgentSpread(property.expression, context));
        continue;
      }
      if (!ts.isPropertyAssignment(property)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          "Workflow agent source must use static property assignments.",
        );
      }
      const name = propertyNameToString(property.name);
      if (!name) {
        throw workflowLibraryError(
          "invalid_agent_source",
          "Workflow agent source must use static property names.",
        );
      }
      record[name] = literalExpressionToStaticValue(property.initializer, context);
    }
    return record;
  }
  const extensionId = extensionReferenceToId(current);
  if (extensionId) return extensionId;
  throw workflowLibraryError(
    "invalid_agent_source",
    `Workflow agent source contains dynamic expression: ${current.getText(context.sourceFile)}`,
  );
}

function extensionReferenceToId(expression: ts.Expression): string | null {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "id" &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Extensions"
  ) {
    return expression.expression.name.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "id" &&
    ts.isElementAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Extensions" &&
    ts.isStringLiteralLike(expression.expression.argumentExpression)
  ) {
    return expression.expression.argumentExpression.text;
  }
  return null;
}

function resolveWorkflowAgentSpread(
  expression: ts.Expression,
  context: WorkflowAgentStaticContext,
): Record<string, unknown> {
  const current = unwrapLiteralExpression(expression);
  if (
    !ts.isPropertyAccessExpression(current) ||
    !ts.isIdentifier(current.expression) ||
    current.expression.text !== "Agents"
  ) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source contains unresolved spread: ${current.getText(context.sourceFile)}`,
    );
  }

  const sourcePath = getWorkflowSourcePath({
    exportName: current.name.text,
    kind: "agent",
    sourceExtension: ".agent.json",
    sourceRoot: context.sourceRoot,
  });
  if (!existsSync(sourcePath)) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source references unknown saved agent ${current.getText(context.sourceFile)}.`,
      sourcePath,
      current.name.text,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  } catch (error) {
    throw workflowLibraryError(
      "invalid_agent_source",
      error instanceof Error
        ? error.message
        : "Workflow agent saved agent source is not valid JSON.",
      sourcePath,
      current.name.text,
    );
  }
  if (!isRecord(parsed)) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source references invalid saved agent ${current.getText(context.sourceFile)}.`,
      sourcePath,
      current.name.text,
    );
  }
  return parsed;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  );
}

function isDefineTaskAgentCall(expression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === "defineTaskAgent" &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "Agents"
    );
  }
  return false;
}

function propertyNameToString(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return extensionReferenceToId(name.expression);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readGeneratedUpdatedAt(generatedPackagePath: string): string {
  if (!existsSync(generatedPackagePath)) {
    return new Date(0).toISOString();
  }
  return new Date(statSync(generatedPackagePath).mtimeMs).toISOString();
}

function readGeneratedManifest(generatedPackagePath: string): Map<string, string> {
  try {
    const path = join(generatedPackagePath, GENERATED_MANIFEST_FILE);
    if (!existsSync(path)) return new Map();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkflowGeneratedManifest;
    if (!Array.isArray(parsed.items)) return new Map();
    return new Map(
      parsed.items
        .filter(
          (item) => typeof item.generatedPath === "string" && typeof item.sourcePath === "string",
        )
        .map((item) => [item.generatedPath, item.sourcePath]),
    );
  } catch {
    return new Map();
  }
}

function workflowSourcePath(input: {
  exportName: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  sourceExtension?: string;
  sourceRoot: string;
}): string {
  const dirName = SOURCE_DIR_BY_KIND[input.kind];
  const extension =
    input.kind === "agent"
      ? ".agent.json"
      : (input.sourceExtension ?? defaultSourceExtension(input.kind));
  return join(input.sourceRoot, dirName, `${input.exportName}${extension}`);
}

function defaultSourceExtension(kind: WorkspaceWorkflowsGeneratedKind): string {
  if (kind === "prompt") return ".mdx";
  if (kind === "workflow") return ".tsx";
  if (kind === "component") return ".ts";
  return ".agent.json";
}

function validateSourceExtension(
  kind: Exclude<WorkspaceWorkflowsGeneratedKind, "agent">,
  extension: string,
  path: string,
): void {
  if (!sourceExtensionMatchesKind(kind, extension, path)) {
    throw workflowLibraryError(
      "invalid_source",
      `Unsupported ${kind} source extension: ${extension}`,
      path,
    );
  }
}

function sourceExtensionMatchesKind(
  kind: WorkspaceWorkflowsGeneratedKind,
  extension: string,
  path: string,
): boolean {
  if (kind === "agent") return path.endsWith(".agent.json");
  if (kind === "prompt") return extension === ".mdx";
  if (kind === "workflow") return extension === ".tsx";
  return extension === ".ts" || extension === ".tsx";
}

function assertValidExportName(exportName: string): void {
  if (!isValidExportName(exportName)) {
    throw workflowLibraryError("invalid_argument", `Invalid Workflows export name: ${exportName}`);
  }
}

function isValidExportName(exportName: string): boolean {
  return isValidWorkflowExportName(exportName);
}

export class WorkflowLibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
    readonly exportName?: string,
  ) {
    super(message);
    this.name = "WorkflowLibraryError";
  }
}

function workflowLibraryError(
  code: string,
  message: string,
  path?: string,
  exportName?: string,
): WorkflowLibraryError {
  return new WorkflowLibraryError(code, message, path, exportName);
}

function walkFiles(root: string): string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else {
        files.push(path);
      }
    }
  }
  return files.toSorted();
}
