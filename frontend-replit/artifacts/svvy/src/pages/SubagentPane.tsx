import { AppShell } from "@/components/svvy/AppShell";
import { StatusBadge } from "@/components/svvy/StatusBadge";
import { ModelBadge } from "@/components/svvy/ModelBadge";
import { Search, Clock, GitBranch, FileText, File } from "lucide-react";

const liveOutput = `Exploring codebase for existing auth patterns...

Reading src/middleware/auth.ts... found verifyToken utility
Reading src/utils/jwt.ts... found JWT configuration
Reading src/types/index.ts... found User interface

Searching for OAuth-related imports across 47 files...
  Found 3 references to passport in package.json (unused)
  Found existing session middleware in src/middleware/session.ts

Analyzing Express route structure...
  src/routes/auth.ts: /login, /logout, /me endpoints exist
  No OAuth callback routes found

Checking test coverage...
  tests/middleware/: 2 test files, 89% coverage
  No OAuth-specific tests found

Summary: Clean integration point at src/middleware/auth.ts
Recommended: extend verifyToken to support Bearer + OAuth tokens
No conflicts with existing session middleware`;

const filesRead = [
  "src/middleware/auth.ts",
  "src/utils/jwt.ts",
  "src/types/index.ts",
  "src/middleware/session.ts",
  "src/routes/auth.ts",
  "tests/middleware/auth.test.ts",
];

export default function SubagentPane() {
  return (
    <AppShell
      title="OAuth Provider Integration"
      sessionStatus="running"
      worktree="feat/oauth-provider"
      budgetPercent={71}
      isStreaming={true}
    >
      <div className="flex flex-col h-full" data-testid="subagent-pane">
        {/* Subagent header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="w-7 h-7 rounded bg-blue-500/15 flex items-center justify-center">
            <Search className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-blue-400">explorer</span>
              <StatusBadge status="running" size="xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">Exploring auth patterns for OAuth integration</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ModelBadge model="haiku" size="xs" />
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              0m 34s
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">1.2k tokens</span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              feat/oauth-provider
            </span>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Live output */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Live output</div>
            <pre className="font-mono text-[11px] text-foreground/80 leading-[1.7] whitespace-pre-wrap">
              {liveOutput}<span className="stream-cursor" />
            </pre>
          </div>

          {/* File operations sidebar */}
          <div className="w-48 flex-shrink-0 border-l border-border overflow-y-auto scrollbar-thin py-3 px-3">
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Files read</div>
            <div className="space-y-1">
              {filesRead.map(f => (
                <div key={f} className="flex items-center gap-1.5" data-testid={`file-read-${f}`}>
                  <FileText className="w-2.5 h-2.5 text-muted-foreground/60 flex-shrink-0" />
                  <span className="font-mono text-[9px] text-muted-foreground truncate">{f.split("/").pop()}</span>
                </div>
              ))}
            </div>

            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-4 mb-2">Files written</div>
            <div className="text-[9px] text-muted-foreground/50 italic">None yet</div>
          </div>
        </div>

        {/* Action bar */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <button
            className="text-[11px] px-3 py-1.5 rounded border border-border text-foreground/70 hover:bg-secondary transition-colors"
            data-testid="btn-interrupt-agent"
          >
            Interrupt
          </button>
          <button
            className="text-[11px] px-3 py-1.5 rounded border border-border text-foreground/70 hover:bg-secondary transition-colors"
            data-testid="btn-expand-context"
          >
            Expand context
          </button>
        </div>
      </div>
    </AppShell>
  );
}
