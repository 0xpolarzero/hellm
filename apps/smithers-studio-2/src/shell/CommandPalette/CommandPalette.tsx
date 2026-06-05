import { useEffect, useMemo } from "react";
import { useStudioStore } from "../../useStudioStore";
import type { NavItem } from "../navRegistry";
import { buildPaletteItems } from "./buildPaletteItems";
import { filterPaletteItems } from "./filterPaletteItems";
import { parseQuery } from "./parseQuery";
import { PaletteRow } from "./PaletteRow";
import { PaletteSectionHeader } from "./PaletteSectionHeader";

export type CommandPaletteProps = {
  registry: NavItem[];
};

/**
 * The universal accelerator (Cmd-K / Cmd-P). Enumerates every registered
 * surface (developer surfaces appear only when registered) plus contextual
 * commands, with prefix pills, 80ms-debounced filtering, grouped results, and
 * keyboard nav. Keeps data-testid="command-palette".
 */
export function CommandPalette({ registry }: CommandPaletteProps) {
  const paletteQuery = useStudioStore((s) => s.paletteQuery);
  const selectedPaletteIndex = useStudioStore((s) => s.selectedPaletteIndex);
  const developerMode = useStudioStore((s) => s.developerMode);
  const { setActiveView, openTerminal, toggleDeveloperMode, closePalette, setPaletteQuery, setSelectedPaletteIndex } =
    useStudioStore.getState();

  const allItems = useMemo(
    () =>
      buildPaletteItems(registry, {
        goToView: (id) => {
          setActiveView(id);
        },
        newTerminal: () => {
          openTerminal();
        },
        toggleDeveloperMode: () => {
          toggleDeveloperMode();
        },
        developerMode,
      }),
    [registry, developerMode, setActiveView, openTerminal, toggleDeveloperMode],
  );

  // Filter synchronously off the current query so the rendered list, the arrow
  // navigation, and the Enter handler always agree. Filtering is pure and the
  // item set is tiny, so debouncing bought nothing but a race: a fast
  // type-then-Enter (within the old 80ms window) ran the stale first row
  // (e.g. "Go to Home") instead of the command the user just typed.
  const items = useMemo(() => filterPaletteItems(allItems, paletteQuery), [allItems, paletteQuery]);
  const parsed = parseQuery(paletteQuery);

  // Whenever the filtered list identity changes (a keystroke narrowed or
  // reordered the results), snap the selection back to the best match at the
  // top. Without this, a stale index — e.g. 0 still pointing at the first
  // "Go to" nav row while the user typed a command name — makes Enter run the
  // wrong item.
  useEffect(() => {
    setSelectedPaletteIndex(() => 0);
  }, [items, setSelectedPaletteIndex]);

  const run = (index: number) => {
    // Resolve Enter against the rendered `items` — the exact list the user is
    // looking at and that the arrow keys navigate. Filtering is synchronous, so
    // this list already reflects the current query. Fall back to the best match
    // at index 0 if the selection index is stale (out of range after a
    // narrowing keystroke).
    const item = items[index] ?? items[0];
    if (!item) return;
    item.run();
    closePalette();
  };

  let lastSection: string | null = null;

  // Stable per-row DOM id so the input can point aria-activedescendant at the
  // arrow-selected row — screen readers announce the active option without the
  // focus ever leaving the text input.
  const rowId = (id: string) => `palette-row-${id}`;
  const activeItem = items[selectedPaletteIndex] ?? items[0];

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && closePalette()}
    >
      <div
        aria-label="Command palette"
        aria-modal="true"
        className="command-palette"
        data-testid="command-palette"
        role="dialog"
      >
        <div className="palette-input-row">
          {parsed.prefix ? (
            <span className="palette-prefix-pill">
              <span className="palette-prefix-glyph">{parsed.prefix}</span>
              <span className="palette-prefix-title">{parsed.modeTitle}</span>
            </span>
          ) : null}
          <input
            aria-activedescendant={activeItem ? rowId(activeItem.id) : undefined}
            aria-autocomplete="list"
            aria-controls="palette-listbox"
            aria-label="Command palette query"
            autoFocus
            className="palette-input"
            role="combobox"
            aria-expanded={items.length > 0}
            onChange={(event) => setPaletteQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closePalette();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedPaletteIndex((index) => Math.min(index + 1, items.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedPaletteIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                run(selectedPaletteIndex);
              }
            }}
            placeholder="Type a command, or > / @ ?"
            value={paletteQuery}
          />
        </div>

        <div aria-label="Command palette results" className="palette-list" id="palette-listbox" role="listbox">
          {items.length === 0 ? (
            <div className="palette-empty">
              <span className="palette-empty-glyph" aria-hidden>
                ✦
              </span>
              <span>No matching results</span>
              {parsed.searchText ? (
                <span className="palette-empty-ask">{`Ask AI: ${parsed.searchText}`}</span>
              ) : null}
            </div>
          ) : (
            items.map((item, index) => {
              const showHeader = item.section !== lastSection;
              lastSection = item.section;
              return (
                <div key={item.id}>
                  {showHeader ? <PaletteSectionHeader title={item.section} /> : null}
                  <PaletteRow
                    item={item}
                    onHover={() => setSelectedPaletteIndex(index)}
                    onRun={() => run(index)}
                    rowId={rowId(item.id)}
                    selected={index === selectedPaletteIndex}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
