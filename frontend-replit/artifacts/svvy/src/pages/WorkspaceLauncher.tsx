import { useLocation } from "wouter";
import { FolderOpen, Clock, Plus, ChevronRight, GitBranch, Settings, Sun, Moon, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/svvy/StatusBadge";
import { useTheme } from "@/hooks/useTheme";
import { mockFolderGroups, mockSessions } from "@/data/mock";

const recentWorkspaces = [
  { path: "~/code/auth-service", branch: "feat/oauth-provider", sessions: 3, lastUsed: "2m ago", status: "running" as const },
  { path: "~/code/payments-api", branch: "main", sessions: 1, lastUsed: "2h ago", status: "idle" as const },
  { path: "~/code/infra-scripts", branch: "refactor/cleanup", sessions: 5, lastUsed: "1d ago", status: "done" as const },
  { path: "~/code/dashboard-v2", branch: "feat/charts", sessions: 2, lastUsed: "3d ago", status: "idle" as const },
];

export default function WorkspaceLauncher() {
  const [, setLocation] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-10 border-b border-border">
        <span className="font-mono text-[12px] text-orange-500 font-semibold tracking-tight">svvy</span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="btn-toggle-theme"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setLocation("/settings/auth")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="btn-settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Hero */}
          <div className="mb-10">
            <h1 className="text-xl font-semibold text-foreground mb-1">Workspaces</h1>
            <p className="text-[13px] text-muted-foreground">Open a local repository to start a session.</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mb-8">
            <button
              className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors font-medium"
              data-testid="btn-open-repo"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open repository
            </button>
            <button
              onClick={() => setLocation("/new")}
              className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded border border-border text-foreground/80 hover:bg-secondary transition-colors"
              data-testid="btn-new-session-launcher"
            >
              <Plus className="w-3.5 h-3.5" />
              New session
            </button>
          </div>

          {/* Recent workspaces */}
          <div>
            <h2 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Recent
            </h2>
            <div className="space-y-1">
              {recentWorkspaces.map((ws, i) => (
                <button
                  key={i}
                  onClick={() => setLocation("/session")}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded border border-transparent hover:border-border hover:bg-card transition-all text-left group"
                  data-testid={`workspace-row-${i}`}
                >
                  <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-foreground truncate">{ws.path}</span>
                      {ws.status === "running" && (
                        <StatusDot status="running" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                        <GitBranch className="w-2 h-2" />
                        {ws.branch}
                      </span>
                      <span className="text-border text-xs">·</span>
                      <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-2 h-2" />
                        {ws.lastUsed}
                      </span>
                      <span className="text-border text-xs">·</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{ws.sessions} sessions</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                </button>
              ))}
            </div>
          </div>

          {/* Recent sessions quick-pick */}
          <div className="mt-10">
            <h2 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Recent Sessions
            </h2>
            <div className="space-y-0.5">
              {mockSessions.slice(0, 3).map(session => (
                <button
                  key={session.id}
                  onClick={() => setLocation("/session")}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-card transition-colors text-left"
                  data-testid={`recent-session-${session.id}`}
                >
                  <StatusDot status={session.status} />
                  <span className="text-[12px] text-foreground/80 flex-1 truncate">{session.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{session.time}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <h2 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Session folders
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {mockFolderGroups.map(group => (
                <button
                  key={group.label}
                  onClick={() => setLocation("/session/multipane")}
                  className="rounded border border-border bg-card px-3 py-2 text-left hover:border-border/70 transition-colors"
                  data-testid={`folder-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-foreground">{group.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{group.sessionIds.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {group.sessionIds
                      .map(id => mockSessions.find(session => session.id === id)?.title)
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(" · ")}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
