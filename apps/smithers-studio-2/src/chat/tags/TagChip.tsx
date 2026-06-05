import type { Tag } from "./Tag";
import { tagColor } from "./tagColor";

const PREFIX: Record<Tag["kind"], string> = {
  topic: "#",
  workflow: "⚙",
  issue: "○",
  pr: "◷",
};

/**
 * A colored tag chip. Clicking filters/focuses the feed by that tag (handled by
 * the parent); the color comes from `tagColor` so the same tag is always the
 * same hue.
 */
export function TagChip({ tag, onClick }: { tag: Tag; onClick?: (tag: Tag) => void }) {
  const color = tagColor(tag);
  return (
    <button
      className="chat-tag"
      data-testid="chat-tag"
      onClick={onClick ? () => onClick(tag) : undefined}
      style={{ color, borderColor: color, ["--tag-color" as string]: color }}
      title={`${tag.kind}: ${tag.label}`}
      type="button"
    >
      <span className="chat-tag-glyph">{PREFIX[tag.kind]}</span>
      {tag.label}
    </button>
  );
}
