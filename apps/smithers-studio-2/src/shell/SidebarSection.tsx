import type { ReactNode } from "react";

export type SidebarSectionProps = {
  title: string;
  /** When true, renders a clickable header that toggles `expanded`. */
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
};

/**
 * A labeled sidebar group. Non-collapsible sections (NAVIGATION) always show
 * their children; collapsible sections (More) render a chevron header and hide
 * children when collapsed — collapse is registry-independent, so hidden items
 * are still in the DOM (reachable by name) but visually folded away.
 */
export function SidebarSection({ title, collapsible, expanded, onToggle, children }: SidebarSectionProps) {
  const open = collapsible ? expanded ?? false : true;

  return (
    <div className="sidebar-section">
      {collapsible ? (
        <button className="sidebar-section-header sidebar-section-header--toggle" onClick={onToggle} type="button">
          <span className="sidebar-section-chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="sidebar-section-title">{title}</span>
        </button>
      ) : (
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">{title}</span>
        </div>
      )}
      {open ? <div className="sidebar-section-rows">{children}</div> : null}
    </div>
  );
}
