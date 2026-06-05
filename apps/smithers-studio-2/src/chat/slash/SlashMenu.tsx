import type { SlashCommand } from "./SlashCommand";

/**
 * Autocomplete popover for slash commands. Presentational: the composer owns
 * the filtered list and the selected index (keyboard nav) and calls back on
 * pick. Renders nothing when there are no matches.
 */
export function SlashMenu({
  commands,
  selectedIndex,
  onPick,
  onHover,
}: {
  commands: SlashCommand[];
  selectedIndex: number;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="slash-menu" data-testid="slash-menu" role="listbox">
      {commands.map((command, index) => (
        <button
          aria-selected={index === selectedIndex}
          className={index === selectedIndex ? "slash-row slash-row--active" : "slash-row"}
          data-testid="slash-row"
          key={command.name}
          onClick={() => onPick(command)}
          onMouseEnter={() => onHover(index)}
          role="option"
          type="button"
        >
          <span className="slash-row-name">/{command.name}</span>
          <span className="slash-row-summary">{command.summary}</span>
          <span className="slash-row-feature">{command.feature}</span>
        </button>
      ))}
    </div>
  );
}
