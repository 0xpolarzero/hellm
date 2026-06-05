import type { Tag } from "./Tag";

/**
 * Deterministic color for a tag. Tags get distinct, stable colors without a
 * stored palette: hash the id to a hue, then tune saturation/lightness per kind
 * so workflow/issue/pr families read as warmer/cooler while staying legible on
 * the dark theme. Pure and unit-tested.
 */
export function tagColor(tag: Tag): string {
  const hue = hashHue(tag.id || tag.label);
  const { sat, light } = TONE[tag.kind];
  return `hsl(${hue} ${sat}% ${light}%)`;
}

const TONE: Record<Tag["kind"], { sat: number; light: number }> = {
  topic: { sat: 55, light: 68 },
  workflow: { sat: 62, light: 66 },
  issue: { sat: 58, light: 70 },
  pr: { sat: 60, light: 67 },
};

/** FNV-1a → hue in [0, 360). Stable across runs for the same input. */
function hashHue(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
