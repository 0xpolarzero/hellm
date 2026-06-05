/**
 * A tag attached to a chat item by the fast tagger agent. Tags replace tabs:
 * every message is classified by topic and by the workflow / issue / PR it
 * belongs to. SEAM: today seeded onto `ChatItem.tags`; later written by a cheap
 * background agent that also re-organizes the feed.
 */
export type TagKind = "topic" | "workflow" | "issue" | "pr";

export type Tag = {
  id: string;
  label: string;
  kind: TagKind;
};
