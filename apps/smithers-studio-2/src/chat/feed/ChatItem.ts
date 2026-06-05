import type { Tag } from "../tags/Tag";
import type { Overlay } from "../overlay/Overlay";

export type ChatRole = "user" | "assistant" | "tool" | "system";

/**
 * One entry in the single chat feed. Every item is tagged (by topic and by the
 * workflow/issue/PR it belongs to) and scoped to a project. The body is either
 * markdown, rich HTML from the agent's HTML tool (rendered sandboxed), or an
 * overlay the agent opened to show a default UI.
 */
export type ChatItem = {
  id: string;
  role: ChatRole;
  projectId: string;
  tags: Tag[];
  body: ChatBody;
  timestampMs: number;
  pending?: boolean;
};

export type ChatBody =
  | { kind: "markdown"; text: string }
  | { kind: "html"; html: string }
  | { kind: "overlay"; summary: string; overlay: Overlay };
