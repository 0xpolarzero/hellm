export const HANDLER_CONTEXT_KEYS = ["ci"] as const;

export type HandlerContextKey = (typeof HANDLER_CONTEXT_KEYS)[number];

export type HandlerContextActor = "handler";

export interface HandlerContextPackMetadata {
  key: HandlerContextKey;
  title: string;
  summary: string;
  version: string;
  allowedActors: HandlerContextActor[];
}

export const HANDLER_CONTEXT_PACK_METADATA: Record<HandlerContextKey, HandlerContextPackMetadata> =
  {
    ci: {
      key: "ci",
      title: "Project CI",
      summary: "Guidance for configuring and modifying Project CI saved workflow entries.",
      version: "2026-04-24",
      allowedActors: ["handler"],
    },
  };

export function isHandlerContextKey(value: string): value is HandlerContextKey {
  return (HANDLER_CONTEXT_KEYS as readonly string[]).includes(value);
}
