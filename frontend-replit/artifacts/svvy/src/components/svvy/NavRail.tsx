import { useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, ChevronRight, Plus, Zap, Settings, Sun, Moon,
  GitBranch, Layers, Clock, ChevronDown, ChevronRight as ChevronRightIcon,
  Workflow, BookOpen, User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionRow } from "./SessionRow";
import { useTheme } from "@/hooks/useTheme";
import { mockFolderGroups, mockPaneSurfaces, mockSessions, mockWorkspace } from "@/data/mock";

interface NavRailProps {
  collapsed?: boolean;
  onToggle?: () => void;
  activeSessionId?: string;
}

export function NavRail({ collapsed = false, onToggle, activeSessionId = "s1" }: NavRailProps) {
  const [, setLocation] = useLocation();
  const { theme, toggle } = useTheme();
  const [expandedSections, setExpandedSections] = useState({
    active: true,
    recent: true,
    archived: false,
    workflows: false,
    episodes: false,
  });

  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const activeSessions = mockSessions.filter(s => s.status === "running" || s.status === "waiting");
  const recentSessions = mockSessions.filter(s => s.status === "done" || s.status === "failed");
  const archivedSessions = mockSessions.filter(s => s.status === "idle");

  const getSessionPath = (id: string) => {
    if (id === "s1") return "/session/active";
    if (id === "s3") return "/session/waiting";
    if (id === "s4") return "/session/failed";
    return "/session";
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200 flex-shrink-0",
        collapsed ? "w-12" : "w-60"
      )}
      data-testid="nav-rail"
    >
      {/* Workspace header */}
      <div className={cn(
        "border-b border-sidebar-border flex-shrink-0",
        collapsed ? "px-2 py-2" : "px-3 py-2.5"
      )}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onToggle}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              data-testid="nav-rail-expand"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[9px] text-orange-500 font-semibold">sv</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] text-orange-500 font-semibold tracking-tight">svvy</span>
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] text-sidebar-foreground font-medium truncate">{mockWorkspace.displayName}</span>
                <span className="font-mono text-[9px] text-muted-foreground border border-border rounded px-1 flex items-center gap-0.5 flex-shrink-0">
                  <GitBranch className="w-2 h-2" />
                  {mockWorkspace.branch.split("/").pop()}
                </span>
              </div>
            </div>
            <button
              onClick={onToggle}
              className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors flex-shrink-0"
              data-testid="nav-rail-collapse"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!collapsed && (
        <div className="px-3 py-2 flex flex-col gap-1 border-b border-sidebar-border flex-shrink-0">
          <button
            onClick={() => setLocation("/new")}
            className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors font-medium"
            data-testid="btn-new-session"
          >
            <Plus className="w-3 h-3" />
            New session
          </button>
          <button
            onClick={() => setLocation("/new")}
            className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            data-testid="btn-new-quick-session"
          >
            <Zap className="w-3 h-3" />
            Quick session
          </button>
        </div>
      )}

      {collapsed && (
        <div className="px-2 py-2 flex flex-col items-center gap-1 border-b border-sidebar-border flex-shrink-0">
          <button
            onClick={() => setLocation("/new")}
            className="w-8 h-8 flex items-center justify-center rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors"
            title="New session"
            data-testid="btn-new-session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setLocation("/new")}
            className="w-8 h-8 flex items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            title="Quick session"
            data-testid="btn-new-quick-session"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {!collapsed && (
          <div className="px-3 pb-2">
            <div className="text-[9px] font-mono font-semibold tracking-wider uppercase text-sidebar-foreground/40 mb-1.5">
              Folders
            </div>
            <div className="space-y-1">
              {mockFolderGroups.map(group => (
                <div key={group.label} className="rounded border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-sidebar-foreground/80">{group.label}</span>
                    <span className="font-mono text-[9px] text-sidebar-foreground/40">{group.sessionIds.length}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {group.sessionIds.map(sessionId => {
                      const session = mockSessions.find(s => s.id === sessionId);
                      if (!session) return null;
                      return (
                        <button
                          key={sessionId}
                          onClick={() => setLocation(getSessionPath(sessionId))}
                          className="font-mono text-[9px] rounded border border-sidebar-border px-1.5 py-0.5 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        >
                          {session.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active */}
        <SectionHeader
          label="ACTIVE"
          count={activeSessions.length}
          expanded={expandedSections.active}
          onToggle={() => toggleSection("active")}
          collapsed={collapsed}
        />
        {expandedSections.active && activeSessions.map(session => (
          <div key={session.id} className={collapsed ? "px-2" : "px-1"}>
            <SessionRow
              session={session}
              isActive={session.id === activeSessionId}
              collapsed={collapsed}
              onClick={() => setLocation(getSessionPath(session.id))}
            />
          </div>
        ))}

        {/* Recent */}
        <SectionHeader
          label="RECENT"
          count={recentSessions.length}
          expanded={expandedSections.recent}
          onToggle={() => toggleSection("recent")}
          collapsed={collapsed}
        />
        {expandedSections.recent && recentSessions.map(session => (
          <div key={session.id} className={collapsed ? "px-2" : "px-1"}>
            <SessionRow
              session={session}
              isActive={session.id === activeSessionId}
              collapsed={collapsed}
              onClick={() => setLocation("/session")}
            />
          </div>
        ))}

        {/* Archived */}
        <SectionHeader
          label="ARCHIVED"
          count={archivedSessions.length}
          expanded={expandedSections.archived}
          onToggle={() => toggleSection("archived")}
          collapsed={collapsed}
        />
        {expandedSections.archived && archivedSessions.map(session => (
          <div key={session.id} className={collapsed ? "px-2" : "px-1"}>
            <SessionRow
              session={session}
              isActive={session.id === activeSessionId}
              collapsed={collapsed}
              onClick={() => setLocation("/session")}
            />
          </div>
        ))}

        {/* Workflows */}
        {!collapsed && (
          <>
            <SectionHeader
              label="WORKFLOWS"
              count={2}
              expanded={expandedSections.workflows}
              onToggle={() => toggleSection("workflows")}
              collapsed={false}
            />
            {expandedSections.workflows && (
              <div className="px-1">
                <button
                  onClick={() => setLocation("/workflow")}
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-sidebar-accent/60 transition-colors"
                  data-testid="workflow-row-auth-refactor"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-sidebar-foreground/80 font-mono truncate">auth-refactor-ci</span>
                    <span className="text-[9px] font-mono text-orange-400 border border-orange-500/20 bg-orange-500/10 rounded px-1">3/8</span>
                  </div>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-sidebar-accent/60 transition-colors"
                  data-testid="workflow-row-ci-pipeline"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-sidebar-foreground/80 font-mono truncate">ci-node18-fix</span>
                    <span className="text-[9px] font-mono text-red-400 border border-red-500/20 bg-red-500/10 rounded px-1">fail</span>
                  </div>
                </button>
              </div>
            )}
          </>
        )}

        {/* Episodes */}
        {!collapsed && (
          <>
            <SectionHeader
              label="EPISODES"
              count={3}
              expanded={expandedSections.episodes}
              onToggle={() => toggleSection("episodes")}
              collapsed={false}
            />
            {expandedSections.episodes && (
              <div className="px-1">
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-sidebar-accent/60 transition-colors"
                  data-testid="episode-row-auth"
                >
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-[11px] text-sidebar-foreground/80 truncate">Auth middleware complete</span>
                  </div>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-sidebar-accent/60 transition-colors"
                  data-testid="episode-row-rate-limit"
                >
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-[11px] text-sidebar-foreground/80 truncate">Rate limit fix verified</span>
                  </div>
                </button>
              </div>
            )}
          </>
        )}

        {!collapsed && (
          <>
            <SectionHeader
              label="OPEN SURFACES"
              count={mockPaneSurfaces.length}
              expanded={true}
              onToggle={() => {}}
              collapsed={false}
              staticSection={true}
            />
            <div className="px-1">
              {mockPaneSurfaces.map(surface => (
                <button
                  key={surface.id}
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-sidebar-accent/60 transition-colors"
                  data-testid={`surface-row-${surface.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-sidebar-foreground/80 truncate">{surface.label}</span>
                    <span className="font-mono text-[9px] text-sidebar-foreground/40 truncate">{surface.positions.join(" ")}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className={cn(
        "border-t border-sidebar-border flex-shrink-0",
        collapsed ? "px-2 py-2 flex flex-col items-center gap-2" : "px-3 py-2 flex items-center justify-between"
      )}>
        {collapsed ? (
          <>
            <button
              onClick={() => setLocation("/settings/auth")}
              className="w-8 h-8 flex items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              title="Settings"
              data-testid="btn-settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggle}
              className="w-8 h-8 flex items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              title="Toggle theme"
              data-testid="btn-toggle-theme"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-5 h-5 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
                <User className="w-2.5 h-2.5 text-muted-foreground" />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground truncate">{mockWorkspace.path}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggle}
                className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
                title="Toggle theme"
                data-testid="btn-toggle-theme"
              >
                {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setLocation("/settings/auth")}
                className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
                title="Settings"
                data-testid="btn-settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label, count, expanded, onToggle, collapsed, staticSection = false
}: {
  label: string; count: number; expanded: boolean; onToggle: () => void; collapsed: boolean; staticSection?: boolean;
}) {
  if (collapsed) return null;
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center justify-between px-3 py-1 mt-1 text-sidebar-foreground/40 transition-colors",
        staticSection ? "cursor-default" : "hover:text-sidebar-foreground/70"
      )}
      data-testid={`section-${label.toLowerCase()}`}
    >
      <div className="flex items-center gap-1">
        {!staticSection && (expanded ? (
          <ChevronDown className="w-2.5 h-2.5" />
        ) : (
          <ChevronRightIcon className="w-2.5 h-2.5" />
        ))}
        <span className="text-[9px] font-mono font-semibold tracking-wider uppercase">{label}</span>
      </div>
      {count > 0 && (
        <span className="font-mono text-[9px] text-sidebar-foreground/30">{count}</span>
      )}
    </button>
  );
}
