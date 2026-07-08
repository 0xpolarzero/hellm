/**
 * Source of truth for the `execute_typescript` prompt contract.
 *
 * Code mode receives actor-scoped generated `extensions` declarations for loaded
 * TypeScript-enabled app-owned `svvyx` extensions. Shell, Apply Patch, and other
 * direct tools remain the canonical agent interface for repository work.
 *
 * Do not import generated Workflows or Extensions packages here. They are
 * Smithers/Workflows authoring imports only; runtime callable extension APIs are
 * exposed only through the injected actor-scoped `extensions` object below.
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

export interface LoadedExtensionsFacade {}

export namespace Run {
  export type OutputFormat = "toon" | "json" | "yaml" | "md" | "jsonl";

  export interface Output {
    text: string;
    format: OutputFormat;
    tokenCount?: number;
    tokenLimit?: number;
    tokenOffset?: number;
  }

  export type Result<TData = unknown> = {
    ok: true;
    data: TData;
    output: Output;
    meta: {
      commandFacts: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}

export interface IncurRpcMeta {
  command: string;
  duration: string;
}

export declare const extensions: LoadedExtensionsFacade;
export declare const console: SvvyConsole;
