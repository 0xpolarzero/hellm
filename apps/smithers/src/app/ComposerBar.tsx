import {
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GRILL_SYSTEM_PROMPT } from "../askme/grillMe";
import { withAgentSystem } from "../control/agentSystemPrompt";
import { useChatStore } from "../chat/chatStore";
import { CommandMenu } from "../CommandMenu";
import { ChevronDownIcon } from "../icons/ChevronDownIcon";
import { CheckIcon } from "../icons/CheckIcon";
import { MicIcon } from "../icons/MicIcon";
import { MoonIcon } from "../icons/MoonIcon";
import { PanelLeftIcon } from "../icons/PanelLeftIcon";
import { SunIcon } from "../icons/SunIcon";
import { MenuBackdrop } from "../components/MenuBackdrop";
import { useNotificationsStore } from "../notifications/notificationsStore";
import { goToView, setProject } from "./navigation";
import { usePreferencesStore } from "./preferencesStore";
import { useRouteStore, type View } from "./routeStore";
import { launchRun, runSlash } from "./runSlash";
import { DICTATION_SUPPORTED, useUiStore } from "./uiStore";

const PROJECTS = ["Smithers Web", "Personal", "Sandbox", "Marketing Site"] as const;

/** Focus the checked menu item on open, else the first (APG menu pattern). */
function focusCheckedItem(menu: HTMLElement | null): void {
  if (!menu) {
    return;
  }
  const items = Array.from(
    menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  );
  const checked = items.find((item) => item.getAttribute("aria-checked") === "true");
  (checked ?? items[0])?.focus();
}

/**
 * The composer: the input, the project picker, dictation, and the view controls.
 * All state lives in stores; submitting parses slash/natural-language commands
 * and otherwise streams a reply through the chat store.
 */
