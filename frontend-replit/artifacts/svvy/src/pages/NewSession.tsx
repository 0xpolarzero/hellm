import { useLocation } from "wouter";
import { Bot, Zap, RotateCcw, ChevronRight, ArrowUp } from "lucide-react";
import { AppShell } from "@/components/svvy/AppShell";
import { StatusDot } from "@/components/svvy/StatusBadge";
import { mockSessions } from "@/data/mock";
import { useState } from "react";

export default function NewSession() {
  const [, setLocation] = useLocation();
  const [prompt, setPrompt] = useState("");

  const recentSessions = mockSessions.slice(0, 3);

  return (
    <AppShell
      title="New Session"
      sessionStatus="idle"
      worktree="feat/oauth-provider"
      budgetPercent={0}
      isStreaming={false}
      activeSessionId=""
    >
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 min-h-[400px]">
        {/* Logo mark */}
        <div className="mb-8 opacity-20">
          <span className="font-mono text-3xl font-bold text-foreground tracking-tight">svvy</span>
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-1">Start orchestrating</h2>
        <p className="text-[13px] text-muted-foreground mb-8">
          Choose a session type or resume a recent session.
        </p>

        {/* Entry point cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-xl mb-10">
          <button
            onClick={() => setLocation("/session/active")}
            className="flex flex-col items-start gap-2 p-4 rounded border border-border bg-card hover:border-orange-500/40 hover:bg-card transition-all text-left group"
            data-testid="btn-new-orchestrator"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-orange-500/15 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-orange-400" />
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground ml-auto" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-foreground mb-0.5">
                Orchestrator session
              </div>
              <div className="text-[11px] text-muted-foreground">Full power, all agents</div>
            </div>
          </button>

          <button
            onClick={() => setLocation("/session")}
            className="flex flex-col items-start gap-2 p-4 rounded border border-border bg-card hover:border-border/70 hover:bg-card transition-all text-left group"
            data-testid="btn-new-quick"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-yellow-500/15 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground ml-auto" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-foreground mb-0.5">Quick session</div>
              <div className="text-[11px] text-muted-foreground">Single-turn, no subagents</div>
            </div>
          </button>

          <button
            className="flex flex-col items-start gap-2 p-4 rounded border border-border bg-card hover:border-border/70 hover:bg-card transition-all text-left group"
            data-testid="btn-resume-session"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-slate-500/15 flex items-center justify-center">
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground ml-auto" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-foreground mb-0.5">Resume session</div>
              <div className="text-[11px] text-muted-foreground">Pick up where you left off</div>
            </div>
          </button>
        </div>

        <div className="w-full max-w-xl mb-8 rounded border border-border bg-card px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-foreground">Session mode preview</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              orchestrator vs quick
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-orange-500/20 bg-orange-500/5 px-2.5 py-2">
              <div className="text-[11px] text-foreground mb-1">Orchestrator</div>
              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Direct, delegated, verification, and pause paths with per-agent runtime profiles.
              </div>
            </div>
            <div className="rounded border border-border px-2.5 py-2">
              <div className="text-[11px] text-foreground mb-1">Quick</div>
              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Single surface, smaller context budget, faster answer path with fewer delegated
                actions.
              </div>
            </div>
          </div>
        </div>

        {/* Quick prompt */}
        <div className="w-full max-w-xl mb-8">
          <div className="flex items-center gap-2 border border-border rounded bg-card px-3 py-2.5 focus-within:border-ring transition-colors">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want to accomplish..."
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none"
              data-testid="new-session-prompt"
              onKeyDown={(e) => {
                if (e.key === "Enter" && prompt.trim()) {
                  setLocation("/session/active");
                }
              }}
            />
            <button
              disabled={!prompt.trim()}
              onClick={() => prompt.trim() && setLocation("/session/active")}
              className="w-7 h-7 flex items-center justify-center rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="btn-start-session"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Recent sessions */}
        <div className="w-full max-w-xl">
          <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Recent
          </h3>
          <div className="space-y-0.5">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setLocation("/session")}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-card transition-colors text-left"
                data-testid={`recent-row-${session.id}`}
              >
                <StatusDot status={session.status} />
                <span className="text-[12px] text-foreground/80 flex-1 truncate">
                  {session.title}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{session.time}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
