/**
 * Mirror of the dark token system defined in `src/theme.css`.
 *
 * Components read `var(--token)` in CSS; this object exists for the rare cases
 * where a token value is needed in TypeScript (e.g. canvas/terminal theming,
 * inline SVG fills). It is the single source of truth in TS — no other file in
 * `src/theme/` exports values. Never inline a raw hex value elsewhere.
 */
export const themeTokens = {
  color: {
    bg: "#0C0E16",
    surface1: "#141826",
    surface2: "#1A2030",
    textPrimary: "rgba(255, 255, 255, 0.88)",
    textSecondary: "rgba(255, 255, 255, 0.60)",
    textTertiary: "rgba(255, 255, 255, 0.45)",
    border: "rgba(255, 255, 255, 0.08)",
    fillHover: "rgba(255, 255, 255, 0.04)",
    fillSelected: "rgba(76, 141, 255, 0.12)",
    accent: "#4C8DFF",
    success: "#34D399",
    warning: "#FBBF24",
    danger: "#F87171",
    info: "#60A5FA",
    accentFill: "rgba(76, 141, 255, 0.12)",
    accentFillStrong: "rgba(76, 141, 255, 0.22)",
    accentStroke: "rgba(76, 141, 255, 0.35)",
  },
  radius: {
    card: "8px",
    pill: "4px",
    row: "0",
  },
  space: {
    1: "4px",
    2: "6px",
    3: "8px",
    4: "12px",
    5: "14px",
    6: "16px",
    7: "24px",
    8: "32px",
    9: "40px",
    10: "48px",
  },
  font: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  motion: {
    fast: "120ms",
    base: "150ms",
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
} as const;
