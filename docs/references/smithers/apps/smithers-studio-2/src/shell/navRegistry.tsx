import type { ReactNode } from "react";
import type { ViewId } from "../useStudioStore";
import { Home } from "../home/Home";
import { Runs } from "../runs/Runs";
import { runsApprovalsBadge } from "../runs/runsBadgeStore";
import { Workspace } from "../workspace/Workspace";
import { Workflows } from "../workflows/Workflows";
import { IssuesPanel } from "../issues/IssuesPanel";
import { LandingsPanel } from "../landings/LandingsPanel";
import { WorkspacesPanel } from "../workspaces/WorkspacesPanel";
import { Memory } from "../memory/Memory";
import { Scores } from "../scores/Scores";
import { Search } from "../search/Search";
import { DevTools } from "../developer/DevTools";
import { SqlBrowser } from "../developer/SqlBrowser";
import { Logs } from "../developer/Logs";

export type NavTier = "primary" | "more" | "developer";

/**
 * A single registered surface. `render` returns the surface component — this is
 * the ONLY place a surface is wired into the shell. Phase-2 surface agents add
 * exactly ONE entry here and create their own folder; they never edit AppShell
 * or Sidebar.
 */
export type NavItem = {
  id: ViewId;
  label: string;
  tier: NavTier;
  icon: string;
  render: () => ReactNode;
  badge?: () => number;
};

export type NavRegistryFlags = {
  developerMode: boolean;
  remote: boolean;
};

/**
 * Builds the nav registry from feature flags. Gating is at the REGISTRY level
 * (conditional construction), never CSS display:none — a surface that is not in
 * the returned array is unreachable by sidebar, palette, and deep-link. When
 * developerMode is false the registry is byte-for-byte identical to non-dev.
 */
export function buildNavRegistry(flags: NavRegistryFlags): NavItem[] {
  const items: NavItem[] = [
    { id: "home", label: "Home", tier: "primary", icon: "\u{1F528}", render: () => <Home /> },
    { id: "runs", label: "Runs", tier: "primary", icon: "▶", badge: runsApprovalsBadge, render: () => <Runs /> },
    { id: "workspace", label: "Workspace", tier: "primary", icon: "⌨", render: () => <Workspace /> },
    { id: "workflows", label: "Workflows", tier: "primary", icon: "⚙", render: () => <Workflows /> },

    { id: "issues", label: "Issues", tier: "more", icon: "○", render: () => <IssuesPanel /> },
    { id: "landings", label: "Landings", tier: "more", icon: "⤓", render: () => <LandingsPanel /> },
    { id: "workspaces", label: "Workspaces", tier: "more", icon: "☁", render: () => <WorkspacesPanel /> },
    { id: "memory", label: "Memory", tier: "more", icon: "◈", render: () => <Memory /> },
    { id: "scores", label: "Scores", tier: "more", icon: "★", render: () => <Scores /> },
    { id: "search", label: "Search", tier: "more", icon: "⌕", render: () => <Search /> },
  ];

  if (flags.developerMode) {
    items.push(
      { id: "devtools", label: "DevTools", tier: "developer", icon: "⚒", render: () => <DevTools /> },
      { id: "sql", label: "SQL Browser", tier: "developer", icon: "▦", render: () => <SqlBrowser /> },
      { id: "logs", label: "Logs", tier: "developer", icon: "≡", render: () => <Logs /> },
    );
  }

  return items;
}
