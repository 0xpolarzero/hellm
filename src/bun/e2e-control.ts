import { existsSync, readFileSync, statSync } from "node:fs";
import type { Message } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

const E2E_CONTROL_PATH_ENV = "SVVY_E2E_CONTROL_PATH";
let cachedControl:
  | {
      controlPath: string | null;
      mtimeMs: number | null;
      size: number | null;
      value: SvvyE2eControl | null;
    }
  | undefined;

export type E2eSessionMutationKind =
  | "createSession"
  | "openSession"
  | "renameSession"
  | "forkSession"
  | "deleteSession";

export interface E2eMutationBehavior {
  delayMs?: number;
  error?: string;
}

export interface E2eOAuthBehavior {
  credentials?: OAuthCredentials;
  delayMs?: number;
  error?: string;
}

export type E2ePromptStep =
  | {
      type: "delay";
      ms: number;
    }
  | {
      type: "text";
      text: string;
      chunkDelayMs?: number;
      chunks?: string[];
    }
  | {
      type: "thinking";
      text: string;
      chunkDelayMs?: number;
      chunks?: string[];
    }
  | {
      type: "toolCall";
      arguments: Record<string, unknown>;
      chunkDelayMs?: number;
      chunks?: string[];
      id?: string;
      name: string;
    };

export interface E2ePromptScenario {
  abortFallbackMessage?: string;
  abortTimeoutMs?: number;
  delayBeforeStartMs?: number;
  error?: string;
  errorReason?: "aborted" | "error";
  persistedMessages?: Message[];
  stream?: E2ePromptStep[];
  waitForAbort?: boolean;
}

export interface SvvyE2eControl {
  bootstrapDelayMs?: number;
  bootstrapError?: string;
  mutations?: Partial<Record<E2eSessionMutationKind, E2eMutationBehavior>>;
  oauth?: Record<string, E2eOAuthBehavior>;
  prompts?: {
    byText?: Record<string, E2ePromptScenario>;
    defaultScenario?: E2ePromptScenario;
  };
  workspaceCwd?: string;
}

function readConfiguredControlPath(): string | null {
  const configuredPath = process.env[E2E_CONTROL_PATH_ENV]?.trim();
  return configuredPath ? configuredPath : null;
}

export function readSvvyE2eControl(): SvvyE2eControl | null {
  const controlPath = readConfiguredControlPath();
  if (!controlPath || !existsSync(controlPath)) {
    cachedControl = {
      controlPath: controlPath ?? null,
      mtimeMs: null,
      size: null,
      value: null,
    };
    return null;
  }

  const stats = statSync(controlPath);
  if (
    cachedControl &&
    cachedControl.controlPath === controlPath &&
    cachedControl.mtimeMs === stats.mtimeMs &&
    cachedControl.size === stats.size
  ) {
    return cachedControl.value;
  }

  const content = readFileSync(controlPath, "utf8");
  const value = JSON.parse(content) as SvvyE2eControl;
  cachedControl = {
    controlPath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    value,
  };
  return value;
}

export async function applyE2eMutationBehavior(
  kind: E2eSessionMutationKind,
): Promise<void> {
  const behavior = readSvvyE2eControl()?.mutations?.[kind];
  if (!behavior) {
    return;
  }

  if (behavior.delayMs && behavior.delayMs > 0) {
    await Bun.sleep(behavior.delayMs);
  }

  if (behavior.error?.trim()) {
    throw new Error(behavior.error.trim());
  }
}

export function getE2eBootstrapError(): string | null {
  const value = readSvvyE2eControl()?.bootstrapError?.trim();
  return value ? value : null;
}

let bootstrapDelayConsumed = false;

export async function applyE2eBootstrapDelayOnce(): Promise<void> {
  if (bootstrapDelayConsumed) {
    return;
  }
  bootstrapDelayConsumed = true;

  const delayMs = readSvvyE2eControl()?.bootstrapDelayMs;
  if (typeof delayMs === "number" && delayMs > 0) {
    await Bun.sleep(delayMs);
  }
}

export function getE2eOAuthBehavior(providerId: string): E2eOAuthBehavior | null {
  return readSvvyE2eControl()?.oauth?.[providerId] ?? null;
}

export function getE2ePromptScenario(
  messages: readonly Message[],
): E2ePromptScenario | null {
  const prompts = readSvvyE2eControl()?.prompts;
  if (!prompts) {
    return null;
  }

  const latestUserText = getLatestUserText(messages);
  if (latestUserText) {
    const matchedScenario = prompts.byText?.[latestUserText];
    if (matchedScenario) {
      return matchedScenario;
    }
  }

  return prompts.defaultScenario ?? null;
}

export function getE2eWorkspaceCwdOverride(): string | null {
  const value = readSvvyE2eControl()?.workspaceCwd?.trim();
  return value ? value : null;
}

function getLatestUserText(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }

    const text = flattenUserContent(message.content).trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function flattenUserContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