export function ComposerBar() {
  const query = useChatStore((state) => state.query);
  const setQuery = useChatStore((state) => state.setQuery);
  const registerInput = useChatStore((state) => state.registerInput);
  const theme = usePreferencesStore((state) => state.theme);
  const layout = usePreferencesStore((state) => state.layout);
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme);
  const toggleLayout = usePreferencesStore((state) => state.toggleLayout);
  const project = useRouteStore((state) => state.project) ?? PROJECTS[0];
  const surface = useRouteStore((state) => state.surface);
  const menuOpen = useUiStore((state) => state.openMenuId === "project");
  const toggleMenu = useUiStore((state) => state.toggleMenu);
  const setOpenMenu = useUiStore((state) => state.setOpenMenu);
  const listening = useUiStore((state) => state.listening);
  const toggleDictation = useUiStore((state) => state.toggleDictation);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = (): void => {
    setOpenMenu(null);
    triggerRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const chat = useChatStore.getState();
    const raw = chat.query.trim();
    if (!raw || chat.pending || chat.streaming) {
      return;
    }

    // Asking to open the store, in plain language, opens it.
    if (/^(open |show |go to )?(the )?store$/i.test(raw)) {
      chat.setQuery("");
      goToView("store");
      return;
    }

    // "/sidebar" (or "/dock") flips the Arc-style layout.
    const layoutSlash = raw.match(/^\/(sidebar|rail|dock|full|normal)$/i);
    if (layoutSlash) {
      const keyword = layoutSlash[1].toLowerCase();
      usePreferencesStore
        .getState()
        .setLayout(keyword === "sidebar" || keyword === "rail" ? "sidebar" : "normal");
      chat.setQuery("");
      return;
    }

    // Feature slash commands (/run, /diff, /logs, /agents, …) post a card or open
    // a canvas. Unknown slashes fall through to the chat path.
    const featureSlash = raw.match(/^\/(\w+)\b\s*([\s\S]*)$/);
    if (featureSlash && runSlash(featureSlash[1].toLowerCase(), featureSlash[2].trim())) {
      chat.setQuery("");
      return;
    }

    // Natural-language launch: "ship …" starts a run, the way the mockups read.
    const shipPhrase = raw.match(/^ship\s+(.+)$/i);
    if (shipPhrase) {
      chat.setQuery("");
      launchRun(`Implement · ${shipPhrase[1].trim()}`);
      return;
    }

    // A leading "/askme", "/chat", or "/store" switches the active view; the rest
    // of the line (if any) is sent as the message.
    let text = raw;
    let active: View = useRouteStore.getState().view;
    const slash = raw.match(/^\/(askme|chat|store)\b\s*([\s\S]*)$/i);
    if (slash) {
      const keyword = slash[1].toLowerCase();
      active = keyword === "chat" ? "home" : (keyword as View);
      text = slash[2].trim();
      if (active !== useRouteStore.getState().view) {
        goToView(active);
      }
    }

    chat.setQuery("");
    // The store is a browse view, not a chat target — opening it is enough.
    if (active === "store") {
      return;
    }
    if (!text) {
      return;
    }

    // Ask Me runs the grill-me interview; plain chat starts from no base prompt.
    // Either way, withAgentSystem appends the app-control protocol so the agent
    // can drive the UI (gated by the approval ring) from any view.
    const system = withAgentSystem(active === "askme" ? GRILL_SYSTEM_PROMPT : undefined);
    const notifId =
      active === "askme"
        ? useNotificationsStore.getState().notify({
            title: "Ask Me",
            detail: text.length > 48 ? `${text.slice(0, 48)}…` : text,
            kind: "workflow",
            command: "askme",
          })
        : null;
    void chat.send(text, system).finally(() => {
      if (notifId) {
        useNotificationsStore.getState().update(notifId, { status: "done" });
      }
    });
  };

  const onProjectMenuKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape") {
      closeMenu();
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    );
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = current < 0 ? 0 : (current + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex =
          current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[nextIndex].focus();
  };

  return (
    <form className="composer-card" onSubmit={handleSubmit}>
      <div className="composer-top-row">
        <div className="composer-input">
          <input
            aria-label="Message Smithers"
            autoComplete="off"
            placeholder="Ask Smithers to build…"
            ref={registerInput}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <nav className="top-controls" aria-label="View navigation">
          {/* A surface forces the sidebar layout, so the toggle can't take
              effect there — hide it instead of leaving a dead button. */}
          {surface === null ? (
            <button
              aria-label={
                layout === "sidebar" ? "Exit sidebar layout" : "Switch to sidebar layout"
              }
              aria-pressed={layout === "sidebar"}
              className="nav-button"
              type="button"
              onClick={toggleLayout}
            >
              <PanelLeftIcon />
            </button>
          ) : null}
          <button
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="nav-button"
            type="button"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <CommandMenu />
        </nav>
      </div>

      <div className="composer-toolbar">
        <div className="project-control">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="ghost-pill"
            ref={triggerRef}
            type="button"
            onClick={() => toggleMenu("project")}
          >
            <span>{project}</span>
            <ChevronDownIcon />
          </button>

          {menuOpen ? (
            <>
              <MenuBackdrop />
              <div
                className="project-menu"
                ref={focusCheckedItem}
                role="menu"
                onKeyDown={onProjectMenuKeyDown}
              >
                {PROJECTS.map((name) => (
                  <button
                    aria-checked={name === project}
                    className="project-option"
                    key={name}
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setProject(name);
                      closeMenu();
                    }}
                  >
                    <span>{name}</span>
                    {name === project ? <CheckIcon /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <button
          aria-label={
            DICTATION_SUPPORTED
              ? listening
                ? "Stop dictation"
                : "Start dictation"
              : "Dictation isn't supported in this browser"
          }
          aria-pressed={DICTATION_SUPPORTED ? listening : undefined}
          className={listening ? "mic-button is-listening" : "mic-button"}
          disabled={!DICTATION_SUPPORTED}
          title={
            DICTATION_SUPPORTED ? undefined : "Dictation isn't supported in this browser"
          }
          type="button"
          onClick={toggleDictation}
        >
          <MicIcon />
        </button>
      </div>
    </form>
  );
}
