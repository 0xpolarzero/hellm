/**
 * Source of truth for the `execute_typescript` prompt contract.
 *
 * Code mode receives actor-specific generated `extensions` clients for loaded
 * TypeScript-enabled `svvyx` extensions. Shell, Apply Patch, and other direct
 * tools remain the canonical agent interface for repository work.
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

export interface LoadedExtensionsClient {}

export namespace Run {
  export type OutputFormat = "toon" | "json" | "yaml" | "md" | "jsonl";

  export interface Output {
    text: string;
    format: OutputFormat;
    tokenCount?: number;
    tokenLimit?: number;
    tokenOffset?: number;
    next?: () => Promise<Result<unknown, unknown> | undefined>;
  }

  export type Result<TData = unknown, TCommands = unknown> = {
    ok: true;
    data: TData;
    output: Output;
    meta: {
      commandFacts: Record<string, unknown>;
      commands?: TCommands;
      [key: string]: unknown;
    };
  };
}

export interface IncurClientModule {
  Client: {
    ClientError: new (message?: string) => Error;
  };
  Resources: Record<string, unknown>;
  Run: Record<string, unknown>;
}

export declare const extensions: LoadedExtensionsClient;
export declare const console: SvvyConsole;
