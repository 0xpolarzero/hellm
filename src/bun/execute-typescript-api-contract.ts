/**
 * Source of truth for the `execute_typescript` prompt contract.
 *
 * Code mode receives a small duplicate subset of the direct svvy tools. The
 * direct tools are the canonical agent interface; these functions exist only so
 * a bounded TypeScript program can batch, loop, filter, aggregate, and write
 * artifact evidence from tool results.
 */

/**
 * Console methods available inside an `execute_typescript` snippet.
 *
 * Logged output is captured and returned in the tool result. Use this for small
 * debugging notes rather than for the main semantic result.
 */
export interface SvvyConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolResult<TDetails = unknown> {
  content: Array<TextContent | ImageContent>;
  details: TDetails;
}

export type TruncationResult = {
  truncated: boolean;
  truncatedBy?: "lines" | "bytes";
  outputLines?: number;
  totalLines?: number;
  maxLines?: number;
  maxBytes?: number;
  firstLineExceedsLimit?: boolean;
};

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface GrepToolDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  linesTruncated?: boolean;
}

export interface FindToolDetails {
  truncation?: TruncationResult;
  resultLimitReached?: number;
}

export interface LsToolDetails {
  truncation?: TruncationResult;
  entryLimitReached?: number;
}

export interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export interface ArtifactWriteResult {
  artifactId: string;
  path?: string;
}

export type WorkflowAssetKind = "definition" | "prompt" | "component";
export type WorkflowAssetScope = "saved" | "artifact";

/**
 * Minimal discovery metadata for one reusable workflow asset.
 */
export interface WorkflowAssetMetadata {
  id: string;
  kind: WorkflowAssetKind;
  title: string;
  summary: string;
  path: string;
  scope: WorkflowAssetScope;
}

export interface WorkflowListAssetsInput {
  kind?: WorkflowAssetKind;
  pathPrefix?: string;
  scope?: WorkflowAssetScope | "both";
}

export interface WorkflowModelInfo {
  providerId: string;
  modelId: string;
  authAvailable: boolean;
  authSource: string;
  capabilityFlags: string[];
}

export interface WorkflowListAssetsDetails {
  assets: WorkflowAssetMetadata[];
}

export interface WorkflowListModelsDetails {
  models: WorkflowModelInfo[];
}

/**
 * Host API injected as the `api` variable inside `execute_typescript`.
 *
 * These functions duplicate direct tools by name and input shape. Use direct
 * tools for ordinary reads, edits, writes, and commands; use this API only when
 * TypeScript control flow is the clearest way to compose several read/search,
 * bash, artifact, or workflow-discovery calls.
 */
export interface SvvyApi {
  read(input: {
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<ToolResult<ReadToolDetails | undefined>>;

  grep(input: {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
  }): Promise<ToolResult<GrepToolDetails | undefined>>;

  find(input: {
    pattern: string;
    path?: string;
    limit?: number;
  }): Promise<ToolResult<FindToolDetails | undefined>>;

  ls(input: { path?: string; limit?: number }): Promise<ToolResult<LsToolDetails | undefined>>;

  bash(input: {
    command: string;
    timeout?: number;
  }): Promise<ToolResult<BashToolDetails | undefined>>;

  artifact: {
    write_text(input: { name: string; text: string }): Promise<ToolResult<ArtifactWriteResult>>;
    write_json(input: {
      name: string;
      value: unknown;
      pretty?: boolean;
    }): Promise<ToolResult<ArtifactWriteResult>>;
    attach_file(input: { path: string; name?: string }): Promise<ToolResult<ArtifactWriteResult>>;
  };

  workflow: {
    list_assets(input?: WorkflowListAssetsInput): Promise<ToolResult<WorkflowListAssetsDetails>>;
    list_models(): Promise<ToolResult<WorkflowListModelsDetails>>;
  };
}
