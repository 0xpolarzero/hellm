import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { goToView } from "../app/navigation";
import { useUiStore } from "../app/uiStore";
import { MenuBackdrop } from "../components/MenuBackdrop";
import { useNotificationsStore, type Notification } from "./notificationsStore";

/** Focus the first action when the toast menu opens. */
function focusFirst(menu: HTMLDivElement | null): void {
  if (!menu) {
    return;
  }
  menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
}

function Toast({ notification }: { notification: Notification }) {
  const menuId = `toast-${notification.id}`;
  const open = useUiStore((state) => state.openMenuId === menuId);
  const toggleMenu = useUiStore((state) => state.toggleMenu);
  const setOpenMenu = useUiStore((state) => state.setOpenMenu);
  const dismiss = useNotificationsStore((state) => state.dismiss);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const running = notification.status === "running";

  // Close the actions menu and return focus to the trigger, per the APG pattern.
  const close = (): void => {
    setOpenMenu(null);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      close();
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
        nextIndex = (current + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex = (current - 1 + items.length) % items.length;
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
    <div className={`toast toast-${notification.status}`}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="toast-main"
        ref={triggerRef}
        type="button"
        onClick={() => toggleMenu(menuId)}
      >
        {running ? (
          <span className="toast-spinner" aria-hidden="true" />
        ) : (
          <svg
            aria-hidden="true"
            className="toast-check"
            fill="none"
            style={{ color: "var(--success)" }}
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path
              d="m8 12 3 3 5-6"
              stroke="var(--surface)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        )}
        <span className="toast-text">
          <span className="toast-title">{notification.title}</span>
          {notification.detail ? (
            <span className="toast-detail" key={notification.detail}>
              {notification.detail}
            </span>
          ) : null}
        </span>
        <span className="toast-status">{running ? "Running" : "Done"}</span>
      </button>

      {open ? (
        <>
          <MenuBackdrop />
          <div
            className="toast-menu"
            ref={focusFirst}
            role="menu"
            onKeyDown={onMenuKeyDown}
          >
            {notification.command ? (
              <button
                className="toast-action"
                role="menuitem"
                type="button"
                onClick={() => {
                  goToView(
                    notification.command === "chat"
                      ? "home"
                      : (notification.command ?? "askme"),
                  );
                  close();
                }}
              >
                View workflow
              </button>
            ) : null}
            <button
              className="toast-action"
              role="menuitem"
              type="button"
              onClick={() => {
                dismiss(notification.id);
                close();
              }}
            >
              Dismiss
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Corner stack of toasts for background/workflow runs. */
export function Toasts() {
  const notifications = useNotificationsStore((state) => state.notifications);
  if (notifications.length === 0) {
    return null;
  }
  return (
    <div className="toast-stack" aria-live="polite">
      {notifications.map((notification) => (
        <Toast key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
