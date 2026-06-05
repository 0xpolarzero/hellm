import type { PaletteItem } from "./PaletteItem";
import { parseQuery, type PaletteMode } from "./parseQuery";

function matchesText(item: PaletteItem, searchText: string): boolean {
  if (!searchText) return true;
  const haystack = `${item.title} ${item.subtitle} ${item.section}`.toLowerCase();
  return haystack.includes(searchText.toLowerCase());
}

/**
 * Restrict the candidate set by the parsed prefix mode BEFORE the free-text
 * match. `>` (command) scopes to contextual commands; `default` searches every
 * surface + command. The `/` (workflow), `@` (file), and `?` (ask) prefixes have
 * no backing data source in the palette item set, so they intentionally match
 * nothing — the empty state then offers the "Ask AI: …" affordance — rather than
 * the prefix silently doing nothing while every item still shows.
 */
function inMode(item: PaletteItem, mode: PaletteMode): boolean {
  switch (mode) {
    case "command":
      return item.section === "Commands";
    case "default":
      return true;
    default:
      return false;
  }
}

/**
 * Synchronous query filter shared by the debounced palette hook and the Enter
 * handler. Honors the parsed prefix mode and then the free-text match, so the
 * prefix pills (> / @ ?) actually scope results instead of being cosmetic.
 */
export function filterPaletteItems(allItems: PaletteItem[], query: string): PaletteItem[] {
  const { mode, searchText } = parseQuery(query);
  return allItems.filter((item) => inMode(item, mode) && matchesText(item, searchText));
}
