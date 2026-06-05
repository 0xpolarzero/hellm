import type { NavItem } from "./navRegistry";

export type NavRowProps = {
  item: NavItem;
  active: boolean;
  onSelect: (id: NavItem["id"]) => void;
};

/**
 * Sidebar nav row. Visual contract (DESIGN.md): 16px icon + 12px label
 * (600 when selected), full-bleed `--radius-row`, `--accent` foreground +
 * `--fill-selected` background when selected, `--fill-hover` on hover.
 *
 * The accessible name is exactly `item.label`, and the testid is
 * `nav.<label>` — the jjhub-parity e2e suite relies on both.
 */
export function NavRow({ item, active, onSelect }: NavRowProps) {
  const badgeCount = item.badge?.() ?? 0;

  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`nav-row${active ? " nav-row--active" : ""}`}
      data-testid={`nav.${item.label}`}
      onClick={() => onSelect(item.id)}
      type="button"
    >
      <span aria-hidden className="nav-row-icon">
        {item.icon}
      </span>
      <span className="nav-row-label">{item.label}</span>
      {badgeCount > 0 ? <span className="nav-row-badge">{badgeCount}</span> : null}
    </button>
  );
}
