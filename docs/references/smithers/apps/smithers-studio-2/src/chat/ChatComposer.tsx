import { useMemo, useState, type KeyboardEvent } from "react";
import { parseSlash } from "./slash/parseSlash";
import { slashCommands } from "./slash/slashCommands";
import { SlashMenu } from "./slash/SlashMenu";
import type { SlashCommand } from "./slash/SlashCommand";

/**
 * Chat composer with slash autocomplete. Typing `/` opens the command menu
 * (filtered by the command token, hidden once you type a space into args);
 * up/down move, Enter/Tab completes, Escape dismisses. Submitting hands the raw
 * text to `onSubmit`, which decides slash-vs-prompt (see ChatShell).
 */
export function ChatComposer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const matches = useMemo(() => {
    const raw = value.replace(/^\s*/, "");
    if (!raw.startsWith("/")) return [];
    const body = raw.slice(1);
    if (/\s/.test(body)) return [];
    return slashCommands.filter((c) => c.name.startsWith(body.toLowerCase()));
  }, [value]);

  const menuOpen = !dismissed && matches.length > 0;
  const index = Math.min(selectedIndex, Math.max(matches.length - 1, 0));

  const complete = (command: SlashCommand) => {
    setValue(`/${command.name} `);
    setDismissed(true);
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
    setDismissed(false);
    setSelectedIndex(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        complete(matches[index]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-composer">
      {menuOpen && (
        <SlashMenu commands={matches} onHover={setSelectedIndex} onPick={complete} selectedIndex={index} />
      )}
      <textarea
        className="chat-composer-input"
        data-testid="chat-composer-input"
        onChange={(event) => {
          setValue(event.target.value);
          setDismissed(false);
        }}
        onKeyDown={onKeyDown}
        placeholder="Message your agent…  Type / for commands"
        rows={1}
        value={value}
      />
      <button className="chat-composer-send" data-testid="chat-composer-send" onClick={submit} type="button">
        Send
      </button>
    </div>
  );
}
