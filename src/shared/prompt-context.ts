export const OPTIONAL_PROMPT_CONTEXT_KEYS = [] as const;

export type OptionalPromptContextKey = (typeof OPTIONAL_PROMPT_CONTEXT_KEYS)[number];

export type PromptContextActor = "orchestrator" | "handler" | "workflow-task";

export interface OptionalPromptContextMetadata {
  key: OptionalPromptContextKey;
  title: string;
  summary: string;
  version: string;
  allowedActors: PromptContextActor[];
}

export const OPTIONAL_PROMPT_CONTEXT_METADATA: Record<
  OptionalPromptContextKey,
  OptionalPromptContextMetadata
> = {};

export function isOptionalPromptContextKey(value: string): value is OptionalPromptContextKey {
  return (OPTIONAL_PROMPT_CONTEXT_KEYS as readonly string[]).includes(value);
}
