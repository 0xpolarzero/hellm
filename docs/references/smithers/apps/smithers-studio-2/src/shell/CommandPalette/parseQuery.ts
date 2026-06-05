export type PaletteMode = "command" | "workflow" | "file" | "ask" | "default";

export type ParsedQuery = {
  prefix: string | null;
  mode: PaletteMode;
  modeTitle: string | null;
  searchText: string;
};

const PREFIX_MODES: Record<string, { mode: PaletteMode; title: string }> = {
  ">": { mode: "command", title: "Commands" },
  "/": { mode: "workflow", title: "Run workflow" },
  "@": { mode: "file", title: "Open file" },
  "?": { mode: "ask", title: "Ask AI" },
};

/**
 * Splits a palette query into its prefix pill and the residual search text.
 * `>` commands, `/` run workflow, `@` open file, `?` ask AI. With no prefix the
 * mode is "default" and the whole string is the search text.
 */
export function parseQuery(raw: string): ParsedQuery {
  const value = raw.trimStart();
  const first = value.charAt(0);
  const entry = PREFIX_MODES[first];
  if (entry) {
    return {
      prefix: first,
      mode: entry.mode,
      modeTitle: entry.title,
      searchText: value.slice(1).trim(),
    };
  }
  return { prefix: null, mode: "default", modeTitle: null, searchText: value.trim() };
}
