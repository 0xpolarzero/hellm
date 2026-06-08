import type { CSSProperties } from "react";
import { Outlet } from "@tanstack/react-router";
import { Dock } from "../apps/Dock";
import { AuthStatus } from "../auth/AuthStatus";
import { SignInModal } from "../auth/SignInModal";
import { useChatStore } from "../chat/chatStore";
import { ChatTranscript } from "../chat/ChatTranscript";
import { PanelLeftIcon } from "../icons/PanelLeftIcon";
import { useRailStore } from "../layout/railStore";
import { Toasts } from "../notifications/Toasts";
import { ControlRing } from "../control/ControlRing";
import { ControlRequestDialog } from "../control/ControlRequestDialog";
import { OnboardingGate } from "../onboarding/OnboardingGate";
import { ComposerBar } from "./ComposerBar";
import { CornerLogo } from "./CornerLogo";
import { usePreferencesStore } from "./preferencesStore";
import { useRouteStore } from "./routeStore";
import { useUiStore } from "./uiStore";

/**
 * The application shell and root route. It owns the chrome — toasts, the chat
 * rail or bottom dock, the composer — and renders the active page through
 * <Outlet/>. Cards and surfaces read the engine and chat stores directly; the
 * shell only owns the layout frame.
 */
export function AppShell() {
  const layout = usePreferencesStore((state) => state.layout);
  const toggleLayout = usePreferencesStore((state) => state.toggleLayout);
  const view = useRouteStore((state) => state.view);
  const surface = useRouteStore((state) => state.surface);
  const messagesCount = useChatStore((state) => state.messages.length);
  const navDir = useUiStore((state) => state.navDir);
  const rail = useRailStore();

  // A surface always shows in the sidebar shell, even if the layout preference
  // is "normal" (e.g. a deep link to /runs/...).
  const effectiveLayout = surface ? "sidebar" : layout;
  const isChat =
    messagesCount > 0 ||
    view === "askme" ||
    view === "store" ||
    view === "concierge" ||
    surface !== null;
  const mode =
    effectiveLayout === "sidebar" ? "sidebar" : isChat ? "chat" : "home";
  const showTranscript =
    surface === null &&
    view !== "store" &&
    view !== "concierge" &&
    (messagesCount > 0 || view === "askme");
  const canvasKey = surface ? `${surface.kind}-${"runId" in surface ? surface.runId : ""}` : view;

  if (view === "login") {
    return (
      <main className="app-shell" data-mode="login">
        <Toasts />
        <Outlet />
      </main>
    );
  }

  return (
    <main
      className={rail.resizing ? "app-shell is-resizing" : "app-shell"}
      data-mode={mode}
    >
      <Toasts />
      <AuthStatus />
      <CornerLogo />
      <ControlRing />
      <ControlRequestDialog />
      <SignInModal />
      <OnboardingGate />
      <Dock />

      {effectiveLayout === "sidebar" ? (
        <>
          <aside
            className="chat-rail"
            hidden={rail.collapsed}
            style={{ "--rail-width": `${rail.width}px` } as CSSProperties}
          >
            <header className="rail-head">
              <span className="rail-brand">
                <span className="rail-dot" />
                Smithers
              </span>
              {/* The layout toggle is meaningless while a surface forces the
                  sidebar (see effectiveLayout), so it only shows off a surface. */}
              {surface === null ? (
                <button
                  aria-label="Exit sidebar layout"
                  className="nav-button"
                  type="button"
                  onClick={toggleLayout}
                >
                  <PanelLeftIcon />
                </button>
              ) : null}
            </header>
            <ChatTranscript />
            <div className="composer-dock">
              <ComposerBar />
            </div>
          </aside>
          {/* Always mounted, even while collapsed: if it unmounted mid-drag the
              pointer capture would orphan and the resize gesture would never
              end. When collapsed it tucks behind the reopen tab. */}
          <div
            aria-label="Resize chat panel"
            aria-orientation="vertical"
            className="rail-resizer"
            role="separator"
            onPointerDown={rail.onResizeStart}
            onPointerMove={rail.onResizeMove}
            onPointerUp={rail.onResizeEnd}
            onPointerCancel={rail.onResizeEnd}
          />
          <section className="main-canvas" data-dir={navDir} key={canvasKey}>
            {rail.collapsed ? (
              <button
                aria-label="Show chat panel"
                className="nav-button rail-restore"
                type="button"
                onClick={rail.expand}
              >
                <PanelLeftIcon />
              </button>
            ) : null}
            <Outlet />
          </section>
        </>
      ) : (
        <>
          <div className="view" data-dir={navDir} key={view}>
            <Outlet />
            {showTranscript ? <ChatTranscript /> : null}
          </div>
          <div className="composer-dock">
            <ComposerBar />
          </div>
        </>
      )}
    </main>
  );
}
